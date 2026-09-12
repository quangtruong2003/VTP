mod commands;
mod error;
mod focus;
mod gemini;
mod history;
mod mic_test;
mod overlay;
mod recorder;
mod session;
mod settings;
mod shortcut;
mod tray;
mod types;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings_store = Arc::new(settings::SettingsStore::load().expect("settings store"));
    let history_store = Arc::new(history::HistoryStore::load().expect("history store"));
    let session_manager = Arc::new(session::SessionManager::new());
    let mic_test_manager = Arc::new(mic_test::MicTestManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // second launch attempt: surface the settings window
            let _ = tray::show_settings(_app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Voice to Prompt")
                .arg("--autostart")
                .build(),
        )
        .manage(settings_store.clone())
        .manage(history_store.clone())
        .manage(session_manager.clone())
        .manage(mic_test_manager.clone())
        .manage(Arc::new(gemini::GeminiClient::new().expect("http client")))
        .invoke_handler(tauri::generate_handler![
            commands::get_public_settings,
            commands::save_settings,
            commands::set_shortcut,
            commands::set_process_shortcut,
            commands::set_cancel_shortcut,
            commands::set_history_shortcut,
            commands::set_settings_shortcut,
            commands::platform_info,
            commands::app_version,
            commands::check_update,
            commands::connect_api_key,
            commands::add_api_key,
            commands::list_api_keys,
            commands::remove_api_key,
            commands::set_primary_api_key,
            commands::list_models,
            commands::list_audio_devices,
            commands::mic_test_start,
            commands::mic_test_stop,
            commands::overlay_toggle,
            commands::overlay_start_recording,
            commands::overlay_toggle_pause,
            commands::overlay_process_recording,
            commands::overlay_cancel,
            commands::overlay_reprocess_audio,
            commands::overlay_retry_insertion,
            commands::overlay_copy_last_result,
            commands::overlay_start_new_recording,
            commands::overlay_hide,
            commands::overlay_session_snapshot,
            commands::overlay_insert_result,
            commands::copy_text,
            commands::history_list,
            commands::history_copy,
            commands::history_clear,
            commands::history_delete,
            commands::history_insert,
            commands::open_history,
            commands::close_history,
            commands::open_settings,
            commands::set_start_with_windows,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            // ---- Tray ----
            let settings_snapshot = settings_store.get();
            tray::install(app, &settings_snapshot)?;

            // ---- Autostart sync ----
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use tauri_plugin_autostart::ManagerExt;
                if settings_snapshot.start_with_windows {
                    let _ = app.autolaunch().enable();
                }
            }

            // ---- Global shortcut ----
            if let Err(error) = shortcut::reregister(app.handle(), &settings_snapshot) {
                log::error!("shortcut registration failed: {error}");
                let _ = tray::show_settings(app.handle());
            }

            // ---- Onboarding: show settings on first run (no API key, not launched via autostart) ----
            let is_autostart = std::env::args().any(|arg| arg == "--autostart");
            // Credential Manager access may involve IPC and disk work. Keep it off the
            // setup/UI thread, then lazily create Settings only when onboarding is needed.
            let settings_for_key_check = settings_store.clone();
            let app_for_onboarding = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let key_set =
                    tokio::task::spawn_blocking(move || settings_for_key_check.api_key_set())
                        .await
                        .unwrap_or(false);
                if !is_autostart && !key_set {
                    let _ = tray::show_settings(&app_for_onboarding);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // The tray owns the app lifetime; when the last window closes we
            // keep running. Tauri 2's RunEvent::ExitRequested carries fields
            // and defaults to preventing exit when windows close and a tray
            // exists, so no explicit handling is needed here.
        });
}
