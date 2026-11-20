//! Multi-format document ingestion pipeline with caching, size limits,
//! path traversal protection, and token/sentence-aware overlapping chunking.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

/// Single source of truth for supported document extensions (exposed to frontend).
pub const ALLOWED_EXTENSIONS: &[&str] = &[
    "pdf", "txt", "md", "rst", "html", "htm", "py", "js", "ts", "tsx", "jsx", "rs", "java", "cpp",
    "c", "h", "hpp", "go", "rb", "php", "swift", "kt", "cs", "json", "yaml", "yml", "toml", "xml",
    "csv", "sh", "ps1", "sql", "log", "conf", "ini", "env",
];

/// Maximum supported file size: 50 MB.
pub const MAX_FILE_SIZE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Clone)]
struct CachedDocument {
    modified: Option<SystemTime>,
    len: u64,
    text: Arc<String>,
}

/// In-memory `(SystemTime, file_len, Arc<String>)` cache keyed by canonical file path.
/// Automatically invalidates whenever a file's mtime or length changes on disk.
#[derive(Default)]
pub struct DocumentCache {
    entries: RwLock<HashMap<PathBuf, CachedDocument>>,
}

impl DocumentCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, path: &Path, modified: Option<SystemTime>, len: u64) -> Option<Arc<String>> {
        let guard = self.entries.read().ok()?;
        let entry = guard.get(path)?;
        if entry.len == len && entry.modified == modified {
            Some(Arc::clone(&entry.text))
        } else {
            None
        }
    }

    pub fn insert(&self, path: PathBuf, modified: Option<SystemTime>, len: u64, text: Arc<String>) {
        if let Ok(mut guard) = self.entries.write() {
            // Keep memory bounded if user attaches hundreds of huge files.
            if guard.len() > 256 {
                guard.clear();
            }
            guard.insert(
                path,
                CachedDocument {
                    modified,
                    len,
                    text,
                },
            );
        }
    }

    pub fn invalidate(&self, path: &Path) {
        if let Ok(mut guard) = self.entries.write() {
            guard.remove(path);
        }
    }
}

/// Estimate LLM tokens for a text slice (fast heuristic ~4 chars/token bounded by words).
pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    if chars == 0 {
        return 0;
    }
    let words = text.split_whitespace().count();
    ((chars + 3) / 4).max(words)
}

/// Check whether a file extension (without leading dot) is in `ALLOWED_EXTENSIONS`.
pub fn is_extension_allowed(ext: &str) -> bool {
    ALLOWED_EXTENSIONS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(ext))
}

/// Validate a path for traversal (`..`), extension allow-list, existence, and 50 MB limit.
pub fn validate_document_path(raw_path: &str) -> Result<(PathBuf, u64, Option<SystemTime>), String> {
    let path = Path::new(raw_path);
    if raw_path.trim().is_empty() {
        return Err("File path is empty.".into());
    }
    for comp in path.components() {
        if matches!(comp, Component::ParentDir) {
            return Err(format!(
                "Path traversal ('..') is not allowed: {}",
                path.display()
            ));
        }
    }
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path {}: {e}", path.display()))?;
    let meta = std::fs::metadata(&canonical)
        .map_err(|e| format!("Cannot read file metadata {}: {e}", canonical.display()))?;
    if !meta.is_file() {
        return Err(format!("Not a regular file: {}", canonical.display()));
    }
    if meta.len() > MAX_FILE_SIZE_BYTES {
        return Err(format!(
            "File exceeds the 50 MB limit ({:.1} MB): {}",
            meta.len() as f64 / (1024.0 * 1024.0),
            canonical.display()
        ));
    }

    // Handle dotfiles like `.env` as well as standard `foo.ext` filenames.
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .or_else(|| {
            canonical
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_prefix('.'))
        })
        .unwrap_or("");
    if !is_extension_allowed(ext) {
        return Err(format!(
            "Unsupported file type '.{ext}'. Supported formats include PDF, Markdown, TXT, HTML, code, and config files."
        ));
    }

    Ok((canonical, meta.len(), meta.modified().ok()))
}

