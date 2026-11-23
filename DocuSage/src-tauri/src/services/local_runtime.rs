//! On-demand `llama-server` local runtime sidecar manager.
//!
//! Keeps the DocuSage desktop installer strictly under 10 MB by never bundling
//! `llama-server` or ML runtimes inside the installer. When the user enables
//! Built-in Local AI, this service downloads the matching official `llama.cpp`
//! release binary (auto-detecting OS/arch + CPU/Vulkan/CUDA/Metal), verifies its
//! SHA256 digest when published, and manages `llama-server` on `127.0.0.1:<free_port>`.

use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const LLAMA_CPP_RELEASES_LATEST_API: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";
const LLAMA_CPP_RELEASES_LIST_API: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15";
const LLAMA_CPP_RELEASE_BY_TAG_PREFIX: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedReleaseAsset {
    pub tag: String,
    pub asset_name: String,
    pub download_url: String,
    pub sha256: Option<String>,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntimeStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub running: bool,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub loaded_model: Option<String>,
    pub loaded_model_path: Option<String>,
    pub embedding_running: bool,
    pub embedding_port: Option<u16>,
    pub embedding_model: Option<String>,
    pub detected_backend: String,
    pub platform_summary: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDownloadProgress {
    pub stage: String,
    pub asset_name: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f32,
    pub done: bool,
    pub error: Option<String>,
}

struct RunningServer {
    child: Child,
    port: u16,
    model_path: PathBuf,
    model_name: String,
}

#[derive(Default)]
struct RuntimeInner {
    chat: Option<RunningServer>,
    embedding: Option<RunningServer>,
}

#[derive(Clone, Default)]
pub struct LocalRuntimeManager {
    inner: Arc<Mutex<RuntimeInner>>,
}

impl Drop for LocalRuntimeManager {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.inner.try_lock() {
            if let Some(mut s) = guard.chat.take() {
                let _ = s.child.start_kill();
            }
            if let Some(mut s) = guard.embedding.take() {
                let _ = s.child.start_kill();
            }
        }
    }
}

pub fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().app_data_dir() {
        return Ok(dir.join("runtime"));
    }
    dirs::data_local_dir()
        .map(|d| d.join("DocuSage").join("runtime"))
        .ok_or_else(|| "Cannot resolve local runtime directory.".to_string())
}

pub fn llama_server_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

/// Locate an installed `llama-server` binary inside `runtime_dir` (searching recursively up to depth 4).
pub fn find_installed_binary(dir: &Path) -> Option<PathBuf> {
    fn search(dir: &Path, exe_name: &str, depth: usize) -> Option<PathBuf> {
        let direct = dir.join(exe_name);
        if direct.is_file() {
            return Some(direct);
        }
        if depth == 0 {
            return None;
        }
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(found) = search(&p, exe_name, depth - 1) {
                    return Some(found);
                }
            }
        }
        None
    }
    search(dir, llama_server_executable_name(), 4)
}

/// Detect the best zero-dependency local inference acceleration backend available on this machine.
/// On Windows, Vulkan works across NVIDIA/AMD/Intel drivers without separate CUDA Toolkit DLLs;
/// CPU works universally as fallback.
pub fn detect_hardware_backend() -> String {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            return "metal".to_string();
        }
        return "cpu".to_string();
    }

    // Check for Vulkan runtime library on Windows / Linux first (works on NVIDIA, AMD, and Intel
    // GPUs without requiring separate cudart DLL packages).
    #[cfg(target_os = "windows")]
    {
        if Path::new(r"C:\Windows\System32\vulkan-1.dll").exists() {
            return "vulkan".to_string();
        }
    }
    #[cfg(target_os = "linux")]
    {
        if Path::new("/usr/lib/x86_64-linux-gnu/libvulkan.so.1").exists()
            || Path::new("/usr/lib/libvulkan.so.1").exists()
        {
            return "vulkan".to_string();
        }
    }

    "cpu".to_string()
}

pub fn platform_summary() -> String {
    format!(
        "{}-{} ({})",
        std::env::consts::OS,
        std::env::consts::ARCH,
        detect_hardware_backend()
    )
}

struct AssetMatchPattern {
    backend: &'static str,
    required: &'static [&'static str],
    forbidden: &'static [&'static str],
}

