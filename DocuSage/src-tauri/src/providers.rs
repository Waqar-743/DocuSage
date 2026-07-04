use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

const LOCAL_PROVIDER_ID: &str = "local";
const KEYRING_SERVICE: &str = "DocuSage";

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderKind {
    Local,
    OpenAi,
    Anthropic,
    GoogleGemini,
    OpenRouter,
    OllamaRemote,
    LmStudioRemote,
    CustomOpenAiCompatible,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub id: String,
    pub name: String,
    pub provider: AiProviderKind,
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub organization: Option<String>,
    pub project: Option<String>,
    pub timeout_secs: u64,
    pub temperature: f32,
    pub api_key_set: bool,
    pub options: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfigInput {
    pub id: Option<String>,
    pub name: String,
    pub provider: AiProviderKind,
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub organization: Option<String>,
    pub project: Option<String>,
    pub timeout_secs: u64,
    pub temperature: f32,
    pub api_key: Option<String>,
    pub delete_api_key: bool,
    pub options: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProviderStore {
    active_provider_id: String,
    providers: Vec<AiProviderConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderList {
    pub active_provider_id: String,
    pub providers: Vec<AiProviderConfig>,
    pub secure_storage_available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudHistoryMessage {
    sender: String,
    text: String,
}

fn default_local_provider() -> AiProviderConfig {
    AiProviderConfig {
        id: LOCAL_PROVIDER_ID.to_string(),
        name: "Local".to_string(),
        provider: AiProviderKind::Local,
        enabled: true,
        base_url: None,
        model: None,
        organization: None,
        project: None,
        timeout_secs: 60,
        temperature: 0.2,
        api_key_set: false,
        options: Value::Object(Default::default()),
    }
}

fn default_store() -> ProviderStore {
    ProviderStore {
        active_provider_id: LOCAL_PROVIDER_ID.to_string(),
        providers: vec![default_local_provider()],
    }
}

fn provider_defaults(kind: &AiProviderKind) -> (Option<String>, Option<String>) {
    match kind {
        AiProviderKind::Local => (None, None),
        AiProviderKind::OpenAi => (
            Some("https://api.openai.com/v1".to_string()),
            Some("gpt-4.1-mini".to_string()),
        ),
        AiProviderKind::Anthropic => (
            Some("https://api.anthropic.com/v1".to_string()),
            Some("claude-3-5-haiku-latest".to_string()),
        ),
        AiProviderKind::GoogleGemini => (
            Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            Some("gemini-2.5-flash".to_string()),
        ),
        AiProviderKind::OpenRouter => (
            Some("https://openrouter.ai/api/v1".to_string()),
            Some("openai/gpt-4.1-mini".to_string()),
        ),
        AiProviderKind::OllamaRemote => (
            Some("http://localhost:11434".to_string()),
            Some("llama3.2".to_string()),
        ),
        AiProviderKind::LmStudioRemote => (
            Some("http://localhost:1234/v1".to_string()),
            Some("local-model".to_string()),
        ),
        AiProviderKind::CustomOpenAiCompatible => (Some("https://example.com/v1".to_string()), None),
    }
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("Cannot resolve app config directory: {e}"))
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("ai-providers.json"))
}

fn keyring_account(provider_id: &str) -> String {
    format!("ai-provider:{provider_id}:api-key")
}

fn keyring_entry(provider_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &keyring_account(provider_id))
        .map_err(|e| format!("Secure credential storage is unavailable: {e}"))
}

fn read_api_key(provider_id: &str) -> Option<String> {
    keyring_entry(provider_id)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|key| !key.trim().is_empty())
}

fn write_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    keyring_entry(provider_id)?
        .set_password(api_key)
        .map_err(|e| format!("Failed to save API key in secure storage: {e}"))
}

fn delete_api_key(provider_id: &str) -> Result<(), String> {
    match keyring_entry(provider_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete API key from secure storage: {e}")),
    }
}

fn secure_storage_available() -> bool {
    keyring_entry("__probe__").is_ok()
}

fn read_store(app: &AppHandle) -> ProviderStore {
    let path = match store_path(app) {
        Ok(path) => path,
        Err(_) => return default_store(),
    };

    let mut store = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ProviderStore>(&raw).ok())
        .unwrap_or_else(default_store);

    if !store.providers.iter().any(|provider| provider.id == LOCAL_PROVIDER_ID) {
        store.providers.insert(0, default_local_provider());
    }
    if !store
        .providers
        .iter()
        .any(|provider| provider.id == store.active_provider_id)
    {
        store.active_provider_id = LOCAL_PROVIDER_ID.to_string();
    }

    for provider in &mut store.providers {
        provider.api_key_set = read_api_key(&provider.id).is_some() || provider.api_key_set;
    }

    store
}

