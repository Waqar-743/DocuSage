use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut,
};

const MAIN_WINDOW_LABEL: &str = "main";
const DEFAULT_SHORTCUT: &str = "Alt+Space";
const ACTIVATION_DEBOUNCE_MS: u64 = 180;

#[derive(Default)]
pub struct AssistantRuntime {
    last_activation: Mutex<Option<Instant>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssistantWindowMode {
    Compact,
    Medium,
    Full,
}

impl AssistantWindowMode {
    pub fn next(self) -> Self {
        match self {
            AssistantWindowMode::Compact => AssistantWindowMode::Medium,
            AssistantWindowMode::Medium => AssistantWindowMode::Full,
            AssistantWindowMode::Full => AssistantWindowMode::Compact,
        }
    }
}

impl Default for AssistantWindowMode {
    fn default() -> Self {
        Self::Medium
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssistantSettings {
    pub launch_hidden: bool,
    pub hide_on_close: bool,
    pub hide_from_taskbar: bool,
    pub keep_model_loaded: bool,
    pub global_shortcut: String,
    pub window_mode: AssistantWindowMode,
    pub last_monitor_name: Option<String>,
}

impl Default for AssistantSettings {
    fn default() -> Self {
        Self {
            launch_hidden: true,
            hide_on_close: true,
            hide_from_taskbar: true,
            keep_model_loaded: true,
            global_shortcut: DEFAULT_SHORTCUT.to_string(),
            window_mode: AssistantWindowMode::Medium,
            last_monitor_name: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapability {
    pub platform: String,
    pub startup_hidden: String,
    pub taskbar_hidden: String,
    pub alt_tab_hidden: String,
    pub focus_notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatus {
    pub is_visible: bool,
    pub settings: AssistantSettings,
    pub platform: PlatformCapability,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("Cannot resolve app config directory: {e}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("assistant-settings.json"))
}

fn read_settings(app: &AppHandle) -> AssistantSettings {
    let path = match settings_path(app) {
        Ok(path) => path,
        Err(_) => return AssistantSettings::default(),
    };

    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AssistantSettings>(&raw).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &AssistantSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create settings directory {}: {e}", parent.display()))?;
    }
    let payload = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Cannot serialize assistant settings: {e}"))?;
    fs::write(&path, payload)
        .map_err(|e| format!("Cannot write assistant settings {}: {e}", path.display()))
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window is not available.".to_string())
}

fn platform_capability() -> PlatformCapability {
    PlatformCapability {
        platform: std::env::consts::OS.to_string(),
        startup_hidden: "Supported by creating the Tauri window hidden and showing it on demand."
            .to_string(),
        taskbar_hidden: if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
            "Best effort via set_skip_taskbar while the assistant is hidden.".to_string()
        } else {
            "macOS has Dock/application activation policy constraints; hidden windows do not appear in the Dock window list, but the app may still have a Dock icon unless packaged with an accessory-style policy.".to_string()
        },
        alt_tab_hidden: if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
            "Hidden windows are removed from Alt+Tab; skip-taskbar is also applied where supported."
                .to_string()
        } else {
            "Hidden windows are removed from Cmd+Tab window cycling; app-level Cmd+Tab behavior follows macOS activation rules.".to_string()
        },
        focus_notes:
            "Focus is requested after show. Fullscreen or elevated-permission foreground apps may deny focus on some platforms."
                .to_string(),
    }
}

fn parse_shortcut(shortcut: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for raw_part in shortcut.split('+') {
        let part = raw_part.trim().to_ascii_lowercase();
        match part.as_str() {
            "alt" | "option" => modifiers |= Modifiers::ALT,
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "cmd" | "command" | "meta" | "super" => modifiers |= Modifiers::SUPER,
            "shift" => modifiers |= Modifiers::SHIFT,
            "space" => code = Some(Code::Space),
            "enter" | "return" => code = Some(Code::Enter),
            "," | "comma" => code = Some(Code::Comma),
            "k" => code = Some(Code::KeyK),
            "n" => code = Some(Code::KeyN),
            _ if part.len() == 1 => {
                code = match part.as_str() {
                    "a" => Some(Code::KeyA),
                    "b" => Some(Code::KeyB),
                    "c" => Some(Code::KeyC),
                    "d" => Some(Code::KeyD),
                    "e" => Some(Code::KeyE),
                    "f" => Some(Code::KeyF),
                    "g" => Some(Code::KeyG),
                    "h" => Some(Code::KeyH),
                    "i" => Some(Code::KeyI),
                    "j" => Some(Code::KeyJ),
                    "l" => Some(Code::KeyL),
                    "m" => Some(Code::KeyM),
                    "o" => Some(Code::KeyO),
                    "p" => Some(Code::KeyP),
                    "q" => Some(Code::KeyQ),
                    "r" => Some(Code::KeyR),
                    "s" => Some(Code::KeyS),
                    "t" => Some(Code::KeyT),
                    "u" => Some(Code::KeyU),
                    "v" => Some(Code::KeyV),
                    "w" => Some(Code::KeyW),
                    "x" => Some(Code::KeyX),
                    "y" => Some(Code::KeyY),
                    "z" => Some(Code::KeyZ),
                    _ => None,
                };
            }
            _ => return Err(format!("Unsupported shortcut segment: {raw_part}")),
        }
    }

    let code = code.ok_or_else(|| "Shortcut must include a key such as Space.".to_string())?;
    if modifiers.is_empty() {
        return Err("Shortcut must include at least one modifier.".to_string());
    }

    Ok(Shortcut::new(Some(modifiers), code))
}

fn monitor_contains(monitor_pos: PhysicalPosition<i32>, monitor_size: PhysicalSize<u32>, point: PhysicalPosition<f64>) -> bool {
    let left = monitor_pos.x as f64;
    let top = monitor_pos.y as f64;
    let right = left + monitor_size.width as f64;
    let bottom = top + monitor_size.height as f64;
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
}

fn target_monitor(window: &WebviewWindow, settings: &AssistantSettings) -> Result<tauri::Monitor, String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("Cannot list monitors: {e}"))?;

    if let Ok(cursor) = window.cursor_position() {
        if let Some(monitor) = monitors.iter().find(|monitor| {
            monitor_contains(*monitor.position(), *monitor.size(), cursor)
        }) {
            return Ok(monitor.clone());
        }
    }

    if let Some(last_name) = settings.last_monitor_name.as_deref() {
        if let Some(monitor) = monitors
            .iter()
            .find(|monitor| monitor.name().map(String::as_str) == Some(last_name))
        {
            return Ok(monitor.clone());
        }
    }

    window
        .primary_monitor()
        .map_err(|e| format!("Cannot get primary monitor: {e}"))?
        .or_else(|| monitors.into_iter().next())
        .ok_or_else(|| "No monitor is available.".to_string())
}

fn apply_window_geometry(window: &WebviewWindow, settings: &AssistantSettings) -> Result<(), String> {
    let monitor = target_monitor(window, settings)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let scale = monitor.scale_factor().max(1.0);
    let padding = (24.0 * scale).round() as i32;

    let screen_w = monitor_size.width as i32;
    let screen_h = monitor_size.height as i32;
    let min_compact = (360.0 * scale).round() as i32;
    let max_compact = (520.0 * scale).round() as i32;
    let min_height = (520.0 * scale).round() as i32;

    let (width, height, x, y, maximize) = match settings.window_mode {
        AssistantWindowMode::Compact => {
            let width = ((screen_w as f32 * 0.15).round() as i32)
                .max(min_compact)
                .min(max_compact)
                .min(screen_w - padding * 2);
            let height = ((screen_h as f32 * 0.82).round() as i32)
                .max(min_height)
                .min(screen_h - padding * 2);
            let x = monitor_pos.x + screen_w - width - padding;
            let y = monitor_pos.y + screen_h - height - padding;
            (width, height, x, y, false)
        }
        AssistantWindowMode::Medium => {
            let width = ((screen_w as f32 * 0.5).round() as i32)
                .max((760.0 * scale).round() as i32)
                .min(screen_w - padding * 2);
            let height = ((screen_h as f32 * 0.86).round() as i32)
                .max(min_height)
                .min(screen_h - padding * 2);
            let x = monitor_pos.x + (screen_w - width) / 2;
            let y = monitor_pos.y + (screen_h - height) / 2;
            (width, height, x, y, false)
        }
        AssistantWindowMode::Full => {
            let width = screen_w - padding * 2;
            let height = screen_h - padding * 2;
            let x = monitor_pos.x + padding;
            let y = monitor_pos.y + padding;
            (width, height, x, y, true)
        }
    };

    let _ = window.unmaximize();
    window
        .set_size(Size::Physical(PhysicalSize::new(width.max(320) as u32, height.max(420) as u32)))
        .map_err(|e| format!("Cannot set assistant size: {e}"))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|e| format!("Cannot position assistant: {e}"))?;

    if maximize {
        let _ = window.maximize();
    }

    let mut next = settings.clone();
    next.last_monitor_name = monitor.name().cloned();
    if let Some(app) = window.app_handle().get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = app.emit("assistant-window-mode", next.window_mode);
    }
    let _ = write_settings(window.app_handle(), &next);

