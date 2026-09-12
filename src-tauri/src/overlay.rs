use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::session::SessionStage;
use crate::types::{OverlayDismissEvent, OverlayPhase, SessionId};

#[derive(Debug, Default)]
struct HoldPressState {
    next_generation: u64,
    active_generation: Option<u64>,
    released_generation: Option<u64>,
}

fn hold_press_state() -> &'static Mutex<HoldPressState> {
    static STATE: OnceLock<Mutex<HoldPressState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(HoldPressState::default()))
}

fn begin_hold_press() -> u64 {
    let mut state = hold_press_state().lock().expect("hold state lock");
    state.next_generation = state.next_generation.wrapping_add(1).max(1);
    state.active_generation = Some(state.next_generation);
    state.released_generation = None;
    state.next_generation
}

fn release_hold_press() {
    let mut state = hold_press_state().lock().expect("hold state lock");
    state.released_generation = state.active_generation;
}

fn hold_press_is_active(generation: u64) -> bool {
    let state = hold_press_state().lock().expect("hold state lock");
    state.active_generation == Some(generation) && state.released_generation != Some(generation)
}

fn end_hold_press(generation: u64) {
    let mut state = hold_press_state().lock().expect("hold state lock");
    if state.active_generation == Some(generation) {
        state.active_generation = None;
        state.released_generation = None;
    }
}

