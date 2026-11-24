//! In-process GGUF text generation powered by `llama-cpp-2`.
//!
//! Architecture adapted from Neurix: runs llama.cpp directly inside the Tauri
//! Rust process (no external `llama-server.exe` binary download or sidecar
//! process management), eliminating Windows `0xc0000005` Vulkan DLL crashes.

use std::ffi::{c_char, c_void, CStr};
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Instant;

use llama_cpp_2::context::params::{KvCacheType, LlamaContextParams};
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use llama_cpp_2::{LlamaStateSeqFlags, SeqState};
use llama_cpp_sys_2::{LLAMA_FLASH_ATTN_TYPE_DISABLED, LLAMA_FLASH_ATTN_TYPE_ENABLED};
use log::{error, info, warn};
use tokio_util::sync::CancellationToken;

use crate::services::local_stream::{self, ReplyFilter, StreamChunk, Utf8Assembler};
use crate::services::local_template::{ChatTemplate, TemplateMessage};

const PROMPT_BATCH: usize = 128;
const CONTEXT_MARGIN: usize = 16;
const MAX_CHECKPOINTS: usize = 4;
const TRIM_TARGET_PERCENT: usize = 70;

#[derive(Debug, Clone, Copy)]
pub struct SamplingDefaults {
    pub top_k: i32,
    pub min_p: f32,
    pub repeat_penalty: f32,
}

impl SamplingDefaults {
    pub fn for_model_filename(filename: &str) -> Self {
        let lower = filename.to_ascii_lowercase();
        if lower.contains("qwen") {
            if lower.contains("0.5b") || lower.contains("0.8b") {
                Self {
                    top_k: 20,
                    min_p: 0.0,
                    repeat_penalty: 1.05,
                }
            } else {
                Self {
                    top_k: 20,
                    min_p: 0.0,
                    repeat_penalty: 1.0,
                }
            }
        } else if lower.contains("gemma") {
            Self {
                top_k: 64,
                min_p: 0.0,
                repeat_penalty: 1.0,
            }
        } else if lower.contains("lfm") {
            Self {
                top_k: 50,
                min_p: 0.15,
                repeat_penalty: 1.05,
            }
        } else if lower.contains("1b") || lower.contains("0.5b") {
            Self {
                top_k: 40,
                min_p: 0.05,
                repeat_penalty: 1.05,
            }
        } else {
            Self {
                top_k: 40,
                min_p: 0.05,
                repeat_penalty: 1.0,
            }
        }
    }
}

pub struct LoadOptions {
    pub context_length: u32,
    pub threads: u32,
    pub kv_cache_quant: String,
    pub flash_attention: bool,
    pub gpu_layers: u32,
}

impl Default for LoadOptions {
    fn default() -> Self {
        let mem = crate::services::device::total_memory_bytes();
        Self {
            context_length: crate::services::device::recommended_context_length(mem),
            threads: crate::services::device::inference_threads(),
            kv_cache_quant: "q8_0".to_string(),
            flash_attention: true,
            gpu_layers: 0,
        }
    }
}

pub struct GenerationRequest {
    pub system_prompt: String,
    pub history: Vec<(String, String)>,
    pub user_message: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_p: f32,
    pub enable_thinking: bool,
}

pub struct GenerationOutput {
    pub reply: String,
    pub stopped: bool,
    pub generated_tokens: usize,
    pub duration_ms: u64,
}

struct Session {
    // Field order matters: `ctx` borrows `model` and must drop first.
    ctx: LlamaContext<'static>,
    model: Box<LlamaModel>,
}

struct Checkpoint {
    pos: usize,
    state: SeqState,
}

pub struct LoadedModel {
    pub model_name: String,
    pub context_length: usize,
    pub threads: u32,
    session: Session,
    template: ChatTemplate,
    sampling: SamplingDefaults,
    cached: Vec<LlamaToken>,
    checkpointing: bool,
    checkpoints: Vec<Checkpoint>,
}

