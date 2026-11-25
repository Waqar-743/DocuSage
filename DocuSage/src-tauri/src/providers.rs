//! AI Provider registry and OS keyring credential storage.
//!
//! API keys are stored exclusively in the OS keyring (`keyring` crate) and never
//! written to JSON config files on disk.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::services::ai_client::{
    fetch_provider_models, verify_and_fetch_provider_models, ProviderFetchError, ProviderModelInfo,
};
use crate::state::AppState;

pub const LOCAL_PROVIDER_ID: &str = "local";
const KEYRING_SERVICE: &str = "DocuSage";

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderKind {
    Local,
    OpenAi,
    Anthropic,
    GoogleGemini,
    OpenRouter,
    OllamaLocal,
    OllamaRemote,
    LmStudio,
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

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProviderVerificationStatus {
    Verified,
    InvalidApiKey,
    ConnectionError,
    NotConfigured,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub status: ProviderVerificationStatus,
    pub message: String,
    pub models: Vec<ProviderModelInfo>,
}

fn default_local_provider() -> AiProviderConfig {
    AiProviderConfig {
        id: LOCAL_PROVIDER_ID.to_string(),
        name: "Built-in Local (GGUF)".to_string(),
        provider: AiProviderKind::Local,
        enabled: true,
        base_url: None,
        model: None,
        organization: None,
        project: None,
        timeout_secs: 60,
        temperature: 0.3,
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

pub fn provider_defaults(kind: &AiProviderKind) -> (Option<String>, Option<String>) {
    match kind {
        AiProviderKind::Local => (None, None),
        AiProviderKind::OpenAi => (
            Some("https://api.openai.com/v1".to_string()),
            Some("gpt-6.2-sol".to_string()),
        ),
        AiProviderKind::Anthropic => (
            Some("https://api.anthropic.com/v1".to_string()),
            Some("claude-sonnet-5-5".to_string()),
        ),
        AiProviderKind::GoogleGemini => (
            Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
            Some("gemini-4-hydrogen".to_string()),
        ),
        AiProviderKind::OpenRouter => (
            Some("https://openrouter.ai/api/v1".to_string()),
            Some("openai/gpt-6.2-sol".to_string()),
        ),
        AiProviderKind::OllamaLocal | AiProviderKind::OllamaRemote => (
            Some("http://localhost:11434".to_string()),
            Some("llama3.2".to_string()),
        ),
        AiProviderKind::LmStudio | AiProviderKind::LmStudioRemote => (
            Some("http://localhost:1234/v1".to_string()),
            Some("local-model".to_string()),
        ),
        AiProviderKind::CustomOpenAiCompatible => {
            (Some("https://example.com/v1".to_string()), None)
        }
    }
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("ai-providers.json"))
        .map_err(|e| format!("Cannot resolve app config directory: {e}"))
}

fn keyring_entry(provider_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("ai-provider:{provider_id}:api-key"))
        .map_err(|e| format!("Secure credential storage is unavailable: {e}"))
}

pub fn read_api_key(provider_id: &str) -> Option<String> {
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
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete API key from secure storage: {e}")),
    }
}

fn secure_storage_available() -> bool {
    matches!(
        keyring_entry("__probe__").map(|entry| entry.get_password()),
        Ok(Ok(_)) | Ok(Err(keyring::Error::NoEntry))
    )
}

fn read_store(app: &AppHandle) -> ProviderStore {
    let path = match store_path(app) {
        Ok(p) => p,
        Err(_) => return default_store(),
    };

    let mut store = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ProviderStore>(&raw).ok())
        .unwrap_or_else(default_store);

    if !store.providers.iter().any(|p| p.id == LOCAL_PROVIDER_ID) {
        store.providers.insert(0, default_local_provider());
    }
    if !store
        .providers
        .iter()
        .any(|p| p.id == store.active_provider_id && p.enabled)
    {
        store.active_provider_id = LOCAL_PROVIDER_ID.to_string();
    }

    for provider in &mut store.providers {
        provider.api_key_set = read_api_key(&provider.id).is_some();
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
    fs::write(&path, payload).map_err(|e| format!("Cannot write provider settings: {e}"))
}

