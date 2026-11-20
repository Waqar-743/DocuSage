//! Pluggable Offline + Online Embedding Service.
//!
//! Supports:
//! - Offline `llama-server` (`/v1/embeddings`)
//! - Offline/Local Ollama (`/api/embed`)
//! - Online Google Gemini (`batchEmbedContents` with `gemini-embedding-001`)
//! - Online/Local OpenAI-compatible (`/v1/embeddings`)
//! - Zero-dependency fallback (`Ok(None)`) so SQLite FTS5 BM25 always works offline without errors.

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::providers::{AiProviderConfig, AiProviderKind};
use crate::services::ai_client::{redact_secret, AiHttpClient};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EmbeddingBackendKind {
    /// Automatically pick the best available backend (local llama-server -> Ollama -> active cloud provider -> FTS5-only).
    Auto,
    /// Disable dense vectors; use pure zero-dependency SQLite FTS5 BM25.
    None,
    /// Use the built-in `llama-server` `/v1/embeddings` endpoint.
    LocalLlama,
    /// Use Ollama `/api/embed`.
    Ollama,
    /// Use Google Gemini `batchEmbedContents`.
    Gemini,
    /// Use OpenAI / OpenAI-compatible `/v1/embeddings`.
    OpenAiCompatible,
}

impl Default for EmbeddingBackendKind {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct EmbeddingConfig {
    pub backend: EmbeddingBackendKind,
    pub model: String,
    pub base_url: Option<String>,
    pub provider_id: Option<String>,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            backend: EmbeddingBackendKind::Auto,
            model: String::new(),
            base_url: None,
            provider_id: None,
        }
    }
}

pub struct EmbeddingBatchResult {
    pub model_id: String,
    pub vectors: Vec<Vec<f32>>,
}

/// Resolve an embedding target from explicit `EmbeddingConfig`, running `llama-server`,
/// or the active AI provider. Returns `None` if no embedding backend is available
/// (graceful fallback to SQLite FTS5 BM25).
#[allow(clippy::too_many_arguments)]
pub async fn embed_texts(
    http: &AiHttpClient,
    config: &EmbeddingConfig,
    texts: &[String],
    local_embed_server: Option<(String, String)>,
    active_provider: Option<&AiProviderConfig>,
    api_key: Option<&str>,
) -> Option<EmbeddingBatchResult> {
    if texts.is_empty() || config.backend == EmbeddingBackendKind::None {
        return None;
    }

    match config.backend {
        EmbeddingBackendKind::None => None,
        EmbeddingBackendKind::LocalLlama => {
            let (base, model) = local_embed_server?;
            let model_name = if config.model.trim().is_empty() {
                model
            } else {
                config.model.trim().to_string()
            };
            embed_openai_compatible(http, &base, &model_name, "", texts)
                .await
                .ok()
        }
        EmbeddingBackendKind::Ollama => {
            let base = config
                .base_url
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("http://localhost:11434")
                .trim_end_matches('/');
            let model = if config.model.trim().is_empty() {
                "nomic-embed-text"
            } else {
                config.model.trim()
            };
            embed_ollama(http, base, model, texts).await.ok()
        }
        EmbeddingBackendKind::Gemini => {
            let key = api_key.filter(|k| !k.trim().is_empty())?;
            let base = config
                .base_url
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
                .trim_end_matches('/');
            let model = if config.model.trim().is_empty() {
                "gemini-embedding-001"
            } else {
                config.model.trim()
            };
            embed_gemini(http, base, model, key, texts).await.ok()
        }
        EmbeddingBackendKind::OpenAiCompatible => {
            let base = config
                .base_url
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("https://api.openai.com/v1")
                .trim_end_matches('/');
            let model = if config.model.trim().is_empty() {
                "text-embedding-3-small"
            } else {
                config.model.trim()
            };
            embed_openai_compatible(http, base, model, api_key.unwrap_or(""), texts)
                .await
                .ok()
        }
        EmbeddingBackendKind::Auto => {
            // 1. Prefer offline running llama-server if available.
            if let Some((base, model)) = local_embed_server {
                if let Ok(res) = embed_openai_compatible(http, &base, &model, "", texts).await {
                    return Some(res);
                }
            }
            // 2. Otherwise use the active provider if it natively supports embeddings.
            let provider = active_provider?;
            let key = api_key.unwrap_or("");
            match provider.provider {
                AiProviderKind::GoogleGemini if !key.trim().is_empty() => {
                    let base = provider
                        .base_url
                        .as_deref()
                        .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
                        .trim_end_matches('/');
                    let model = if config.model.trim().is_empty() {
                        "gemini-embedding-001"
                    } else {
                        config.model.trim()
                    };
                    embed_gemini(http, base, model, key, texts).await.ok()
                }
                AiProviderKind::OpenAi if !key.trim().is_empty() => {
                    let base = provider
                        .base_url
                        .as_deref()
                        .unwrap_or("https://api.openai.com/v1")
                        .trim_end_matches('/');
                    let model = if config.model.trim().is_empty() {
                        "text-embedding-3-small"
                    } else {
                        config.model.trim()
                    };
                    embed_openai_compatible(http, base, model, key, texts)
                        .await
                        .ok()
                }
                AiProviderKind::OllamaLocal | AiProviderKind::OllamaRemote => {
                    let base = provider
                        .base_url
                        .as_deref()
                        .unwrap_or("http://localhost:11434")
                        .trim_end_matches('/');
                    let model = if config.model.trim().is_empty() {
                        "nomic-embed-text"
                    } else {
                        config.model.trim()
                    };
                    embed_ollama(http, base, model, texts).await.ok()
                }
                AiProviderKind::LmStudio | AiProviderKind::LmStudioRemote => {
                    let base = provider
                        .base_url
                        .as_deref()
                        .unwrap_or("http://localhost:1234/v1")
                        .trim_end_matches('/');
                    let model = if config.model.trim().is_empty() {
                        "text-embedding-nomic-embed-text-v1.5"
                    } else {
                        config.model.trim()
                    };
                    embed_openai_compatible(http, base, model, key, texts)
                        .await
                        .ok()
                }
                _ => None,
            }
        }
    }
}