unsafe extern "C" fn forward_log(
    level: llama_cpp_sys_2::ggml_log_level,
    text: *const c_char,
    _user_data: *mut c_void,
) {
    if text.is_null() {
        return;
    }
    let message = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    let message = message.trim_end();
    if message.is_empty() {
        return;
    }
    if level == llama_cpp_sys_2::GGML_LOG_LEVEL_ERROR {
        error!("llama.cpp: {message}");
    } else if level == llama_cpp_sys_2::GGML_LOG_LEVEL_WARN {
        warn!("llama.cpp: {message}");
    }
}

fn backend() -> Result<&'static LlamaBackend, String> {
    static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| {
            unsafe { llama_cpp_sys_2::llama_log_set(Some(forward_log), std::ptr::null_mut()) };
            LlamaBackend::init()
                .map_err(|e| format!("Could not initialize built-in llama.cpp engine: {e}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn special_token_text(model: &LlamaModel, token: LlamaToken) -> String {
    let vocab = model.vocab();
    if token.0 < 0 || token.0 >= vocab.n_tokens() {
        return String::new();
    }
    String::from_utf8_lossy(&vocab.token_to_piece(token, true, None)).into_owned()
}

pub fn load_model_from_disk(
    model_name: &str,
    model_path: &Path,
    options: LoadOptions,
) -> Result<LoadedModel, String> {
    let backend = backend()?;
    let started = Instant::now();

    info!("Loading {model_name} from {}", model_path.display());
    let mut gpu_layers = options.gpu_layers.min(999);
    if gpu_layers != 0 && !backend.supports_gpu_offload() {
        gpu_layers = 0;
    }

    let load_weights = |layers| {
        let params = LlamaModelParams::default().with_n_gpu_layers(layers);
        LlamaModel::load_from_file(backend, model_path, &params)
    };
    let weights = match load_weights(gpu_layers) {
        Err(e) if gpu_layers != 0 => {
            warn!("GPU offload failed for {model_name} ({e}); retrying on CPU");
            load_weights(0)
        }
        result => result,
    };
    let model = weights.map_err(|e| {
        format!(
            "Could not load {model_name} ({e}). The GGUF file may be damaged — delete it and download again."
        )
    })?;
    let model = Box::new(model);

    let trained = model.n_ctx_train().max(512);
    let n_ctx = options.context_length.clamp(512, trained);
    let threads = options.threads.clamp(1, 32) as i32;

    let base_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx))
        .with_n_batch(PROMPT_BATCH as u32)
        .with_n_threads(threads)
        .with_n_threads_batch(threads);

    // SAFETY: `model` is heap-allocated in a `Box` and stored in `Session`
    // after `ctx`, so `ctx` is always dropped before `model`.
    let model_ref: &'static LlamaModel = unsafe { &*(model.as_ref() as *const LlamaModel) };
    let flash_attention = options.flash_attention
        && !model
            .meta_val_str("general.architecture")
            .is_ok_and(|arch| arch == "grok");
    let kv_type = match (flash_attention, options.kv_cache_quant.as_str()) {
        (true, "q8_0") => KvCacheType::Q8_0,
        (true, "q4_0") => KvCacheType::Q4_0,
        _ => KvCacheType::F16,
    };
    let new_context = |flash, cache_type| {
        let policy = if flash {
            LLAMA_FLASH_ATTN_TYPE_ENABLED
        } else {
            LLAMA_FLASH_ATTN_TYPE_DISABLED
        };
        model_ref.new_context(
            backend,
            base_params
                .clone()
                .with_flash_attention_policy(policy)
                .with_type_k(cache_type)
                .with_type_v(cache_type),
        )
    };
    let context = match new_context(flash_attention, kv_type) {
        Err(e) if flash_attention || kv_type != KvCacheType::F16 => {
            warn!("Context setup failed for {model_name} ({e}); retrying with F16 and Flash Attention off");
            new_context(false, KvCacheType::F16)
        }
        result => result,
    };
    let ctx = context.map_err(|e| {
        format!(
            "Not enough memory to start {model_name} ({e}). Close other apps or choose a smaller model."
        )
    })?;
    let context_length = ctx.n_ctx() as usize;

    let vocab = model.vocab();
    let template_source = model
        .chat_template(None)
        .ok()
        .and_then(|t| t.to_string().ok());
    let template = ChatTemplate::new(
        template_source,
        special_token_text(&model, vocab.bos()),
        special_token_text(&model, vocab.eos()),
    );
    let checkpointing = model.is_recurrent() || model.is_hybrid();
    let sampling = SamplingDefaults::for_model_filename(model_name);

    info!(
        "Loaded {model_name} in {} ms (ctx {context_length}, {threads} threads)",
        started.elapsed().as_millis()
    );

    Ok(LoadedModel {
        model_name: model_name.to_string(),
        context_length,
        threads: threads as u32,
        session: Session { ctx, model },
        template,
        sampling,
        cached: Vec::new(),
        checkpointing,
        checkpoints: Vec::new(),
    })
}

