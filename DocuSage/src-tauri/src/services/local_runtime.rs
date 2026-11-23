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

const LLAMA_CPP_RELEASES_API: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";

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

/// Select the best matching official `llama.cpp` GitHub release asset for this platform.
pub fn select_release_asset(
    assets: &[serde_json::Value],
    os: &str,
    arch: &str,
    backend: &str,
) -> Option<(String, String, Option<String>)> {
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

    let patterns: Vec<Vec<&str>> = match (os, arch) {
        ("windows", "x86_64") => match backend {
            "cuda" => vec![
                vec!["bin-win-cuda", "x64", ".zip"],
                vec!["bin-win-vulkan-x64", ".zip"],
                vec!["bin-win-cpu-x64", ".zip"],
                vec!["bin-win-avx2-x64", ".zip"],
            ],
            "vulkan" => vec![
                vec!["bin-win-vulkan-x64", ".zip"],
                vec!["bin-win-cpu-x64", ".zip"],
                vec!["bin-win-avx2-x64", ".zip"],
            ],
            _ => vec![
                vec!["bin-win-cpu-x64", ".zip"],
                vec!["bin-win-avx2-x64", ".zip"],
                vec!["bin-win-vulkan-x64", ".zip"],
            ],
        },
        ("windows", "aarch64") => vec![
            vec!["bin-win-cpu-arm64", ".zip"],
            vec!["bin-win-arm64", ".zip"],
        ],
        ("macos", "aarch64") => vec![
            vec!["bin-macos-arm64", ".zip"],
            vec!["bin-macos-arm64", ".tar.gz"],
        ],
        ("macos", "x86_64") => vec![
            vec!["bin-macos-x64", ".zip"],
            vec!["bin-macos-x64", ".tar.gz"],
        ],
        ("linux", "x86_64") => match backend {
            "vulkan" => vec![
                vec!["bin-ubuntu-vulkan-x64", ".tar.gz"],
                vec!["bin-ubuntu-vulkan-x64", ".zip"],
                vec!["bin-ubuntu-x64", ".tar.gz"],
                vec!["bin-ubuntu-x64", ".zip"],
            ],
            _ => vec![
                vec!["bin-ubuntu-x64", ".tar.gz"],
                vec!["bin-ubuntu-x64", ".zip"],
            ],
        },
        ("linux", "aarch64") => vec![
            vec!["bin-ubuntu-arm64", ".tar.gz"],
            vec!["bin-ubuntu-arm64", ".zip"],
        ],
        _ => vec![],
    };

    for required in patterns {
        if let Some((name, url, digest)) = candidates.iter().find(|(name, _, _)| {
            let lower = name.to_ascii_lowercase();
            !lower.contains("cudart")
                && required.iter().all(|needle| lower.contains(needle))
        }) {
            return Some((
                (*name).to_string(),
                (*url).to_string(),
                digest.map(ToString::to_string),
            ));
        }
    }
    None
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

        let release: serde_json::Value = client
            .get(LLAMA_CPP_RELEASES_API)
            .send()
            .await
            .map_err(|e| format!("Failed to reach GitHub Releases for llama.cpp: {e}"))?
            .error_for_status()
            .map_err(|e| format!("GitHub Releases returned error: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Invalid GitHub release payload: {e}"))?;

        let tag = release["tag_name"]
            .as_str()
            .unwrap_or("latest")
            .to_string();
        let assets = release["assets"]
            .as_array()
            .ok_or_else(|| "GitHub release contains no downloadable assets.".to_string())?;

        let (asset_name, download_url, expected_sha256) =
            select_release_asset(assets, std::env::consts::OS, std::env::consts::ARCH, &backend)
                .ok_or_else(|| {
                    format!(
                        "No prebuilt llama-server archive found for {}-{} ({backend}).",
                        std::env::consts::OS,
                        std::env::consts::ARCH
                    )
                })?;

        let archive_path = dir.join(format!("{asset_name}.part"));
        let resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download llama-server: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Download failed with HTTP error: {e}"))?;

        let total = resp.content_length().unwrap_or(0);
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
                let err = format!(
                    "SHA256 verification failed for {asset_name} (expected {expected}, got {actual_sha256})."
                );
                let _ = app.emit(
                    "runtime-download-progress",
                    RuntimeDownloadProgress {
                        stage: "error".into(),
                        asset_name,
                        downloaded: 0,
                        total,
                        percent: 0.0,
                        done: true,
                        error: Some(err.clone()),
                    },
                );
                return Err(err);
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

        // Stop any running server before replacing binaries.
        self.stop_all().await;

        let dir_clone = dir.clone();
        let archive_clone = archive_path.clone();
        let asset_clone = asset_name.clone();
        tokio::task::spawn_blocking(move || extract_archive(&archive_clone, &dir_clone, &asset_clone))
            .await
            .map_err(|e| format!("Extraction task failed: {e}"))??;

        let _ = tokio::fs::remove_file(&archive_path).await;
        let _ = tokio::fs::write(dir.join("version.txt"), format!("{tag} ({backend})")).await;

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

        let mut cmd = Command::new(&bin);
        cmd.arg("--model")
            .arg(gguf_path)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ctx-size")
            .arg(ctx.to_string())
            .arg("--threads")
            .arg(threads.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        if let Some(parent) = bin.parent() {
            cmd.current_dir(parent);
            configure_shared_lib_env(&mut cmd, parent);
        }

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start llama-server: {e}"))?;

        if let Err(err) = wait_for_health(&mut child, port, Duration::from_secs(60)).await {
            let _ = child.kill().await;
            return Err(err);
        }

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

        let mut cmd = Command::new(&bin);
        cmd.arg("--model")
            .arg(gguf_path)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--embeddings")
            .arg("--threads")
            .arg(threads.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        if let Some(parent) = bin.parent() {
            cmd.current_dir(parent);
            configure_shared_lib_env(&mut cmd, parent);
        }

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start llama-server (embeddings): {e}"))?;

        if let Err(err) = wait_for_health(&mut child, port, Duration::from_secs(45)).await {
            let _ = child.kill().await;
            return Err(err);
        }

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
    let mut buf = vec![0u8; 2048];
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
                "name": "llama-b5000-bin-win-cpu-x64.zip",
                "browser_download_url": "https://example.com/win-cpu.zip",
                "digest": "sha256:abc123"
            }),
            serde_json::json!({
                "name": "llama-b5000-bin-win-vulkan-x64.zip",
                "browser_download_url": "https://example.com/win-vulkan.zip",
                "digest": "sha256:def456"
            }),
            serde_json::json!({
                "name": "llama-b5000-bin-ubuntu-x64.tar.gz",
                "browser_download_url": "https://example.com/linux.tar.gz"
            }),
        ];

        let (name, _, sha) = select_release_asset(&assets, "windows", "x86_64", "vulkan").unwrap();
        assert_eq!(name, "llama-b5000-bin-win-vulkan-x64.zip");
        assert_eq!(sha.as_deref(), Some("def456"));

        let (name_cpu, _, _) = select_release_asset(&assets, "windows", "x86_64", "cpu").unwrap();
        assert_eq!(name_cpu, "llama-b5000-bin-win-cpu-x64.zip");

        let (name_linux, _, _) = select_release_asset(&assets, "linux", "x86_64", "cpu").unwrap();
        assert_eq!(name_linux, "llama-b5000-bin-ubuntu-x64.tar.gz");
    }
}