fn generate_provider_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    format!("provider-{millis}")
}

pub fn resolve_provider(app: &AppHandle, provider_id: Option<&str>) -> Result<AiProviderConfig, String> {
    let store = read_store(app);
    let target_id = provider_id.unwrap_or(&store.active_provider_id);
    if let Some(provider) = store.providers.iter().find(|p| p.id == target_id) {
        if !provider.enabled {
            return Err(format!("Provider '{}' is disabled.", provider.name));
        }
        return Ok(provider.clone());
    }
    store
        .providers
        .into_iter()
        .find(|p| p.id == LOCAL_PROVIDER_ID)
        .ok_or_else(|| "No AI provider configured.".to_string())
}

pub fn api_key_for(config: &AiProviderConfig) -> Result<String, String> {
    match config.provider {
        AiProviderKind::Local => Ok(String::new()),
        AiProviderKind::OllamaLocal
        | AiProviderKind::OllamaRemote
        | AiProviderKind::LmStudio
        | AiProviderKind::LmStudioRemote
        | AiProviderKind::CustomOpenAiCompatible => Ok(read_api_key(&config.id).unwrap_or_default()),
        _ => read_api_key(&config.id)
            .ok_or_else(|| format!("No API key is saved for {}. Add one in Settings -> Providers.", config.name)),
    }
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
    if config.id.as_deref() == Some(LOCAL_PROVIDER_ID) && config.provider != AiProviderKind::Local {
        return Err("The local profile cannot be changed into a remote provider.".into());
    }
    if config.provider == AiProviderKind::Local
        && (!config.enabled || config.id.as_deref().is_some_and(|id| id != LOCAL_PROVIDER_ID))
    {
        return Err("The local profile must stay enabled and use its reserved ID.".into());
    }
    if config.provider != AiProviderKind::Local {
        let (default_base, default_model) = provider_defaults(&config.provider);
        let raw = config
            .base_url
            .as_deref()
            .filter(|v| !v.trim().is_empty())
            .or(default_base.as_deref())
            .unwrap_or_default();
        let url = reqwest::Url::parse(raw.trim())
            .map_err(|_| "Enter a valid HTTP or HTTPS base URL.")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(
                "Use an HTTP or HTTPS base URL without embedded credentials, query parameters, or fragments."
                    .into(),
            );
        }
        let model = config.model.as_deref().or(default_model.as_deref());
        if model.unwrap_or_default().trim().is_empty() {
            return Err("Model is required for cloud and remote providers.".to_string());
        }
    }
    Ok(())
}