    Ok(())
}

fn should_debounce(app: &AppHandle) -> bool {
    let runtime = app.state::<AssistantRuntime>();
    let mut guard = match runtime.last_activation.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };
    let now = Instant::now();
    if let Some(last) = *guard {
        if now.duration_since(last) < Duration::from_millis(ACTIVATION_DEBOUNCE_MS) {
            return true;
        }
    }
    *guard = Some(now);
    false
}

pub fn show_assistant(app: &AppHandle) -> Result<(), String> {
    if should_debounce(app) {
        return Ok(());
    }

    let window = main_window(app)?;
    let settings = read_settings(app);

    let _ = window.set_skip_taskbar(false);
    apply_window_geometry(&window, &settings)?;
    window.show().map_err(|e| format!("Cannot show assistant: {e}"))?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = app.emit("assistant-focus-prompt", serde_json::json!({}));

    Ok(())
}

pub fn hide_assistant(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    let settings = read_settings(app);
    if settings.hide_from_taskbar {
        let _ = window.set_skip_taskbar(true);
    }
    window.hide().map_err(|e| format!("Cannot hide assistant: {e}"))
}

pub fn toggle_assistant(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    if window.is_visible().unwrap_or(false) {
        hide_assistant(app)
    } else {
        show_assistant(app)
    }
}

