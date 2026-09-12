use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{AppError, AppResult};
use crate::focus;
use crate::gemini::GeminiClient;
use crate::history::HistoryStore;
use crate::mic_test::MicTestManager;
use crate::recorder;
use crate::session;
use crate::settings::SettingsStore;
use crate::types::{
    AppSettings, AudioDeviceInfo, GeminiModelInfo, MicLevelPayload, PlatformInfo, PublicSettings,
};

// ---------- settings ----------

#[tauri::command]
pub async fn get_public_settings(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
) -> AppResult<PublicSettings> {
    let mut settings = store.get();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri_plugin_autostart::ManagerExt;
        if let Ok(is_enabled) = app.autolaunch().is_enabled() {
            settings.start_with_windows = is_enabled;
        }
    }
    Ok(PublicSettings {
        api_key_set: store.api_key_set(),
        settings,
    })
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    settings: AppSettings,
) -> AppResult<PublicSettings> {
    let _shortcut_changes = store.lock_shortcut_changes();
    // Sanitize: the API would reject these outright.
    let mut settings = settings;
    settings.model = settings.model.trim().to_string();
    if settings.model.is_empty() {
        settings.model = "gemini-2.0-flash".into();
    }
    settings.temperature = settings.temperature.clamp(0.0, 2.0);
    settings.max_output_tokens = settings.max_output_tokens.clamp(64, 8192);
    settings.shortcut_mode = if settings.shortcut_mode.eq_ignore_ascii_case("hold") {
        "hold".into()
    } else {
        "toggle".into()
    };
    // Generic settings autosave is never allowed to replace native shortcuts.
    // Shortcut changes must use the dedicated atomic commands below.
    let current = store.get();
    settings.shortcut = current.shortcut;
    settings.process_shortcut = current.process_shortcut;
    settings.cancel_shortcut = current.cancel_shortcut;
    settings.history_shortcut = current.history_shortcut;
    settings.settings_shortcut = current.settings_shortcut;
    let autostart_changed = current.start_with_windows != settings.start_with_windows;
    let tray_changed = current.ui_locale != settings.ui_locale;

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri_plugin_autostart::ManagerExt;
        if autostart_changed {
            if settings.start_with_windows {
                if let Err(e) = app.autolaunch().enable() {
                    log::warn!("failed to enable autostart: {e}");
                }
            } else if let Err(e) = app.autolaunch().disable() {
                log::warn!("failed to disable autostart: {e}");
            }
        }
    }

    let snapshot = store.update(|s| *s = settings)?;
    if tray_changed {
        if let Err(error) = crate::tray::refresh(&app, &snapshot) {
            log::warn!("tray refresh failed after settings save: {error}");
        }
    }
    let public = PublicSettings {
        api_key_set: store.api_key_set(),
        settings: snapshot,
    };
    let _ = app.emit("settings://saved", &public);
    Ok(public)
}

#[tauri::command]
pub async fn set_start_with_windows(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    enabled: bool,
) -> AppResult<PublicSettings> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri_plugin_autostart::ManagerExt;
        if enabled {
            app.autolaunch()
                .enable()
                .map_err(|e| AppError::Settings(e.to_string()))?;
        } else {
            app.autolaunch()
                .disable()
                .map_err(|e| AppError::Settings(e.to_string()))?;
        }
    }
    let snapshot = store.update(|s| s.start_with_windows = enabled)?;
    let public = PublicSettings {
        api_key_set: store.api_key_set(),
        settings: snapshot,
    };
    let _ = app.emit("settings://saved", &public);
    Ok(public)
}

#[derive(Clone, Copy)]
enum ShortcutField {
    Record,
    Process,
    Cancel,
    History,
    Settings,
}

impl ShortcutField {
    fn action(self) -> crate::shortcut::ShortcutAction {
        match self {
            Self::Record => crate::shortcut::ShortcutAction::RecordToggle,
            Self::Process => crate::shortcut::ShortcutAction::Process,
            Self::Cancel => crate::shortcut::ShortcutAction::Cancel,
            Self::History => crate::shortcut::ShortcutAction::HistoryToggle,
            Self::Settings => crate::shortcut::ShortcutAction::SettingsToggle,
        }
    }

    fn current(self, settings: &AppSettings) -> &str {
        match self {
            Self::Record => &settings.shortcut,
            Self::Process => &settings.process_shortcut,
            Self::Cancel => &settings.cancel_shortcut,
            Self::History => &settings.history_shortcut,
            Self::Settings => &settings.settings_shortcut,
        }
    }

