//! Crash-isolated `llama.cpp` inference worker process and supervisor.
//!
//! Native `llama.cpp` / `ggml` faults on Windows (such as `0xc0000005`
//! `STATUS_ACCESS_VIOLATION`, `0xc000001d` `STATUS_ILLEGAL_INSTRUCTION`, or
//! `0xc00000fd` `STATUS_STACK_OVERFLOW`) cannot be caught by Rust `catch_unwind`
//! or JavaScript `try/catch`. Running `llama.cpp` inside a child process spawned
//! from the same `docusage` executable (`--local-engine-worker`) guarantees that
//! a native fault terminates only the worker—never the DocuSage desktop UI—and
//! lets the parent capture the exact OS exit code, stderr, and last flushed FFI
//! stage from `local-engine.log`.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio_util::sync::CancellationToken;

use crate::services::device;
use crate::services::local_engine::{self, GenerationRequest, LoadOptions, LoadedModel};
use crate::services::local_log;

pub const WORKER_ARG: &str = "--local-engine-worker";
pub const SELFTEST_ARG: &str = "--local-engine-selftest";
const WORKER_THREAD_STACK_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_LINES: usize = 40;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WorkerRequest {
    Load {
        model_name: String,
        model_path: String,
        context_length: u32,
        threads: u32,
        use_mmap: bool,
    },
    Generate {
        system_prompt: String,
        history: Vec<(String, String)>,
        user_message: String,
        max_tokens: u32,
        temperature: f32,
        top_p: f32,
        enable_thinking: bool,
    },
    Cancel,
    Shutdown,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WorkerEvent {
    Ready {
        pid: u32,
    },
    Loaded {
        model_name: String,
        context_length: usize,
        threads: u32,
    },
    Token {
        text: String,
    },
    Done {
        reply: String,
        stopped: bool,
        generated_tokens: usize,
        duration_ms: u64,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone)]
pub struct WorkerLoadOutcome {
    pub model_name: String,
    pub context_length: usize,
    pub threads: u32,
}

#[derive(Debug, Clone)]
pub struct WorkerGenerateOutcome {
    pub reply: String,
    pub stopped: bool,
    pub generated_tokens: usize,
    pub duration_ms: u64,
}

fn emit_event(out: &mut std::io::StdoutLock<'_>, event: &WorkerEvent) {
    if let Ok(line) = serde_json::to_string(event) {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

/// Entry point executed when `docusage` is spawned with `--local-engine-worker`.
/// Runs before Tauri or single-instance initialization so no GUI or tray is created.
pub fn run_worker_from_env() -> i32 {
    local_log::log_line(
        "worker_start",
        &format!(
            "starting isolated local engine worker (os={}, arch={})",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );

    enum InferenceCmd {
        Load {
            model_name: String,
            model_path: String,
            context_length: u32,
            threads: u32,
            use_mmap: bool,
        },
        Generate {
            req: GenerationRequest,
            cancel: CancellationToken,
        },
        Shutdown,
    }

    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<InferenceCmd>();
    let active_cancel: Arc<Mutex<Option<CancellationToken>>> = Arc::new(Mutex::new(None));
    let active_cancel_worker = active_cancel.clone();

    let worker_handle = match std::thread::Builder::new()
        .name("docusage-llama-worker".to_string())
        .stack_size(WORKER_THREAD_STACK_BYTES)
        .spawn(move || {
            let stdout = std::io::stdout();
            {
                let mut lock = stdout.lock();
                emit_event(
                    &mut lock,
                    &WorkerEvent::Ready {
                        pid: std::process::id(),
                    },
                );
            }

            let mut loaded: Option<LoadedModel> = None;

            while let Ok(cmd) = cmd_rx.recv() {
                match cmd {
                    InferenceCmd::Load {
                        model_name,
                        model_path,
                        context_length,
                        threads,
                        use_mmap,
                    } => {
                        // Drop previous weights before allocating new ones.
                        loaded = None;
                        let mut options = LoadOptions::default();
                        options.context_length = context_length;
                        options.threads = threads;
                        options.use_mmap = use_mmap;

                        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            local_engine::load_model_from_disk(
                                &model_name,
                                Path::new(&model_path),
                                options,
                            )
                        }));

                        let mut lock = stdout.lock();
                        match outcome {
                            Ok(Ok(model)) => {
                                let ev = WorkerEvent::Loaded {
                                    model_name: model.model_name.clone(),
                                    context_length: model.context_length,
                                    threads: model.threads,
                                };
                                loaded = Some(model);
                                emit_event(&mut lock, &ev);
                            }
                            Ok(Err(message)) => {
                                emit_event(&mut lock, &WorkerEvent::Error { message });
                            }
                            Err(payload) => {
                                let msg = payload
                                    .downcast_ref::<&str>()
                                    .copied()
                                    .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                                    .unwrap_or("unexpected panic during model load");
                                local_log::log_line("worker_panic", msg);
                                emit_event(
                                    &mut lock,
                                    &WorkerEvent::Error {
                                        message: format!("Local engine panicked while loading model: {msg}"),
                                    },
                                );
                            }
                        }
                    }
                    InferenceCmd::Generate { req, cancel } => {
                        let Some(ref mut model) = loaded else {
                            let mut lock = stdout.lock();
                            emit_event(
                                &mut lock,
                                &WorkerEvent::Error {
                                    message: "No model is loaded in the local worker.".to_string(),
                                },
                            );
                            continue;
                        };

                        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            model.generate_streaming(&req, &cancel, |tok| {
                                let mut lock = stdout.lock();
                                emit_event(
                                    &mut lock,
                                    &WorkerEvent::Token {
                                        text: tok.to_string(),
                                    },
                                );
                            })
                        }));

                        if let Ok(mut guard) = active_cancel_worker.lock() {
                            *guard = None;
                        }

                        let mut lock = stdout.lock();
                        match outcome {
                            Ok(Ok(output)) => {
                                emit_event(
                                    &mut lock,
                                    &WorkerEvent::Done {
                                        reply: output.reply,
                                        stopped: output.stopped,
                                        generated_tokens: output.generated_tokens,
                                        duration_ms: output.duration_ms,
                                    },
                                );
                            }
                            Ok(Err(message)) => {
                                emit_event(&mut lock, &WorkerEvent::Error { message });
                            }
                            Err(payload) => {
                                let msg = payload
                                    .downcast_ref::<&str>()
                                    .copied()
                                    .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                                    .unwrap_or("unexpected panic during generation");
                                local_log::log_line("worker_panic", msg);
                                loaded = None;
                                emit_event(
                                    &mut lock,
                                    &WorkerEvent::Error {
                                        message: format!("Local engine panicked while generating: {msg}"),
                                    },
                                );
                            }
                        }
                    }
                    InferenceCmd::Shutdown => {
                        local_log::log_line("worker_shutdown", "unloading model and exiting cleanly");
                        drop(loaded.take());
                        break;
                    }
                }
            }
        }) {
        Ok(handle) => handle,
        Err(e) => {
            local_log::log_line("worker_spawn_thread_err", &e.to_string());
            eprintln!("Failed to spawn inference thread: {e}");
            return 2;
        }
    };

    let stdin = std::io::stdin();
    for line_res in stdin.lock().lines() {
        let Ok(line) = line_res else {
            break;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<WorkerRequest>(trimmed) {
            Ok(WorkerRequest::Load {
                model_name,
                model_path,
                context_length,
                threads,
                use_mmap,
            }) => {
                if cmd_tx
                    .send(InferenceCmd::Load {
                        model_name,
                        model_path,
                        context_length,
                        threads,
                        use_mmap,
                    })
                    .is_err()
                {
                    break;
                }
            }
            Ok(WorkerRequest::Generate {
                system_prompt,
                history,
                user_message,
                max_tokens,
                temperature,
                top_p,
                enable_thinking,
            }) => {
                let cancel = CancellationToken::new();
                if let Ok(mut guard) = active_cancel.lock() {
                    *guard = Some(cancel.clone());
                }
                let req = GenerationRequest {
                    system_prompt,
                    history,
                    user_message,
                    max_tokens,
                    temperature,
                    top_p,
                    enable_thinking,
                };
                if cmd_tx.send(InferenceCmd::Generate { req, cancel }).is_err() {
                    break;
                }
            }
            Ok(WorkerRequest::Cancel) => {
                if let Ok(guard) = active_cancel.lock() {
                    if let Some(ref token) = *guard {
                        token.cancel();
                    }
                }
            }
            Ok(WorkerRequest::Shutdown) => {
                if let Ok(guard) = active_cancel.lock() {
                    if let Some(ref token) = *guard {
                        token.cancel();
                    }
                }
                let _ = cmd_tx.send(InferenceCmd::Shutdown);
                break;
            }
            Err(e) => {
                local_log::log_line("worker_ipc_err", &format!("invalid request: {e}"));
            }
        }
    }

    if let Ok(guard) = active_cancel.lock() {
        if let Some(ref token) = *guard {
            token.cancel();
        }
    }
    let _ = cmd_tx.send(InferenceCmd::Shutdown);
    let _ = worker_handle.join();
    0
}