pub fn register_shortcut(app: &AppHandle, shortcut_text: &str) -> Result<(), String> {
    let shortcut = parse_shortcut(shortcut_text)?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("Shortcut '{shortcut_text}' could not be registered. Another app may already be using it: {e}"))
}

fn replace_shortcut(app: &AppHandle, next_shortcut: &str, previous_shortcut: Option<&str>) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Cannot clear previous shortcuts: {e}"))?;

    if let Err(error) = register_shortcut(app, next_shortcut) {
        if let Some(previous) = previous_shortcut {
            let _ = register_shortcut(app, previous);
        }
        return Err(error);
    }

    Ok(())
}

fn setup_tray(app: &App) -> Result<(), tauri::Error> {
    let show = MenuItem::with_id(app, "show-assistant", "Show Assistant", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide-assistant", "Hide Assistant", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let check_updates =
        MenuItem::with_id(app, "check-updates", "Check for Updates", true, None::<&str>)?;
    let restart_ai =
        MenuItem::with_id(app, "restart-ai", "Restart AI Engine", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show, &hide, &settings, &check_updates, &restart_ai, &quit],
    )?;

    TrayIconBuilder::with_id("docusage-assistant")
        .tooltip("DocuSage")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-assistant" => {
                let _ = show_assistant(app);
            }
            "hide-assistant" => {
                let _ = hide_assistant(app);
            }
            "settings" => {
                let _ = show_assistant(app);
                let _ = app.emit("assistant-open-settings", serde_json::json!({}));
            }
            "check-updates" => {
                let _ = show_assistant(app);
                let _ = app.emit("assistant-check-updates", serde_json::json!({}));
            }
            "restart-ai" => {
                let _ = app.emit("assistant-restart-ai-engine", serde_json::json!({}));
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_assistant(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(AssistantRuntime::default());

    let app_handle = app.handle().clone();
    let settings = read_settings(&app_handle);
    if let Err(error) = replace_shortcut(&app_handle, &settings.global_shortcut, None) {
        let _ = app_handle.emit(
            "assistant-shortcut-error",
            serde_json::json!({ "message": error }),
        );
    }

    setup_tray(app)?;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if settings.launch_hidden {
            let _ = window.set_skip_taskbar(settings.hide_from_taskbar);
            let _ = window.hide();
        } else {
            let _ = apply_window_geometry(&window, &settings);
            let _ = window.show();
        }
    }

    Ok(())
}

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        let settings = read_settings(window.app_handle());
        if settings.hide_on_close {
            api.prevent_close();
            let _ = hide_assistant(window.app_handle());
        }
    }
}

