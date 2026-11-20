//! Unified streaming AI client with shared connection pools, API-key redaction,
//! full SSE/NDJSON streaming + `CancellationToken` cancellation across all providers,
//! and dynamic model listing ("Verify & Fetch Models").

use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use crate::providers::{AiProviderConfig, AiProviderKind};
use crate::services::sse::{StreamDelta, StreamFormat, StreamParser};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub sender: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTokenPayload {
    pub request_id: String,
    pub token: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelInfo {
    pub id: String,
    pub label: String,
}

/// Warm shared `reqwest` client pool.
/// - `stream_client`: 15s connect timeout, NO whole-request timeout so long streams never drop.
/// - `api_client`: 15s connect timeout, 30s request timeout for model discovery / embeddings / health.
pub struct AiHttpClient {
    pub stream_client: reqwest::Client,
    pub api_client: reqwest::Client,
}

impl AiHttpClient {
    pub fn new() -> Self {
        let stream_client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(8)
            .user_agent("DocuSage/2.0")
            .build()
            .expect("failed to construct stream reqwest client");

        let api_client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(8)
            .user_agent("DocuSage/2.0")
            .build()
            .expect("failed to construct api reqwest client");

        Self {
            stream_client,
            api_client,
        }
    }
}

impl Default for AiHttpClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Redact sensitive API keys from any error string or log line before surfacing it.
pub fn redact_secret(text: &str, secret: &str) -> String {
    if secret.trim().len() < 4 {
        return text.to_string();
    }
    text.replace(secret, "[REDACTED]")
}

fn bearer_headers(config: &AiProviderConfig, api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if !api_key.trim().is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
                .map_err(|e| format!("Invalid API key header value: {e}"))?,
        );
    }
    if let Some(org) = config.organization.as_deref() {
        if !org.trim().is_empty() {
            headers.insert(
                "OpenAI-Organization",
                HeaderValue::from_str(org.trim())
                    .map_err(|e| format!("Invalid organization header: {e}"))?,
            );
        }
    }
    if let Some(project) = config.project.as_deref() {
        if !project.trim().is_empty() {
            headers.insert(
                "OpenAI-Project",
                HeaderValue::from_str(project.trim())
                    .map_err(|e| format!("Invalid project header: {e}"))?,
            );
        }
    }
    if config.provider == AiProviderKind::OpenRouter {
        headers.insert("HTTP-Referer", HeaderValue::from_static("https://docusage.app"));
        headers.insert("X-Title", HeaderValue::from_static("DocuSage"));
    }
    Ok(headers)
}

fn to_openai_messages(system_prompt: &str, history: &[ChatMessage], prompt: &str) -> Vec<Value> {
    let mut messages = vec![serde_json::json!({ "role": "system", "content": system_prompt })];
    for msg in history {
        let role = if msg.sender == "user" {
            "user"
        } else {
            "assistant"
        };
        let text = msg.text.trim();
        if !text.is_empty() {
            messages.push(serde_json::json!({ "role": role, "content": text }));
        }
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));
    messages
}

fn effective_base_url(config: &AiProviderConfig, local_base_url: Option<&str>) -> Result<String, String> {
    if config.provider == AiProviderKind::Local {
        return local_base_url
            .map(|u| u.trim_end_matches('/').to_string())
            .ok_or_else(|| {
                "Built-in Local AI runtime is not running. Connect a GGUF model in Settings -> Local AI."
                    .to_string()
            });
    }
    config
        .base_url
        .as_deref()
        .map(|u| u.trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty())
        .ok_or_else(|| "Base URL is required for this provider.".to_string())
}

fn effective_model(config: &AiProviderConfig, model_override: Option<&str>) -> Result<String, String> {
    if let Some(m) = model_override.map(str::trim).filter(|m| !m.is_empty()) {
        return Ok(m.to_string());
    }
    if config.provider == AiProviderKind::Local {
        return Ok(config
            .model
            .clone()
            .unwrap_or_else(|| "local-gguf".to_string()));
    }
    config
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "Model is required for this provider.".to_string())
}