fn normalize_config(
    input: AiProviderConfigInput,
    existing: Option<&AiProviderConfig>,
) -> AiProviderConfig {
    let id = input.id.unwrap_or_else(generate_provider_id);
    let (default_base, default_model) = provider_defaults(&input.provider);

    AiProviderConfig {
        id,
        name: input.name.trim().to_string(),
        provider: input.provider,
        enabled: input.enabled,
        base_url: input
            .base_url
            .filter(|v| !v.trim().is_empty())
            .or(default_base),
        model: input
            .model
            .filter(|v| !v.trim().is_empty())
            .or(default_model),
        organization: input.organization.filter(|v| !v.trim().is_empty()),
        project: input.project.filter(|v| !v.trim().is_empty()),
        timeout_secs: input.timeout_secs,
        temperature: input.temperature,
        api_key_set: existing.map(|p| p.api_key_set).unwrap_or(false),
        options: input.options,
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
    let existing = input
        .id
        .as_ref()
        .and_then(|id| store.providers.iter().find(|p| &p.id == id));

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
        config.api_key_set = read_api_key(&config.id).is_some();
    }

    if let Some(idx) = store.providers.iter().position(|p| p.id == config.id) {
        store.providers[idx] = config.clone();
    } else {
        store.providers.push(config.clone());
    }
    if !config.enabled && store.active_provider_id == config.id {
        store.active_provider_id = LOCAL_PROVIDER_ID.to_string();
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
    store.providers.retain(|p| p.id != provider_id);
    if store.active_provider_id == provider_id {
        store.active_provider_id = LOCAL_PROVIDER_ID.to_string();
    }
    delete_api_key(&provider_id)?;
    write_store(&app, &store)
}

#[tauri::command]
pub fn set_active_ai_provider(app: AppHandle, provider_id: String) -> Result<String, String> {
    let mut store = read_store(&app);
    if !store.providers.iter().any(|p| p.id == provider_id) {
        return Err("Provider does not exist.".to_string());
    }
    if !store
        .providers
        .iter()
        .any(|p| p.id == provider_id && p.enabled)
    {
        return Err("Enable this provider before making it active.".into());
    }
    store.active_provider_id = provider_id.clone();
    write_store(&app, &store)?;
    Ok(provider_id)
}

/// Verify credentials/reachability AND return the live list of available models
/// ("Verify & Fetch Models").
#[tauri::command]
pub async fn test_ai_provider_connection(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    provider_id: String,
) -> Result<ProviderTestResult, String> {
    let store = read_store(&app);
    let config = store
        .providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "Provider does not exist.".to_string())?;

    if config.provider == AiProviderKind::Local {
        let rt = state.local_runtime.status(&app).await;
        if rt.running {
            let model = rt.loaded_model.unwrap_or_else(|| "local-gguf".into());
            return Ok(ProviderTestResult {
                ok: true,
                status: ProviderVerificationStatus::Verified,
                message: format!("Built-in llama-server is running with {model}."),
                models: vec![ProviderModelInfo {
                    id: model.clone(),
                    label: model,
                }],
            });
        }
        return Ok(ProviderTestResult {
            ok: false,
            status: ProviderVerificationStatus::NotConfigured,
            message: if rt.installed {
                "llama-server is installed. Download or load a GGUF model to start chatting offline.".into()
            } else {
                "Built-in llama-server runtime is not installed yet.".into()
            },
            models: Vec::new(),
        });
    }

    let api_key = match api_key_for(&config) {
        Ok(key) => key,
        Err(_) => {
            return Ok(ProviderTestResult {
                ok: false,
                status: ProviderVerificationStatus::NotConfigured,
                message: format!("Not Configured: Save an API key for {} first.", config.name),
                models: Vec::new(),
            });
        }
    };

    match verify_and_fetch_provider_models(&state.http, &config, &api_key).await {
        Ok(models) => Ok(ProviderTestResult {
            ok: true,
            status: ProviderVerificationStatus::Verified,
            message: format!(
                "Verified! Connected to {} ({} model{} available).",
                config.name,
                models.len(),
                if models.len() == 1 { "" } else { "s" }
            ),
            models,
        }),
        Err(ProviderFetchError::InvalidApiKey(err)) => Ok(ProviderTestResult {
            ok: false,
            status: ProviderVerificationStatus::InvalidApiKey,
            message: err,
            models: Vec::new(),
        }),
        Err(ProviderFetchError::ConnectionError(err)) => Ok(ProviderTestResult {
            ok: false,
            status: ProviderVerificationStatus::ConnectionError,
            message: err,
            models: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn fetch_ai_provider_models(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    provider_id: String,
) -> Result<Vec<ProviderModelInfo>, String> {
    let store = read_store(&app);
    let config = store
        .providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "Provider does not exist.".to_string())?;

    if config.provider == AiProviderKind::Local {
        let models = crate::commands::list_downloaded_models(app, state)?;
        return Ok(models
            .into_iter()
            .map(|m| ProviderModelInfo {
                id: m.path,
                label: m.filename,
            })
            .collect());
    }

    let api_key = api_key_for(&config)?;
    fetch_provider_models(&state.http, &config, &api_key).await
}
