use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::sync::Mutex as AsyncMutex;

use crate::error::{AppError, AppResult};
use crate::focus;
use crate::gemini;
use crate::gemini::GeminiClient;
use crate::history::{self, HistoryStore};
use crate::recorder::{self, RecorderHandle};
use crate::settings::SettingsStore;
use crate::types::{HistoryEntry, OverlayEvent, OverlayPhase, SessionId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStage {
    Idle,
    Starting,
    Recording,
    Paused,
    Encoding,
    Requesting,
    Inserting,
}

#[derive(Clone)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub fn side_effects_allowed(&self) -> bool {
        !self.is_cancelled()
    }
}

fn should_paste_clipboard(current_result_copied: bool, paste_automatically: bool) -> bool {
    current_result_copied && paste_automatically
}

fn should_persist_history(show_history: bool, succeeded: bool) -> bool {
    show_history && succeeded
}

fn can_process_stage(stage: SessionStage) -> bool {
    matches!(stage, SessionStage::Recording | SessionStage::Paused)
}

fn cancel_terminal_overlay_phase() -> Option<OverlayPhase> {
    None
}

fn elapsed_ms(session: &Session) -> u64 {
    let current = session
        .started
        .map(|started| started.elapsed())
        .unwrap_or_default();
    (session.elapsed_before_pause + current).as_millis() as u64
}

/// One voice-to-text turn. The insertion target and lifecycle state belong to
/// this exact session and cannot be overwritten by later overlay interaction.
pub struct Session {
    id: SessionId,
    stage: SessionStage,
    started: Option<Instant>,
    elapsed_before_pause: Duration,
    recorder: Option<RecorderHandle>,
    target: Option<focus::FocusTarget>,
    cancelled: CancellationToken,
}

#[derive(Clone)]
pub struct CachedTurn {
    pub wav: Vec<u8>,
    pub duration_ms: u64,
    pub target: Option<focus::FocusTarget>,
}

/// Full-lifecycle single-flight guard. `active` stays populated until the
/// matching turn reaches a terminal state.
pub struct SessionManager {
    pub active: AsyncMutex<Option<Session>>,
    pub last_turn: AsyncMutex<Option<CachedTurn>>,
    next_id: AtomicU64,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            active: AsyncMutex::new(None),
            last_turn: AsyncMutex::new(None),
            next_id: AtomicU64::new(0),
        }
    }

    pub async fn set_last_turn(&self, turn: CachedTurn) {
        let mut guard = self.last_turn.lock().await;
        *guard = Some(turn);
    }

    pub async fn get_last_turn(&self) -> Option<CachedTurn> {
        self.last_turn.lock().await.clone()
    }

    pub async fn clear_last_turn(&self) {
        let mut guard = self.last_turn.lock().await;
        *guard = None;
    }

    async fn begin_test_turn(&self) -> Option<SessionId> {
        let mut guard = self.active.lock().await;
        if guard.is_some() {
            return None;
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        *guard = Some(Session {
            id,
            stage: SessionStage::Idle,
            started: None,
            elapsed_before_pause: Duration::ZERO,
            recorder: None,
            target: None,
            cancelled: CancellationToken::new(),
        });
        Some(id)
    }

    pub async fn set_stage(&self, id: SessionId, stage: SessionStage) -> bool {
        let mut guard = self.active.lock().await;
        let Some(session) = guard.as_mut() else {
            return false;
        };
        if session.id != id {
            return false;
        }
        session.stage = stage;
        true
    }

    pub async fn active_stage(&self) -> Option<(SessionId, SessionStage)> {
        self.active.lock().await.as_ref().map(|s| (s.id, s.stage))
    }

    pub async fn active_id(&self) -> Option<SessionId> {
        self.active.lock().await.as_ref().map(|s| s.id)
    }

    pub async fn finish(&self, id: SessionId) -> bool {
        let mut guard = self.active.lock().await;
        if guard.as_ref().map(|s| s.id) != Some(id) {
            return false;
        }
        *guard = None;
        true
    }
}

fn emit_state(app: &AppHandle, session_id: SessionId, phase: OverlayPhase) {
    crate::overlay::apply_layout(app, &phase);
    let event = OverlayEvent {
        session_id,
        state: phase,
    };
    let _ = app.emit_to("overlay", "overlay://state", &event);
}

pub async fn active_stage(app: &AppHandle) -> Option<(SessionId, SessionStage)> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    mgr.active_stage().await
}

