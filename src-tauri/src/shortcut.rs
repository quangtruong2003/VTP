use std::str::FromStr;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutAction {
    RecordToggle,
    Process,
    Cancel,
    HistoryToggle,
    SettingsToggle,
}

pub fn parse_shortcut(value: &str) -> AppResult<Shortcut> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Shortcut("shortcut cannot be empty".into()));
    }
    let has_key = trimmed.split('+').any(|part| {
        !matches!(
            part.trim().to_ascii_lowercase().as_str(),
            "ctrl"
                | "control"
                | "shift"
                | "alt"
                | "option"
                | "meta"
                | "super"
                | "cmd"
                | "command"
                | "cmdorctrl"
                | "commandorcontrol"
        )
    });
    if !has_key {
        return Err(AppError::Shortcut(
            "shortcut must include a non-modifier key".into(),
        ));
    }
    Shortcut::from_str(trimmed).map_err(|e| AppError::Shortcut(e.to_string()))
}

pub fn ensure_distinct_shortcuts(
    record: &str,
    process: &str,
    cancel: &str,
    history: &str,
    settings: &str,
) -> AppResult<()> {
    let r = parse_shortcut(record)?;
    let p = parse_shortcut(process)?;
    let c = parse_shortcut(cancel)?;
    let h = parse_shortcut(history)?;
    let s = parse_shortcut(settings)?;

    let items = [r, p, c, h, s];
    for i in 0..items.len() {
        for j in (i + 1)..items.len() {
            if items[i] == items[j] {
                return Err(AppError::Shortcut(
                    "all shortcuts must be distinct from each other".into(),
                ));
            }
        }
    }
    Ok(())
}

pub fn register_action(
    app: &AppHandle,
    shortcut: Shortcut,
    action: ShortcutAction,
) -> AppResult<()> {
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            match action {
                ShortcutAction::RecordToggle => crate::overlay::toggle(app.clone()),
                ShortcutAction::Process => crate::overlay::process(app.clone()),
                ShortcutAction::Cancel => crate::overlay::cancel(app.clone()),
                ShortcutAction::HistoryToggle => crate::tray::toggle_history(app),
                ShortcutAction::SettingsToggle => crate::tray::toggle_settings(app),
            }
        })
        .map_err(|e| AppError::Shortcut(e.to_string()))
}

pub fn register(app: &AppHandle, shortcut: Shortcut) -> AppResult<()> {
    register_action(app, shortcut, ShortcutAction::RecordToggle)
}

pub fn unregister(app: &AppHandle, shortcut: Shortcut) -> AppResult<()> {
    app.global_shortcut()
        .unregister(shortcut)
        .map_err(|e| AppError::Shortcut(e.to_string()))
}

pub fn register_session_shortcuts(
    app: &AppHandle,
    process_shortcut: &str,
    cancel_shortcut: &str,
) -> AppResult<()> {
    let process = parse_shortcut(process_shortcut)?;
    let cancel = parse_shortcut(cancel_shortcut)?;
    register_action(app, process, ShortcutAction::Process)?;
    if let Err(error) = register_action(app, cancel, ShortcutAction::Cancel) {
        let _ = unregister(app, process);
        return Err(error);
    }
    Ok(())
}

pub fn unregister_session_shortcuts(
    app: &AppHandle,
    process_shortcut: &str,
    cancel_shortcut: &str,
) {
    if let Ok(shortcut) = parse_shortcut(process_shortcut) {
        let _ = unregister(app, shortcut);
    }
    if let Ok(shortcut) = parse_shortcut(cancel_shortcut) {
        let _ = unregister(app, shortcut);
    }
}

/// Startup-only registration. Runtime replacement uses atomic commands and
/// never unregisters the working record shortcut first.
pub fn reregister(app: &AppHandle, settings: &crate::types::AppSettings) -> AppResult<()> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let record = settings.shortcut.trim();
    if !record.is_empty() {
        if let Ok(parsed) = parse_shortcut(record) {
            let _ = register(app, parsed);
        }
    }

    let history = settings.history_shortcut.trim();
    if !history.is_empty() {
        if let Ok(parsed) = parse_shortcut(history) {
            if let Err(e) = register_action(app, parsed, ShortcutAction::HistoryToggle) {
                eprintln!("failed to register history shortcut: {e}");
            }
        }
    }

    let settings_sc = settings.settings_shortcut.trim();
    if !settings_sc.is_empty() {
        if let Ok(parsed) = parse_shortcut(settings_sc) {
            if let Err(e) = register_action(app, parsed, ShortcutAction::SettingsToggle) {
                eprintln!("failed to register settings shortcut: {e}");
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_candidate_is_rejected_before_old_shortcut_changes() {
        let old = parse_shortcut("CmdOrCtrl+Shift+Space").unwrap();
        assert!(parse_shortcut("Shift").is_err());
        assert_eq!(old, parse_shortcut("CmdOrCtrl+Shift+Space").unwrap());
    }

    #[test]
    fn record_process_and_cancel_shortcuts_must_be_distinct() {
        assert!(
            ensure_distinct_shortcuts("Ctrl+Shift+Space", "Enter", "Escape", "Alt+V", "Alt+S")
                .is_ok()
        );
        assert!(ensure_distinct_shortcuts("Enter", "Enter", "Escape", "Alt+V", "Alt+S").is_err());
        assert!(ensure_distinct_shortcuts(
            "Ctrl+Shift+Space",
            "Escape",
            "Escape",
            "Alt+V",
            "Alt+S"
        )
        .is_err());
        assert!(
            ensure_distinct_shortcuts("Ctrl+Shift+Space", "Enter", "Escape", "Alt+V", "Alt+V")
                .is_err()
        );
    }
}