fn write_store(app: &AppHandle, store: &ProviderStore) -> Result<(), String> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create provider settings directory: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Cannot serialize provider settings: {e}"))?;
    fs::write(&path, payload)
        .map_err(|e| format!("Cannot write provider settings {}: {e}", path.display()))
}

fn generate_provider_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("provider-{millis}")
}

fn validate_provider(config: &AiProviderConfigInput) -> Result<(), String> {
    if config.name.trim().is_empty() {
        return Err("Provider name is required.".to_string());
    }

    if config.timeout_secs == 0 || config.timeout_secs > 600 {
        return Err("Timeout must be between 1 and 600 seconds.".to_string());
    }

    if !(0.0..=2.0).contains(&config.temperature) {
        return Err("Temperature must be between 0 and 2.".to_string());
    }

    if config.provider != AiProviderKind::Local {
        let (_, default_model) = provider_defaults(&config.provider);
        let model = config.model.as_deref().or(default_model.as_deref());
        if model.unwrap_or_default().trim().is_empty() {
            return Err("Model is required for cloud and remote providers.".to_string());
        }
    }

    Ok(())
}

fn normalize_config(input: AiProviderConfigInput, existing: Option<&AiProviderConfig>) -> AiProviderConfig {
    let id = input.id.unwrap_or_else(generate_provider_id);
    let (default_base, default_model) = provider_defaults(&input.provider);

    AiProviderConfig {
        id,
        name: input.name.trim().to_string(),
        provider: input.provider,
        enabled: input.enabled,
        base_url: input
            .base_url
            .filter(|value| !value.trim().is_empty())
            .or(default_base),
        model: input
            .model
            .filter(|value| !value.trim().is_empty())
            .or(default_model),
        organization: input.organization.filter(|value| !value.trim().is_empty()),
        project: input.project.filter(|value| !value.trim().is_empty()),
        timeout_secs: input.timeout_secs,
        temperature: input.temperature,
        api_key_set: existing.map(|provider| provider.api_key_set).unwrap_or(false),
        options: input.options,
    }
}

fn active_provider(app: &AppHandle) -> Result<AiProviderConfig, String> {
    let store = read_store(app);
    if let Some(provider) = store
        .providers
        .iter()
        .find(|provider| provider.id == store.active_provider_id)
    {
        return Ok(provider.clone());
    }
    store
        .providers
        .into_iter()
        .find(|provider| provider.id == LOCAL_PROVIDER_ID)
        .ok_or_else(|| "No active AI provider is configured.".to_string())
}

fn bearer_headers(config: &AiProviderConfig, api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}"))
            .map_err(|e| format!("Invalid API key header value: {e}"))?,
    );
    if let Some(org) = config.organization.as_deref() {
        headers.insert(
            "OpenAI-Organization",
            HeaderValue::from_str(org).map_err(|e| format!("Invalid organization header: {e}"))?,
        );
    }
    if let Some(project) = config.project.as_deref() {
        headers.insert(
            "OpenAI-Project",
            HeaderValue::from_str(project).map_err(|e| format!("Invalid project header: {e}"))?,
        );
    }
    Ok(headers)
}

fn base_url(config: &AiProviderConfig) -> Result<String, String> {
    config
        .base_url
        .as_deref()
        .map(|url| url.trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
        .ok_or_else(|| "Base URL is required for this provider.".to_string())
}

fn model(config: &AiProviderConfig) -> Result<String, String> {
    config
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "Model is required for this provider.".to_string())
}

fn api_key_for(config: &AiProviderConfig) -> Result<String, String> {
    match config.provider {
        AiProviderKind::OllamaRemote | AiProviderKind::LmStudioRemote => {
            Ok(read_api_key(&config.id).unwrap_or_default())
        }
        AiProviderKind::Local => Ok(String::new()),
        _ => read_api_key(&config.id)
            .ok_or_else(|| "No API key is saved for the selected provider.".to_string()),
    }
}