#[tauri::command]
pub fn get_assistant_status(app: AppHandle) -> Result<AssistantStatus, String> {
    let window = main_window(&app)?;
    Ok(AssistantStatus {
        is_visible: window.is_visible().unwrap_or(false),
        settings: read_settings(&app),
        platform: platform_capability(),
    })
}

#[tauri::command]
pub fn save_assistant_settings(
    app: AppHandle,
    settings: AssistantSettings,
) -> Result<AssistantSettings, String> {
    let previous = read_settings(&app);
    replace_shortcut(&app, &settings.global_shortcut, Some(&previous.global_shortcut))?;
    write_settings(&app, &settings)?;

    if let Ok(window) = main_window(&app) {
        let _ = window.set_skip_taskbar(settings.hide_from_taskbar && !window.is_visible().unwrap_or(false));
    }

    Ok(settings)
}

#[tauri::command]
pub fn show_assistant_window(app: AppHandle) -> Result<(), String> {
    show_assistant(&app)
}

#[tauri::command]
pub fn hide_assistant_window(app: AppHandle) -> Result<(), String> {
    hide_assistant(&app)
}

#[tauri::command]
pub fn toggle_assistant_window(app: AppHandle) -> Result<(), String> {
    toggle_assistant(&app)
}

#[tauri::command]
pub fn set_assistant_window_mode(
    app: AppHandle,
    window_mode: AssistantWindowMode,
) -> Result<AssistantWindowMode, String> {
    let mut settings = read_settings(&app);
    settings.window_mode = window_mode;
    write_settings(&app, &settings)?;

    let window = main_window(&app)?;
    apply_window_geometry(&window, &settings)?;
    Ok(window_mode)
}

#[tauri::command]
pub fn cycle_assistant_window_mode(app: AppHandle) -> Result<AssistantWindowMode, String> {
    let mut settings = read_settings(&app);
    settings.window_mode = settings.window_mode.next();
    write_settings(&app, &settings)?;

    let window = main_window(&app)?;
    apply_window_geometry(&window, &settings)?;
    let _ = app.emit("assistant-window-mode", settings.window_mode);
    Ok(settings.window_mode)
}

#[tauri::command]
pub fn check_for_updates() -> Result<String, String> {
    Ok("No updater plugin is configured for this build.".to_string())
}