pub fn canonical_source(path: &str) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .into_owned()
}

/// Extract clean text from any supported document format synchronously (run inside `spawn_blocking`).
pub fn extract_text_sync(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;

    if ext == "pdf" {
        let extracted = pdf_extract::extract_text_from_mem(&bytes)
            .map_err(|e| format!("PDF extraction failed for {}: {e}", path.display()))?;
        return Ok(extracted);
    }

    let raw = String::from_utf8_lossy(&bytes).into_owned();
    if ext == "html" || ext == "htm" {
        return Ok(strip_html_to_text(&raw));
    }
    Ok(raw)
}

/// Read and extract document text via `tokio::task::spawn_blocking`, utilizing `DocumentCache`.
pub async fn read_document_text_cached(
    cache: &DocumentCache,
    raw_path: &str,
) -> Result<(PathBuf, Arc<String>), String> {
    let (canonical, len, modified) = validate_document_path(raw_path)?;
    if let Some(hit) = cache.get(&canonical, modified, len) {
        return Ok((canonical, hit));
    }

    let path_for_task = canonical.clone();
    let text = tokio::task::spawn_blocking(move || extract_text_sync(&path_for_task))
        .await
        .map_err(|e| format!("Document extraction task failed: {e}"))??;

    let arc = Arc::new(text);
    cache.insert(canonical.clone(), modified, len, Arc::clone(&arc));
    Ok((canonical, arc))
}

/// Lightweight, zero-dependency HTML-to-plain-text extractor that strips `<script>` and `<style>` blocks.
pub fn strip_html_to_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let lower_bytes = lower.as_bytes();
    let mut out = String::with_capacity(html.len() / 2);
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'<' {
            // Skip entire <script>...</script> and <style>...</style> sections.
            if lower_bytes[i..].starts_with(b"<script") {
                if let Some(end) = lower[i..].find("</script>") {
                    i += end + 9;
                    continue;
                }
            } else if lower_bytes[i..].starts_with(b"<style") {
                if let Some(end) = lower[i..].find("</style>") {
                    i += end + 8;
                    continue;
                }
            }
            if let Some(close) = html[i..].find('>') {
                let tag = &lower[i + 1..i + close];
                if matches!(
                    tag.split_whitespace().next().unwrap_or(""),
                    "p" | "/p" | "br" | "br/" | "div" | "/div" | "li" | "h1" | "h2" | "h3" | "h4" | "tr"
                ) {
                    out.push('\n');
                }
                i += close + 1;
                continue;
            }
        }
        if let Some(ch) = html[i..].chars().next() {
            out.push(ch);
            i += ch.len_utf8();
        } else {
            break;
        }
    }

    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Sentence-aware overlapping chunker configured by token target (`chunk_tokens`, `overlap_tokens`).
/// Preserves paragraph and sentence boundaries cleanly across Unicode text.
pub fn chunk_text_tokens(text: &str, chunk_tokens: usize, overlap_tokens: usize) -> Vec<String> {
    let target_chars = chunk_tokens.saturating_mul(4);
    let overlap_chars = overlap_tokens.saturating_mul(4);
    chunk_text_chars(text, target_chars, overlap_chars)
}