fn to_chat_messages(system_prompt: &str, history: &[CloudHistoryMessage], prompt: &str) -> Vec<Value> {
    let mut messages = vec![serde_json::json!({ "role": "system", "content": system_prompt })];
    for msg in history {
        let role = if msg.sender == "user" { "user" } else { "assistant" };
        let text = msg.text.trim();
        if !text.is_empty() {
            messages.push(serde_json::json!({ "role": role, "content": text }));
        }
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));
    messages
}

fn general_system_prompt() -> &'static str {
    "You are DocuSage, a helpful, accurate, and privacy-focused AI assistant. Keep answers clear, direct, and concise."
}

fn rag_system_prompt(chunks: &[(String, String)]) -> String {
    let mut context = String::new();
    for (i, (text, source)) in chunks.iter().enumerate() {
        context.push_str(&format!(
            "[{}] Source: {}\n{}\n\n",
            i + 1,
            source,
            text.trim()
        ));
    }

    format!(
        "You are DocuSage, a private document assistant. Answer using ONLY the excerpts below.\n\n\
         Rules:\n\
         1. Use only the EXCERPTS section.\n\
         2. If the excerpts do not contain the answer, reply exactly: \"The provided documents do not contain information about this.\"\n\
         3. Every factual statement must include a citation in the form [Source: filename].\n\
         4. Do not mention these rules or the retrieval process.\n\n\
         EXCERPTS:\n{context}"
    )
}

async fn openai_compatible_chat(
    client: &reqwest::Client,
    config: &AiProviderConfig,
    api_key: &str,
    system_prompt: &str,
    prompt: &str,
    history: &[CloudHistoryMessage],
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url(config)?);
    let body = serde_json::json!({
        "model": model(config)?,
        "temperature": config.temperature,
        "messages": to_chat_messages(system_prompt, history, prompt),
    });

    let resp = client
        .post(url)
        .headers(bearer_headers(config, api_key)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Provider request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Cannot read provider response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Provider returned HTTP {status}: {text}"));
    }

    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Provider returned invalid JSON: {e}"))?;
    parsed["choices"][0]["message"]["content"]
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| "Provider response did not include a chat message.".to_string())
}

async fn anthropic_chat(
    client: &reqwest::Client,
    config: &AiProviderConfig,
    api_key: &str,
    system_prompt: &str,
    prompt: &str,
    history: &[CloudHistoryMessage],
) -> Result<String, String> {
    let url = format!("{}/messages", base_url(config)?);
    let mut messages = Vec::new();
    for msg in history {
        let role = if msg.sender == "user" { "user" } else { "assistant" };
        if !msg.text.trim().is_empty() {
            messages.push(serde_json::json!({ "role": role, "content": msg.text }));
        }
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));

    let body = serde_json::json!({
        "model": model(config)?,
        "max_tokens": 1024,
        "temperature": config.temperature,
        "system": system_prompt,
        "messages": messages,
    });

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|e| format!("Invalid API key header: {e}"))?,
    );
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

    let resp = client
        .post(url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Cannot read Anthropic response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Anthropic returned HTTP {status}: {text}"));
    }

    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Anthropic returned invalid JSON: {e}"))?;
    parsed["content"]
        .as_array()
        .and_then(|items| items.iter().find_map(|item| item["text"].as_str()))
        .map(ToString::to_string)
        .ok_or_else(|| "Anthropic response did not include text content.".to_string())
}

async fn gemini_chat(
    client: &reqwest::Client,
    config: &AiProviderConfig,
    api_key: &str,
    system_prompt: &str,
    prompt: &str,
    history: &[CloudHistoryMessage],
) -> Result<String, String> {
    let url = format!(
        "{}/models/{}:generateContent?key={}",
        base_url(config)?,
        model(config)?,
        api_key
    );

    let mut transcript = String::new();
    transcript.push_str(system_prompt);
    transcript.push_str("\n\n");
    for msg in history {
        let role = if msg.sender == "user" { "User" } else { "Assistant" };
        transcript.push_str(&format!("{role}: {}\n", msg.text));
    }
    transcript.push_str(&format!("User: {prompt}"));

    let body = serde_json::json!({
        "contents": [{ "parts": [{ "text": transcript }] }],
        "generationConfig": { "temperature": config.temperature }
    });

    let resp = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Cannot read Gemini response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Gemini returned HTTP {status}: {text}"));
    }

    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Gemini returned invalid JSON: {e}"))?;
    parsed["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| "Gemini response did not include text content.".to_string())
}

