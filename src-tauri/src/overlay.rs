use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::session::SessionStage;
use crate::types::{OverlayDismissEvent, OverlayPhase};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NormalShortcutStartStep {
    BeginRecording,
    ShowOverlay,
}

fn normal_shortcut_start_steps() -> [NormalShortcutStartStep; 2] {
    [
        NormalShortcutStartStep::BeginRecording,
        NormalShortcutStartStep::ShowOverlay,
    ]
}

/// The record shortcut owns capture only: start from idle, then pause/resume.
/// Processing and cancellation are separate session-scoped shortcuts.
pub fn toggle(app: AppHandle) {
    if let Some(gemini) = app.try_state::<std::sync::Arc<crate::gemini::GeminiClient>>() {
        gemini.prewarm();
    }
    tauri::async_runtime::spawn(async move {
        match crate::session::active_stage(&app).await {
            Some((_id, SessionStage::Recording | SessionStage::Paused)) => {
                if let Err(e) = crate::session::toggle_pause(app.clone()).await {
                    log::warn!("record shortcut pause/resume failed: {e}");
                }
            }
            Some((id, SessionStage::Idle)) => {
                let _ = crate::session::begin_recording(app.clone(), id).await;
            }
            Some((_id, _)) => {
                crate::session::acknowledge_busy(&app).await;
            }
            None => {
                let session_id = match crate::session::create_turn(&app).await {
                    Ok(id) => id,
                    Err(crate::error::AppError::SessionBusy) => return,
                    Err(e) => {
                        log::warn!("create voice turn failed: {e}");
                        return;
                    }
                };
                let mut start_result = Ok(());
                for step in normal_shortcut_start_steps() {
                    match step {
                        NormalShortcutStartStep::BeginRecording => {
                            start_result =
                                crate::session::begin_recording(app.clone(), session_id).await;
                        }
                        NormalShortcutStartStep::ShowOverlay => show_without_activation(&app),
                    }
                }
                if let Err(e) = start_result {
                    log::warn!("start voice recording failed: {e}");
                }
            }
        }
    });
}

pub fn process(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::session::process_recording(app).await {
            log::warn!("process shortcut failed: {e}");
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CancelLifecycleStep {
    CancelSession,
    RequestUiExit,
}

fn cancel_lifecycle_steps() -> [CancelLifecycleStep; 2] {
    [
        CancelLifecycleStep::CancelSession,
        CancelLifecycleStep::RequestUiExit,
    ]
}

pub async fn request_cancel(app: AppHandle) {
    let mut cancelled_session_id = None;
    for step in cancel_lifecycle_steps() {
        match step {
            CancelLifecycleStep::CancelSession => {
                cancelled_session_id = crate::session::cancel_recording(app.clone()).await;
            }
            CancelLifecycleStep::RequestUiExit => {
                if let Some(session_id) = cancelled_session_id {
                    let event = OverlayDismissEvent { session_id };
                    if let Err(error) = app.emit_to("overlay", "overlay://dismiss", &event) {
                        log::warn!("overlay dismiss request failed: {error}");
                        let _ = hide(&app);
                    }
                } else {
                    let _ = hide(&app);
                }
            }
        }
    }
}

pub fn cancel(app: AppHandle) {
    tauri::async_runtime::spawn(request_cancel(app));
}

const FAST_PATH_LAYOUT: (f64, f64) = (280.0, 48.0);
const RECOVERY_LAYOUT: (f64, f64) = (350.0, 160.0);

pub fn layout_for(phase: &OverlayPhase) -> (f64, f64) {
    match phase {
        OverlayPhase::Success { pasted: false, .. } | OverlayPhase::Error { .. } => RECOVERY_LAYOUT,
        OverlayPhase::Idle
        | OverlayPhase::Recording { .. }
        | OverlayPhase::Paused { .. }
        | OverlayPhase::Uploading
        | OverlayPhase::Processing
        | OverlayPhase::Success { pasted: true, .. }
        | OverlayPhase::Info { .. } => FAST_PATH_LAYOUT,
    }
}

pub fn visible_layout_for(phase: &OverlayPhase) -> Option<(f64, f64)> {
    if matches!(phase, OverlayPhase::Idle) {
        None
    } else {
        Some(layout_for(phase))
    }
}

fn layout_change_required(
    current_physical: (u32, u32),
    scale_factor: f64,
    desired_logical: (f64, f64),
) -> bool {
    let expected_width = (desired_logical.0 * scale_factor).round() as u32;
    let expected_height = (desired_logical.1 * scale_factor).round() as u32;
    current_physical != (expected_width, expected_height)
}

fn bottom_center_position(
    monitor_width: f64,
    monitor_height: f64,
    window_width: f64,
    window_height: f64,
) -> (i32, i32) {
    let x = ((monitor_width - window_width) / 2.0).max(8.0);
    let y = (monitor_height - window_height - 24.0).max(8.0);
    (x.round() as i32, y.round() as i32)
}

fn position_on_monitor(window: &WebviewWindow, monitor: &tauri::Monitor) {
    let scale = monitor.scale_factor();
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let monitor_width = monitor_size.width as f64 / scale;
    let monitor_height = monitor_size.height as f64 / scale;
    let window_width = window_size.width as f64 / scale;
    let window_height = window_size.height as f64 / scale;
    let (local_x, local_y) =
        bottom_center_position(monitor_width, monitor_height, window_width, window_height);
    let x = monitor_position.x + (local_x as f64 * scale).round() as i32;
    let y = monitor_position.y + (local_y as f64 * scale).round() as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn position_bottom_center(app: &AppHandle) -> Option<()> {
    let window = app.get_webview_window("overlay")?;
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())?;
    position_on_monitor(&window, &monitor);
    Some(())
}

pub fn apply_layout(app: &AppHandle, phase: &OverlayPhase) {
    let Some((width, height)) = visible_layout_for(phase) else {
        return;
    };
    let Some(window) = app.get_webview_window("overlay") else {
        return;
    };
    if let (Ok(current), Ok(scale_factor)) = (window.outer_size(), window.scale_factor()) {
        if !layout_change_required(
            (current.width, current.height),
            scale_factor,
            (width, height),
        ) {
            return;
        }
    }
    if let Err(error) = window.set_size(LogicalSize::new(width, height)) {
        log::warn!("overlay resize failed: {error}");
        return;
    }
    if let Ok(Some(monitor)) = window.current_monitor() {
        position_on_monitor(&window, &monitor);
    } else {
        let _ = position_bottom_center(app);
    }
}

pub fn show_without_activation(app: &AppHandle) {
    let Some(w) = app.get_webview_window("overlay") else {
        return;
    };
    let _ = position_bottom_center(app);
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
        };
        let hwnd = w.hwnd().map(|h| h.0).unwrap_or_default();
        if hwnd as usize != 0 {
            let ok = unsafe {
                ShowWindow(hwnd as _, SW_SHOWNOACTIVATE);
                SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE,
                )
            };
            if ok == 0 {
                let _ = w.show();
            }
        } else {
            let _ = w.show();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = w.show();
    }
    let _ = w.set_always_on_top(true);
}

