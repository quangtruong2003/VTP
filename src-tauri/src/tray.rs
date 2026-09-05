use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Wry};

use crate::types::AppSettings;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrayLabels {
    start: &'static str,
    settings: &'static str,
    history: &'static str,
    quit: &'static str,
}

fn labels_for_locale(ui_locale: &str, system_locale: Option<&str>) -> TrayLabels {
    let use_vietnamese = match ui_locale {
        "vi" => true,
        "en" => false,
        "system" => system_locale
            .map(|locale| locale.to_ascii_lowercase().starts_with("vi"))
            .unwrap_or(false),
        _ => false,
    };

    if use_vietnamese {
        TrayLabels {
            start: "Bắt đầu ghi âm",
            settings: "Cài đặt",
            history: "Lịch sử",
            quit: "Thoát",
        }
    } else {
        TrayLabels {
            start: "Start recording",
            settings: "Settings",
            history: "History",
            quit: "Quit",
        }
    }
}

#[cfg(target_os = "windows")]
fn system_locale() -> Option<String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetUserDefaultLocaleName(locale_name: *mut u16, locale_name_len: i32) -> i32;
    }

    let mut buffer = [0u16; 85];
    let length = unsafe { GetUserDefaultLocaleName(buffer.as_mut_ptr(), buffer.len() as i32) };
    if length <= 1 {
        return None;
    }
    String::from_utf16(&buffer[..length as usize - 1]).ok()
}

#[cfg(not(target_os = "windows"))]
fn system_locale() -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

fn start_label(ui_locale: &str, system_locale: Option<&str>, shortcut: &str) -> String {
    let labels = labels_for_locale(ui_locale, system_locale);
    format!("{} ({})", labels.start, shortcut)
}

fn build_menu(app: &AppHandle, settings: &AppSettings) -> tauri::Result<Menu<Wry>> {
    let os_locale = system_locale();
    let labels = labels_for_locale(&settings.ui_locale, os_locale.as_deref());
    let start = MenuItem::with_id(
        app,
        "toggle",
        start_label(
            &settings.ui_locale,
            os_locale.as_deref(),
            &settings.shortcut,
        ),
        true,
        None::<&str>,
    )?;
    let settings_item = MenuItem::with_id(app, "settings", labels.settings, true, None::<&str>)?;
    let history = MenuItem::with_id(app, "history", labels.history, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&start, &settings_item, &history, &quit])
}

fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn install(app: &App<Wry>, settings: &AppSettings) -> tauri::Result<()> {
    let menu = build_menu(app.handle(), settings)?;
    TrayIconBuilder::<Wry>::with_id("main-tray")
        .icon(app.default_window_icon().expect("default app icon").clone())
        .menu(&menu)
        .tooltip("VoiceToPrompt")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_settings(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => crate::overlay::toggle(app.clone()),
            "settings" => show_settings(app),
            "history" => {
                show_settings(app);
                let _ = app.emit_to("settings", "app://settings-section", "history");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn refresh(app: &AppHandle, settings: &AppSettings) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return Ok(());
    };
    tray.set_menu(Some(build_menu(app, settings)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_vietnamese_labels_for_vietnamese_ui() {
        let labels = labels_for_locale("vi", None);
        assert_eq!(labels.settings, "Cài đặt");
        assert_eq!(labels.history, "Lịch sử");
        assert_eq!(labels.quit, "Thoát");
    }

    #[test]
    fn system_locale_can_select_vietnamese_labels() {
        let labels = labels_for_locale("system", Some("vi-VN"));
        assert_eq!(labels.settings, "Cài đặt");
    }

    #[test]
    fn start_label_includes_the_current_shortcut() {
        assert_eq!(
            start_label("en", None, "Ctrl+Shift+Space"),
            "Start recording (Ctrl+Shift+Space)"
        );
    }
}
