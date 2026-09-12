//! Focus preservation + text insertion into the previously-active app.
//!
//! Strategy per platform:
//! - Windows: we query the foreground window before the overlay shows, keep
//!   the HWND, and re-activate it via `SetForegroundWindow` before injecting.
//!   Text insertion is done with enigo (unicode-safe) or — for stubborn
//!   targets — an optional Ctrl+V fallback, since we already own the
//!   clipboard.
//! - macOS: `app.activate` via accessibility APIs; requires the app be
//!   granted no special TCC permission for keystroke injection, but the
//!   overlay must not become key or the target loses its text field state.

use crate::error::{AppError, AppResult};
use tauri::AppHandle;

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use tauri::Manager;
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYEVENTF_KEYUP, VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
        SetForegroundWindow,
    };

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct FocusTarget {
        hwnd: isize,
    }

    pub fn monitor_point(target: &FocusTarget) -> Option<(f64, f64)> {
        use windows_sys::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL,
        };
        let target_hwnd = target.hwnd as windows_sys::Win32::Foundation::HWND;
        unsafe {
            let monitor = MonitorFromWindow(target_hwnd, MONITOR_DEFAULTTONULL);
            if monitor.is_null() {
                return None;
            }
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return None;
            }
            Some((
                ((info.rcMonitor.left + info.rcMonitor.right) / 2) as f64,
                ((info.rcMonitor.top + info.rcMonitor.bottom) / 2) as f64,
            ))
        }
    }

    pub fn capture_target() -> Option<FocusTarget> {
        let hwnd = unsafe { GetForegroundWindow() };
        (hwnd as usize != 0).then_some(FocusTarget {
            hwnd: hwnd as isize,
        })
    }

    pub fn capture_target_excluding(app: &AppHandle) -> Option<FocusTarget> {
        let target = capture_target()?;
        let target_hwnd = target.hwnd as usize;
        for label in ["overlay", "settings", "history"] {
            let is_own_window = app
                .get_webview_window(label)
                .and_then(|window| window.hwnd().ok())
                .map(|hwnd| hwnd.0 as usize)
                == Some(target_hwnd);
            if is_own_window {
                return None;
            }
        }
        Some(target)
    }

    pub fn restore_target(target: &FocusTarget) -> AppResult<()> {
        let target_hwnd = target.hwnd as windows_sys::Win32::Foundation::HWND;
        if target_hwnd.is_null() || unsafe { IsWindow(target_hwnd) } == 0 {
            return Err(AppError::Focus(
                "captured target window is no longer available".into(),
            ));
        }
        let current_thread = unsafe { GetCurrentThreadId() };
        let target_thread = unsafe { GetWindowThreadProcessId(target_hwnd, std::ptr::null_mut()) };

        unsafe {
            let fg = GetForegroundWindow();
            if fg != target_hwnd {
                let fg_thread = if fg as usize != 0 {
                    GetWindowThreadProcessId(fg, std::ptr::null_mut())
                } else {
                    0
                };

                if fg_thread != 0 && fg_thread != current_thread {
                    AttachThreadInput(current_thread, fg_thread, 1);
                }
                if target_thread != 0 && target_thread != current_thread {
                    AttachThreadInput(current_thread, target_thread, 1);
                }

                // Simulate Alt key event to acquire foreground lock rights
                keybd_event(VK_MENU as u8, 0, 0, 0);
                keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);

                SetForegroundWindow(target_hwnd);
                BringWindowToTop(target_hwnd);

                if fg_thread != 0 && fg_thread != current_thread {
                    AttachThreadInput(current_thread, fg_thread, 0);
                }
                if target_thread != 0 && target_thread != current_thread {
                    AttachThreadInput(current_thread, target_thread, 0);
                }

                // The overlay never activates on Windows, so the common path is
                // the target already being foreground: skip the settle sleep
                // entirely. Only wait after an actual SetForegroundWindow call,
                // where apps need a moment to accept focus.
                std::thread::sleep(std::time::Duration::from_millis(80));
                if GetForegroundWindow() != target_hwnd {
                    return Err(AppError::Focus(
                        "captured target could not be restored to the foreground".into(),
                    ));
                }
            } else {
                BringWindowToTop(target_hwnd);
            }
        }
        Ok(())
    }

    pub fn ensure_target_foreground(target: &FocusTarget) -> AppResult<()> {
        let target_hwnd = target.hwnd as windows_sys::Win32::Foundation::HWND;
        if target_hwnd.is_null()
            || unsafe { IsWindow(target_hwnd) } == 0
            || unsafe { GetForegroundWindow() } != target_hwnd
        {
            return Err(AppError::Focus(
                "captured target is no longer the foreground window".into(),
            ));
        }
        Ok(())
    }

    pub fn insert_text(text: &str, use_paste_fallback: bool) -> AppResult<()> {
        if use_paste_fallback {
            return paste_via_clipboard();
        }
        type_text(text)
    }

    fn type_text(text: &str) -> AppResult<()> {
        use enigo::Keyboard;
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| AppError::Focus(format!("enigo init: {e}")))?;
        // The session pipeline already sleeps 50ms after focus restore before
        // calling insert_text; no extra settle delay is needed here.
        enigo
            .text(text)
            .map_err(|e| AppError::Focus(format!("typing failed: {e}")))?;
        Ok(())
    }

    pub fn paste_via_clipboard() -> AppResult<()> {
        const VK_V: u8 = 0x56;
        std::thread::sleep(std::time::Duration::from_millis(60));
        unsafe {
            // Release modifier keys if any were held down
            keybd_event(VK_SHIFT as u8, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL as u8, 0, KEYEVENTF_KEYUP, 0);

            // Send Ctrl+V
            keybd_event(VK_CONTROL as u8, 0, 0, 0);
            keybd_event(VK_V, 0, 0, 0);
            keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL as u8, 0, KEYEVENTF_KEYUP, 0);
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    extern "C" {
        fn GetFrontProcessASN() -> i64; // existing best-effort platform identifier
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct FocusTarget {
        pid: i64,
    }

    pub fn capture_target() -> Option<FocusTarget> {
        let pid = unsafe { GetFrontProcessASN() };
        Some(FocusTarget { pid })
    }

    pub fn capture_target_excluding(_app: &AppHandle) -> Option<FocusTarget> {
        capture_target()
    }

    pub fn monitor_point(_target: &FocusTarget) -> Option<(f64, f64)> {
        None
    }

    pub fn restore_target(_target: &FocusTarget) -> AppResult<()> {
        // The normal overlay path is non-activating on macOS, so the captured
        // app should still own focus. The value is still session-scoped so a
        // future activation path can restore exactly this target.
        Ok(())
    }

    pub fn ensure_target_foreground(_target: &FocusTarget) -> AppResult<()> {
        Ok(())
    }

    pub fn insert_text(text: &str, _use_paste_fallback: bool) -> AppResult<()> {
        use enigo::Keyboard;
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| AppError::Focus(format!("enigo init: {e}")))?;
        std::thread::sleep(std::time::Duration::from_millis(60));
        enigo
            .text(text)
            .map_err(|e| AppError::Focus(format!("typing failed: {e}")))?;
        Ok(())
    }

    pub fn paste_via_clipboard() -> AppResult<()> {
        use enigo::Keyboard;
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| AppError::Focus(format!("enigo init: {e}")))?;
        enigo
            .key(enigo::Key::Meta, enigo::Direction::Press)
            .map_err(|e| AppError::Focus(format!("press meta: {e}")))?;
        enigo
            .key(enigo::Key::Unicode('v'), enigo::Direction::Click)
            .map_err(|e| AppError::Focus(format!("click v: {e}")))?;
        enigo
            .key(enigo::Key::Meta, enigo::Direction::Release)
            .map_err(|e| AppError::Focus(format!("release meta: {e}")))?;
        Ok(())
    }
}

pub use imp::capture_target_excluding;
pub use imp::ensure_target_foreground;
pub use imp::insert_text;
pub use imp::monitor_point;
pub use imp::paste_via_clipboard;
pub use imp::restore_target;
pub use imp::FocusTarget;

use std::sync::Mutex;
static LAST_HISTORY_TARGET: Mutex<Option<FocusTarget>> = Mutex::new(None);

pub fn store_history_target(app: &AppHandle) {
    *LAST_HISTORY_TARGET.lock().unwrap() = capture_target_excluding(app);
}

pub fn restore_history_target() -> AppResult<()> {
    let target = LAST_HISTORY_TARGET
        .lock()
        .unwrap()
        .as_ref()
        .copied()
        .ok_or_else(|| AppError::Focus("no valid History insertion target is available".into()))?;
    restore_target(&target)
}