fn common_prefix(a: &[LlamaToken], b: &[LlamaToken]) -> usize {
    a.iter().zip(b).take_while(|(x, y)| x == y).count()
}

struct RenderedPrompt {
    text: String,
    tokens: Vec<LlamaToken>,
    stable_len: usize,
}

impl LoadedModel {
    fn render(
        &self,
        request: &GenerationRequest,
        history: &[(String, String)],
        add_generation_prompt: bool,
    ) -> Result<String, String> {
        let system = request.system_prompt.trim();
        let mut messages = Vec::with_capacity(history.len() * 2 + 2);
        if !system.is_empty() {
            messages.push(TemplateMessage::system(system));
        }
        for (user, assistant) in history {
            messages.push(TemplateMessage::user(user.as_str()));
            messages.push(TemplateMessage::assistant(assistant.as_str()));
        }
        messages.push(TemplateMessage::user(request.user_message.as_str()));

        match self
            .template
            .render(&messages, add_generation_prompt, request.enable_thinking)
        {
            Ok(text) => Ok(text),
            Err(first_err) if !system.is_empty() => {
                let mut merged = messages[1..].to_vec();
                merged[0].content = format!("{system}\n\n{}", merged[0].content);
                self.template
                    .render(&merged, add_generation_prompt, request.enable_thinking)
                    .map_err(|_| first_err)
            }
            Err(e) => Err(e),
        }
    }

    fn tokenize(&self, text: &str) -> Vec<LlamaToken> {
        let bos = self.template.bos_token();
        let add_special = bos.is_empty() || !text.starts_with(bos);
        self.session
            .model
            .vocab()
            .tokenize(text.as_bytes(), add_special, true)
    }

    fn build_prompt(
        &self,
        request: &GenerationRequest,
        history: &[(String, String)],
    ) -> Result<RenderedPrompt, String> {
        let text = self.render(request, history, true)?;
        let tokens = self.tokenize(&text);
        let stable_len = self
            .render(request, history, false)
            .map(|stable| common_prefix(&self.tokenize(&stable), &tokens))
            .unwrap_or(0);
        Ok(RenderedPrompt {
            text,
            tokens,
            stable_len,
        })
    }

    fn fit_prompt(
        &self,
        request: &GenerationRequest,
        max_tokens: usize,
    ) -> Result<RenderedPrompt, String> {
        let budget = self
            .context_length
            .saturating_sub(max_tokens + CONTEXT_MARGIN);
        let mut dropped = 0usize;
        let mut prompt = self.build_prompt(request, &request.history[dropped..])?;
        if prompt.tokens.len() > budget {
            let target = budget * TRIM_TARGET_PERCENT / 100;
            while prompt.tokens.len() > target && dropped < request.history.len() {
                dropped += 1;
                prompt = self.build_prompt(request, &request.history[dropped..])?;
            }
            if prompt.tokens.len() > budget {
                return Err(format!(
                    "Message is too long for this model's context ({} tokens > {} budget). Try shortening the prompt or attached context.",
                    prompt.tokens.len(),
                    budget
                ));
            }
        }
        Ok(prompt)
    }