/// Parent-side handle to an isolated `--local-engine-worker` child process.
pub struct SupervisedWorker {
    child: Child,
    pid: Option<u32>,
    stdin: ChildStdin,
    stdout_lines: Lines<BufReader<ChildStdout>>,
    stderr_buf: Arc<Mutex<Vec<String>>>,
    log_path: PathBuf,
    alive: bool,
}

impl SupervisedWorker {
    pub async fn spawn(log_path: PathBuf) -> Result<Self, String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Could not resolve DocuSage executable path: {e}"))?;

        let mut cmd = Command::new(&exe);
        cmd.arg(WORKER_ARG)
            .env(local_log::ENV_ENGINE_LOG_PATH, &log_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not launch isolated local AI worker: {e}"))?;
        let pid = child.id();

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Worker stdin pipe unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Worker stdout pipe unavailable.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Worker stderr pipe unavailable.".to_string())?;

        let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let stderr_buf_clone = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(mut buf) = stderr_buf_clone.lock() {
                    buf.push(trimmed.to_string());
                    if buf.len() > MAX_STDERR_LINES {
                        buf.remove(0);
                    }
                }
            }
        });

        let mut worker = Self {
            child,
            pid,
            stdin,
            stdout_lines: BufReader::new(stdout).lines(),
            stderr_buf,
            log_path,
            alive: true,
        };

        let ready_line = tokio::time::timeout(
            Duration::from_secs(15),
            worker.stdout_lines.next_line(),
        )
        .await
        .map_err(|_| {
            "Isolated local AI worker timed out during startup.".to_string()
        })?;

        match ready_line {
            Ok(Some(line)) => match serde_json::from_str::<WorkerEvent>(&line) {
                Ok(WorkerEvent::Ready { .. }) => Ok(worker),
                Ok(WorkerEvent::Error { message }) => Err(message),
                other => Err(format!(
                    "Unexpected startup handshake from local AI worker: {other:?}"
                )),
            },
            Ok(None) => Err(worker.collect_crash_report("starting worker").await),
            Err(e) => Err(format!("Failed reading worker startup handshake: {e}")),
        }
    }

    pub fn is_alive(&self) -> bool {
        self.alive
    }

    async fn send_request(&mut self, req: &WorkerRequest) -> Result<(), String> {
        let mut payload = serde_json::to_string(req)
            .map_err(|e| format!("Failed to encode worker request: {e}"))?;
        payload.push('\n');
        self.stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("Failed sending command to local AI worker: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Failed flushing command to local AI worker: {e}"))?;
        Ok(())
    }

    async fn collect_crash_report(&mut self, phase: &str) -> String {
        self.alive = false;
        let status = tokio::time::timeout(Duration::from_secs(3), self.child.wait())
            .await
            .ok()
            .and_then(|res| res.ok());
        let exit_desc = match status {
            Some(s) => local_log::describe_exit_code(s.code()),
            None => "process terminated unexpectedly".to_string(),
        };

        let last_stage = local_log::last_stage_for_pid(&self.log_path, self.pid);
        let stderr_tail = self
            .stderr_buf
            .lock()
            .ok()
            .map(|b| {
                b.iter()
                    .rev()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join(" | ")
            })
            .unwrap_or_default();

        let mut parts = vec![format!(
            "Local AI worker exited unexpectedly while {phase} ({exit_desc}). DocuSage stayed safe."
        )];
        if let Some(stage) = last_stage {
            parts.push(format!("Last engine step: {stage}"));
        }
        if !stderr_tail.is_empty() {
            parts.push(format!("Worker stderr: {stderr_tail}"));
        }
        parts.push(format!("Diagnostic log: {}", self.log_path.display()));
        let report = parts.join(" ");
        local_log::log_line("supervisor_crash_report", &report);
        report
    }

    pub async fn load_model(
        &mut self,
        model_name: &str,
        model_path: &Path,
        context_length: u32,
        threads: u32,
        use_mmap: bool,
    ) -> Result<WorkerLoadOutcome, String> {
        self.send_request(&WorkerRequest::Load {
            model_name: model_name.to_string(),
            model_path: model_path.to_string_lossy().into_owned(),
            context_length,
            threads,
            use_mmap,
        })
        .await?;

        match self.stdout_lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<WorkerEvent>(&line) {
                Ok(WorkerEvent::Loaded {
                    model_name,
                    context_length,
                    threads,
                }) => Ok(WorkerLoadOutcome {
                    model_name,
                    context_length,
                    threads,
                }),
                Ok(WorkerEvent::Error { message }) => Err(format!(
                    "{message} (Diagnostic log: {})",
                    self.log_path.display()
                )),
                other => Err(format!(
                    "Unexpected response while loading {model_name}: {other:?}"
                )),
            },
            Ok(None) => Err(self
                .collect_crash_report(&format!("loading {model_name}"))
                .await),
            Err(e) => Err(format!("Lost connection to local AI worker while loading {model_name}: {e}")),
        }
    }

    pub async fn generate_streaming(
        &mut self,
        req: &GenerationRequest,
        cancel: &CancellationToken,
        mut on_token: impl FnMut(&str),
    ) -> Result<WorkerGenerateOutcome, String> {
        self.send_request(&WorkerRequest::Generate {
            system_prompt: req.system_prompt.clone(),
            history: req.history.clone(),
            user_message: req.user_message.clone(),
            max_tokens: req.max_tokens,
            temperature: req.temperature,
            top_p: req.top_p,
            enable_thinking: req.enable_thinking,
        })
        .await?;

        let mut cancel_sent = false;
        loop {
            let line_res = if cancel_sent {
                match tokio::time::timeout(
                    Duration::from_secs(10),
                    self.stdout_lines.next_line(),
                )
                .await
                {
                    Ok(res) => res,
                    Err(_) => {
                        let _ = self.child.start_kill();
                        self.alive = false;
                        return Ok(WorkerGenerateOutcome {
                            reply: String::new(),
                            stopped: true,
                            generated_tokens: 0,
                            duration_ms: 0,
                        });
                    }
                }
            } else {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        cancel_sent = true;
                        let _ = self.send_request(&WorkerRequest::Cancel).await;
                        continue;
                    }
                    res = self.stdout_lines.next_line() => res,
                }
            };

            match line_res {
                Ok(Some(line)) => match serde_json::from_str::<WorkerEvent>(&line) {
                    Ok(WorkerEvent::Token { text }) => {
                        on_token(&text);
                    }
                    Ok(WorkerEvent::Done {
                        reply,
                        stopped,
                        generated_tokens,
                        duration_ms,
                    }) => {
                        return Ok(WorkerGenerateOutcome {
                            reply,
                            stopped,
                            generated_tokens,
                            duration_ms,
                        });
                    }
                    Ok(WorkerEvent::Error { message }) => {
                        return Err(format!(
                            "{message} (Diagnostic log: {})",
                            self.log_path.display()
                        ));
                    }
                    _ => {}
                },
                Ok(None) => {
                    return Err(self.collect_crash_report("generating a reply").await);
                }
                Err(e) => {
                    self.alive = false;
                    return Err(format!(
                        "Lost connection to local AI worker while generating: {e}"
                    ));
                }
            }
        }
    }

    pub async fn shutdown(mut self) {
        if self.alive {
            let _ = self.send_request(&WorkerRequest::Shutdown).await;
            let _ = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
        }
        let _ = self.child.start_kill();
        self.alive = false;
    }
}