fn hold_start_can_show(
    generation_active: bool,
    active_session: Option<(SessionId, SessionStage)>,
    session_id: SessionId,
) -> bool {
    generation_active && active_session == Some((session_id, SessionStage::Recording))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MonitorSource {
    Target,
    Cursor,
    Primary,
}

fn select_monitor_source(target: bool, cursor: bool, primary: bool) -> Option<MonitorSource> {
    if target {
        Some(MonitorSource::Target)
    } else if cursor {
        Some(MonitorSource::Cursor)
    } else if primary {
        Some(MonitorSource::Primary)
    } else {
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NormalShortcutStartStep {
    BeginRecording,
    PositionAndShowTarget,
}

fn normal_shortcut_start_steps() -> [NormalShortcutStartStep; 2] {
    [
        NormalShortcutStartStep::BeginRecording,
        NormalShortcutStartStep::PositionAndShowTarget,
    ]
}

pub fn toggle(app: AppHandle) {
    if let Some(gemini) = app.try_state::<std::sync::Arc<crate::gemini::GeminiClient>>() {
        gemini.prewarm();
    }
    tauri::async_runtime::spawn(async move {
        match crate::session::active_stage(&app).await {
            Some((_id, SessionStage::Recording | SessionStage::Paused)) => {
                if let Err(e) = crate::session::process_recording(app.clone()).await {
                    log::warn!("record shortcut finish failed: {e}");
                }
            }
            Some((id, SessionStage::Idle)) => {
                let target_point = crate::session::target_monitor_point(&app, id).await;
                match crate::session::begin_recording(app.clone(), id).await {
                    Ok(()) => show_on_target_without_activation(&app, target_point),
                    Err(error) => log::warn!("start voice recording failed: {error}"),
                }
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
                let target_point = crate::session::target_monitor_point(&app, session_id).await;
                for step in normal_shortcut_start_steps() {
                    match step {
                        NormalShortcutStartStep::BeginRecording => {
                            start_result =
                                crate::session::begin_recording(app.clone(), session_id).await;
                        }
                        NormalShortcutStartStep::PositionAndShowTarget => {
                            show_on_target_without_activation(&app, target_point)
                        }
                    }
                }
                if let Err(e) = start_result {
                    log::warn!("start voice recording failed: {e}");
                }
            }
        }
    });
}

pub fn start(app: AppHandle) {
    if let Some(gemini) = app.try_state::<std::sync::Arc<crate::gemini::GeminiClient>>() {
        gemini.prewarm();
    }
    let generation = begin_hold_press();
    tauri::async_runtime::spawn(async move {
        if !hold_press_is_active(generation) {
            return;
        }
        if crate::session::active_stage(&app).await.is_some() {
            end_hold_press(generation);
            return;
        }
        let Ok(session_id) = crate::session::create_turn(&app).await else {
            end_hold_press(generation);
            return;
        };
        if !hold_press_is_active(generation) {
            crate::session::cancel_recording(app.clone()).await;
            end_hold_press(generation);
            return;
        }
        let target_point = crate::session::target_monitor_point(&app, session_id).await;
        if !hold_press_is_active(generation) {
            crate::session::cancel_recording(app.clone()).await;
            end_hold_press(generation);
            return;
        }
        if let Err(error) = crate::session::begin_recording(app.clone(), session_id).await {
            log::warn!("hold shortcut start failed: {error}");
            end_hold_press(generation);
            return;
        }
        if !hold_start_can_show(
            hold_press_is_active(generation),
            crate::session::active_stage(&app).await,
            session_id,
        ) {
            end_hold_press(generation);
            return;
        }
        show_on_target_without_activation(&app, target_point);
        end_hold_press(generation);
    });
}

pub fn finish_hold(app: AppHandle) {
    release_hold_press();
    tauri::async_runtime::spawn(async move {
        match crate::session::finish_hold(app.clone()).await {
            Ok(Some(session_id)) => request_ui_exit(&app, session_id),
            Ok(None) => {}
            Err(error) => {
                log::warn!("hold shortcut finish failed: {error}");
                request_cancel(app).await;
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
                    request_ui_exit(&app, session_id);
                } else {
                    let _ = hide(&app);
                }
            }
        }
    }
}

fn request_ui_exit(app: &AppHandle, session_id: SessionId) {
    let event = OverlayDismissEvent { session_id };
    if let Err(error) = app.emit_to("overlay", "overlay://dismiss", &event) {
        log::warn!("overlay dismiss request failed: {error}");
        let _ = hide(app);
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
        | OverlayPhase::Processing { .. }
        | OverlayPhase::Opening { .. }
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
    // Skip the native SetWindowPos call when the window is already in place;
    // this runs on every 10 Hz recording tick and unnecessary native calls
    // cause visible churn on Windows.
    if let Ok(current) = window.outer_position() {
        if current.x == x && current.y == y {
            return;
        }
    }
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn position_bottom_center(app: &AppHandle, target_point: Option<(f64, f64)>) -> Option<()> {
    let window = app.get_webview_window("overlay")?;
    let target = target_point.and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten());
    let cursor = app
        .cursor_position()
        .ok()
        .and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten());
    let primary = app.primary_monitor().ok().flatten();
    let monitor = select_monitor(target, cursor, primary)?;
    position_on_monitor(&window, &monitor);
    Some(())
}

fn select_monitor<T>(target: Option<T>, cursor: Option<T>, primary: Option<T>) -> Option<T> {
    match select_monitor_source(target.is_some(), cursor.is_some(), primary.is_some())? {
        MonitorSource::Target => target,
        MonitorSource::Cursor => cursor,
        MonitorSource::Primary => primary,
    }
}

pub fn apply_layout_with_target(
    app: &AppHandle,
    phase: &OverlayPhase,
    target_point: Option<(f64, f64)>,
) {
    apply_layout_internal(app, phase, target_point, true);
}

fn apply_layout_internal(
    app: &AppHandle,
    phase: &OverlayPhase,
    target_point: Option<(f64, f64)>,
    prefer_target_monitor: bool,
) {
    let Some((width, height)) = visible_layout_for(phase) else {
        return;
    };
    let Some(window) = app.get_webview_window("overlay") else {
        return;
    };
    let accepts_input = matches!(
        phase,
        OverlayPhase::Success { pasted: false, .. } | OverlayPhase::Error { .. }
    );
    // set_focusable is a native call; cache the last applied value so the
    // 10 Hz recording ticks don't repeat it.
    static LAST_FOCUSABLE: Mutex<Option<bool>> = Mutex::new(None);
    if let Ok(last) = LAST_FOCUSABLE.lock() {
        if *last != Some(accepts_input) {
            drop(last);
            let _ = window.set_focusable(accepts_input);
            if let Ok(mut last) = LAST_FOCUSABLE.lock() {
                *last = Some(accepts_input);
            }
        }
    }
    let size_needs_update = match (window.outer_size(), window.scale_factor()) {
        (Ok(current), Ok(scale_factor)) => layout_change_required(
            (current.width, current.height),
            scale_factor,
            (width, height),
        ),
        _ => true,
    };
    if size_needs_update {
        if let Err(error) = window.set_size(LogicalSize::new(width, height)) {
            log::warn!("overlay resize failed: {error}");
            return;
        }
    }
    if prefer_target_monitor {
        if target_point.is_some() {
            let _ = position_bottom_center(app, target_point);
        } else if let Ok(Some(monitor)) = window.current_monitor() {
            position_on_monitor(&window, &monitor);
        } else {
            let _ = position_bottom_center(app, None);
        }
    } else if let Ok(Some(monitor)) = window.current_monitor() {
        position_on_monitor(&window, &monitor);
    } else {
        let _ = position_bottom_center(app, None);
    }
    if accepts_input {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_on_target_without_activation(app: &AppHandle, target_point: Option<(f64, f64)>) {
    if app.get_webview_window("overlay").is_none() {
        return;
    }
    let _ = position_bottom_center(app, target_point);
    show_without_activation_native(app);
}

fn show_without_activation_native(app: &AppHandle) {
    let Some(w) = app.get_webview_window("overlay") else {
        return;
    };
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
            SetWindowPos, ShowWindow, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SW_HIDE,
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
    use crate::types::{ErrorCode, FrontendError, OutputOutcome};

    #[test]
    fn monitor_fallback_prefers_target_then_cursor_then_primary() {
        assert_eq!(
            select_monitor_source(true, true, true),
            Some(MonitorSource::Target)
        );
        assert_eq!(
            select_monitor_source(false, true, true),
            Some(MonitorSource::Cursor)
        );
        assert_eq!(
            select_monitor_source(false, false, true),
            Some(MonitorSource::Primary)
        );
        assert_eq!(select_monitor_source(false, false, false), None);
    }

    #[test]
    fn monitor_selection_returns_the_highest_priority_available_monitor() {
        assert_eq!(
            select_monitor(Some("target"), Some("cursor"), Some("primary")),
            Some("target")
        );
        assert_eq!(
            select_monitor(None, Some("cursor"), Some("primary")),
            Some("cursor")
        );
        assert_eq!(select_monitor(None, None, Some("primary")), Some("primary"));
        assert_eq!(select_monitor::<&str>(None, None, None), None);
    }

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
                NormalShortcutStartStep::PositionAndShowTarget,
            ]
        );
    }

    #[test]
    fn releasing_hold_before_start_invalidates_the_pending_start() {
        let generation = begin_hold_press();
        assert!(hold_press_is_active(generation));
        release_hold_press();
        assert!(!hold_press_is_active(generation));
        end_hold_press(generation);
    }

    #[test]
    fn hold_start_requires_the_same_live_recording_session_before_showing() {
        let session_id = 7;
        assert!(hold_start_can_show(
            true,
            Some((session_id, SessionStage::Recording)),
            session_id
        ));
        assert!(!hold_start_can_show(
            false,
            Some((session_id, SessionStage::Recording)),
            session_id
        ));
        assert!(!hold_start_can_show(
            true,
            Some((session_id, SessionStage::Starting)),
            session_id
        ));
        assert!(!hold_start_can_show(true, None, session_id));
    }

    #[test]
    fn fast_path_phases_share_one_native_footprint() {
        let recording = layout_for(&OverlayPhase::Recording {
            elapsed_ms: 0,
            level: 0,
            health: crate::types::RecordingHealth::Healthy,
            warning: None,
        });
        assert_eq!(recording, (280.0, 48.0));
        assert_eq!(
            layout_for(&OverlayPhase::Paused { elapsed_ms: 0 }),
            recording
        );
        assert_eq!(layout_for(&OverlayPhase::Uploading), recording);
        assert_eq!(
            layout_for(&OverlayPhase::Processing {
                status: crate::types::ProcessingStatus::Requesting,
                model: None,
                attempt: 1,
                total_attempts: 1,
            }),
            recording
        );
        assert_eq!(
            layout_for(&OverlayPhase::Success {
                text: "x".into(),
                pasted: true,
                copied: true,
                output: OutputOutcome::Inserted,
                profile: None,
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
                output: OutputOutcome::Copied,
                profile: None,
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