    fn sampler(&self, request: &GenerationRequest) -> LlamaSampler {
        let s = self.sampling;
        let mut chain = Vec::new();
        if (s.repeat_penalty - 1.0).abs() > f32::EPSILON {
            chain.push(LlamaSampler::penalties(
                self.session.model.n_vocab(),
                64,
                s.repeat_penalty,
                0.0,
                0.0,
            ));
        }
        if request.temperature <= 0.0 {
            chain.push(LlamaSampler::greedy());
            return LlamaSampler::chain_simple(chain);
        }
        if s.top_k > 0 {
            chain.push(LlamaSampler::top_k(s.top_k));
        }
        if request.top_p < 1.0 {
            chain.push(LlamaSampler::top_p(request.top_p, 1));
        }
        if s.min_p > 0.0 {
            chain.push(LlamaSampler::min_p(s.min_p, 1));
        }
        chain.push(LlamaSampler::temp(request.temperature));
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() ^ (d.as_secs() as u32))
            .unwrap_or(0x5eed);
        chain.push(LlamaSampler::dist(seed));
        LlamaSampler::chain_simple(chain)
    }

    fn reset_context(&mut self) {
        self.session.ctx.clear_kv_cache();
        self.cached.clear();
        self.checkpoints.clear();
    }

    fn rewind_to(&mut self, target: usize) -> usize {
        if self
            .session
            .ctx
            .kv_cache_seq_rm(0, Some(target as u32), None)
            .is_ok()
        {
            self.cached.truncate(target);
            self.checkpoints.retain(|c| c.pos <= target);
            return target;
        }

        self.checkpointing = true;
        if let Some(index) = self.checkpoints.iter().rposition(|c| c.pos <= target) {
            self.checkpoints.truncate(index + 1);
            let checkpoint = &self.checkpoints[index];
            let pos = checkpoint.pos;
            let restored = self.session.ctx.state_seq_set(&checkpoint.state, 0).is_ok()
                && self
                    .session
                    .ctx
                    .kv_cache_seq_rm(0, Some(pos as u32), None)
                    .is_ok();
            if restored {
                self.cached.truncate(pos);
                return pos;
            }
        }

        self.reset_context();
        0
    }

    fn save_checkpoint(&mut self) {
        let pos = self.cached.len();
        if self.checkpoints.iter().any(|c| c.pos == pos) {
            return;
        }
        if let Ok(state) = self
            .session
            .ctx
            .state_seq_get(0, LlamaStateSeqFlags::PARTIAL_ONLY)
        {
            self.checkpoints.push(Checkpoint { pos, state });
            if self.checkpoints.len() > MAX_CHECKPOINTS {
                self.checkpoints.remove(0);
            }
        }
    }

    fn ingest(
        &mut self,
        prompt: &RenderedPrompt,
        cancel: &CancellationToken,
    ) -> Result<bool, String> {
        let tokens = prompt.tokens.as_slice();
        if tokens.is_empty() {
            return Err("Prompt is empty.".to_string());
        }
        let mut reused = common_prefix(&self.cached, tokens).min(tokens.len() - 1);
        if reused < self.cached.len() {
            reused = self.rewind_to(reused);
        }

        let snapshot_at = (self.checkpointing
            && prompt.stable_len > reused
            && prompt.stable_len < tokens.len())
        .then_some(prompt.stable_len);

        let mut batch = LlamaBatch::new(PROMPT_BATCH, 1);
        while self.cached.len() < tokens.len() {
            if cancel.is_cancelled() {
                return Ok(false);
            }
            let from = self.cached.len();
            let limit = match snapshot_at {
                Some(at) if from < at => at,
                _ => tokens.len(),
            };
            let to = (from + PROMPT_BATCH).min(limit);

            batch.clear();
            for (position, token) in tokens.iter().enumerate().take(to).skip(from) {
                batch
                    .add(*token, position as i32, &[0], position + 1 == tokens.len())
                    .map_err(|e| format!("Failed to queue prompt tokens: {e}"))?;
            }
            if let Err(e) = self.session.ctx.decode(&mut batch) {
                self.reset_context();
                return Err(format!("Local model failed while reading prompt: {e}"));
            }
            self.cached.extend_from_slice(&tokens[from..to]);

            if snapshot_at == Some(to) {
                self.save_checkpoint();
            }
        }
        Ok(true)
    }

    pub fn generate_streaming(
        &mut self,
        request: &GenerationRequest,
        cancel: &CancellationToken,
        mut on_token: impl FnMut(&str),
    ) -> Result<GenerationOutput, String> {
        let max_tokens = (request.max_tokens.max(16) as usize).min(self.context_length / 2);
        let prompt = self.fit_prompt(request, max_tokens)?;

        let started = Instant::now();
        if !self.ingest(&prompt, cancel)? {
            return Ok(GenerationOutput {
                reply: String::new(),
                stopped: true,
                generated_tokens: 0,
                duration_ms: started.elapsed().as_millis() as u64,
            });
        }

        let mut sampler = self.sampler(request);
        let mut batch = LlamaBatch::new(1, 1);
        let mut assembler = Utf8Assembler::default();
        let mut filter = ReplyFilter::new(local_stream::prompt_opens_reasoning(&prompt.text));
        let mut chunks: Vec<StreamChunk> = Vec::new();
        let mut generated: Vec<i32> = Vec::with_capacity(max_tokens);
        let mut full_reply = String::new();
        let mut stopped = false;

        let mut deliver = |chunks: &mut Vec<StreamChunk>, full_reply: &mut String| {
            for chunk in chunks.drain(..) {
                if let StreamChunk::Answer(tok) = chunk {
                    if !tok.is_empty() {
                        full_reply.push_str(&tok);
                        on_token(&tok);
                    }
                }
            }
        };

        loop {
            if cancel.is_cancelled() {
                stopped = true;
                break;
            }
            let token = sampler.sample(&self.session.ctx, -1);
            let vocab = self.session.model.vocab();
            if vocab.is_eog(token) {
                break;
            }
            generated.push(token.0);

            let piece = vocab.token_to_piece(token, true, None);
            let hidden = vocab.is_control(token)
                && !local_stream::is_reasoning_marker(&String::from_utf8_lossy(&piece));
            if !hidden {
                let text = assembler.push(&piece);
                if !text.is_empty() {
                    filter.push(&text, &mut chunks);
                    deliver(&mut chunks, &mut full_reply);
                }
            }

            if generated.len() >= max_tokens || self.cached.len() >= self.context_length {
                break;
            }
            if cancel.is_cancelled() {
                stopped = true;
                break;
            }
            if generated.len() % 32 == 0 && local_stream::is_stuck(&generated) {
                break;
            }

            batch.clear();
            batch
                .add(token, self.cached.len() as i32, &[0], true)
                .map_err(|e| format!("Failed to queue token: {e}"))?;
            if let Err(e) = self.session.ctx.decode(&mut batch) {
                self.reset_context();
                return Err(format!("Local model failed while generating: {e}"));
            }
            self.cached.push(token);
        }

        assembler.reset();
        filter.finish(&mut chunks);
        deliver(&mut chunks, &mut full_reply);

        Ok(GenerationOutput {
            reply: full_reply.trim().to_string(),
            stopped,
            generated_tokens: generated.len(),
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampling_defaults_match_model_families() {
        let qwen = SamplingDefaults::for_model_filename("Qwen3.5-2B-Q4_K_M.gguf");
        assert_eq!(qwen.top_k, 20);
        let gemma = SamplingDefaults::for_model_filename("gemma-4-E2B_q4_0-it.gguf");
        assert_eq!(gemma.top_k, 64);
        let lfm = SamplingDefaults::for_model_filename("LFM2.5-1.2B-Instruct-Q5_K_M.gguf");
        assert_eq!(lfm.top_k, 50);
    }
}