async fn ollama_chat(
    client: &reqwest::Client,
    config: &AiProviderConfig,
    system_prompt: &str,
    prompt: &str,
    history: &[CloudHistoryMessage],
) -> Result<String, String> {
    let url = format!("{}/api/chat", base_url(config)?);
    let body = serde_json::json!({
        "model": model(config)?,
        "stream": false,
        "options": { "temperature": config.temperature },
        "messages": to_chat_messages(system_prompt, history, prompt),
    });

    let resp = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Cannot read Ollama response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Ollama returned HTTP {status}: {text}"));
    }

    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Ollama returned invalid JSON: {e}"))?;
    parsed["message"]["content"]
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| "Ollama response did not include message content.".to_string())
}

async fn send_chat(
    config: &AiProviderConfig,
    system_prompt: &str,
    prompt: &str,
    history: &[CloudHistoryMessage],
) -> Result<String, String> {
    if !config.enabled {
        return Err("Selected provider is disabled.".to_string());
    }
    if config.provider == AiProviderKind::Local {
        return Err("Local provider cannot be used by cloud chat commands.".to_string());
    }

    let api_key = api_key_for(config)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(config.timeout_secs.max(1)))
        .build()
        .map_err(|e| format!("Cannot create HTTP client: {e}"))?;

    match config.provider {
        AiProviderKind::OpenAi
        | AiProviderKind::OpenRouter
        | AiProviderKind::LmStudioRemote
        | AiProviderKind::CustomOpenAiCompatible => {
            openai_compatible_chat(&client, config, &api_key, system_prompt, prompt, history).await
        }
        AiProviderKind::Anthropic => {
            anthropic_chat(&client, config, &api_key, system_prompt, prompt, history).await
        }
        AiProviderKind::GoogleGemini => {
            gemini_chat(&client, config, &api_key, system_prompt, prompt, history).await
        }
        AiProviderKind::OllamaRemote => ollama_chat(&client, config, system_prompt, prompt, history).await,
        AiProviderKind::Local => unreachable!(),
    }
}

async fn test_provider(config: &AiProviderConfig) -> Result<String, String> {
    match config.provider {
        AiProviderKind::Local => Ok("Local mode is available when a GGUF model is connected.".to_string()),
        AiProviderKind::OllamaRemote => {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(config.timeout_secs.max(1)))
                .build()
                .map_err(|e| format!("Cannot create HTTP client: {e}"))?;
            let url = format!("{}/api/tags", base_url(config)?);
            let resp = client.get(url).send().await.map_err(|e| format!("Ollama test failed: {e}"))?;
            if resp.status().is_success() {
                Ok("Ollama remote connection succeeded.".to_string())
            } else {
                Err(format!("Ollama returned HTTP {}", resp.status()))
            }
        }
        AiProviderKind::GoogleGemini => {
            let api_key = api_key_for(config)?;
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(config.timeout_secs.max(1)))
                .build()
                .map_err(|e| format!("Cannot create HTTP client: {e}"))?;
            let url = format!("{}/models?key={}", base_url(config)?, api_key);
            let resp = client.get(url).send().await.map_err(|e| format!("Gemini test failed: {e}"))?;
            if resp.status().is_success() {
                Ok("Gemini connection succeeded.".to_string())
            } else {
                Err(format!("Gemini returned HTTP {}", resp.status()))
            }
        }
        AiProviderKind::Anthropic => {
            let answer = send_chat(
                config,
                "Reply with exactly: ok",
                "ok",
                &[],
            )
            .await?;
            Ok(format!("Anthropic connection succeeded: {}", answer.trim()))
        }
        _ => {
            let api_key = api_key_for(config)?;
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(config.timeout_secs.max(1)))
                .build()
                .map_err(|e| format!("Cannot create HTTP client: {e}"))?;
            let url = format!("{}/models", base_url(config)?);
            let resp = client
                .get(url)
                .headers(bearer_headers(config, &api_key)?)
                .send()
                .await
                .map_err(|e| format!("Provider test failed: {e}"))?;
            if resp.status().is_success() {
                Ok("Provider connection succeeded.".to_string())
            } else {
                Err(format!("Provider returned HTTP {}", resp.status()))
            }
        }
    }
}

#[tauri::command]
pub fn list_ai_provider_configs(app: AppHandle) -> Result<ProviderList, String> {
    let store = read_store(&app);
    Ok(ProviderList {
        active_provider_id: store.active_provider_id,
        providers: store.providers,
        secure_storage_available: secure_storage_available(),
    })
}