/// Character-budgeted recursive paragraph → sentence → char overlapping chunker.
pub fn chunk_text_chars(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    if text.trim().is_empty() {
        return Vec::new();
    }
    if chunk_size == 0 {
        return vec![text.trim().to_string()];
    }
    let overlap = overlap.min(chunk_size.saturating_sub(1));

    let paragraphs: Vec<String> = text
        .replace("\r\n", "\n")
        .split("\n\n")
        .map(|p| p.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|p| !p.is_empty())
        .collect();

    let mut units: Vec<String> = Vec::new();
    for para in paragraphs {
        if para.chars().count() <= chunk_size {
            units.push(para);
        } else {
            units.extend(split_into_sentences(&para, chunk_size));
        }
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;

    for unit in units {
        let unit_len = unit.chars().count();
        let sep_len = if current.is_empty() { 0 } else { 1 };

        if current_len + sep_len + unit_len > chunk_size && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
            if overlap > 0 {
                let last = chunks.last().unwrap();
                let tail = take_tail(last, overlap.min(chunk_size.saturating_sub(unit_len + 1)));
                current.push_str(&tail);
                current_len = current.chars().count();
            } else {
                current_len = 0;
            }
        }

        if !current.is_empty() {
            current.push(' ');
            current_len += 1;
        }
        current.push_str(&unit);
        current_len += unit_len;
    }

    if !current.trim().is_empty() {
        chunks.push(current);
    }

    chunks
}

fn split_into_sentences(paragraph: &str, max_len: usize) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut buf = String::new();
    for ch in paragraph.chars() {
        buf.push(ch);
        if matches!(ch, '.' | '!' | '?') {
            let trimmed = buf.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            buf.clear();
        }
    }
    let tail = buf.trim().to_string();
    if !tail.is_empty() {
        sentences.push(tail);
    }

    let mut out = Vec::new();
    for s in sentences {
        if s.chars().count() <= max_len {
            out.push(s);
        } else {
            let chars: Vec<char> = s.chars().collect();
            for window in chars.chunks(max_len) {
                out.push(window.iter().collect());
            }
        }
    }
    out
}

fn take_tail(s: &str, n: usize) -> String {
    if n == 0 {
        return String::new();
    }
    let chars: Vec<char> = s.chars().collect();
    let total = chars.len();
    if total <= n {
        return s.to_string();
    }
    let tail: String = chars[total - n..].iter().collect();
    if let Some(idx) = tail.find(['.', '!', '?']) {
        let trimmed = tail[idx + 1..].trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    tail
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn validates_extensions_and_rejects_traversal() {
        assert!(is_extension_allowed("pdf"));
        assert!(is_extension_allowed("TSX"));
        assert!(is_extension_allowed("rs"));
        assert!(is_extension_allowed("env"));
        assert!(!is_extension_allowed("exe"));
        assert!(!is_extension_allowed("dll"));

        let err = validate_document_path("../secret.txt").unwrap_err();
        assert!(err.contains("Path traversal"));
    }

    #[tokio::test]
    async fn document_cache_hits_and_invalidates_on_edit() {
        let dir = std::env::temp_dir().join(format!("docusage-pipe-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("notes.md");
        std::fs::write(&file, "Initial version").unwrap();

        let cache = DocumentCache::new();
        let (p1, t1) = read_document_text_cached(&cache, file.to_str().unwrap())
            .await
            .unwrap();
        let (p2, t2) = read_document_text_cached(&cache, file.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(p1, p2);
        assert!(Arc::ptr_eq(&t1, &t2), "unchanged file should hit Arc cache");

        // Edit file length -> automatic invalidation.
        std::fs::write(&file, "Updated version with additional content!").unwrap();
        let (_, t3) = read_document_text_cached(&cache, file.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(t3.as_str(), "Updated version with additional content!");
        assert!(!Arc::ptr_eq(&t1, &t3));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn html_stripping_and_unicode_chunking_are_clean() {
        let html = "<html><head><style>body{color:red}</style></head><body><script>alert(1)</script><h1>Hello</h1><p>World &amp; friends</p></body></html>";
        let plain = strip_html_to_text(html);
        assert!(plain.contains("Hello"));
        assert!(plain.contains("World & friends"));
        assert!(!plain.contains("alert(1)"));
        assert!(!plain.contains("color:red"));

        let text = format!("{}\n\nFinal sentence.", "你好🌿. ".repeat(100));
        let chunks = chunk_text_chars(&text, 40, 35);
        assert!(chunks.iter().all(|c| c.chars().count() <= 40));
        assert!(chunks.last().unwrap().contains("Final sentence."));
    }
}
