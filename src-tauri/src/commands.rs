use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{AppError, AppResult};
use crate::focus;
use crate::gemini::GeminiClient;
use crate::history::{transcript_hint, HistoryStore};
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
    store: State<'_, Arc<SettingsStore>>,
) -> AppResult<PublicSettings> {
    Ok(PublicSettings {
        api_key_set: store.api_key_set(),
        settings: store.get(),
    })
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    settings: AppSettings,
) -> AppResult<PublicSettings> {
    // Sanitize: the API would reject these outright.
    let mut settings = settings;
    settings.model = settings.model.trim().to_string();
    if settings.model.is_empty() {
        settings.model = "gemini-2.0-flash".into();
    }
    settings.temperature = settings.temperature.clamp(0.0, 2.0);
    settings.max_output_tokens = settings.max_output_tokens.clamp(64, 8192);
    // Generic settings autosave is never allowed to replace native shortcuts.
    // Shortcut changes must use the dedicated atomic commands below.
    let current = store.get();
    settings.shortcut = current.shortcut;
    settings.process_shortcut = current.process_shortcut;
    settings.cancel_shortcut = current.cancel_shortcut;

    let snapshot = store.update(|s| *s = settings)?;
    if let Err(error) = crate::tray::refresh(&app, &snapshot) {
        log::warn!("tray refresh failed after settings save: {error}");
    }
    let _ = app.emit_to(
        "settings",
        "settings://saved",
        &PublicSettings {
            api_key_set: store.api_key_set(),
            settings: snapshot.clone(),
        },
    );
    Ok(PublicSettings {
        api_key_set: store.api_key_set(),
        settings: snapshot,
    })
}

#[derive(Clone, Copy)]
enum ShortcutField {
    Record,
    Process,
    Cancel,
}

impl ShortcutField {
    fn action(self) -> crate::shortcut::ShortcutAction {
        match self {
            Self::Record => crate::shortcut::ShortcutAction::RecordToggle,
            Self::Process => crate::shortcut::ShortcutAction::Process,
            Self::Cancel => crate::shortcut::ShortcutAction::Cancel,
        }
    }

    fn current<'a>(self, settings: &'a AppSettings) -> &'a str {
        match self {
            Self::Record => &settings.shortcut,
            Self::Process => &settings.process_shortcut,
            Self::Cancel => &settings.cancel_shortcut,
        }
    }

    fn set(self, settings: &mut AppSettings, value: String) {
        match self {
            Self::Record => settings.shortcut = value,
            Self::Process => settings.process_shortcut = value,
            Self::Cancel => settings.cancel_shortcut = value,
        }
    }
}

async fn replace_shortcut(
    app: &AppHandle,
    store: &SettingsStore,
    field: ShortcutField,
    candidate: String,
) -> AppResult<PublicSettings> {
    let current = store.get();
    let old_text = field.current(&current).to_string();
    let new_text = candidate.trim().to_string();
    if new_text == old_text {
        return Ok(PublicSettings {
            api_key_set: store.api_key_set(),
            settings: current,
        });
    }

    let (record, process, cancel) = match field {
        ShortcutField::Record => (
            new_text.as_str(),
            current.process_shortcut.as_str(),
            current.cancel_shortcut.as_str(),
        ),
        ShortcutField::Process => (
            current.shortcut.as_str(),
            new_text.as_str(),
            current.cancel_shortcut.as_str(),
        ),
        ShortcutField::Cancel => (
            current.shortcut.as_str(),
            current.process_shortcut.as_str(),
            new_text.as_str(),
        ),
    };
    crate::shortcut::ensure_distinct_shortcuts(record, process, cancel)?;

    let new = crate::shortcut::parse_shortcut(&new_text)?;
    let old = crate::shortcut::parse_shortcut(&old_text)?;
    let active_session = session::active_stage(app).await.is_some();
    let old_is_registered = matches!(field, ShortcutField::Record) || active_session;

    // Register the candidate first so a conflict never destroys the working
    // binding. Session-only Enter/Esc bindings are validated and immediately
    // released when no voice turn is active.
    crate::shortcut::register_action(app, new, field.action())?;
    if old_is_registered {
        if let Err(error) = crate::shortcut::unregister(app, old) {
            let _ = crate::shortcut::unregister(app, new);
            return Err(error);
        }
    } else {
        let _ = crate::shortcut::unregister(app, new);
    }

    match store.update(|settings| field.set(settings, new_text.clone())) {
        Ok(snapshot) => {
            if matches!(field, ShortcutField::Record) {
                if let Err(error) = crate::tray::refresh(app, &snapshot) {
                    log::warn!("tray refresh failed after shortcut change: {error}");
                }
            }
            Ok(PublicSettings {
                api_key_set: store.api_key_set(),
                settings: snapshot,
            })
        }
        Err(error) => {
            if old_is_registered {
                let _ = crate::shortcut::unregister(app, new);
                let _ = crate::shortcut::register_action(app, old, field.action());
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
pub fn list_audio_devices() -> Vec<AudioDeviceInfo> {
    recorder::list_input_devices()
        .into_iter()
        .map(|(name, is_default)| AudioDeviceInfo { name, is_default })
        .collect()
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

/// Start recording from the overlay UI (Space on the idle screen when
/// "start on open" is off, or the overlay is reopened after success).
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
pub async fn overlay_retry(app: AppHandle) {
    session::retry(app).await;
}

#[tauri::command]
pub fn overlay_hide(app: AppHandle) -> AppResult<()> {
    crate::overlay::hide(&app)
}

#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> AppResult<()> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| AppError::Other(format!("clipboard: {e}")))
}

// ---------- history ----------

#[tauri::command]
pub fn history_list(store: State<'_, Arc<HistoryStore>>) -> Vec<crate::types::HistoryEntry> {
    store.all()
}

#[tauri::command]
pub fn history_copy(
    app: AppHandle,
    id: String,
    store: State<'_, Arc<HistoryStore>>,
) -> AppResult<()> {
    let entry = store
        .all()
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::Other("entry not found".into()))?;
    app.clipboard()
        .write_text(entry.response_text)
        .map_err(|e| AppError::Other(format!("clipboard: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn history_clear(store: State<'_, Arc<HistoryStore>>) -> AppResult<()> {
    store.clear()
}

// ---------- window helpers ----------

#[tauri::command]
pub fn open_settings(app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn test_text_insertion(_app: AppHandle) -> AppResult<()> {
    let target = focus::capture_target()
        .ok_or_else(|| AppError::Focus("no foreground target available".into()))?;
    focus::restore_target(&target)?;
    focus::insert_text("Voice to Prompt — test insertion", false)?;
    Ok(())
}

#[tauri::command]
pub fn set_start_recording_on_open(app: AppHandle, enabled: bool) {
    let store = app.state::<Arc<SettingsStore>>();
    let _ = store.update(|s| s.start_recording_on_open = enabled);
}

#[tauri::command]
pub fn get_transcript_hint(text: String) -> String {
    transcript_hint(&text)
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