    fn set(self, settings: &mut AppSettings, value: String) {
        match self {
            Self::Record => settings.shortcut = value,
            Self::Process => settings.process_shortcut = value,
            Self::Cancel => settings.cancel_shortcut = value,
            Self::History => settings.history_shortcut = value,
            Self::Settings => settings.settings_shortcut = value,
        }
    }
}

async fn replace_shortcut(
    app: &AppHandle,
    store: &SettingsStore,
    field: ShortcutField,
    candidate: String,
) -> AppResult<PublicSettings> {
    let active_session = session::active_stage(app).await.is_some();
    let _shortcut_changes = store.lock_shortcut_changes();
    let current = store.get();
    let old_text = field.current(&current).to_string();
    let new_text = candidate.trim().to_string();
    if new_text == old_text {
        return Ok(PublicSettings {
            api_key_set: store.api_key_set(),
            settings: current,
        });
    }

    let mut record = current.shortcut.as_str();
    let mut process = current.process_shortcut.as_str();
    let mut cancel = current.cancel_shortcut.as_str();
    let mut history = current.history_shortcut.as_str();
    let mut settings = current.settings_shortcut.as_str();

    match field {
        ShortcutField::Record => record = new_text.as_str(),
        ShortcutField::Process => process = new_text.as_str(),
        ShortcutField::Cancel => cancel = new_text.as_str(),
        ShortcutField::History => history = new_text.as_str(),
        ShortcutField::Settings => settings = new_text.as_str(),
    }
    crate::shortcut::ensure_distinct_shortcuts(record, process, cancel, history, settings)?;

    let new = if new_text.is_empty() && matches!(field, ShortcutField::Process) {
        None
    } else {
        Some(crate::shortcut::parse_shortcut(&new_text)?)
    };
    let old = (!old_text.is_empty())
        .then(|| crate::shortcut::parse_shortcut(&old_text))
        .transpose()?;
    let old_is_registered = matches!(
        field,
        ShortcutField::Record | ShortcutField::History | ShortcutField::Settings
    ) || active_session;

    // Register the candidate first so a conflict never destroys the working
    // binding. Session-only Enter/Esc bindings are validated and immediately
    // released when no voice turn is active.
    if let Some(new) = new {
        crate::shortcut::register_action(app, new, field.action())?;
    }
    if old_is_registered {
        if let Some(old) = old {
            if let Err(error) = crate::shortcut::unregister(app, old) {
                if let Some(new) = new {
                    let _ = crate::shortcut::unregister(app, new);
                }
                return Err(error);
            }
        }
    } else if let Some(new) = new {
        let _ = crate::shortcut::unregister(app, new);
    }

    match store.update(|settings| field.set(settings, new_text.clone())) {
        Ok(snapshot) => {
            if matches!(field, ShortcutField::Record) {
                if let Err(error) = crate::tray::refresh(app, &snapshot) {
                    log::warn!("tray refresh failed after shortcut change: {error}");
                }
            }
            let public = PublicSettings {
                api_key_set: store.api_key_set(),
                settings: snapshot,
            };
            let _ = app.emit("settings://saved", &public);
            Ok(public)
        }
        Err(error) => {
            if let Some(new) = new {
                let _ = crate::shortcut::unregister(app, new);
            }
            if old_is_registered {
                if let Some(old) = old {
                    let _ = crate::shortcut::register_action(app, old, field.action());
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn set_shortcut(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    shortcut: String,
) -> AppResult<PublicSettings> {
    replace_shortcut(
        &app,
        store.inner().as_ref(),
        ShortcutField::Record,
        shortcut,
    )
    .await
}

#[tauri::command]
pub async fn set_process_shortcut(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    shortcut: String,
) -> AppResult<PublicSettings> {
    replace_shortcut(
        &app,
        store.inner().as_ref(),
        ShortcutField::Process,
        shortcut,
    )
    .await
}

#[tauri::command]
pub async fn set_cancel_shortcut(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    shortcut: String,
) -> AppResult<PublicSettings> {
    replace_shortcut(
        &app,
        store.inner().as_ref(),
        ShortcutField::Cancel,
        shortcut,
    )
    .await
}

#[tauri::command]
pub async fn set_history_shortcut(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    shortcut: String,
) -> AppResult<PublicSettings> {
    replace_shortcut(
        &app,
        store.inner().as_ref(),
        ShortcutField::History,
        shortcut,
    )
    .await
}

#[tauri::command]
pub async fn set_settings_shortcut(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    shortcut: String,
) -> AppResult<PublicSettings> {
    replace_shortcut(
        &app,
        store.inner().as_ref(),
        ShortcutField::Settings,
        shortcut,
    )
    .await
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.into(),
        primary_modifier: if cfg!(target_os = "macos") {
            "Meta".into()
        } else {
            "Ctrl".into()
        },
    }
}

async fn validate_then_store_api_key<V, VFut, S>(key: &str, validate: V, store: S) -> AppResult<()>
where
    V: FnOnce(String) -> VFut,
    VFut: std::future::Future<Output = AppResult<()>>,
    S: FnOnce(&str) -> AppResult<()>,
{
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(AppError::MissingApiKey);
    }
    validate(trimmed.to_string()).await?;
    store(trimmed)
}

#[tauri::command]
pub async fn connect_api_key(
    store: State<'_, Arc<SettingsStore>>,
    gemini: State<'_, Arc<GeminiClient>>,
    key: String,
) -> AppResult<()> {
    validate_then_store_api_key(
        &key,
        |candidate| async move { gemini.list_models(&candidate).await.map(|_| ()) },
        |candidate| store.set_api_key(candidate),
    )
    .await
}

#[tauri::command]
pub async fn delete_api_key(store: State<'_, Arc<SettingsStore>>) -> AppResult<()> {
    store.delete_api_key()
}

// ---------- models ----------

#[tauri::command]
pub async fn list_models(
    store: State<'_, Arc<SettingsStore>>,
    gemini: State<'_, Arc<GeminiClient>>,
) -> AppResult<Vec<GeminiModelInfo>> {
    let key = store.get_api_key()?;
    gemini.list_models(&key).await
}

// ---------- audio ----------

#[tauri::command]
pub async fn list_audio_devices() -> AppResult<Vec<AudioDeviceInfo>> {
    let devices = tokio::task::spawn_blocking(recorder::list_input_devices)
        .await
        .map_err(|error| AppError::Other(format!("audio device scan failed: {error}")))?;
    Ok(devices
        .into_iter()
        .map(|(name, is_default)| AudioDeviceInfo { name, is_default })
        .collect())
}

#[tauri::command]
pub async fn mic_test_start(
    app: AppHandle,
    manager: State<'_, Arc<MicTestManager>>,
    device_name: Option<String>,
) -> AppResult<()> {
    let manager = manager.inner().clone();
    let generation = manager.start(device_name).await?;
    let app_for_levels = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let Some(level) = manager.level_for(generation).await else {
                break;
            };
            let _ = app_for_levels.emit_to(
                "settings",
                "settings://mic-level",
                &MicLevelPayload { level },
            );
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn mic_test_stop(
    app: AppHandle,
    manager: State<'_, Arc<MicTestManager>>,
) -> AppResult<()> {
    if let Some(handle) = manager.stop().await {
        tokio::task::spawn_blocking(move || drop(handle.stop()))
            .await
            .map_err(|error| AppError::Other(format!("microphone test stop failed: {error}")))?;
    }
    let _ = app.emit_to(
        "settings",
        "settings://mic-level",
        &MicLevelPayload { level: 0 },
    );
    Ok(())
}

// ---------- overlay lifecycle ----------

#[tauri::command]
pub fn overlay_toggle(app: AppHandle) {
    crate::overlay::toggle(app);
}

/// Start recording from the overlay UI when the session is idle or reset.
/// Normal turns start through the configured Toggle or Hold-to-talk shortcut.
#[tauri::command]
pub async fn overlay_start_recording(app: AppHandle) -> AppResult<()> {
    let session_id = match session::active_stage(&app).await {
        Some((id, session::SessionStage::Idle)) => id,
        Some(_) => return Err(AppError::SessionBusy),
        None => session::create_turn(&app).await?,
    };
    session::begin_recording(app, session_id).await
}

#[tauri::command]
pub async fn overlay_toggle_pause(app: AppHandle) -> AppResult<()> {
    session::toggle_pause(app).await
}

#[tauri::command]
pub async fn overlay_process_recording(app: AppHandle) -> AppResult<()> {
    session::process_recording(app).await
}

#[tauri::command]
pub async fn overlay_cancel(app: AppHandle) {
    crate::overlay::request_cancel(app).await;
}

#[tauri::command]
pub async fn overlay_reprocess_audio(app: AppHandle) -> AppResult<()> {
    session::reprocess_audio(app).await
}

#[tauri::command]
pub async fn overlay_retry_insertion(app: AppHandle, text: Option<String>) -> AppResult<()> {
    session::retry_insertion(app, text).await
}

#[tauri::command]
pub async fn overlay_copy_last_result(app: AppHandle) -> AppResult<()> {
    session::copy_last_result(app).await
}

#[tauri::command]
pub async fn overlay_start_new_recording(app: AppHandle) -> AppResult<()> {
    session::start_new_recording(app).await
}

#[tauri::command]
pub fn overlay_hide(app: AppHandle) -> AppResult<()> {
    session::clear_snapshot(&app);
    crate::overlay::hide(&app)
}

#[tauri::command]
pub fn overlay_session_snapshot(app: AppHandle) -> Option<crate::types::OverlayEvent> {
    session::snapshot(&app)
}

#[tauri::command]
pub async fn overlay_insert_result(app: AppHandle, text: String) -> AppResult<()> {
    session::insert_result(app, text).await
}

#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> AppResult<()> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| AppError::Clipboard(e.to_string()))
}

// ---------- history ----------

#[tauri::command]
pub async fn history_list(
    store: State<'_, Arc<HistoryStore>>,
) -> AppResult<Vec<crate::types::HistoryEntry>> {
    let store = store.inner().clone();
    tokio::task::spawn_blocking(move || store.all())
        .await
        .map_err(|error| AppError::Other(format!("history read failed: {error}")))?
}

#[tauri::command]
pub async fn history_copy(
    app: AppHandle,
    id: String,
    store: State<'_, Arc<HistoryStore>>,
) -> AppResult<()> {
    let store = store.inner().clone();
    let entries = tokio::task::spawn_blocking(move || store.all())
        .await
        .map_err(|error| AppError::Other(format!("history read failed: {error}")))??;
    let entry = entries
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::Other("entry not found".into()))?;
    app.clipboard()
        .write_text(entry.response_text)
        .map_err(|e| AppError::Clipboard(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn history_clear(app: AppHandle, store: State<'_, Arc<HistoryStore>>) -> AppResult<()> {
    let store = store.inner().clone();
    tokio::task::spawn_blocking(move || store.clear())
        .await
        .map_err(|error| AppError::Other(format!("history clear failed: {error}")))??;
    let _ = app.emit("history://changed", ());
    Ok(())
}

#[tauri::command]
pub async fn history_delete(
    app: AppHandle,
    id: String,
    store: State<'_, Arc<HistoryStore>>,
) -> AppResult<()> {
    let store = store.inner().clone();
    tokio::task::spawn_blocking(move || store.delete(&id))
        .await
        .map_err(|error| AppError::Other(format!("history delete failed: {error}")))??;
    let _ = app.emit("history://changed", ());
    Ok(())
}

#[tauri::command]
pub async fn history_insert(app: AppHandle, text: String) -> AppResult<()> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| AppError::Clipboard(e.to_string()))?;
    tokio::task::spawn_blocking(|| {
        focus::restore_history_target()?;
        focus::paste_via_clipboard()
    })
    .await
    .map_err(|error| AppError::Other(format!("history insertion failed: {error}")))??;
    if let Some(w) = app.get_webview_window("history") {
        let _ = w.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn open_history(app: AppHandle) {
    let _ = crate::tray::show_history(&app);
}

#[tauri::command]
pub fn close_history(app: AppHandle) {
    if let Some(w) = app.get_webview_window("history") {
        let _ = w.hide();
    }
}

// ---------- window helpers ----------

#[tauri::command]
pub fn open_settings(app: AppHandle, section: Option<String>) -> AppResult<()> {
    let section = section.filter(|value| {
        matches!(
            value.as_str(),
            "general" | "voice" | "ai_prompt" | "shortcut" | "output" | "history"
        )
    });
    crate::tray::show_settings_at(&app, section)
        .map_err(|error| AppError::Other(format!("settings window show failed: {error}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn invalid_candidate_api_key_is_never_persisted() {
        let persisted = Arc::new(Mutex::new(Vec::<String>::new()));
        let persisted_for_store = persisted.clone();

        let result = validate_then_store_api_key(
            "  bad-key  ",
            |_candidate| async {
                Err(AppError::Api {
                    status: 401,
                    message: "invalid".into(),
                })
            },
            move |candidate| {
                persisted_for_store
                    .lock()
                    .unwrap()
                    .push(candidate.to_string());
                Ok(())
            },
        )
        .await;

        assert!(result.is_err());
        assert!(persisted.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn valid_candidate_is_trimmed_then_persisted() {
        let persisted = Arc::new(Mutex::new(Vec::<String>::new()));
        let persisted_for_store = persisted.clone();

        validate_then_store_api_key(
            "  valid-key  ",
            |candidate| async move {
                assert_eq!(candidate, "valid-key");
                Ok(())
            },
            move |candidate| {
                persisted_for_store
                    .lock()
                    .unwrap()
                    .push(candidate.to_string());
                Ok(())
            },
        )
        .await
        .unwrap();

        assert_eq!(persisted.lock().unwrap().as_slice(), &["valid-key"]);
    }
}