/// Stream a chat completion from ANY configured provider with instant `CancellationToken` support.
/// Emits `chat-token` events progressively and returns the accumulated reply.
#[allow(clippy::too_many_arguments)]
pub async fn stream_chat_completion(
    app: &AppHandle,
    http: &AiHttpClient,
    config: &AiProviderConfig,
    api_key: &str,
    local_base_url: Option<&str>,
    model_override: Option<&str>,
    system_prompt: &str,
    history: &[ChatMessage],
    prompt: &str,
    request_id: &str,
    grounded: bool,
    cancel_token: CancellationToken,
) -> Result<(String, bool), String> {
    let base = effective_base_url(config, local_base_url)?;
    let model = effective_model(config, model_override)?;
    let temp = if grounded {
        config.temperature.min(0.25)
    } else {
        config.temperature
    };

    let (response_fut, format) = match config.provider {
        AiProviderKind::Local
        | AiProviderKind::OpenAi
        | AiProviderKind::OpenRouter
        | AiProviderKind::LmStudio
        | AiProviderKind::LmStudioRemote
        | AiProviderKind::CustomOpenAiCompatible => {
            let url = format!("{base}/chat/completions");
            let body = serde_json::json!({
                "model": model,
                "stream": true,
                "temperature": temp,
                "messages": to_openai_messages(system_prompt, history, prompt),
            });
            let req = http
                .stream_client
                .post(url)
                .headers(bearer_headers(config, api_key)?)
                .json(&body);
            (req.send(), StreamFormat::OpenAiSse)
        }
        AiProviderKind::Anthropic => {
            let url = format!("{base}/messages");
            let mut messages = Vec::new();
            for msg in history {
                let role = if msg.sender == "user" {
                    "user"
                } else {
                    "assistant"
                };
                if !msg.text.trim().is_empty() {
                    messages.push(serde_json::json!({ "role": role, "content": msg.text }));
                }
            }
            messages.push(serde_json::json!({ "role": "user", "content": prompt }));
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 4096,
                "stream": true,
                "temperature": temp,
                "system": system_prompt,
                "messages": messages,
            });
            let mut headers = HeaderMap::new();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(api_key.trim())
                    .map_err(|e| format!("Invalid Anthropic API key header: {e}"))?,
            );
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
            let req = http.stream_client.post(url).headers(headers).json(&body);
            (req.send(), StreamFormat::AnthropicSse)
        }
        AiProviderKind::GoogleGemini => {
            let url = format!("{base}/models/{model}:streamGenerateContent?alt=sse");
            let mut contents = Vec::new();
            for msg in history {
                let role = if msg.sender == "user" { "user" } else { "model" };
                if !msg.text.trim().is_empty() {
                    contents.push(serde_json::json!({
                        "role": role,
                        "parts": [{ "text": msg.text }]
                    }));
                }
            }
            contents.push(serde_json::json!({
                "role": "user",
                "parts": [{ "text": prompt }]
            }));
            let body = serde_json::json!({
                "systemInstruction": { "parts": [{ "text": system_prompt }] },
                "contents": contents,
                "generationConfig": { "temperature": temp }
            });
            let req = http
                .stream_client
                .post(url)
                .header(CONTENT_TYPE, "application/json")
                .header("x-goog-api-key", api_key.trim())
                .json(&body);
            (req.send(), StreamFormat::GeminiSse)
        }
        AiProviderKind::OllamaLocal | AiProviderKind::OllamaRemote => {
            let url = format!("{base}/api/chat");
            let body = serde_json::json!({
                "model": model,
                "stream": true,
                "options": { "temperature": temp },
                "messages": to_openai_messages(system_prompt, history, prompt),
            });
            let req = http
                .stream_client
                .post(url)
                .headers(bearer_headers(config, api_key)?)
                .json(&body);
            (req.send(), StreamFormat::OllamaNdjson)
        }
    };

    let response = tokio::select! {
        res = response_fut => res.map_err(|e| redact_secret(&format!("Provider request failed: {}", e.without_url()), api_key))?,
        _ = cancel_token.cancelled() => {
            emit_done(app, request_id);
            return Ok((String::new(), true));
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let snippet: String = redact_secret(&body, api_key).chars().take(260).collect();
        return Err(format!(
            "Provider returned HTTP {status}. {}",
            if snippet.trim().is_empty() {
                "Check the model, endpoint, and credentials.".to_string()
            } else {
                snippet
            }
        ));
    }

    let mut parser = StreamParser::new(format);
    let mut stream = response.bytes_stream();
    let mut full_reply = String::new();
    let mut stopped = false;

    loop {
        let next_chunk = tokio::select! {
            chunk = stream.next() => chunk,
            _ = cancel_token.cancelled() => {
                stopped = true;
                None
            }
        };

        let Some(chunk_res) = next_chunk else {
            break;
        };

        let bytes = chunk_res.map_err(|e| {
            redact_secret(&format!("Stream interrupted: {}", e.without_url()), api_key)
        })?;

        for delta in parser.push(&bytes) {
            match delta {
                StreamDelta::Token(tok) if !tok.is_empty() => {
                    full_reply.push_str(&tok);
                    let _ = app.emit(
                        "chat-token",
                        ChatTokenPayload {
                            request_id: request_id.to_string(),
                            token: tok,
                            done: false,
                        },
                    );
                }
                StreamDelta::Done => {
                    emit_done(app, request_id);
                    return Ok((full_reply.trim().to_string(), stopped));
                }
                _ => {}
            }
        }
    }

    if !stopped {
        for delta in parser.finish() {
            if let StreamDelta::Token(tok) = delta {
                if !tok.is_empty() {
                    full_reply.push_str(&tok);
                    let _ = app.emit(
                        "chat-token",
                        ChatTokenPayload {
                            request_id: request_id.to_string(),
                            token: tok,
                            done: false,
                        },
                    );
                }
            }
        }
    }

    emit_done(app, request_id);
    Ok((full_reply.trim().to_string(), stopped))
}