/// Select the best matching official `llama.cpp` GitHub release asset for this platform.
/// Returns `(asset_name, download_url, expected_sha256, resolved_backend)`.
///
/// For GPU backends (such as Windows x64 `vulkan`), automatically falls back to a compatible
/// CPU build when a GPU archive is unavailable in the release.
pub fn select_release_asset(
    assets: &[serde_json::Value],
    os: &str,
    arch: &str,
    backend: &str,
) -> Option<(String, String, Option<String>, String)> {
    let candidates: Vec<(&str, &str, Option<&str>)> = assets
        .iter()
        .filter_map(|a| {
            let name = a["name"].as_str()?;
            let url = a["browser_download_url"].as_str()?;
            let digest = a["digest"]
                .as_str()
                .and_then(|d| d.strip_prefix("sha256:"))
                .map(|s| s.trim());
            Some((name, url, digest))
        })
        .collect();

    const WIN_X64_VULKAN: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "vulkan",
            required: &["bin-win-vulkan-x64", ".zip"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "vulkan",
            required: &["bin-win-vulkan", "x64", ".zip"],
            forbidden: &["arm64"],
        },
        AssetMatchPattern {
            backend: "vulkan",
            required: &["bin-win-vulkan", "x64", ".tar.gz"],
            forbidden: &["arm64"],
        },
    ];
    const WIN_X64_CPU: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-cpu-x64", ".zip"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-cpu", "x64", ".zip"],
            forbidden: &["arm64"],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-avx2-x64", ".zip"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-avx-x64", ".zip"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-noavx-x64", ".zip"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-openblas", "x64", ".zip"],
            forbidden: &["arm64"],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-x64", ".zip"],
            forbidden: &["cuda", "rocm", "sycl", "openvino", "opencl", "vulkan"],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-cpu", "x64", ".tar.gz"],
            forbidden: &["arm64"],
        },
    ];
    const WIN_X64_CUDA: &[AssetMatchPattern] = &[AssetMatchPattern {
        backend: "cuda",
        required: &["bin-win-cuda", "x64", ".zip"],
        forbidden: &["arm64"],
    }];

    const WIN_ARM64_VULKAN: &[AssetMatchPattern] = &[AssetMatchPattern {
        backend: "vulkan",
        required: &["bin-win-vulkan-arm64", ".zip"],
        forbidden: &[],
    }];
    const WIN_ARM64_CPU: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-cpu-arm64", ".zip"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-win-arm64", ".zip"],
            forbidden: &["cuda", "opencl", "vulkan"],
        },
    ];

    const MACOS_ARM64: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "metal",
            required: &["bin-macos-arm64", ".tar.gz"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "metal",
            required: &["bin-macos-arm64", ".zip"],
            forbidden: &[],
        },
    ];
    const MACOS_X64: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-macos-x64", ".tar.gz"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-macos-x64", ".zip"],
            forbidden: &[],
        },
    ];

    const LINUX_X64_VULKAN: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "vulkan",
            required: &["bin-ubuntu-vulkan-x64", ".tar.gz"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "vulkan",
            required: &["bin-ubuntu-vulkan-x64", ".zip"],
            forbidden: &[],
        },
    ];
    const LINUX_X64_CPU: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-ubuntu-x64", ".tar.gz"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-ubuntu-x64", ".zip"],
            forbidden: &[],
        },
    ];
    const LINUX_ARM64_VULKAN: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "vulkan",
            required: &["bin-ubuntu-vulkan-arm64", ".tar.gz"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "vulkan",
            required: &["bin-ubuntu-vulkan-arm64", ".zip"],
            forbidden: &[],
        },
    ];
    const LINUX_ARM64_CPU: &[AssetMatchPattern] = &[
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-ubuntu-arm64", ".tar.gz"],
            forbidden: &[],
        },
        AssetMatchPattern {
            backend: "cpu",
            required: &["bin-ubuntu-arm64", ".zip"],
            forbidden: &[],
        },
    ];

    let mut groups: Vec<&[AssetMatchPattern]> = Vec::new();
    match (os, arch) {
        ("windows", "x86_64") => match backend {
            "cuda" => {
                groups.push(WIN_X64_CUDA);
                groups.push(WIN_X64_VULKAN);
                groups.push(WIN_X64_CPU);
            }
            "vulkan" => {
                groups.push(WIN_X64_VULKAN);
                groups.push(WIN_X64_CPU);
            }
            _ => {
                groups.push(WIN_X64_CPU);
                groups.push(WIN_X64_VULKAN);
            }
        },
        ("windows", "aarch64") => match backend {
            "vulkan" => {
                groups.push(WIN_ARM64_VULKAN);
                groups.push(WIN_ARM64_CPU);
            }
            _ => {
                groups.push(WIN_ARM64_CPU);
                groups.push(WIN_ARM64_VULKAN);
            }
        },
        ("macos", "aarch64") => groups.push(MACOS_ARM64),
        ("macos", "x86_64") => groups.push(MACOS_X64),
        ("linux", "x86_64") => match backend {
            "vulkan" => {
                groups.push(LINUX_X64_VULKAN);
                groups.push(LINUX_X64_CPU);
            }
            _ => {
                groups.push(LINUX_X64_CPU);
                groups.push(LINUX_X64_VULKAN);
            }
        },
        ("linux", "aarch64") => match backend {
            "vulkan" => {
                groups.push(LINUX_ARM64_VULKAN);
                groups.push(LINUX_ARM64_CPU);
            }
            _ => {
                groups.push(LINUX_ARM64_CPU);
                groups.push(LINUX_ARM64_VULKAN);
            }
        },
        _ => {}
    }

    for group in groups {
        for pattern in group {
            if let Some((name, url, digest)) = candidates.iter().find(|(name, _, _)| {
                let lower = name.to_ascii_lowercase();
                !lower.contains("cudart")
                    && !lower.contains("-ui.")
                    && !lower.ends_with(".sha256")
                    && !lower.ends_with(".txt")
                    && !lower.ends_with(".sig")
                    && !lower.ends_with(".asc")
                    && pattern.required.iter().all(|needle| lower.contains(needle))
                    && pattern
                        .forbidden
                        .iter()
                        .all(|blocked| !lower.contains(blocked))
            }) {
                return Some((
                    (*name).to_string(),
                    (*url).to_string(),
                    digest.map(ToString::to_string),
                    pattern.backend.to_string(),
                ));
            }
        }
    }
    None
}

