//! Hardware detection: physical RAM and CPU thread layout.
//!
//! Used to size local context windows and inference threads cleanly across
//! Windows, macOS, and Linux, and to report device memory to the UI so the
//! model catalog can indicate which models fit comfortably.

use std::fs;

/// Physical RAM in bytes, when the platform exposes it. `None` means unknown.
#[cfg(not(any(windows, target_os = "macos")))]
pub fn total_memory_bytes() -> Option<u64> {
    fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|text| parse_mem_total(&text))
}

#[cfg(target_os = "macos")]
pub fn total_memory_bytes() -> Option<u64> {
    use std::ffi::{c_char, c_int, c_void};

    unsafe extern "C" {
        fn sysctlbyname(
            name: *const c_char,
            value: *mut c_void,
            length: *mut usize,
            new_value: *mut c_void,
            new_length: usize,
        ) -> c_int;
    }

    let mut bytes: u64 = 0;
    let mut length = std::mem::size_of::<u64>();
    let result = unsafe {
        sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&raw mut bytes).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    (result == 0 && bytes > 0).then_some(bytes)
}

#[cfg(windows)]
pub fn total_memory_bytes() -> Option<u64> {
    #[repr(C)]
    #[derive(Default)]
    struct MemoryStatus {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatus) -> i32;
    }

    let mut status = MemoryStatus {
        length: std::mem::size_of::<MemoryStatus>() as u32,
        ..Default::default()
    };
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    (ok != 0).then_some(status.total_phys)
}

#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn parse_mem_total(meminfo: &str) -> Option<u64> {
    meminfo
        .lines()
        .find(|line| line.starts_with("MemTotal:"))?
        .split_whitespace()
        .nth(1)?
        .parse::<u64>()
        .ok()
        .map(|kb| kb * 1024)
}

fn per_core(leaf: &str) -> Vec<u64> {
    let mut values = Vec::new();
    for cpu in 0..64 {
        let path = format!("/sys/devices/system/cpu/cpu{cpu}/{leaf}");
        match fs::read_to_string(&path)
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
        {
            Some(value) => values.push(value),
            None => break,
        }
    }
    values
}

/// Recommended thread count for local CPU inference.
pub fn inference_threads() -> u32 {
    let logical = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let capacity = per_core("cpu_capacity");
    if !capacity.is_empty() {
        return threads_for(&capacity, 60, logical);
    }
    threads_for(&per_core("cpufreq/cpuinfo_max_freq"), 75, logical)
}

fn threads_for(strengths: &[u64], percent: u64, logical_cores: usize) -> u32 {
    let Some(strongest) = strengths.iter().copied().max() else {
        return (logical_cores / 2).clamp(2, 8) as u32;
    };
    let fast = strengths
        .iter()
        .filter(|s| **s * 100 >= strongest * percent)
        .count();
    fast.clamp(2, 8) as u32
}

/// Recommended context length based on detected system memory.
pub fn recommended_context_length(total_memory_bytes: Option<u64>) -> u32 {
    let Some(bytes) = total_memory_bytes else {
        return 4096;
    };
    let gib = bytes / (1024 * 1024 * 1024);
    if gib >= 16 {
        8192
    } else if gib >= 8 {
        4096
    } else {
        2048
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_mem_total() {
        let sample = "MemTotal:        8040348 kB\nMemFree:          123456 kB\n";
        assert_eq!(parse_mem_total(sample), Some(8_040_348 * 1024));
    }

    #[test]
    fn desktops_use_physical_cores() {
        assert_eq!(threads_for(&[], 60, 8), 4);
        assert_eq!(threads_for(&[], 60, 32), 8);
        assert_eq!(threads_for(&[], 60, 2), 2);
    }

    #[test]
    fn context_length_scales_with_ram() {
        assert_eq!(recommended_context_length(Some(16 * 1024u64.pow(3))), 8192);
        assert_eq!(recommended_context_length(Some(8 * 1024u64.pow(3))), 4096);
        assert_eq!(recommended_context_length(Some(4 * 1024u64.pow(3))), 2048);
        assert_eq!(recommended_context_length(None), 4096);
    }
}