fn emit_done(app: &AppHandle, request_id: &str) {
    let _ = app.emit(
        "chat-token",
        ChatTokenPayload {
            request_id: request_id.to_string(),
            token: String::new(),
            done: true,
        },
    );
}

/// Dynamically fetch available models from a provider ("Verify & Fetch Models").
pub async fn fetch_provider_models(
    http: &AiHttpClient,
    config: &AiProviderConfig,
    api_key: &str,
) -> Result<Vec<ProviderModelInfo>, String> {
    let base = effective_base_url(config, None)?;

    match config.provider {
        AiProviderKind::OllamaLocal | AiProviderKind::OllamaRemote => {
            let url = format!("{base}/api/tags");
            let resp = http
                .api_client
                .get(url)
                .headers(bearer_headers(config, api_key)?)
                .send()
                .await
                .map_err(|e| redact_secret(&format!("Ollama request failed: {}", e.without_url()), api_key))?;
            if !resp.status().is_success() {
                return Err(format!("Ollama returned HTTP {}", resp.status()));
            }
            let json: Value = resp
                .json()
                .await
                .map_err(|e| format!("Invalid Ollama tags JSON: {e}"))?;
            let mut models: Vec<ProviderModelInfo> = json["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["name"].as_str())
                .map(|id| ProviderModelInfo {
                    id: id.to_string(),
                    label: id.to_string(),
                })
                .collect();
            models.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(models)
        }
        AiProviderKind::GoogleGemini => {
            let url = format!("{base}/models");
            let resp = http
                .api_client
                .get(url)
                .header("x-goog-api-key", api_key.trim())
                .send()
                .await
                .map_err(|e| redact_secret(&format!("Gemini request failed: {}", e.without_url()), api_key))?;
            if !resp.status().is_success() {
                return Err(format!("Gemini returned HTTP {}", resp.status()));
            }
            let json: Value = resp
                .json()
                .await
                .map_err(|e| format!("Invalid Gemini models JSON: {e}"))?;
            let mut models: Vec<ProviderModelInfo> = json["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"]
                        .as_array()
                        .is_some_and(|arr| {
                            arr.iter()
                                .any(|v| v.as_str() == Some("generateContent"))
                        })
                })
                .filter_map(|m| {
                    let raw = m["name"].as_str()?;
                    let id = raw.strip_prefix("models/").unwrap_or(raw).to_string();
                    let label = m["displayName"]
                        .as_str()
                        .map(|d| format!("{d} ({id})"))
                        .unwrap_or_else(|| id.clone());
                    Some(ProviderModelInfo { id, label })
                })
                .collect();
            models.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(models)
        }
        AiProviderKind::Anthropic => {
            let url = format!("{base}/models");
            let mut headers = HeaderMap::new();
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(api_key.trim())
                    .map_err(|e| format!("Invalid Anthropic key header: {e}"))?,
            );
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
            let resp = http
                .api_client
                .get(url)
                .headers(headers)
                .send()
                .await
                .map_err(|e| redact_secret(&format!("Anthropic request failed: {}", e.without_url()), api_key))?;
            if !resp.status().is_success() {
                return Err(format!("Anthropic returned HTTP {}", resp.status()));
            }
            let json: Value = resp
                .json()
                .await
                .map_err(|e| format!("Invalid Anthropic models JSON: {e}"))?;
            let mut models: Vec<ProviderModelInfo> = json["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| {
                    let id = m["id"].as_str()?.to_string();
                    let label = m["display_name"]
                        .as_str()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| id.clone());
                    Some(ProviderModelInfo { id, label })
                })
                .collect();
            models.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(models)
        }
        _ => {
            // OpenAI, OpenRouter, LM Studio, Custom OpenAI-compatible
            let url = format!("{base}/models");
            let resp = http
                .api_client
                .get(url)
                .headers(bearer_headers(config, api_key)?)
                .send()
                .await
                .map_err(|e| redact_secret(&format!("Provider request failed: {}", e.without_url()), api_key))?;
            if !resp.status().is_success() {
                return Err(format!("Provider returned HTTP {}", resp.status()));
            }
            let json: Value = resp
                .json()
                .await
                .map_err(|e| format!("Invalid models JSON: {e}"))?;
            let mut models: Vec<ProviderModelInfo> = json["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| {
                    let id = m["id"].as_str()?.to_string();
                    let label = m["name"]
                        .as_str()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| id.clone());
                    Some(ProviderModelInfo { id, label })
                })
                .collect();
            models.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(models)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_api_keys_from_error_strings() {
        let key = "sk-super-secret-12345";
        let err = format!("Auth failed using Bearer {key} on endpoint");
        let redacted = redact_secret(&err, key);
        assert!(!redacted.contains(key));
        assert!(redacted.contains("[REDACTED]"));
    }
}