impl Drop for SupervisedWorker {
    fn drop(&mut self) {
        if self.alive {
            let _ = self.child.start_kill();
            self.alive = false;
        }
    }
}

/// Spawn a worker and load `gguf_path` with automatic conservative fallback if
/// the first isolated attempt fails (e.g. mmap/RAM pressure on 8 GB Windows machines).
pub async fn spawn_and_load_with_fallback(
    gguf_path: &Path,
    ctx_override: Option<u32>,
    log_path: PathBuf,
) -> Result<(SupervisedWorker, WorkerLoadOutcome), String> {
    let model_name = gguf_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "local-model.gguf".into());

    // Fast pre-flight GGUF validation in parent before spawning worker.
    let model_bytes = local_engine::validate_gguf_file(&model_name, gguf_path)?;

    let total_mem = device::total_memory_bytes();
    let avail_mem = device::available_memory_bytes();
    let safe_ctx = device::safe_context_length(total_mem, avail_mem, model_bytes);
    let primary_ctx = ctx_override.unwrap_or(safe_ctx).min(safe_ctx).max(512);
    let primary_threads = device::inference_threads();

    let mut worker = SupervisedWorker::spawn(log_path.clone()).await?;
    match worker
        .load_model(&model_name, gguf_path, primary_ctx, primary_threads, true)
        .await
    {
        Ok(outcome) => Ok((worker, outcome)),
        Err(first_err) => {
            worker.shutdown().await;
            local_log::log_line(
                "supervisor_fallback",
                &format!(
                    "first load failed for {model_name}; retrying isolated worker with use_mmap=false ctx={} threads={}",
                    primary_ctx.min(1024),
                    primary_threads.min(2)
                ),
            );
            let mut fallback_worker = SupervisedWorker::spawn(log_path.clone()).await?;
            match fallback_worker
                .load_model(
                    &model_name,
                    gguf_path,
                    primary_ctx.min(1024),
                    primary_threads.min(2),
                    false,
                )
                .await
            {
                Ok(outcome) => Ok((fallback_worker, outcome)),
                Err(second_err) => {
                    fallback_worker.shutdown().await;
                    Err(format!(
                        "{first_err} (Safe CPU fallback without mmap also failed: {second_err})"
                    ))
                }
            }
        }
    }
}

