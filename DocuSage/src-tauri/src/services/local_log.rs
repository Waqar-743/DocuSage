//! Flush-on-write diagnostic logging for native `llama.cpp` inference.
//!
//! Every entry is written, flushed, and `sync_all()`'d before returning so if a
//! native FFI call faults (e.g., Windows `0xc0000005` / `0xc000001d` / `0xc00000fd`),
//! the exact stage and parameters immediately preceding the fault remain on disk.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Utc;

pub const ENV_ENGINE_LOG_PATH: &str = "DOCUSAGE_ENGINE_LOG";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

static CONFIGURED_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn path_slot() -> &'static Mutex<Option<PathBuf>> {
    CONFIGURED_PATH.get_or_init(|| Mutex::new(None))
}

/// Set the process-wide diagnostic log file path (typically `<app_data_dir>/logs/local-engine.log`).
pub fn init_log_path(path: PathBuf) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut guard) = path_slot().lock() {
        *guard = Some(path);
    }
}

/// Resolve the active diagnostic log path.
pub fn resolve_log_path() -> PathBuf {
    if let Ok(guard) = path_slot().lock() {
        if let Some(ref p) = *guard {
            return p.clone();
        }
    }
    if let Ok(env_path) = std::env::var(ENV_ENGINE_LOG_PATH) {
        let trimmed = env_path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    std::env::temp_dir().join("docusage-local-engine.log")
}

/// Append a single line to the engine diagnostic log and `sync_all()` immediately.
pub fn log_line(stage: &str, message: &str) {
    let path = resolve_log_path();
    let _guard = WRITE_LOCK.lock().ok();

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let rotated = path.with_extension("log.prev");
            let _ = fs::rename(&path, &rotated);
        }
    }

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };

    let ts = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let pid = std::process::id();
    let clean = message.replace(['\r', '\n'], " ");
    let _ = writeln!(file, "[{ts}] [pid={pid}] [{stage}] {clean}");
    let _ = file.flush();
    let _ = file.sync_all();
}

/// Read up to `max_lines` trailing non-empty lines from the diagnostic log.
pub fn read_tail_lines(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let lines: Vec<String> = raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(ToString::to_string)
        .collect();
    if lines.len() <= max_lines {
        lines
    } else {
        lines[lines.len() - max_lines..].to_vec()
    }
}

/// Return the last recorded `[stage]` entry for a specific worker PID (or overall).
pub fn last_stage_for_pid(path: &Path, pid: Option<u32>) -> Option<String> {
    let lines = read_tail_lines(path, 60);
    let pid_needle = pid.map(|p| format!("[pid={p}]"));
    lines
        .into_iter()
        .rev()
        .find(|line| match pid_needle.as_deref() {
            Some(needle) => line.contains(needle),
            None => true,
        })
}

/// Translate OS process exit codes (including Windows NTSTATUS fault codes) into readable diagnostics.
pub fn describe_exit_code(code: Option<i32>) -> String {
    let Some(raw) = code else {
        return "terminated by signal".to_string();
    };
    let unsigned = raw as u32;
    match unsigned {
        0xc000_0005 => "0xc0000005 (STATUS_ACCESS_VIOLATION)".to_string(),
        0xc000_001d => "0xc000001d (STATUS_ILLEGAL_INSTRUCTION — unsupported CPU SIMD instruction)".to_string(),
        0xc000_00fd => "0xc00000fd (STATUS_STACK_OVERFLOW)".to_string(),
        0xc000_0135 => "0xc0000135 (STATUS_DLL_NOT_FOUND)".to_string(),
        0xc000_007b => "0xc000007b (STATUS_INVALID_IMAGE_FORMAT)".to_string(),
        0xc000_0409 => "0xc0000409 (STATUS_STACK_BUFFER_OVERRUN)".to_string(),
        0xc000_0017 => "0xc0000017 (STATUS_NO_MEMORY)".to_string(),
        0x8000_0003 => "0x80000003 (STATUS_BREAKPOINT / abort)".to_string(),
        c if c >= 0x8000_0000 => format!("0x{c:08x}"),
        _ => format!("exit code {raw}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_windows_ntstatus_codes() {
        assert!(describe_exit_code(Some(0xc000_0005u32 as i32)).contains("STATUS_ACCESS_VIOLATION"));
        assert!(describe_exit_code(Some(0xc000_001du32 as i32)).contains("STATUS_ILLEGAL_INSTRUCTION"));
        assert!(describe_exit_code(Some(0xc000_00fdu32 as i32)).contains("STATUS_STACK_OVERFLOW"));
        assert_eq!(describe_exit_code(Some(1)), "exit code 1");
        assert_eq!(describe_exit_code(None), "terminated by signal");
    }

    #[test]
    fn writes_and_reads_tail_lines() {
        let tmp = std::env::temp_dir().join(format!("docusage-log-test-{}.log", std::process::id()));
        let _ = fs::remove_file(&tmp);
        init_log_path(tmp.clone());
        log_line("backend_init", "initializing llama.cpp");
        log_line("model_load", "loading test.gguf");
        let tail = read_tail_lines(&tmp, 5);
        assert!(tail.iter().any(|l| l.contains("[backend_init]")));
        assert!(tail.iter().any(|l| l.contains("[model_load]")));
        let _ = fs::remove_file(&tmp);
    }
}
