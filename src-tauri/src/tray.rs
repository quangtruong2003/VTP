use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WebviewWindow, Wry};

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

pub fn show_settings(app: &AppHandle) -> tauri::Result<WebviewWindow<Wry>> {
    show_settings_at(app, None)
}

pub fn show_settings_at(
    app: &AppHandle,
    section: Option<String>,
) -> tauri::Result<WebviewWindow<Wry>> {
    if let Some(window) = app.get_webview_window("settings") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
        if let Some(section) = section {
            window.emit("app://settings-section", section)?;
        }
        Ok(window)
    } else {
        let url = section
            .map(|section| format!("settings.html?section={section}"))
            .unwrap_or_else(|| "settings.html".into());
        tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App(url.into()))
            .title("Voice to Prompt Settings")
            .inner_size(720.0, 520.0)
            .min_inner_size(620.0, 440.0)
            .resizable(true)
            .center()
            .build()
    }
}

pub fn toggle_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
    }
    let _ = show_settings(app);
}

pub fn show_history(app: &AppHandle) -> tauri::Result<WebviewWindow<Wry>> {
    let history_visible = app
        .get_webview_window("history")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if !history_visible {
        crate::focus::store_history_target(app);
    }
    if let Some(window) = app.get_webview_window("history") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
        let _ = window.emit("history://opened", ());
        Ok(window)
    } else {
        let window = tauri::WebviewWindowBuilder::new(
            app,
            "history",
            tauri::WebviewUrl::App("history.html".into()),
        )
        .title("Voice to Prompt History")
        .inner_size(440.0, 600.0)
        .min_inner_size(360.0, 420.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .center()
        .build()?;
        let _ = window.emit("history://opened", ());
        Ok(window)
    }
}

pub fn toggle_history(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("history") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
    }
    let _ = show_history(app);
}

pub fn install(app: &App<Wry>, settings: &AppSettings) -> tauri::Result<()> {
    let menu = build_menu(app.handle(), settings)?;
    TrayIconBuilder::<Wry>::with_id("main-tray")
        .icon(app.default_window_icon().expect("default app icon").clone())
        .menu(&menu)
        .tooltip("VoiceToPrompt")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                let _ = show_settings(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => crate::overlay::toggle(app.clone()),
            "settings" => {
                let _ = show_settings(app);
            }
            "history" => {
                let _ = show_history(app);
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
