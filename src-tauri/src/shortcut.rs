use std::str::FromStr;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutAction {
    RecordToggle,
    Process,
    Cancel,
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

pub fn ensure_distinct_shortcuts(record: &str, process: &str, cancel: &str) -> AppResult<()> {
    let record = parse_shortcut(record)?;
    let process = parse_shortcut(process)?;
    let cancel = parse_shortcut(cancel)?;
    if record == process || record == cancel || process == cancel {
        return Err(AppError::Shortcut(
            "record, process, and cancel shortcuts must be different".into(),
        ));
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
pub fn reregister(app: &AppHandle, shortcut: &str) -> AppResult<()> {
    let gs = app.global_shortcut();
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        let _ = gs.unregister_all();
        return Ok(());
    }
    let parsed = parse_shortcut(trimmed)?;
    let _ = gs.unregister_all();
    register(app, parsed)
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
        assert!(ensure_distinct_shortcuts("Ctrl+Shift+Space", "Enter", "Escape").is_ok());
        assert!(ensure_distinct_shortcuts("Enter", "Enter", "Escape").is_err());
        assert!(ensure_distinct_shortcuts("Ctrl+Shift+Space", "Escape", "Escape").is_err());
    }
}