/// Inspect a single GitHub Release JSON object and extract a matching prebuilt runtime archive.
pub fn select_release_asset_from_release(
    release: &serde_json::Value,
    os: &str,
    arch: &str,
    backend: &str,
) -> Option<ResolvedReleaseAsset> {
    if release["draft"].as_bool().unwrap_or(false) {
        return None;
    }
    let assets = release["assets"].as_array()?;
    let tag = release["tag_name"].as_str().unwrap_or("latest").to_string();
    let (asset_name, download_url, sha256, resolved_backend) =
        select_release_asset(assets, os, arch, backend)?;
    Some(ResolvedReleaseAsset {
        tag,
        asset_name,
        download_url,
        sha256,
        backend: resolved_backend,
    })
}

/// Check if a release (such as `llama.cpp` `v1.0.0`) publishes a `nightly-tag.txt` pointer
/// referencing the matching binary build tag (e.g. `b12359`).
pub fn find_nightly_tag_url(release: &serde_json::Value) -> Option<String> {
    let assets = release["assets"].as_array()?;
    assets.iter().find_map(|a| {
        let name = a["name"].as_str()?;
        if name.eq_ignore_ascii_case("nightly-tag.txt") {
            a["browser_download_url"].as_str().map(ToString::to_string)
        } else {
            None
        }
    })
}

/// Validate a tag name read from `nightly-tag.txt` before using it in a GitHub API URL.
pub fn sanitize_release_tag(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return None;
    }
    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

/// Scan a list of GitHub releases (newest first) and pick the best matching prebuilt archive.
/// Prefers an exact match for `preferred_backend` before accepting a fallback backend (e.g. CPU).
pub fn select_best_from_releases(
    releases: &[serde_json::Value],
    os: &str,
    arch: &str,
    preferred_backend: &str,
) -> Option<ResolvedReleaseAsset> {
    let mut fallback: Option<ResolvedReleaseAsset> = None;
    for release in releases {
        if let Some(resolved) = select_release_asset_from_release(release, os, arch, preferred_backend)
        {
            if resolved.backend == preferred_backend {
                return Some(resolved);
            }
            if fallback.is_none() {
                fallback = Some(resolved);
            }
        }
    }
    fallback
}