pub fn hide(app: &AppHandle) -> AppResult<()> {
    let Some(w) = app.get_webview_window("overlay") else {
        return Ok(());
    };
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, SW_HIDE, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE,
            SWP_NOSIZE,
        };
        let hwnd = w.hwnd().map(|h| h.0).unwrap_or_default();
        if hwnd as usize != 0 {
            unsafe {
                ShowWindow(hwnd as _, SW_HIDE);
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_HIDEWINDOW | SWP_NOACTIVATE,
                );
            }
        }
    }
    w.hide()
        .map_err(|error| AppError::Other(format!("overlay hide failed: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ErrorCode, FrontendError};

    #[test]
    fn bottom_center_position_ignores_cursor_coordinates() {
        assert_eq!(
            bottom_center_position(1920.0, 1080.0, 360.0, 96.0),
            (780, 960)
        );
        assert_eq!(
            bottom_center_position(1280.0, 720.0, 404.0, 220.0),
            (438, 476)
        );
    }

    #[test]
    fn cancel_pipeline_requests_ui_exit_only_after_logical_cancellation() {
        assert_eq!(
            cancel_lifecycle_steps(),
            [
                CancelLifecycleStep::CancelSession,
                CancelLifecycleStep::RequestUiExit,
            ]
        );
    }

    #[test]
    fn normal_shortcut_flow_begins_recording_before_showing_overlay() {
        assert_eq!(
            normal_shortcut_start_steps(),
            [
                NormalShortcutStartStep::BeginRecording,
                NormalShortcutStartStep::ShowOverlay,
            ]
        );
    }

    #[test]
    fn fast_path_phases_share_one_native_footprint() {
        let recording = layout_for(&OverlayPhase::Recording {
            elapsed_ms: 0,
            level: 0,
        });
        assert_eq!(recording, (280.0, 48.0));
        assert_eq!(
            layout_for(&OverlayPhase::Paused { elapsed_ms: 0 }),
            recording
        );
        assert_eq!(layout_for(&OverlayPhase::Uploading), recording);
        assert_eq!(layout_for(&OverlayPhase::Processing), recording);
        assert_eq!(
            layout_for(&OverlayPhase::Success {
                text: "x".into(),
                pasted: true,
                copied: true,
            }),
            recording
        );
        assert_eq!(
            layout_for(&OverlayPhase::Info {
                message: "x".into(),
            }),
            recording
        );
    }

    #[test]
    fn recovery_panels_keep_their_larger_native_footprint() {
        assert_eq!(
            layout_for(&OverlayPhase::Success {
                text: "x".into(),
                pasted: false,
                copied: true,
            }),
            (350.0, 160.0)
        );
        assert_eq!(
            layout_for(&OverlayPhase::Error {
                error: FrontendError {
                    code: ErrorCode::Unknown,
                    recoverable: true,
                    detail: None,
                },
            }),
            (350.0, 160.0),
        );
    }

    #[test]
    fn idle_has_no_visible_native_layout() {
        assert_eq!(visible_layout_for(&OverlayPhase::Idle), None);
    }

    #[test]
    fn unchanged_layout_skips_native_geometry_updates() {
        assert!(!layout_change_required((350, 60), 1.25, (280.0, 48.0)));
        assert!(layout_change_required((350, 60), 1.25, (350.0, 160.0)));
    }
}