#[tauri::command]
pub fn save_ai_provider_config(
    app: AppHandle,
    input: AiProviderConfigInput,
) -> Result<AiProviderConfig, String> {
    validate_provider(&input)?;

    let mut store = read_store(&app);
    let existing_index = input
        .id
        .as_ref()
        .and_then(|id| store.providers.iter().position(|provider| provider.id == *id));
    let existing = existing_index.and_then(|idx| store.providers.get(idx));

    let delete_key = input.delete_api_key;
    let incoming_key = input.api_key.clone().unwrap_or_default();
    let mut config = normalize_config(input, existing);

    if config.provider == AiProviderKind::Local {
        config.id = LOCAL_PROVIDER_ID.to_string();
        config.api_key_set = false;
    } else if delete_key {
        delete_api_key(&config.id)?;
        config.api_key_set = false;
    } else if !incoming_key.trim().is_empty() {
        write_api_key(&config.id, incoming_key.trim())?;
        config.api_key_set = true;
    } else {
        config.api_key_set = read_api_key(&config.id).is_some() || config.api_key_set;
    }

    if let Some(idx) = store.providers.iter().position(|provider| provider.id == config.id) {
        store.providers[idx] = config.clone();
    } else {
        store.providers.push(config.clone());
    }

    write_store(&app, &store)?;
    Ok(config)
}

#[tauri::command]
pub fn delete_ai_provider_config(app: AppHandle, provider_id: String) -> Result<(), String> {
    if provider_id == LOCAL_PROVIDER_ID {
        return Err("The local provider cannot be deleted.".to_string());
    }

    let mut store = read_store(&app);
    store.providers.retain(|provider| provider.id != provider_id);
    if store.active_provider_id == provider_id {
        store.active_provider_id = LOCAL_PROVIDER_ID.to_string();
    }
    delete_api_key(&provider_id)?;
    write_store(&app, &store)
}

#[tauri::command]
pub fn set_active_ai_provider(app: AppHandle, provider_id: String) -> Result<String, String> {
    let mut store = read_store(&app);
    if !store.providers.iter().any(|provider| provider.id == provider_id) {
        return Err("Provider does not exist.".to_string());
    }
    store.active_provider_id = provider_id.clone();
    write_store(&app, &store)?;
    Ok(provider_id)
}

#[tauri::command]
pub async fn test_ai_provider_connection(
    app: AppHandle,
    provider_id: String,
) -> Result<ProviderTestResult, String> {
    let store = read_store(&app);
    let config = store
        .providers
        .into_iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| "Provider does not exist.".to_string())?;

    match test_provider(&config).await {
        Ok(message) => Ok(ProviderTestResult { ok: true, message }),
        Err(message) => Ok(ProviderTestResult { ok: false, message }),
    }
}

#[tauri::command]
pub async fn chat_cloud(
    app: AppHandle,
    prompt: String,
    history: Vec<CloudHistoryMessage>,
    request_id: String,
) -> Result<String, String> {
    let config = active_provider(&app)?;
    let response = send_chat(&config, general_system_prompt(), &prompt, &history).await?;
    let _ = app.emit(
        "chat-token",
        serde_json::json!({ "requestId": request_id, "token": "", "done": true }),
    );
    Ok(response.trim().to_string())
}

#[tauri::command]
pub async fn chat_cloud_rag(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: String,
    history: Vec<CloudHistoryMessage>,
    request_id: String,
) -> Result<String, String> {
    let db_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("lancedb"))
        .or_else(|| dirs::data_local_dir().map(|p| p.join("DocuSage").join("lancedb")))
        .ok_or_else(|| "Cannot determine data directory.".to_string())?;

    let top_k = state
        .rag_config
        .read()
        .map_err(|e| format!("rag_config lock: {e}"))?
        .top_k;

    let chunks = crate::rag::query_similar(&prompt, &db_dir, top_k).await?;
    if chunks.is_empty() {
        return Err(format!(
            "RAG Error: 0 matching chunks from '{}'. The documents table may be empty.",
            db_dir.display()
        ));
    }

    let config = active_provider(&app)?;
    let system_prompt = rag_system_prompt(&chunks);
    let response = send_chat(&config, &system_prompt, &prompt, &history).await?;
    let _ = app.emit(
        "chat-token",
        serde_json::json!({ "requestId": request_id, "token": "", "done": true }),
    );
    Ok(response.trim().to_string())
}