/// Resolve the best prebuilt `llama-server` archive from upstream `ggml-org/llama.cpp` releases.
///
/// Resolution order:
/// 1. `/releases/latest` directly (if it attaches prebuilt archives).
/// 2. `/releases/latest` -> `nightly-tag.txt` pointer -> `/releases/tags/<tag>` (how `llama.cpp`
///    `v1.0.0+` links stable releases to their prebuilt `bNNNNN` binary archives).
/// 3. `/releases?per_page=15` scanning non-draft builds (including `prerelease: true` `bNNNNN`
///    builds), preferring the requested backend with automatic fallback to compatible CPU builds.
async fn resolve_upstream_release_asset(
    client: &reqwest::Client,
    os: &str,
    arch: &str,
    preferred_backend: &str,
) -> Result<ResolvedReleaseAsset, String> {
    let mut fallback_candidate: Option<ResolvedReleaseAsset> = None;
    let mut last_error: Option<String> = None;

    // 1. Check `/releases/latest` (and follow `nightly-tag.txt` if present).
    match client.get(LLAMA_CPP_RELEASES_LATEST_API).send().await {
        Ok(resp) => match resp.error_for_status() {
            Ok(ok_resp) => match ok_resp.json::<serde_json::Value>().await {
                Ok(latest_release) => {
                    if let Some(resolved) = select_release_asset_from_release(
                        &latest_release,
                        os,
                        arch,
                        preferred_backend,
                    ) {
                        if resolved.backend == preferred_backend {
                            return Ok(resolved);
                        }
                        fallback_candidate = Some(resolved);
                    } else if let Some(nightly_url) = find_nightly_tag_url(&latest_release) {
                        if let Ok(tag_resp) = client.get(&nightly_url).send().await {
                            if let Ok(ok_tag) = tag_resp.error_for_status() {
                                if let Ok(raw_tag) = ok_tag.text().await {
                                    if let Some(nightly_tag) = sanitize_release_tag(&raw_tag) {
                                        let tag_api =
                                            format!("{LLAMA_CPP_RELEASE_BY_TAG_PREFIX}{nightly_tag}");
                                        if let Ok(rel_resp) = client.get(&tag_api).send().await {
                                            if let Ok(ok_rel) = rel_resp.error_for_status() {
                                                if let Ok(tagged_release) =
                                                    ok_rel.json::<serde_json::Value>().await
                                                {
                                                    if let Some(resolved) =
                                                        select_release_asset_from_release(
                                                            &tagged_release,
                                                            os,
                                                            arch,
                                                            preferred_backend,
                                                        )
                                                    {
                                                        if resolved.backend == preferred_backend {
                                                            return Ok(resolved);
                                                        }
                                                        if fallback_candidate.is_none() {
                                                            fallback_candidate = Some(resolved);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => last_error = Some(format!("Invalid GitHub release payload: {e}")),
            },
            Err(e) => last_error = Some(format!("GitHub Releases returned error: {e}")),
        },
        Err(e) => {
            last_error = Some(format!(
                "Failed to reach GitHub Releases for llama.cpp: {e}"
            ))
        }
    }

    // 2. Scan recent non-draft releases (including `prerelease: true` `bNNNNN` binary builds).
    match client.get(LLAMA_CPP_RELEASES_LIST_API).send().await {
        Ok(resp) => match resp.error_for_status() {
            Ok(ok_resp) => match ok_resp.json::<Vec<serde_json::Value>>().await {
                Ok(releases) => {
                    if let Some(resolved) =
                        select_best_from_releases(&releases, os, arch, preferred_backend)
                    {
                        if resolved.backend == preferred_backend || fallback_candidate.is_none() {
                            return Ok(resolved);
                        }
                    }
                }
                Err(e) => {
                    if last_error.is_none() {
                        last_error = Some(format!("Invalid GitHub releases list payload: {e}"));
                    }
                }
            },
            Err(e) => {
                if last_error.is_none() {
                    last_error = Some(format!("GitHub Releases list returned error: {e}"));
                }
            }
        },
        Err(e) => {
            if last_error.is_none() {
                last_error = Some(format!(
                    "Failed to reach GitHub Releases for llama.cpp: {e}"
                ));
            }
        }
    }

    if let Some(fallback) = fallback_candidate {
        return Ok(fallback);
    }

    if let Some(err) = last_error {
        return Err(err);
    }

    Err(format!(
        "No prebuilt llama-server archive found for {os}-{arch} ({preferred_backend}) in recent llama.cpp releases."
    ))
}

fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to allocate local port for llama-server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read allocated port: {e}"))?
        .port();
    Ok(port)
}

fn read_runtime_version(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join("version.txt"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

impl LocalRuntimeManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn status(&self, app: &AppHandle) -> LocalRuntimeStatus {
        let dir = runtime_dir(app).ok();
        let binary = dir.as_deref().and_then(find_installed_binary);
        let version = dir.as_deref().and_then(read_runtime_version);
        let mut guard = self.inner.lock().await;

        // Reap crashed processes cleanly so status never lies.
        if let Some(ref mut chat) = guard.chat {
            if chat.child.try_wait().ok().flatten().is_some() {
                guard.chat = None;
            }
        }
        if let Some(ref mut emb) = guard.embedding {
            if emb.child.try_wait().ok().flatten().is_some() {
                guard.embedding = None;
            }
        }

        let (running, port, base_url, loaded_model, loaded_model_path) = match &guard.chat {
            Some(s) => (
                true,
                Some(s.port),
                Some(format!("http://127.0.0.1:{}/v1", s.port)),
                Some(s.model_name.clone()),
                Some(s.model_path.to_string_lossy().into_owned()),
            ),
            None => (false, None, None, None, None),
        };

        let (embedding_running, embedding_port, embedding_model) = match &guard.embedding {
            Some(s) => (true, Some(s.port), Some(s.model_name.clone())),
            None => (false, None, None),
        };

        LocalRuntimeStatus {
            installed: binary.is_some(),
            binary_path: binary.map(|p| p.to_string_lossy().into_owned()),
            running,
            port,
            base_url,
            loaded_model,
            loaded_model_path,
            embedding_running,
            embedding_port,
            embedding_model,
            detected_backend: detect_hardware_backend(),
            platform_summary: platform_summary(),
            version,
        }
    }

    pub async fn chat_base_url(&self) -> Option<String> {
        let mut guard = self.inner.lock().await;
        if let Some(ref mut s) = guard.chat {
            if s.child.try_wait().ok().flatten().is_some() {
                guard.chat = None;
                return None;
            }
            return Some(format!("http://127.0.0.1:{}/v1", s.port));
        }
        None
    }

    pub async fn embedding_base_url(&self) -> Option<(String, String)> {
        let mut guard = self.inner.lock().await;
        if let Some(ref mut s) = guard.embedding {
            if s.child.try_wait().ok().flatten().is_some() {
                guard.embedding = None;
            } else {
                return Some((
                    format!("http://127.0.0.1:{}/v1", s.port),
                    s.model_name.clone(),
                ));
            }
        }
        if let Some(ref mut s) = guard.chat {
            if s.child.try_wait().ok().flatten().is_none() {
                return Some((
                    format!("http://127.0.0.1:{}/v1", s.port),
                    s.model_name.clone(),
                ));
            }
        }
        None
    }

    /// Download & verify the official `llama-server` binary for this platform.
    pub async fn install_runtime(
        &self,
        app: &AppHandle,
        preferred_backend: Option<String>,
    ) -> Result<LocalRuntimeStatus, String> {
        match self.install_runtime_inner(app, preferred_backend).await {
            Ok(status) => Ok(status),
            Err(err) => {
                let _ = app.emit(
                    "runtime-download-progress",
                    RuntimeDownloadProgress {
                        stage: "error".into(),
                        asset_name: String::new(),
                        downloaded: 0,
                        total: 0,
                        percent: 0.0,
                        done: true,
                        error: Some(err.clone()),
                    },
                );
                Err(err)
            }
        }
    }

    async fn install_runtime_inner(
        &self,
        app: &AppHandle,
        preferred_backend: Option<String>,
    ) -> Result<LocalRuntimeStatus, String> {
        let dir = runtime_dir(app)?;
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("Cannot create runtime directory: {e}"))?;

        let backend = preferred_backend.unwrap_or_else(detect_hardware_backend);
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .user_agent("DocuSage/2.0")
            .build()
            .map_err(|e| format!("Cannot build HTTP client: {e}"))?;

        let _ = app.emit(
            "runtime-download-progress",
            RuntimeDownloadProgress {
                stage: "resolving".into(),
                asset_name: String::new(),
                downloaded: 0,
                total: 0,
                percent: 0.0,
                done: false,
                error: None,
            },
        );

        let resolved = resolve_upstream_release_asset(
            &client,
            std::env::consts::OS,
            std::env::consts::ARCH,
            &backend,
        )
        .await?;
        let ResolvedReleaseAsset {
            tag,
            asset_name,
            download_url,
            sha256: expected_sha256,
            backend: resolved_backend,
        } = resolved;

        let archive_path = dir.join(format!("{asset_name}.part"));
        let resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download llama-server: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Download failed with HTTP error: {e}"))?;

        let total = resp.content_length().unwrap_or(0);
        let _ = app.emit(
            "runtime-download-progress",
            RuntimeDownloadProgress {
                stage: "downloading".into(),
                asset_name: asset_name.clone(),
                downloaded: 0,
                total,
                percent: 0.0,
                done: false,
                error: None,
            },
        );

        let mut file = tokio::fs::File::create(&archive_path)
            .await
            .map_err(|e| format!("Cannot create archive file: {e}"))?;

        let mut stream = resp.bytes_stream();
        let mut downloaded = 0u64;
        let mut hasher = Sha256::new();
        let mut last_emit = Instant::now();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| {
                let _ = std::fs::remove_file(&archive_path);
                format!("Runtime download interrupted: {e}")
            })?;
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed writing runtime archive: {e}"))?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= Duration::from_millis(120) {
                let percent = if total > 0 {
                    (downloaded as f32 / total as f32) * 100.0
                } else {
                    0.0
                };
                let _ = app.emit(
                    "runtime-download-progress",
                    RuntimeDownloadProgress {
                        stage: "downloading".into(),
                        asset_name: asset_name.clone(),
                        downloaded,
                        total,
                        percent,
                        done: false,
                        error: None,
                    },
                );
                last_emit = Instant::now();
            }
        }
        file.flush()
            .await
            .map_err(|e| format!("Failed flushing archive: {e}"))?;
        drop(file);

        // Verify SHA256 digest if published by GitHub.
        let actual_sha256 = hex::encode(hasher.finalize());
        if let Some(expected) = expected_sha256 {
            if !actual_sha256.eq_ignore_ascii_case(&expected) {
                let _ = tokio::fs::remove_file(&archive_path).await;
                return Err(format!(
                    "SHA256 verification failed for {asset_name} (expected {expected}, got {actual_sha256})."
                ));
            }
        }

        let _ = app.emit(
            "runtime-download-progress",
            RuntimeDownloadProgress {
                stage: "extracting".into(),
                asset_name: asset_name.clone(),
                downloaded,
                total,
                percent: 99.0,
                done: false,
                error: None,
            },
        );

        // Stop any running server before replacing binaries so Windows unlocks DLLs/EXEs.
        self.stop_all().await;

        let dir_clone = dir.clone();
        let archive_clone = archive_path.clone();
        let asset_clone = asset_name.clone();
        tokio::task::spawn_blocking(move || {
            clean_runtime_dir_except(&dir_clone, &archive_clone)?;
            extract_archive(&archive_clone, &dir_clone, &asset_clone)
        })
        .await
        .map_err(|e| format!("Extraction task failed: {e}"))??;

        let _ = tokio::fs::remove_file(&archive_path).await;
        let _ = tokio::fs::write(
            dir.join("version.txt"),
            format!("{tag} ({resolved_backend})"),
        )
        .await;

        if find_installed_binary(&dir).is_none() {
            return Err(format!(
                "Extracted {asset_name}, but {} was not found in {}.",
                llama_server_executable_name(),
                dir.display()
            ));
        }

        let _ = app.emit(
            "runtime-download-progress",
            RuntimeDownloadProgress {
                stage: "ready".into(),
                asset_name,
                downloaded,
                total,
                percent: 100.0,
                done: true,
                error: None,
            },
        );

        Ok(self.status(app).await)
    }

    /// Start (or hot-swap) `llama-server` with a specific `.gguf` file on a free localhost port.
    pub async fn start_chat_model(
        &self,
        app: &AppHandle,
        gguf_path: &Path,
        ctx_size: Option<u32>,
    ) -> Result<LocalRuntimeStatus, String> {
        if !gguf_path.is_file() {
            return Err(format!("Model file not found: {}", gguf_path.display()));
        }
        let dir = runtime_dir(app)?;
        let bin = find_installed_binary(&dir).ok_or_else(|| {
            "Built-in llama-server runtime is not installed yet. Click 'Install Local Runtime' in Settings -> Local AI."
                .to_string()
        })?;

        let port = pick_free_port()?;
        let threads = std::thread::available_parallelism()
            .map(|p| p.get().saturating_sub(1).max(1))
            .unwrap_or(2);
        let ctx = ctx_size.unwrap_or(4096);
        let model_name = gguf_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "local-model.gguf".into());

        // Stop previous chat server before launching the new one.
        self.stop_chat().await;

        let child = spawn_and_wait_llama_server(
            &bin,
            gguf_path,
            port,
            threads,
            Some(ctx),
            false,
            Duration::from_secs(60),
        )
        .await?;

        {
            let mut guard = self.inner.lock().await;
            guard.chat = Some(RunningServer {
                child,
                port,
                model_path: gguf_path.to_path_buf(),
                model_name,
            });
        }

        Ok(self.status(app).await)
    }

    /// Start (or hot-swap) a dedicated lightweight `llama-server --embeddings` instance
    /// for offline GGUF embeddings (e.g. `bge-small-en-v1.5` or `nomic-embed-text`).
    pub async fn start_embedding_model(
        &self,
        app: &AppHandle,
        gguf_path: &Path,
    ) -> Result<LocalRuntimeStatus, String> {
        if !gguf_path.is_file() {
            return Err(format!(
                "Embedding model file not found: {}",
                gguf_path.display()
            ));
        }
        let dir = runtime_dir(app)?;
        let bin = find_installed_binary(&dir).ok_or_else(|| {
            "Built-in llama-server runtime is not installed yet.".to_string()
        })?;

        let port = pick_free_port()?;
        let threads = std::thread::available_parallelism()
            .map(|p| (p.get() / 2).max(1))
            .unwrap_or(2);
        let model_name = gguf_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "embed-model.gguf".into());

        self.stop_embedding().await;

        let child = spawn_and_wait_llama_server(
            &bin,
            gguf_path,
            port,
            threads,
            None,
            true,
            Duration::from_secs(45),
        )
        .await?;

        {
            let mut guard = self.inner.lock().await;
            guard.embedding = Some(RunningServer {
                child,
                port,
                model_path: gguf_path.to_path_buf(),
                model_name,
            });
        }

        Ok(self.status(app).await)
    }

    pub async fn stop_chat(&self) {
        let old = {
            let mut guard = self.inner.lock().await;
            guard.chat.take()
        };
        if let Some(mut s) = old {
            let _ = s.child.kill().await;
            let _ = s.child.wait().await;
        }
    }

    pub async fn stop_embedding(&self) {
        let old = {
            let mut guard = self.inner.lock().await;
            guard.embedding.take()
        };
        if let Some(mut s) = old {
            let _ = s.child.kill().await;
            let _ = s.child.wait().await;
        }
    }

    pub async fn stop_all(&self) {
        self.stop_chat().await;
        self.stop_embedding().await;
    }

    /// Run a fast live inference smoke test against the currently running local chat model.
    pub async fn quick_test_chat(
        &self,
        http: &reqwest::Client,
    ) -> Result<(String, String, u64), String> {
        let (base_url, model_name) = {
            let mut guard = self.inner.lock().await;
            let Some(ref mut s) = guard.chat else {
                return Err("No local GGUF model is currently loaded.".to_string());
            };
            if s.child.try_wait().ok().flatten().is_some() {
                guard.chat = None;
                return Err("Local llama-server process stopped unexpectedly.".to_string());
            }
            (format!("http://127.0.0.1:{}/v1", s.port), s.model_name.clone())
        };

        let started = Instant::now();
        let resp = http
            .post(format!("{base_url}/chat/completions"))
            .json(&serde_json::json!({
                "model": model_name,
                "max_tokens": 32,
                "temperature": 0.1,
                "stream": false,
                "messages": [
                    { "role": "user", "content": "Reply with one short sentence confirming you are ready." }
                ]
            }))
            .send()
            .await
            .map_err(|e| format!("Failed to reach local llama-server: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(180).collect();
            return Err(format!("Local model returned HTTP {status}: {snippet}"));
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid local model response JSON: {e}"))?;
        let reply = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("Local model is ready!")
            .trim()
            .to_string();
        let elapsed_ms = started.elapsed().as_millis() as u64;
        Ok((model_name, reply, elapsed_ms))
    }
}

async fn spawn_and_wait_llama_server(
    bin: &Path,
    gguf_path: &Path,
    port: u16,
    threads: usize,
    ctx_size: Option<u32>,
    embeddings: bool,
    timeout: Duration,
) -> Result<Child, String> {
    let first_err = match spawn_once(bin, gguf_path, port, threads, ctx_size, embeddings, false) {
        Ok(mut child) => match wait_for_health(&mut child, port, timeout).await {
            Ok(()) => return Ok(child),
            Err(err) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                err
            }
        },
        Err(err) => return Err(err),
    };

    // If GPU/Vulkan initialization fails on machines with older or unsupported drivers,
    // automatically retry once in pure CPU mode (`--n-gpu-layers 0`).
    let mut fallback_child = spawn_once(bin, gguf_path, port, threads, ctx_size, embeddings, true)?;
    match wait_for_health(&mut fallback_child, port, timeout).await {
        Ok(()) => Ok(fallback_child),
        Err(fallback_err) => {
            let _ = fallback_child.kill().await;
            let _ = fallback_child.wait().await;
            Err(format!("{first_err} (CPU fallback also failed: {fallback_err})"))
        }
    }
}

fn spawn_once(
    bin: &Path,
    gguf_path: &Path,
    port: u16,
    threads: usize,
    ctx_size: Option<u32>,
    embeddings: bool,
    force_cpu: bool,
) -> Result<Child, String> {
    let mut cmd = Command::new(bin);
    cmd.arg("--model")
        .arg(gguf_path)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--threads")
        .arg(threads.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if let Some(ctx) = ctx_size {
        cmd.arg("--ctx-size").arg(ctx.to_string());
    }
    if embeddings {
        cmd.arg("--embeddings");
    }
    if force_cpu {
        cmd.arg("--n-gpu-layers").arg("0");
        cmd.env("GGML_VK_VISIBLE_DEVICES", "");
    }

    if let Some(parent) = bin.parent() {
        cmd.current_dir(parent);
        configure_shared_lib_env(&mut cmd, parent);
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let label = if embeddings {
        "llama-server (embeddings)"
    } else {
        "llama-server"
    };
    cmd.spawn()
        .map_err(|e| format!("Failed to start {label}: {e}"))
}

fn clean_runtime_dir_except(dir: &Path, keep_file: &Path) -> Result<(), String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p == keep_file {
            continue;
        }
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(&p);
        } else {
            let _ = std::fs::remove_file(&p);
        }
    }
    Ok(())
}

fn configure_shared_lib_env(cmd: &mut Command, bin_dir: &Path) {
    #[cfg(target_os = "linux")]
    {
        let existing = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
        let val = if existing.is_empty() {
            bin_dir.to_string_lossy().into_owned()
        } else {
            format!("{}:{existing}", bin_dir.to_string_lossy())
        };
        cmd.env("LD_LIBRARY_PATH", val);
    }
    #[cfg(target_os = "macos")]
    {
        let existing = std::env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
        let val = if existing.is_empty() {
            bin_dir.to_string_lossy().into_owned()
        } else {
            format!("{}:{existing}", bin_dir.to_string_lossy())
        };
        cmd.env("DYLD_LIBRARY_PATH", val);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (cmd, bin_dir);
    }
}

async fn read_stderr_snippet(child: &mut Child) -> String {
    use tokio::io::AsyncReadExt;
    let Some(mut stderr) = child.stderr.take() else {
        return String::new();
    };
    let mut buf = vec![0u8; 4096];
    let n = tokio::time::timeout(Duration::from_millis(300), stderr.read(&mut buf))
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(0);
    String::from_utf8_lossy(&buf[..n])
        .lines()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

async fn wait_for_health(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Health-check client error: {e}"))?;
    let url = format!("http://127.0.0.1:{port}/health");
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            let detail = read_stderr_snippet(child).await;
            return Err(if detail.is_empty() {
                format!("llama-server exited unexpectedly during startup (exit status: {status}).")
            } else {
                format!("llama-server exited during startup ({status}): {detail}")
            });
        }
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                // Drain stderr in the background once healthy so the child never gets SIGPIPE
                // or blocks on a full pipe buffer.
                if let Some(mut stderr) = child.stderr.take() {
                    tokio::spawn(async move {
                        let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
                    });
                }
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    Err("Timed out waiting for llama-server /health to become ready.".into())
}

fn extract_archive(archive_path: &Path, dest_dir: &Path, asset_name: &str) -> Result<(), String> {
    let lower = asset_name.to_ascii_lowercase();
    if lower.ends_with(".zip") {
        let file = std::fs::File::open(archive_path)
            .map_err(|e| format!("Cannot open zip archive: {e}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip archive: {e}"))?;
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Zip entry read error: {e}"))?;
            let Some(enclosed) = entry.enclosed_name().map(PathBuf::from) else {
                continue;
            };
            let out_path = dest_dir.join(enclosed);
            if entry.is_dir() {
                std::fs::create_dir_all(&out_path)
                    .map_err(|e| format!("Cannot create dir: {e}"))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Cannot create parent dir: {e}"))?;
                }
                let mut out_file = std::fs::File::create(&out_path)
                    .map_err(|e| format!("Cannot create extracted file: {e}"))?;
                let mut buf = Vec::new();
                entry
                    .read_to_end(&mut buf)
                    .map_err(|e| format!("Failed reading zip entry: {e}"))?;
                std::io::Write::write_all(&mut out_file, &buf)
                    .map_err(|e| format!("Failed writing extracted file: {e}"))?;
                set_executable_if_needed(&out_path);
            }
        }
        return Ok(());
    }

    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        let file = std::fs::File::open(archive_path)
            .map_err(|e| format!("Cannot open tar.gz archive: {e}"))?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        for entry_res in tar
            .entries()
            .map_err(|e| format!("Invalid tar.gz archive: {e}"))?
        {
            let mut entry = entry_res.map_err(|e| format!("Tar entry error: {e}"))?;
            let rel = entry
                .path()
                .map_err(|e| format!("Invalid tar entry path: {e}"))?
                .into_owned();
            // Reject any path traversal inside archives.
            if rel
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::RootDir))
            {
                continue;
            }
            let out_path = dest_dir.join(&rel);
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create parent dir: {e}"))?;
            }
            entry
                .unpack(&out_path)
                .map_err(|e| format!("Failed extracting {}: {e}", rel.display()))?;
            set_executable_if_needed(&out_path);
        }
        return Ok(());
    }

    Err(format!("Unsupported runtime archive format: {asset_name}"))
}