/// CLI end-to-end integration test (`docusage --local-engine-selftest <path.gguf>`).
/// Exercises the exact supervised-worker code path used by the desktop app:
/// loads the GGUF file, generates a real completion, and prints diagnostic output.
pub fn run_selftest_cli(gguf_path: &Path) -> i32 {
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("SELFTEST_FAIL: failed to create async runtime: {e}");
            return 1;
        }
    };

    let log_path = local_log::resolve_log_path();
    local_log::init_log_path(log_path.clone());

    rt.block_on(async move {
        println!(
            "DocuSage Local Engine Self-Test\n  Model: {}\n  Log:   {}",
            gguf_path.display(),
            log_path.display()
        );

        let (mut worker, loaded) = match spawn_and_load_with_fallback(gguf_path, None, log_path.clone()).await {
            Ok(pair) => pair,
            Err(err) => {
                eprintln!("SELFTEST_FAIL (load): {err}");
                return 1;
            }
        };

        println!(
            "Loaded OK: {} (ctx={}, threads={})",
            loaded.model_name, loaded.context_length, loaded.threads
        );

        let req = GenerationRequest {
            system_prompt: "You are a concise assistant.".to_string(),
            history: Vec::new(),
            user_message: "Reply in one short sentence confirming local offline inference works.".to_string(),
            max_tokens: 48,
            temperature: 0.1,
            top_p: 0.95,
            enable_thinking: false,
        };
        let cancel = CancellationToken::new();
        let mut streamed = String::new();
        let gen = worker
            .generate_streaming(&req, &cancel, |tok| {
                streamed.push_str(tok);
            })
            .await;

        worker.shutdown().await;

        match gen {
            Ok(out) => {
                if out.reply.trim().is_empty() && streamed.trim().is_empty() {
                    eprintln!("SELFTEST_FAIL (generate): model returned an empty reply");
                    return 1;
                }
                println!(
                    "SELFTEST_PASS\n  Tokens:   {}\n  Duration: {} ms\n  Reply:    {}",
                    out.generated_tokens,
                    out.duration_ms,
                    if out.reply.is_empty() { &streamed } else { &out.reply }
                );
                0
            }
            Err(err) => {
                eprintln!("SELFTEST_FAIL (generate): {err}");
                1
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_corrupt_gguf_before_spawning_worker() {
        let tmp = std::env::temp_dir().join(format!(
            "docusage-worker-corrupt-{}.gguf",
            std::process::id()
        ));
        std::fs::write(&tmp, b"NOT_A_GGUF_FILE").unwrap();
        let log_path = std::env::temp_dir().join(format!(
            "docusage-worker-corrupt-{}.log",
            std::process::id()
        ));

        let res = spawn_and_load_with_fallback(&tmp, None, log_path.clone()).await;
        let err = match res {
            Ok(_) => panic!("expected corrupt GGUF to fail validation"),
            Err(e) => e,
        };
        assert!(
            err.contains("incomplete") || err.contains("not a valid GGUF"),
            "unexpected error: {err}"
        );

        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(&log_path);
    }
}