pub async fn create_turn(app: &AppHandle) -> AppResult<SessionId> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    mgr.clear_last_turn().await;
    let mut guard = mgr.active.lock().await;
    if guard.is_some() {
        return Err(AppError::SessionBusy);
    }
    let id = mgr.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let target = focus::capture_target();
    *guard = Some(Session {
        id,
        stage: SessionStage::Idle,
        started: None,
        elapsed_before_pause: Duration::ZERO,
        recorder: None,
        target,
        cancelled: CancellationToken::new(),
    });
    Ok(id)
}

/// Start recording for an already-created turn. The target was captured by
/// `create_turn` before the overlay became visible.
pub async fn begin_recording(app: AppHandle, session_id: SessionId) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    {
        let mut guard = mgr.active.lock().await;
        let Some(session) = guard.as_mut() else {
            return Err(AppError::Other("voice session is no longer active".into()));
        };
        if session.id != session_id {
            return Err(AppError::Other("stale voice session".into()));
        }
        if session.stage != SessionStage::Idle {
            return Err(AppError::SessionBusy);
        }
        session.stage = SessionStage::Starting;
    }

    let settings = app.state::<Arc<SettingsStore>>();
    let snapshot = settings.get();
    if let Err(error) = crate::shortcut::ensure_distinct_shortcuts(
        &snapshot.shortcut,
        &snapshot.process_shortcut,
        &snapshot.cancel_shortcut,
    ) {
        emit_state(
            &app,
            session_id,
            OverlayPhase::Error {
                error: error.frontend(),
            },
        );
        mgr.finish(session_id).await;
        return Err(error);
    }
    if let Err(error) = crate::shortcut::register_session_shortcuts(
        &app,
        &snapshot.process_shortcut,
        &snapshot.cancel_shortcut,
    ) {
        emit_state(
            &app,
            session_id,
            OverlayPhase::Error {
                error: error.frontend(),
            },
        );
        mgr.finish(session_id).await;
        return Err(error);
    }
    let rec = match recorder::start_recording(snapshot.device_name.as_deref()) {
        Ok(rec) => rec,
        Err(e) => {
            emit_state(
                &app,
                session_id,
                OverlayPhase::Error {
                    error: e.frontend(),
                },
            );
            crate::shortcut::unregister_session_shortcuts(
                &app,
                &snapshot.process_shortcut,
                &snapshot.cancel_shortcut,
            );
            mgr.finish(session_id).await;
            return Err(e);
        }
    };

    {
        let mut guard = mgr.active.lock().await;
        let Some(session) = guard.as_mut() else {
            let _ = rec.stop();
            crate::shortcut::unregister_session_shortcuts(
                &app,
                &snapshot.process_shortcut,
                &snapshot.cancel_shortcut,
            );
            return Ok(());
        };
        if session.id != session_id {
            let _ = rec.stop();
            crate::shortcut::unregister_session_shortcuts(
                &app,
                &snapshot.process_shortcut,
                &snapshot.cancel_shortcut,
            );
            return Ok(());
        }
        session.started = Some(Instant::now());
        session.elapsed_before_pause = Duration::ZERO;
        session.recorder = Some(rec);
        session.stage = SessionStage::Recording;
    }

    let gemini: Arc<GeminiClient> = app.state::<Arc<GeminiClient>>().inner().clone();
    gemini.prewarm();

    emit_state(
        &app,
        session_id,
        OverlayPhase::Recording {
            elapsed_ms: 0,
            level: 0,
        },
    );

    let app2 = app.clone();
    let mgr2 = mgr.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let g = mgr2.active.lock().await;
            let Some(session) = g.as_ref() else { break };
            if session.id != session_id {
                break;
            }
            match session.stage {
                SessionStage::Recording => {
                    let Some(rec) = session.recorder.as_ref() else {
                        break;
                    };
                    emit_state(
                        &app2,
                        session_id,
                        OverlayPhase::Recording {
                            elapsed_ms: elapsed_ms(session),
                            level: rec.level(),
                        },
                    );
                }
                SessionStage::Paused => {}
                _ => break,
            }
        }
    });
    Ok(())
}