fn set_executable_if_needed(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n == "llama-server" || n.starts_with("llama-"))
        {
            if let Ok(meta) = std::fs::metadata(path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_asset_selector_picks_best_platform_binary() {
        let assets = vec![
            serde_json::json!({
                "name": "cudart-llama-bin-win-cuda-12.4-x64.zip",
                "browser_download_url": "https://example.com/cudart.zip"
            }),
            serde_json::json!({
                "name": "llama-b12359-bin-win-cpu-x64.zip",
                "browser_download_url": "https://example.com/win-cpu.zip",
                "digest": "sha256:abc123"
            }),
            serde_json::json!({
                "name": "llama-b12359-bin-win-vulkan-x64.zip",
                "browser_download_url": "https://example.com/win-vulkan.zip",
                "digest": "sha256:def456"
            }),
            serde_json::json!({
                "name": "llama-b12359-bin-ubuntu-x64.tar.gz",
                "browser_download_url": "https://example.com/linux.tar.gz"
            }),
        ];

        let (name, _, sha, backend) =
            select_release_asset(&assets, "windows", "x86_64", "vulkan").unwrap();
        assert_eq!(name, "llama-b12359-bin-win-vulkan-x64.zip");
        assert_eq!(sha.as_deref(), Some("def456"));
        assert_eq!(backend, "vulkan");

        let (name_cpu, _, _, backend_cpu) =
            select_release_asset(&assets, "windows", "x86_64", "cpu").unwrap();
        assert_eq!(name_cpu, "llama-b12359-bin-win-cpu-x64.zip");
        assert_eq!(backend_cpu, "cpu");

        let (name_linux, _, _, backend_linux) =
            select_release_asset(&assets, "linux", "x86_64", "cpu").unwrap();
        assert_eq!(name_linux, "llama-b12359-bin-ubuntu-x64.tar.gz");
        assert_eq!(backend_linux, "cpu");
    }

    #[test]
    fn windows_vulkan_falls_back_to_cpu_when_vulkan_archive_missing() {
        let assets = vec![
            serde_json::json!({
                "name": "llama-b12359-bin-win-vulkan-arm64.zip",
                "browser_download_url": "https://example.com/win-vulkan-arm64.zip"
            }),
            serde_json::json!({
                "name": "llama-b12359-bin-win-cpu-x64.zip",
                "browser_download_url": "https://example.com/win-cpu-x64.zip",
                "digest": "sha256:cpu123"
            }),
        ];

        let (name, _, sha, backend) =
            select_release_asset(&assets, "windows", "x86_64", "vulkan").unwrap();
        assert_eq!(name, "llama-b12359-bin-win-cpu-x64.zip");
        assert_eq!(sha.as_deref(), Some("cpu123"));
        assert_eq!(backend, "cpu");
    }

    #[test]
    fn release_resolver_handles_v1_nightly_pointer_and_prerelease_list() {
        let v1_release = serde_json::json!({
            "tag_name": "v1.0.0",
            "draft": false,
            "prerelease": false,
            "assets": [
                {
                    "name": "nightly-tag.txt",
                    "browser_download_url": "https://github.com/ggml-org/llama.cpp/releases/download/v1.0.0/nightly-tag.txt"
                }
            ]
        });

        assert!(
            select_release_asset_from_release(&v1_release, "windows", "x86_64", "vulkan").is_none()
        );
        assert_eq!(
            find_nightly_tag_url(&v1_release).as_deref(),
            Some("https://github.com/ggml-org/llama.cpp/releases/download/v1.0.0/nightly-tag.txt")
        );
        assert_eq!(sanitize_release_tag("b12359\n").as_deref(), Some("b12359"));
        assert!(sanitize_release_tag("../bad").is_none());

        let releases = vec![
            v1_release,
            serde_json::json!({
                "tag_name": "b12651",
                "draft": false,
                "prerelease": true,
                "assets": [
                    {
                        "name": "llama-b12651-bin-win-cpu-x64.zip",
                        "browser_download_url": "https://example.com/b12651-cpu.zip"
                    }
                ]
            }),
            serde_json::json!({
                "tag_name": "b12650",
                "draft": false,
                "prerelease": true,
                "assets": [
                    {
                        "name": "llama-b12650-bin-win-vulkan-x64.zip",
                        "browser_download_url": "https://example.com/b12650-vulkan.zip"
                    },
                    {
                        "name": "llama-b12650-bin-win-cpu-x64.zip",
                        "browser_download_url": "https://example.com/b12650-cpu.zip"
                    }
                ]
            }),
        ];

        // Prefers the release that actually ships Vulkan over a newer release with only CPU.
        let best = select_best_from_releases(&releases, "windows", "x86_64", "vulkan").unwrap();
        assert_eq!(best.tag, "b12650");
        assert_eq!(best.asset_name, "llama-b12650-bin-win-vulkan-x64.zip");
        assert_eq!(best.backend, "vulkan");

        // Falls back to CPU when no release ships Vulkan.
        let cpu_only_releases = vec![releases[0].clone(), releases[1].clone()];
        let fallback =
            select_best_from_releases(&cpu_only_releases, "windows", "x86_64", "vulkan").unwrap();
        assert_eq!(fallback.tag, "b12651");
        assert_eq!(fallback.asset_name, "llama-b12651-bin-win-cpu-x64.zip");
        assert_eq!(fallback.backend, "cpu");
    }
}
