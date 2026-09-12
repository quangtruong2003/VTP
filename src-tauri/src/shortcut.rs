use std::str::FromStr;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShortcutMode {
    Toggle,
    Hold,
}

impl ShortcutMode {
    fn from_setting(value: &str) -> Self {
        if value.eq_ignore_ascii_case("hold") {
            Self::Hold
        } else {
            Self::Toggle
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShortcutEdge {
    Pressed,
    Released,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecordCommand {
    Toggle,
    Start,
    Finish,
}

#[derive(Debug, Default)]
struct RecordShortcutState {
    pressed_mode: Option<ShortcutMode>,
}

impl RecordShortcutState {
    fn handle(&mut self, mode: ShortcutMode, edge: ShortcutEdge) -> Option<RecordCommand> {
        match edge {
            ShortcutEdge::Pressed if self.pressed_mode.is_some() => None,
            ShortcutEdge::Pressed => {
                self.pressed_mode = Some(mode);
                Some(match mode {
                    ShortcutMode::Toggle => RecordCommand::Toggle,
                    ShortcutMode::Hold => RecordCommand::Start,
                })
            }
            ShortcutEdge::Released => match self.pressed_mode.take() {
                Some(ShortcutMode::Hold) => Some(RecordCommand::Finish),
                Some(ShortcutMode::Toggle) | None => None,
            },
        }
    }
}

pub fn parse_shortcut(value: &str) -> AppResult<Shortcut> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Shortcut("shortcut cannot be empty".into()));
    }
    if trimmed.eq_ignore_ascii_case("enter") {
        return Err(AppError::Shortcut(
            "bare Enter cannot be registered as a global shortcut".into(),
        ));
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
    let p = (!process.trim().is_empty())
        .then(|| parse_shortcut(process))
        .transpose()?;
    let c = parse_shortcut(cancel)?;
    let h = parse_shortcut(history)?;
    let s = parse_shortcut(settings)?;

    let items = [Some(r), p, Some(c), Some(h), Some(s)];
    for i in 0..items.len() {
        for j in (i + 1)..items.len() {
            if items[i].is_some() && items[i] == items[j] {
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
    let record_state = Arc::new(Mutex::new(RecordShortcutState::default()));
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if action == ShortcutAction::RecordToggle {
                let edge = if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    ShortcutEdge::Pressed
                } else {
                    ShortcutEdge::Released
                };
                let mode = app
                    .try_state::<std::sync::Arc<crate::settings::SettingsStore>>()
                    .map(|store| ShortcutMode::from_setting(&store.get().shortcut_mode))
                    .unwrap_or(ShortcutMode::Toggle);
                let command = record_state
                    .lock()
                    .ok()
                    .and_then(|mut state| state.handle(mode, edge));
                match command {
                    Some(RecordCommand::Toggle) => crate::overlay::toggle(app.clone()),
                    Some(RecordCommand::Start) => crate::overlay::start(app.clone()),
                    Some(RecordCommand::Finish) => crate::overlay::finish_hold(app.clone()),
                    None => {}
                }
                return;
            }
            if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            match action {
                ShortcutAction::RecordToggle => unreachable!(),
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
    let cancel = parse_shortcut(cancel_shortcut)?;
    if !process_shortcut.trim().is_empty() {
        let process = parse_shortcut(process_shortcut)?;
        register_action(app, process, ShortcutAction::Process)?;
        if let Err(error) = register_action(app, cancel, ShortcutAction::Cancel) {
            let _ = unregister(app, process);
            return Err(error);
        }
    } else {
        register_action(app, cancel, ShortcutAction::Cancel)?;
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
    gs.unregister_all()
        .map_err(|e| AppError::Shortcut(e.to_string()))?;
    let mut first_error = None;

    let record = settings.shortcut.trim();
    if !record.is_empty() {
        match parse_shortcut(record).and_then(|parsed| register(app, parsed)) {
            Ok(()) => {}
            Err(error) => {
                log::error!("failed to register record shortcut: {error}");
                first_error = Some(error);
            }
        }
    }

    let history = settings.history_shortcut.trim();
    if !history.is_empty() {
        match parse_shortcut(history)
            .and_then(|parsed| register_action(app, parsed, ShortcutAction::HistoryToggle))
        {
            Ok(()) => {}
            Err(error) => {
                log::error!("failed to register history shortcut: {error}");
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    let settings_sc = settings.settings_shortcut.trim();
    if !settings_sc.is_empty() {
        match parse_shortcut(settings_sc)
            .and_then(|parsed| register_action(app, parsed, ShortcutAction::SettingsToggle))
        {
            Ok(()) => {}
            Err(error) => {
                log::error!("failed to register settings shortcut: {error}");
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    first_error.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hold_mode_ignores_repeat_and_duplicate_release() {
        let mut state = RecordShortcutState::default();

        assert_eq!(
            state.handle(ShortcutMode::Hold, ShortcutEdge::Pressed),
            Some(RecordCommand::Start)
        );
        assert_eq!(
            state.handle(ShortcutMode::Hold, ShortcutEdge::Pressed),
            None
        );
        assert_eq!(
            state.handle(ShortcutMode::Hold, ShortcutEdge::Released),
            Some(RecordCommand::Finish)
        );
        assert_eq!(
            state.handle(ShortcutMode::Hold, ShortcutEdge::Released),
            None
        );
    }

    #[test]
    fn hold_release_uses_the_mode_that_started_the_press() {
        let mut state = RecordShortcutState::default();

        assert_eq!(
            state.handle(ShortcutMode::Hold, ShortcutEdge::Pressed),
            Some(RecordCommand::Start)
        );
        assert_eq!(
            state.handle(ShortcutMode::Toggle, ShortcutEdge::Released),
            Some(RecordCommand::Finish)
        );
    }

    #[test]
    fn toggle_mode_runs_once_per_physical_press() {
        let mut state = RecordShortcutState::default();

        assert_eq!(
            state.handle(ShortcutMode::Toggle, ShortcutEdge::Pressed),
            Some(RecordCommand::Toggle)
        );
        assert_eq!(
            state.handle(ShortcutMode::Toggle, ShortcutEdge::Pressed),
            None
        );
        assert_eq!(
            state.handle(ShortcutMode::Toggle, ShortcutEdge::Released),
            None
        );
        assert_eq!(
            state.handle(ShortcutMode::Toggle, ShortcutEdge::Pressed),
            Some(RecordCommand::Toggle)
        );
    }

    #[test]
    fn optional_process_shortcut_may_be_empty() {
        assert!(
            ensure_distinct_shortcuts("Ctrl+Shift+Space", "", "Escape", "Alt+V", "Alt+S").is_ok()
        );
    }

    #[test]
    fn invalid_candidate_is_rejected_before_old_shortcut_changes() {
        let old = parse_shortcut("CmdOrCtrl+Shift+Space").unwrap();
        assert!(parse_shortcut("Shift").is_err());
        assert_eq!(old, parse_shortcut("CmdOrCtrl+Shift+Space").unwrap());
    }

    #[test]
    fn record_process_and_cancel_shortcuts_must_be_distinct() {
        assert!(ensure_distinct_shortcuts(
            "Ctrl+Shift+Space",
            "Ctrl+Enter",
            "Escape",
            "Alt+V",
            "Alt+S"
        )
        .is_ok());
        assert!(
            ensure_distinct_shortcuts("Ctrl+Shift+Space", "Enter", "Escape", "Alt+V", "Alt+S")
                .is_err()
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