pub async fn toggle_pause(app: AppHandle) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let (session_id, paused, elapsed) = {
        let mut guard = mgr.active.lock().await;
        let Some(session) = guard.as_mut() else {
            return Ok(());
        };
        match session.stage {
            SessionStage::Recording => {
                if let Some(started) = session.started.take() {
                    session.elapsed_before_pause += started.elapsed();
                }
                if let Some(recorder) = session.recorder.as_ref() {
                    recorder.pause();
                }
                session.stage = SessionStage::Paused;
                (session.id, true, elapsed_ms(session))
            }
            SessionStage::Paused => {
                if let Some(recorder) = session.recorder.as_ref() {
                    recorder.resume();
                }
                session.started = Some(Instant::now());
                session.stage = SessionStage::Recording;
                (session.id, false, elapsed_ms(session))
            }
            _ => return Ok(()),
        }
    };

    emit_state(
        &app,
        session_id,
        if paused {
            OverlayPhase::Paused {
                elapsed_ms: elapsed,
            }
        } else {
            OverlayPhase::Recording {
                elapsed_ms: elapsed,
                level: 0,
            }
        },
    );
    Ok(())
}

async fn execute_ai_turn(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    session_id: SessionId,
    wav: Vec<u8>,
    duration_ms: u64,
    target: Option<focus::FocusTarget>,
    cancellation: CancellationToken,
    snapshot: &crate::types::AppSettings,
) -> AppResult<()> {
    if cancellation.is_cancelled() {
        return Ok(());
    }

    mgr.set_stage(session_id, SessionStage::Requesting).await;
    emit_state(app, session_id, OverlayPhase::Processing);
    let gemini: Arc<GeminiClient> = app.state::<Arc<GeminiClient>>().inner().clone();
    let settings: Arc<SettingsStore> = app.state::<Arc<SettingsStore>>().inner().clone();
    let text = gemini
        .transcribe_and_respond(&settings, &wav, snapshot)
        .await
        .map_err(|e| {
            gemini::GeminiClient::friendly_api_error(&e)
                .map(AppError::Other)
                .unwrap_or(e)
        })?;

    if cancellation.is_cancelled() {
        return Ok(());
    }

    mgr.set_stage(session_id, SessionStage::Inserting).await;

    let mut copied = false;
    if snapshot.copy_to_clipboard || snapshot.paste_automatically {
        if !cancellation.side_effects_allowed() {
            return Ok(());
        }
        copied = app.clipboard().write_text(text.clone()).is_ok();
        if !copied {
            log::warn!("clipboard write failed");
        }
    }

    let mut pasted = false;
    let mut insertion_error: Option<AppError> = None;
    if snapshot.paste_automatically {
        if !cancellation.side_effects_allowed() {
            return Ok(());
        }
        let focus_result = match target.as_ref() {
            Some(target) => focus::restore_target(target),
            None => Err(AppError::Focus("captured target is unavailable".into())),
        };
        match focus_result {
            Ok(()) => {
                if !cancellation.side_effects_allowed() {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
                match focus::paste_via_clipboard() {
                    Ok(()) => pasted = true,
                    Err(e) => {
                        log::warn!("paste_via_clipboard failed: {e}; falling back to typing");
                        if focus::insert_text(&text, false).is_ok() {
                            pasted = true;
                        } else {
                            insertion_error = Some(AppError::Focus(e.to_string()));
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("focus restore failed: {e}");
                if focus::paste_via_clipboard().is_ok() {
                    pasted = true;
                } else {
                    insertion_error = Some(e);
                }
            }
        }
    }

    if cancellation.is_cancelled() {
        return Ok(());
    }

    if should_persist_history(snapshot.show_history, true) {
        if !cancellation.side_effects_allowed() {
            return Ok(());
        }
        let history_store = app.state::<Arc<HistoryStore>>();
        let entry = HistoryEntry {
            id: history::new_id(),
            created_at: history::now_iso(),
            duration_ms,
            transcript_hint: history::transcript_hint(&text),
            response_text: text.clone(),
            model: snapshot.model.clone(),
            status: "success".into(),
            error_message: None,
        };
        let _ = history_store.push(&entry);
        let _ = app.emit_to("settings", "history://changed", ());
    }

    if let Some(error) = insertion_error {
        return Err(error);
    }

    if !cancellation.side_effects_allowed() {
        return Ok(());
    }

    mgr.clear_last_turn().await;

    emit_state(
        app,
        session_id,
        OverlayPhase::Success {
            text,
            pasted,
            copied: snapshot.copy_to_clipboard || copied,
        },
    );
    Ok(())
}

/// Explicitly finish capture and run the AI pipeline. The record shortcut no
/// longer triggers this; processing is a separate action (Enter by default).
pub async fn process_recording(app: AppHandle) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let (session_id, rec, target, cancellation) = {
        let mut guard = mgr.active.lock().await;
        let Some(session) = guard.as_mut() else {
            return Ok(());
        };
        if !can_process_stage(session.stage) {
            return Ok(());
        }
        if let Some(started) = session.started.take() {
            session.elapsed_before_pause += started.elapsed();
        }
        session.stage = SessionStage::Encoding;
        let Some(rec) = session.recorder.take() else {
            return Ok(());
        };
        (session.id, rec, session.target, session.cancelled.clone())
    };

    let settings: Arc<SettingsStore> = app.state::<Arc<SettingsStore>>().inner().clone();
    let snapshot = settings.get();

    emit_state(&app, session_id, OverlayPhase::Uploading);
    let recording = rec.stop();

    if recording.samples.is_empty() {
        let error = AppError::Recording(
            "No audio captured — check that the selected microphone is working".into(),
        );
        emit_state(
            &app,
            session_id,
            OverlayPhase::Error {
                error: error.frontend(),
            },
        );
        crate::shortcut::unregister_session_shortcuts(
            &app,
            &snapshot.process_shortcut,
            &snapshot.cancel_shortcut,
        );
        mgr.finish(session_id).await;
        return Err(error);
    }

    let wav = recorder::samples_to_wav(
        &recording.samples,
        recording.sample_rate,
        recording.channels,
    );

    if cancellation.is_cancelled() {
        crate::shortcut::unregister_session_shortcuts(
            &app,
            &snapshot.process_shortcut,
            &snapshot.cancel_shortcut,
        );
        mgr.finish(session_id).await;
        return Ok(());
    }

    // Cache the turn audio and focus target so retry can re-use it if an error occurs
    mgr.set_last_turn(CachedTurn {
        wav: wav.clone(),
        duration_ms: recording.duration_ms,
        target,
    })
    .await;

    let result = execute_ai_turn(
        &app,
        &mgr,
        session_id,
        wav,
        recording.duration_ms,
        target,
        cancellation.clone(),
        &snapshot,
    )
    .await;

    if let Err(error) = &result {
        if cancellation.side_effects_allowed() {
            emit_state(
                &app,
                session_id,
                OverlayPhase::Error {
                    error: error.frontend(),
                },
            );
        }
    }
    crate::shortcut::unregister_session_shortcuts(
        &app,
        &snapshot.process_shortcut,
        &snapshot.cancel_shortcut,
    );
    let latest_shortcuts = settings.get();
    if latest_shortcuts.process_shortcut != snapshot.process_shortcut
        || latest_shortcuts.cancel_shortcut != snapshot.cancel_shortcut
    {
        crate::shortcut::unregister_session_shortcuts(
            &app,
            &latest_shortcuts.process_shortcut,
            &latest_shortcuts.cancel_shortcut,
        );
    }
    mgr.finish(session_id).await;
    result
}

/// Abort the active turn. Cancellation is marked while the session is still
/// owned by the manager, before recorder cleanup or any UI-dismiss request can
/// occur. A cancelled turn intentionally emits no visible terminal phase.
pub async fn cancel_recording(app: AppHandle) -> Option<SessionId> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    mgr.clear_last_turn().await;
    let session = {
        let mut guard = mgr.active.lock().await;
        if let Some(session) = guard.as_mut() {
            session.cancelled.cancel();
        }
        guard.take()
    };
    let cancelled_id = session.as_ref().map(|session| session.id);
    if let Some(mut session) = session {
        if let Some(rec) = session.recorder.take() {
            let _ = rec.stop();
        }
        if let Some(phase) = cancel_terminal_overlay_phase() {
            emit_state(&app, session.id, phase);
        }
    }
    let snapshot = app.state::<Arc<SettingsStore>>().get();
    crate::shortcut::unregister_session_shortcuts(
        &app,
        &snapshot.process_shortcut,
        &snapshot.cancel_shortcut,
    );
    cancelled_id
}

pub async fn acknowledge_busy(app: &AppHandle) {
    if let Some((session_id, _)) = active_stage(app).await {
        emit_state(
            app,
            session_id,
            OverlayPhase::Info {
                message: "Voice session is still processing".into(),
            },
        );
    }
}

/// Retry starts a fresh session after the prior terminal/recovery state.
/// If a turn previously captured audio that encountered an error, retry
/// will reprocess that exact audio instead of forcing the user to speak again.
pub async fn retry(app: AppHandle) {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    if let Some(cached) = mgr.get_last_turn().await {
        let session_id = mgr.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let cancellation = CancellationToken::new();
        {
            let mut guard = mgr.active.lock().await;
            *guard = Some(Session {
                id: session_id,
                stage: SessionStage::Requesting,
                started: None,
                elapsed_before_pause: Duration::ZERO,
                recorder: None,
                target: cached.target,
                cancelled: cancellation.clone(),
            });
        }

        let settings: Arc<SettingsStore> = app.state::<Arc<SettingsStore>>().inner().clone();
        let snapshot = settings.get();

        let _ = crate::shortcut::register_session_shortcuts(
            &app,
            &snapshot.process_shortcut,
            &snapshot.cancel_shortcut,
        );

        let app_clone = app.clone();
        let mgr_clone = mgr.clone();
        tauri::async_runtime::spawn(async move {
            let result = execute_ai_turn(
                &app_clone,
                &mgr_clone,
                session_id,
                cached.wav,
                cached.duration_ms,
                cached.target,
                cancellation.clone(),
                &snapshot,
            )
            .await;

            if let Err(error) = &result {
                if cancellation.side_effects_allowed() {
                    emit_state(
                        &app_clone,
                        session_id,
                        OverlayPhase::Error {
                            error: error.frontend(),
                        },
                    );
                }
            }
            crate::shortcut::unregister_session_shortcuts(
                &app_clone,
                &snapshot.process_shortcut,
                &snapshot.cancel_shortcut,
            );
            mgr_clone.finish(session_id).await;
        });
        return;
    }

    cancel_recording(app.clone()).await;
    if let Ok(session_id) = create_turn(&app).await {
        let _ = begin_recording(app, session_id).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn requesting_turn_blocks_a_second_turn() {
        let mgr = SessionManager::new();
        let first = mgr.begin_test_turn().await.expect("first turn");
        assert!(mgr.set_stage(first, SessionStage::Requesting).await);
        assert!(mgr.begin_test_turn().await.is_none());
        assert_eq!(
            mgr.active_stage().await,
            Some((first, SessionStage::Requesting))
        );
    }

    #[tokio::test]
    async fn finishing_only_clears_the_matching_turn() {
        let mgr = SessionManager::new();
        let first = mgr.begin_test_turn().await.expect("first turn");
        assert!(!mgr.finish(first + 1).await);
        assert_eq!(mgr.active_id().await, Some(first));
        assert!(mgr.finish(first).await);
        assert_eq!(mgr.active_id().await, None);
    }

    #[test]
    fn cancelled_token_blocks_side_effects() {
        let token = CancellationToken::new();
        assert!(token.side_effects_allowed());
        token.cancel();
        assert!(!token.side_effects_allowed());
    }

    #[test]
    fn cancellation_has_no_visible_terminal_overlay_phase() {
        assert!(cancel_terminal_overlay_phase().is_none());
    }

    #[test]
    fn clipboard_fallback_requires_current_result_copy() {
        assert!(!should_paste_clipboard(false, true));
        assert!(!should_paste_clipboard(false, false));
        assert!(should_paste_clipboard(true, true));
    }

    #[test]
    fn history_disabled_never_persists() {
        assert!(!should_persist_history(false, true));
        assert!(should_persist_history(true, true));
    }

    #[test]
    fn processing_is_explicit_and_allowed_from_recording_or_paused_only() {
        assert!(can_process_stage(SessionStage::Recording));
        assert!(can_process_stage(SessionStage::Paused));
        assert!(!can_process_stage(SessionStage::Idle));
        assert!(!can_process_stage(SessionStage::Requesting));
    }

    #[tokio::test]
    async fn cached_turn_is_stored_and_cleared() {
        let mgr = SessionManager::new();
        assert!(mgr.get_last_turn().await.is_none());
        mgr.set_last_turn(CachedTurn {
            wav: vec![1, 2, 3],
            duration_ms: 500,
            target: None,
        })
        .await;
        let cached = mgr.get_last_turn().await.expect("cached turn");
        assert_eq!(cached.wav, vec![1, 2, 3]);
        assert_eq!(cached.duration_ms, 500);
        mgr.clear_last_turn().await;
        assert!(mgr.get_last_turn().await.is_none());
    }
}