async fn embed_openai_compatible(
    http: &AiHttpClient,
    base_url: &str,
    model: &str,
    api_key: &str,
    texts: &[String],
) -> Result<EmbeddingBatchResult, String> {
    let url = format!("{}/embeddings", base_url.trim_end_matches('/'));
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if !api_key.trim().is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
                .map_err(|e| format!("Invalid embedding auth header: {e}"))?,
        );
    }

    let mut all_vectors = Vec::with_capacity(texts.len());
    for batch in texts.chunks(32) {
        let body = serde_json::json!({
            "model": model,
            "input": batch,
        });
        let resp = http
            .api_client
            .post(&url)
            .headers(headers.clone())
            .json(&body)
            .send()
            .await
            .map_err(|e| redact_secret(&format!("Embedding request failed: {}", e.without_url()), api_key))?;
        if !resp.status().is_success() {
            return Err(format!("Embedding endpoint returned HTTP {}", resp.status()));
        }
        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid embedding response JSON: {e}"))?;
        let data = json["data"]
            .as_array()
            .ok_or_else(|| "Embedding response missing data array.".to_string())?;
        for item in data {
            let vec: Vec<f32> = item["embedding"]
                .as_array()
                .ok_or_else(|| "Embedding item missing vector.".to_string())?
                .iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect();
            if vec.is_empty() {
                return Err("Received empty embedding vector.".into());
            }
            all_vectors.push(vec);
        }
    }

    if all_vectors.len() != texts.len() {
        return Err("Embedding count mismatch.".into());
    }
    Ok(EmbeddingBatchResult {
        model_id: format!("openai:{model}"),
        vectors: all_vectors,
    })
}

async fn embed_ollama(
    http: &AiHttpClient,
    base_url: &str,
    model: &str,
    texts: &[String],
) -> Result<EmbeddingBatchResult, String> {
    let url = format!("{}/api/embed", base_url.trim_end_matches('/'));
    let mut all_vectors = Vec::with_capacity(texts.len());

    for batch in texts.chunks(32) {
        let body = serde_json::json!({
            "model": model,
            "input": batch,
        });
        let resp = http
            .api_client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama embed failed: {}", e.without_url()))?;
        if !resp.status().is_success() {
            return Err(format!("Ollama embed returned HTTP {}", resp.status()));
        }
        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid Ollama embed JSON: {e}"))?;
        let embeddings = json["embeddings"]
            .as_array()
            .ok_or_else(|| "Ollama embed missing embeddings array.".to_string())?;
        for row in embeddings {
            let vec: Vec<f32> = row
                .as_array()
                .ok_or_else(|| "Invalid Ollama embedding vector.".to_string())?
                .iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect();
            if vec.is_empty() {
                return Err("Received empty Ollama embedding vector.".into());
            }
            all_vectors.push(vec);
        }
    }

    if all_vectors.len() != texts.len() {
        return Err("Ollama embedding count mismatch.".into());
    }
    Ok(EmbeddingBatchResult {
        model_id: format!("ollama:{model}"),
        vectors: all_vectors,
    })
}

async fn embed_gemini(
    http: &AiHttpClient,
    base_url: &str,
    model: &str,
    api_key: &str,
    texts: &[String],
) -> Result<EmbeddingBatchResult, String> {
    let clean_model = model.strip_prefix("models/").unwrap_or(model);
    let url = format!(
        "{}/models/{}:batchEmbedContents",
        base_url.trim_end_matches('/'),
        clean_model
    );

    let mut all_vectors = Vec::with_capacity(texts.len());
    for batch in texts.chunks(64) {
        let requests: Vec<Value> = batch
            .iter()
            .map(|text| {
                serde_json::json!({
                    "model": format!("models/{clean_model}"),
                    "content": { "parts": [{ "text": text }] }
                })
            })
            .collect();
        let body = serde_json::json!({ "requests": requests });
        let resp = http
            .api_client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .header("x-goog-api-key", api_key.trim())
            .json(&body)
            .send()
            .await
            .map_err(|e| redact_secret(&format!("Gemini embed failed: {}", e.without_url()), api_key))?;
        if !resp.status().is_success() {
            return Err(format!("Gemini embed returned HTTP {}", resp.status()));
        }
        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid Gemini embed JSON: {e}"))?;
        let embeddings = json["embeddings"]
            .as_array()
            .ok_or_else(|| "Gemini batchEmbedContents missing embeddings array.".to_string())?;
        for item in embeddings {
            let vec: Vec<f32> = item["values"]
                .as_array()
                .ok_or_else(|| "Gemini embedding item missing values.".to_string())?
                .iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect();
            if vec.is_empty() {
                return Err("Received empty Gemini embedding vector.".into());
            }
            all_vectors.push(vec);
        }
    }

    if all_vectors.len() != texts.len() {
        return Err("Gemini embedding count mismatch.".into());
    }
    Ok(EmbeddingBatchResult {
        model_id: format!("gemini:{clean_model}"),
        vectors: all_vectors,
    })
}
