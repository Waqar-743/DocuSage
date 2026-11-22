//! Window lifecycle: Cursor-summoned Spotlight (`440x560`, multi-monitor clamped,
//! auto-hide on blur unless pinned / dialog / settings open) + Full Dashboard
//! (`1140x760`, remembers bounds & maximized state) + System Tray + Autostart (`--hidden`).

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

const MAIN_WINDOW_LABEL: &str = "main";
const DEFAULT_SHORTCUT: &str = "Alt+Space";
const FALLBACK_SHORTCUT: &str = "Ctrl+Space";
const ACTIVATION_DEBOUNCE_MS: u64 = 180;

const DEFAULT_SPOTLIGHT_WIDTH: f64 = 440.0;
const DEFAULT_SPOTLIGHT_HEIGHT: f64 = 560.0;
const DEFAULT_DASHBOARD_WIDTH: f64 = 1140.0;
const DEFAULT_DASHBOARD_HEIGHT: f64 = 760.0;

#[derive(Default)]
pub struct AssistantRuntime {
    last_activation: Mutex<Option<Instant>>,
    pinned: AtomicBool,
    dialog_open: AtomicBool,
    settings_open: AtomicBool,
    pending_show: AtomicBool,
    suppress_blur_until: Mutex<Option<Instant>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssistantWindowMode {
    #[serde(alias = "compact")]
    Spotlight,
    #[serde(alias = "medium", alias = "full")]
    Dashboard,
}

impl AssistantWindowMode {
    pub fn toggle(self) -> Self {
        match self {
            AssistantWindowMode::Spotlight => AssistantWindowMode::Dashboard,
            AssistantWindowMode::Dashboard => AssistantWindowMode::Spotlight,
        }
    }
}

impl Default for AssistantWindowMode {
    fn default() -> Self {
        Self::Spotlight
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AssistantSettings {
    pub launch_hidden: bool,
    pub hide_on_close: bool,
    pub hide_from_taskbar: bool,
    pub auto_hide_on_blur: bool,
    pub keep_model_loaded: bool,
    pub global_shortcut: String,
    pub window_mode: AssistantWindowMode,
    pub last_monitor_name: Option<String>,
    pub first_open_done: bool,
    pub spotlight_width: u32,
    pub spotlight_height: u32,
    pub dashboard_bounds: Option<WindowBounds>,
}

impl Default for AssistantSettings {
    fn default() -> Self {
        Self {
            launch_hidden: false,
            hide_on_close: true,
            hide_from_taskbar: true,
            auto_hide_on_blur: true,
            keep_model_loaded: true,
            global_shortcut: DEFAULT_SHORTCUT.to_string(),
            window_mode: AssistantWindowMode::Spotlight,
            last_monitor_name: None,
            first_open_done: false,
            spotlight_width: DEFAULT_SPOTLIGHT_WIDTH as u32,
            spotlight_height: DEFAULT_SPOTLIGHT_HEIGHT as u32,
            dashboard_bounds: None,
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
    pub is_pinned: bool,
    pub autostart_enabled: bool,
    pub settings: AssistantSettings,
    pub platform: PlatformCapability,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("assistant-settings.json"))
        .map_err(|e| format!("Cannot resolve app config directory: {e}"))
}

fn read_settings(app: &AppHandle) -> AssistantSettings {
    let Ok(path) = settings_path(app) else {
        return AssistantSettings::default();
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
            .map_err(|e| format!("Cannot create settings directory: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Cannot serialize assistant settings: {e}"))?;
    fs::write(&path, payload).map_err(|e| format!("Cannot write assistant settings: {e}"))
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window is not available.".to_string())
}

fn platform_capability() -> PlatformCapability {
    PlatformCapability {
        platform: std::env::consts::OS.to_string(),
        startup_hidden: "Supported via --hidden launch flag and autostart.".to_string(),
        taskbar_hidden: if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
            "Best effort via set_skip_taskbar while in Spotlight / hidden tray mode.".to_string()
        } else {
            "macOS Dock behavior follows system activation policy.".to_string()
        },
        alt_tab_hidden: "Hidden windows stay out of Alt+Tab; Dashboard mode appears normally in taskbar."
            .to_string(),
        focus_notes:
            "Spotlight summons at your cursor, clamped to the active monitor, and auto-hides on blur unless pinned."
                .to_string(),
    }
}

pub fn parse_shortcut(shortcut: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for raw_part in shortcut.split('+') {
        let part = raw_part.trim().to_ascii_lowercase();
        if code.is_some()
            && !matches!(
                part.as_str(),
                "alt" | "option" | "ctrl" | "control" | "cmd" | "command" | "meta" | "super" | "shift"
            )
        {
            return Err("A shortcut must contain exactly one key.".into());
        }
        match part.as_str() {
            "alt" | "option" => modifiers |= Modifiers::ALT,
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "cmd" | "command" | "meta" | "super" => modifiers |= Modifiers::SUPER,
            "shift" => modifiers |= Modifiers::SHIFT,
            "space" => code = Some(Code::Space),
            "enter" | "return" => code = Some(Code::Enter),
            "," | "comma" => code = Some(Code::Comma),
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
                    "k" => Some(Code::KeyK),
                    "l" => Some(Code::KeyL),
                    "m" => Some(Code::KeyM),
                    "n" => Some(Code::KeyN),
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

fn monitor_contains(
    monitor_pos: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
    point: PhysicalPosition<f64>,
) -> bool {
    let left = monitor_pos.x as f64;
    let top = monitor_pos.y as f64;
    let right = left + monitor_size.width as f64;
    let bottom = top + monitor_size.height as f64;
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
}

/// Clamp a Spotlight rectangle to stay fully visible inside the active monitor's bounds.
pub fn clamp_spotlight_to_monitor(
    cursor_x: i32,
    cursor_y: i32,
    win_w: i32,
    win_h: i32,
    mon_x: i32,
    mon_y: i32,
    mon_w: i32,
    mon_h: i32,
    margin: i32,
) -> (i32, i32) {
    let min_x = mon_x + margin;
    let max_x = (mon_x + mon_w - win_w - margin).max(min_x);
    let min_y = mon_y + margin;
    let max_y = (mon_y + mon_h - win_h - margin).max(min_y);

    // Center horizontally on cursor and open slightly below/around cursor so pointer isn't covered.
    let desired_x = cursor_x - win_w / 2;
    let desired_y = cursor_y - 44;
    (
        desired_x.clamp(min_x, max_x),
        desired_y.clamp(min_y, max_y),
    )
}

fn target_monitor_and_cursor(
    window: &WebviewWindow,
    settings: &AssistantSettings,
) -> Result<(tauri::Monitor, Option<PhysicalPosition<f64>>), String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("Cannot list monitors: {e}"))?;

    let cursor = window.cursor_position().ok();
    if let Some(pos) = cursor {
        if let Some(monitor) = monitors
            .iter()
            .find(|m| monitor_contains(*m.position(), *m.size(), pos))
        {
            return Ok((monitor.clone(), Some(pos)));
        }
    }

    if let Some(last_name) = settings.last_monitor_name.as_deref() {
        if let Some(monitor) = monitors
            .iter()
            .find(|m| m.name().map(String::as_str) == Some(last_name))
        {
            return Ok((monitor.clone(), cursor));
        }
    }

    let primary = window
        .primary_monitor()
        .map_err(|e| format!("Cannot get primary monitor: {e}"))?
        .or_else(|| monitors.into_iter().next())
        .ok_or_else(|| "No monitor is available.".to_string())?;
    Ok((primary, cursor))
}

fn apply_window_geometry(
    window: &WebviewWindow,
    settings: &AssistantSettings,
    summon_at_cursor: bool,
) -> Result<(), String> {
    let (monitor, cursor) = target_monitor_and_cursor(window, settings)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let scale = monitor.scale_factor().max(1.0);
    let margin = (16.0 * scale).round() as i32;
    let screen_w = monitor_size.width as i32;
    let screen_h = monitor_size.height as i32;

    match settings.window_mode {
        AssistantWindowMode::Spotlight => {
            let _ = window.unmaximize();
            let desired_w = ((settings.spotlight_width.max(380) as f64) * scale).round() as i32;
            let desired_h = ((settings.spotlight_height.max(420) as f64) * scale).round() as i32;
            let width = desired_w.min((screen_w - margin * 2).max(360));
            let height = desired_h.min((screen_h - margin * 2).max(400));

            let (x, y) = if summon_at_cursor {
                if let Some(pos) = cursor {
                    clamp_spotlight_to_monitor(
                        pos.x.round() as i32,
                        pos.y.round() as i32,
                        width,
                        height,
                        monitor_pos.x,
                        monitor_pos.y,
                        screen_w,
                        screen_h,
                        margin,
                    )
                } else {
                    (
                        monitor_pos.x + (screen_w - width) / 2,
                        monitor_pos.y + (screen_h - height) / 3,
                    )
                }
            } else {
                (
                    monitor_pos.x + (screen_w - width) / 2,
                    monitor_pos.y + (screen_h - height) / 3,
                )
            };

            let _ = window.set_always_on_top(true);
            window
                .set_size(Size::Physical(PhysicalSize::new(
                    width.max(360) as u32,
                    height.max(400) as u32,
                )))
                .map_err(|e| format!("Cannot set Spotlight size: {e}"))?;
            window
                .set_position(Position::Physical(PhysicalPosition::new(x, y)))
                .map_err(|e| format!("Cannot position Spotlight: {e}"))?;
        }
        AssistantWindowMode::Dashboard => {
            let _ = window.set_always_on_top(false);
            let _ = window.set_skip_taskbar(false);

            if let Some(ref saved) = settings.dashboard_bounds {
                let _ = window.unmaximize();
                let w = saved.width.max(760).min((screen_w - margin).max(760) as u32);
                let h = saved.height.max(520).min((screen_h - margin).max(520) as u32);
                let _ = window.set_size(Size::Physical(PhysicalSize::new(w, h)));
                let _ = window.set_position(Position::Physical(PhysicalPosition::new(
                    saved.x, saved.y,
                )));
                if saved.maximized {
                    let _ = window.maximize();
                }
            } else {
                let _ = window.unmaximize();
                let width = ((DEFAULT_DASHBOARD_WIDTH * scale).round() as i32)
                    .min((screen_w - margin * 2).max(760));
                let height = ((DEFAULT_DASHBOARD_HEIGHT * scale).round() as i32)
                    .min((screen_h - margin * 2).max(520));
                let x = monitor_pos.x + (screen_w - width) / 2;
                let y = monitor_pos.y + (screen_h - height) / 2;
                window
                    .set_size(Size::Physical(PhysicalSize::new(
                        width as u32,
                        height as u32,
                    )))
                    .map_err(|e| format!("Cannot set Dashboard size: {e}"))?;
                window
                    .set_position(Position::Physical(PhysicalPosition::new(x, y)))
                    .map_err(|e| format!("Cannot position Dashboard: {e}"))?;
            }
        }
    }

    let mut next = settings.clone();
    next.last_monitor_name = monitor.name().cloned();
    let _ = window.app_handle().emit("assistant-window-mode", next.window_mode);
    let _ = write_settings(window.app_handle(), &next);
    Ok(())
}

fn record_current_window_bounds(window: &tauri::Window) {
    let app = window.app_handle();
    let mut settings = read_settings(app);
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0).max(1.0);

    match settings.window_mode {
        AssistantWindowMode::Spotlight => {
            let logical_w = (size.width as f64 / scale).round() as u32;
            let logical_h = (size.height as f64 / scale).round() as u32;
            if (380..=900).contains(&logical_w) && (420..=1100).contains(&logical_h) {
                settings.spotlight_width = logical_w;
                settings.spotlight_height = logical_h;
                let _ = write_settings(app, &settings);
            }
        }
        AssistantWindowMode::Dashboard => {
            let maximized = window.is_maximized().unwrap_or(false);
            if !maximized && size.width >= 600 && size.height >= 420 {
                settings.dashboard_bounds = Some(WindowBounds {
                    x: pos.x,
                    y: pos.y,
                    width: size.width,
                    height: size.height,
                    maximized: false,
                });
            } else if let Some(ref mut b) = settings.dashboard_bounds {
                b.maximized = maximized;
            }
            let _ = write_settings(app, &settings);
        }
    }
}

fn should_debounce(app: &AppHandle) -> bool {
    let Some(runtime) = app.try_state::<AssistantRuntime>() else {
        return false;
    };
    let mut guard = match runtime.last_activation.lock() {
        Ok(g) => g,
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

fn suppress_blur_briefly(app: &AppHandle, ms: u64) {
    if let Some(runtime) = app.try_state::<AssistantRuntime>() {
        if let Ok(mut guard) = runtime.suppress_blur_until.lock() {
            let candidate = Instant::now() + Duration::from_millis(ms);
            let next = match *guard {
                Some(existing) if existing > candidate => existing,
                _ => candidate,
            };
            *guard = Some(next);
        }
    }
}

fn show_assistant_with_blur_guard(app: &AppHandle, blur_guard_ms: u64) -> Result<(), String> {
    let Ok(window) = main_window(app) else {
        if let Some(runtime) = app.try_state::<AssistantRuntime>() {
            runtime.pending_show.store(true, Ordering::Relaxed);
        }
        suppress_blur_briefly(app, blur_guard_ms.max(30_000));
        return Ok(());
    };

    if should_debounce(app) {
        return Ok(());
    }

    let mut settings = read_settings(app);
    if !settings.first_open_done {
        settings.window_mode = AssistantWindowMode::Spotlight;
        settings.first_open_done = true;
        let _ = write_settings(app, &settings);
    }

    suppress_blur_briefly(app, blur_guard_ms);
    let _ = window.set_skip_taskbar(false);
    let _ = apply_window_geometry(
        &window,
        &settings,
        settings.window_mode == AssistantWindowMode::Spotlight,
    );
    window
        .show()
        .map_err(|e| format!("Cannot show assistant: {e}"))?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = app.emit("assistant-focus-prompt", serde_json::json!({}));
    Ok(())
}

pub fn show_assistant(app: &AppHandle) -> Result<(), String> {
    show_assistant_with_blur_guard(app, 350)
}

pub fn show_assistant_from_single_instance(app: &AppHandle) -> Result<(), String> {
    show_assistant_with_blur_guard(app, 30_000)
}

pub fn hide_assistant(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    let settings = read_settings(app);
    if settings.hide_from_taskbar {
        let _ = window.set_skip_taskbar(true);
    }
    window
        .hide()
        .map_err(|e| format!("Cannot hide assistant: {e}"))
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
    app.global_shortcut().register(shortcut).map_err(|e| {
        format!("Shortcut '{shortcut_text}' could not be registered. Another app may already be using it: {e}")
    })
}

fn replace_shortcut(
    app: &AppHandle,
    next_shortcut: &str,
    previous_shortcut: Option<&str>,
) -> Result<(), String> {
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

fn register_shortcut_with_fallback(
    app: &AppHandle,
    settings: &AssistantSettings,
) -> AssistantSettings {
    let mut active_settings = settings.clone();
    match replace_shortcut(app, &settings.global_shortcut, None) {
        Ok(()) => active_settings,
        Err(primary_error) => {
            let fallback = if settings.global_shortcut == FALLBACK_SHORTCUT {
                DEFAULT_SHORTCUT
            } else {
                FALLBACK_SHORTCUT
            };
            match register_shortcut(app, fallback) {
                Ok(()) => {
                    active_settings.global_shortcut = fallback.to_string();
                    let _ = write_settings(app, &active_settings);
                    let _ = app.emit(
                        "assistant-shortcut-error",
                        serde_json::json!({
                            "message": format!("{primary_error} Fallback shortcut '{fallback}' was registered instead.")
                        }),
                    );
                }
                Err(fallback_error) => {
                    let _ = app.emit(
                        "assistant-shortcut-error",
                        serde_json::json!({
                            "message": format!("{primary_error} Fallback shortcut '{fallback}' also failed: {fallback_error}")
                        }),
                    );
                }
            }
            active_settings
        }
    }
}

fn setup_tray(app: &App) -> Result<(), tauri::Error> {
    let show = MenuItem::with_id(app, "show-spotlight", "Summon Spotlight", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "open-dashboard", "Open Dashboard", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide-assistant", "Hide", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let check_updates =
        MenuItem::with_id(app, "check-updates", "Check for Updates", true, None::<&str>)?;
    let restart_ai =
        MenuItem::with_id(app, "restart-ai", "Restart Local AI", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DocuSage", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &dashboard,
            &hide,
            &settings,
            &check_updates,
            &restart_ai,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("docusage-assistant");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.tooltip("DocuSage — Alt+Space")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-spotlight" => {
                let _ = set_mode_internal(app, AssistantWindowMode::Spotlight, true);
            }
            "open-dashboard" => {
                let _ = set_mode_internal(app, AssistantWindowMode::Dashboard, true);
            }
            "hide-assistant" => {
                let _ = hide_assistant(app);
            }
            "settings" => {
                let _ = set_mode_internal(app, AssistantWindowMode::Dashboard, true);
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

fn set_mode_internal(
    app: &AppHandle,
    mode: AssistantWindowMode,
    ensure_visible: bool,
) -> Result<AssistantWindowMode, String> {
    let mut settings = read_settings(app);
    settings.window_mode = mode;
    write_settings(app, &settings)?;

    let window = main_window(app)?;
    suppress_blur_briefly(app, 350);
    apply_window_geometry(&window, &settings, mode == AssistantWindowMode::Spotlight)?;
    if ensure_visible {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit("assistant-window-mode", mode);
    Ok(mode)
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    if app.try_state::<AssistantRuntime>().is_none() {
        app.manage(AssistantRuntime::default());
    }

    let app_handle = app.handle().clone();
    let mut settings = register_shortcut_with_fallback(&app_handle, &read_settings(&app_handle));
    let launched_with_hidden_arg = std::env::args().any(|arg| arg == "--hidden");
    if !app_handle
        .global_shortcut()
        .is_registered(parse_shortcut(&settings.global_shortcut)?)
    {
        settings.launch_hidden = false;
    }

    setup_tray(app)?;

    let pending_show = app
        .try_state::<AssistantRuntime>()
        .is_some_and(|rt| rt.pending_show.swap(false, Ordering::Relaxed));

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if !pending_show && (launched_with_hidden_arg || settings.launch_hidden) {
            let _ = window.set_skip_taskbar(settings.hide_from_taskbar);
            let _ = window.hide();
        } else {
            suppress_blur_briefly(&app_handle, 30_000);
            let _ = window.set_skip_taskbar(false);
            let _ = apply_window_geometry(&window, &settings, false);
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    Ok(())
}

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }

    match event {
        WindowEvent::CloseRequested { api, .. } => {
            record_current_window_bounds(window);
            let settings = read_settings(window.app_handle());
            if settings.hide_on_close {
                api.prevent_close();
                let _ = hide_assistant(window.app_handle());
            }
        }
        WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
            if window.is_visible().unwrap_or(false) {
                record_current_window_bounds(window);
            }
        }
        WindowEvent::Focused(false) => {
            let app = window.app_handle();
            let settings = read_settings(app);
            if settings.window_mode != AssistantWindowMode::Spotlight || !settings.auto_hide_on_blur
            {
                return;
            }
            let Some(rt) = app.try_state::<AssistantRuntime>() else {
                return;
            };
            if rt.pinned.load(Ordering::Relaxed)
                || rt.dialog_open.load(Ordering::Relaxed)
                || rt.settings_open.load(Ordering::Relaxed)
            {
                return;
            }
            if let Ok(guard) = rt.suppress_blur_until.lock() {
                if guard.is_some_and(|until| Instant::now() < until) {
                    return;
                }
            }
            let _ = hide_assistant(app);
        }
        _ => {}
    }
}

#[tauri::command]
pub fn get_assistant_status(app: AppHandle) -> Result<AssistantStatus, String> {
    let window = main_window(&app)?;
    let is_pinned = app
        .try_state::<AssistantRuntime>()
        .is_some_and(|rt| rt.pinned.load(Ordering::Relaxed));
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    Ok(AssistantStatus {
        is_visible: window.is_visible().unwrap_or(false),
        is_pinned,
        autostart_enabled,
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
    if previous.global_shortcut != settings.global_shortcut {
        replace_shortcut(
            &app,
            &settings.global_shortcut,
            Some(&previous.global_shortcut),
        )?;
    }
    write_settings(&app, &settings)?;

    if let Ok(window) = main_window(&app) {
        let _ = window.set_skip_taskbar(
            settings.hide_from_taskbar
                && (settings.window_mode == AssistantWindowMode::Spotlight
                    || !window.is_visible().unwrap_or(false)),
        );
    }
    Ok(settings)
}

#[tauri::command]
pub fn set_assistant_pinned(app: AppHandle, pinned: bool) -> Result<bool, String> {
    if let Some(rt) = app.try_state::<AssistantRuntime>() {
        rt.pinned.store(pinned, Ordering::Relaxed);
    }
    if let Ok(window) = main_window(&app) {
        let settings = read_settings(&app);
        if settings.window_mode == AssistantWindowMode::Spotlight {
            let _ = window.set_always_on_top(true);
        } else {
            let _ = window.set_always_on_top(pinned);
        }
    }
    Ok(pinned)
}

#[tauri::command]
pub fn set_assistant_focus_guard(
    app: AppHandle,
    dialog_open: Option<bool>,
    settings_open: Option<bool>,
) -> Result<(), String> {
    if let Some(rt) = app.try_state::<AssistantRuntime>() {
        if let Some(v) = dialog_open {
            rt.dialog_open.store(v, Ordering::Relaxed);
        }
        if let Some(v) = settings_open {
            rt.settings_open.store(v, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|e| format!("Failed to enable autostart: {e}"))?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|e| format!("Failed to disable autostart: {e}"))?;
    }
    Ok(app.autolaunch().is_enabled().unwrap_or(enabled))
}

#[tauri::command]
pub fn read_clipboard_text(app: AppHandle) -> Result<String, String> {
    app.clipboard()
        .read_text()
        .map_err(|e| format!("Cannot read clipboard: {e}"))
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
    set_mode_internal(&app, window_mode, false)
}

#[tauri::command]
pub fn cycle_assistant_window_mode(app: AppHandle) -> Result<AssistantWindowMode, String> {
    let settings = read_settings(&app);
    set_mode_internal(&app, settings.window_mode.toggle(), false)
}

#[tauri::command]
pub async fn check_for_updates() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("DocuSage update check")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get("https://api.github.com/repos/Waqar-743/DocuSage/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Cannot reach GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub update check failed: {e}"))?;
    let release: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let tag = release["tag_name"]
        .as_str()
        .ok_or("GitHub did not return a release version")?;
    let current = env!("CARGO_PKG_VERSION");
    if tag.trim_start_matches('v') == current {
        Ok(format!("You are using the latest release ({current})."))
    } else {
        Ok(format!(
            "Latest GitHub release: {tag}. Installed: {current}. Download updates from GitHub Releases."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_parser_rejects_ambiguous_and_unmodified_keys() {
        assert!(parse_shortcut("Space").is_err());
        assert!(parse_shortcut("Alt+Space+N").is_err());
        assert!(parse_shortcut("Alt+Unsupported").is_err());
        assert!(parse_shortcut("Ctrl+Shift+K").is_ok());
        assert!(parse_shortcut("Option+Space").is_ok());
    }

    #[test]
    fn spotlight_clamps_cleanly_inside_multi_monitor_bounds() {
        // Secondary monitor at x = 1920..3840, y = 0..1080; cursor near bottom-right corner.
        let (x, y) = clamp_spotlight_to_monitor(3830, 1070, 440, 560, 1920, 0, 1920, 1080, 16);
        assert!(x >= 1920 + 16);
        assert!(x + 440 <= 3840 - 16);
        assert!(y >= 16);
        assert!(y + 560 <= 1080 - 16);
    }

    #[test]
    fn legacy_window_modes_deserialize_into_v2_modes() {
        assert_eq!(
            serde_json::from_str::<AssistantWindowMode>("\"compact\"").unwrap(),
            AssistantWindowMode::Spotlight
        );
        assert_eq!(
            serde_json::from_str::<AssistantWindowMode>("\"full\"").unwrap(),
            AssistantWindowMode::Dashboard
        );
    }
}
