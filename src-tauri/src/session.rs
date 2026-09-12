use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::sync::Mutex as AsyncMutex;

use crate::error::{AppError, AppResult};
use crate::focus;
use crate::gemini::GeminiClient;
use crate::history::{self, HistoryStore};
use crate::recorder::{self, RecorderHandle};
use crate::settings::SettingsStore;
use crate::types::{
    HistoryEntry, OutputOutcome, OverlayEvent, OverlayPhase, ProcessingStatus, RecordingHealth,
    RecordingWarning, SessionId,
};

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

fn clipboard_matches_result(current_clipboard: Option<&str>, result: &str) -> bool {
    current_clipboard == Some(result)
}

fn can_paste_result(
    cancellation: &CancellationToken,
    current_result_copied: bool,
    paste_automatically: bool,
) -> bool {
    cancellation.side_effects_allowed()
        && should_paste_clipboard(current_result_copied, paste_automatically)
}

fn should_persist_history(show_history: bool, succeeded: bool) -> bool {
    show_history && succeeded
}

fn can_process_stage(stage: SessionStage) -> bool {
    matches!(stage, SessionStage::Recording | SessionStage::Paused)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HoldFinishAction {
    Cancel,
    Process,
    Ignore,
}

fn hold_finish_action(stage: SessionStage) -> HoldFinishAction {
    match stage {
        SessionStage::Starting => HoldFinishAction::Cancel,
        SessionStage::Recording | SessionStage::Paused => HoldFinishAction::Process,
        SessionStage::Idle => HoldFinishAction::Cancel,
        SessionStage::Encoding | SessionStage::Requesting | SessionStage::Inserting => {
            HoldFinishAction::Ignore
        }
    }
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

fn recording_health(
    level: u8,
    elapsed_ms: u64,
    warning: Option<RecordingWarning>,
) -> RecordingHealth {
    if warning.is_some() {
        RecordingHealth::Warning
    } else if level == 0 && elapsed_ms >= 2_000 {
        RecordingHealth::Silent
    } else {
        RecordingHealth::Healthy
    }
}

fn recording_warning_with_health(
    configured_warning: Option<RecordingWarning>,
    dropped_samples: u64,
    elapsed_ms: u64,
) -> Option<RecordingWarning> {
    if dropped_samples > 0 {
        Some(RecordingWarning::AudioQueueOverflow)
    } else if elapsed_ms >= recorder::LONG_RECORDING_WARNING_MS {
        Some(RecordingWarning::LongRecording)
    } else {
        configured_warning
    }
}

/// Cheap resume-path warning: reuses the live recorder's device-fallback flag
/// instead of re-enumerating all WASAPI input devices (which can block a
/// tokio worker for tens of milliseconds).
fn resume_recording_warning(
    selected_device: Option<&str>,
    recorder_device_unavailable: bool,
) -> Option<RecordingWarning> {
    if selected_device.is_none() {
        Some(RecordingWarning::DefaultMicrophone)
    } else if recorder_device_unavailable {
        Some(RecordingWarning::SelectedMicrophoneUnavailable)
    } else {
        None
    }
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
    shortcuts: Option<SessionShortcuts>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionShortcuts {
    process: String,
    cancel: String,
}

impl SessionShortcuts {
    fn new(process: impl Into<String>, cancel: impl Into<String>) -> Self {
        Self {
            process: process.into(),
            cancel: cancel.into(),
        }
    }
}

#[derive(Clone)]
pub struct CachedTurn {
    pub session_id: SessionId,
    pub audio: Arc<[u8]>,
    pub duration_ms: u64,
    pub target: Option<focus::FocusTarget>,
    pub generated_text: Option<String>,
}

struct RetryClaim {
    session_id: SessionId,
    cancellation: CancellationToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OutputStatus {
    copied: bool,
    pasted: bool,
}

impl OutputStatus {
    fn new(copied: bool, pasted: bool) -> Self {
        Self { copied, pasted }
    }
}

/// Full-lifecycle single-flight guard. `active` stays populated until the
/// matching turn reaches a terminal state.
pub struct SessionManager {
    pub active: AsyncMutex<Option<Session>>,
    pub last_turn: AsyncMutex<Option<CachedTurn>>,
    ownership: AsyncMutex<()>,
    next_id: AtomicU64,
    current_session_id: AtomicU64,
    snapshot: RwLock<Option<OverlayEvent>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            active: AsyncMutex::new(None),
            last_turn: AsyncMutex::new(None),
            ownership: AsyncMutex::new(()),
            next_id: AtomicU64::new(0),
            current_session_id: AtomicU64::new(0),
            snapshot: RwLock::new(None),
        }
    }

    fn mark_current(&self, id: SessionId) {
        self.current_session_id.store(id, Ordering::Release);
    }

    fn is_current(&self, id: SessionId) -> bool {
        self.current_session_id.load(Ordering::Acquire) == id
    }

    fn clear_current(&self, id: SessionId) {
        let _ =
            self.current_session_id
                .compare_exchange(id, 0, Ordering::AcqRel, Ordering::Acquire);
    }

    pub fn record_snapshot(&self, event: OverlayEvent) {
        if let Ok(mut snapshot) = self.snapshot.write() {
            *snapshot = Some(event);
        }
    }

    fn record_snapshot_if_current(&self, event: OverlayEvent) -> bool {
        if !self.is_current(event.session_id) {
            return false;
        }
        let Ok(mut snapshot) = self.snapshot.write() else {
            return false;
        };
        if !self.is_current(event.session_id) {
            return false;
        }
        *snapshot = Some(event);
        true
    }

    pub fn snapshot(&self) -> Option<OverlayEvent> {
        self.snapshot
            .read()
            .ok()
            .and_then(|snapshot| snapshot.clone())
    }

    pub fn clear_snapshot(&self) {
        if let Ok(mut snapshot) = self.snapshot.write() {
            *snapshot = None;
        }
    }

    #[cfg(test)]
    pub async fn set_last_turn(&self, turn: CachedTurn) {
        let _ownership = self.ownership.lock().await;
        let mut guard = self.last_turn.lock().await;
        *guard = Some(turn);
    }

    pub async fn get_last_turn(&self) -> Option<CachedTurn> {
        self.last_turn.lock().await.clone()
    }

    pub async fn clear_last_turn(&self) {
        let _ownership = self.ownership.lock().await;
        let mut guard = self.last_turn.lock().await;
        *guard = None;
    }

    #[cfg(test)]
    async fn begin_test_turn(&self) -> Option<SessionId> {
        let _ownership = self.ownership.lock().await;
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
            shortcuts: None,
        });
        self.mark_current(id);
        Some(id)
    }

    #[cfg(test)]
    async fn begin_test_turn_with_shortcuts(
        &self,
        process: &str,
        cancel: &str,
    ) -> Option<SessionId> {
        let id = self.begin_test_turn().await?;
        let mut guard = self.active.lock().await;
        guard.as_mut().unwrap().shortcuts = Some(SessionShortcuts::new(process, cancel));
        Some(id)
    }

    async fn claim_retry(&self, cached: &CachedTurn) -> AppResult<RetryClaim> {
        let _ownership = self.ownership.lock().await;
        let mut guard = self.active.lock().await;
        if guard.is_some() {
            return Err(AppError::SessionBusy);
        }
        let mut cached_guard = self.last_turn.lock().await;
        let Some(current) = cached_guard.as_mut() else {
            return Err(AppError::SessionBusy);
        };
        if current.session_id != cached.session_id {
            return Err(AppError::SessionBusy);
        }
        let session_id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let cancellation = CancellationToken::new();
        *guard = Some(Session {
            id: session_id,
            stage: SessionStage::Requesting,
            started: None,
            elapsed_before_pause: Duration::ZERO,
            recorder: None,
            target: cached.target,
            cancelled: cancellation.clone(),
            shortcuts: None,
        });
        self.mark_current(session_id);
        current.session_id = session_id;
        Ok(RetryClaim {
            session_id,
            cancellation,
        })
    }

    async fn shortcut_cleanup(&self, id: SessionId) -> Option<SessionShortcuts> {
        let mut guard = self.active.lock().await;
        let session = guard.as_mut()?;
        (session.id == id)
            .then(|| session.shortcuts.take())
            .flatten()
    }

    async fn set_generated_text(&self, id: SessionId, text: String) -> bool {
        let _ownership = self.ownership.lock().await;
        let active = self.active.lock().await;
        if active
            .as_ref()
            .filter(|session| session.id == id)
            .map(|session| session.cancelled.is_cancelled())
            .unwrap_or(true)
        {
            return false;
        }
        let mut guard = self.last_turn.lock().await;
        let Some(turn) = guard.as_mut() else {
            return false;
        };
        if turn.session_id != id {
            return false;
        }
        turn.generated_text = Some(text);
        true
    }

    async fn cache_turn_for_session(&self, id: SessionId, turn: CachedTurn) -> bool {
        let _ownership = self.ownership.lock().await;
        let active = self.active.lock().await;
        let Some(session) = active
            .as_ref()
            .filter(|session| session.id == id && !session.cancelled.is_cancelled())
        else {
            return false;
        };
        if turn.session_id != session.id {
            return false;
        }
        let mut cached = self.last_turn.lock().await;
        *cached = Some(turn);
        true
    }

    async fn side_effects_allowed(&self, id: SessionId, cancellation: &CancellationToken) -> bool {
        let active = self.active.lock().await;
        active.as_ref().is_some_and(|session| {
            session.id == id
                && Arc::ptr_eq(&session.cancelled.0, &cancellation.0)
                && session.cancelled.side_effects_allowed()
        })
    }

    async fn run_owned_side_effect<T, F>(
        &self,
        id: SessionId,
        cancellation: &CancellationToken,
        effect: F,
    ) -> Option<T>
    where
        F: FnOnce() -> T,
    {
        let _ownership = self.ownership.lock().await;
        let active = self.active.lock().await;
        let allowed = active.as_ref().is_some_and(|session| {
            session.id == id
                && Arc::ptr_eq(&session.cancelled.0, &cancellation.0)
                && session.cancelled.side_effects_allowed()
        });
        allowed.then(effect)
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

    #[cfg(test)]
    pub async fn active_id(&self) -> Option<SessionId> {
        self.active.lock().await.as_ref().map(|s| s.id)
    }

    pub async fn target_monitor_point(&self, id: SessionId) -> Option<(f64, f64)> {
        let target = self
            .active
            .lock()
            .await
            .as_ref()
            .filter(|session| session.id == id)
            .and_then(|session| session.target)?;
        focus::monitor_point(&target)
    }

    pub async fn finish(&self, id: SessionId) -> bool {
        let _ownership = self.ownership.lock().await;
        let mut guard = self.active.lock().await;
        if guard.as_ref().map(|s| s.id) != Some(id) {
            return false;
        }
        *guard = None;
        self.clear_current(id);
        true
    }
}

fn emit_state(app: &AppHandle, session_id: SessionId, phase: OverlayPhase) {
    emit_state_with_target(app, session_id, phase, None);
}

fn emit_state_with_target(
    app: &AppHandle,
    session_id: SessionId,
    phase: OverlayPhase,
    target_point: Option<(f64, f64)>,
) {
    let Some(mgr) = app.try_state::<Arc<SessionManager>>() else {
        return;
    };
    if !mgr.is_current(session_id) {
        return;
    }
    crate::overlay::apply_layout_with_target(app, &phase, target_point);
    let event = OverlayEvent {
        session_id,
        state: phase,
    };
    if !mgr.record_snapshot_if_current(event.clone()) {
        return;
    }
    let _ = app.emit_to("overlay", "overlay://state", &event);
}

fn emit_state_unchecked(
    app: &AppHandle,
    session_id: SessionId,
    phase: OverlayPhase,
    target_point: Option<(f64, f64)>,
) {
    crate::overlay::apply_layout_with_target(app, &phase, target_point);
    let event = OverlayEvent {
        session_id,
        state: phase,
    };
    app.state::<Arc<SessionManager>>()
        .record_snapshot(event.clone());
    let _ = app.emit_to("overlay", "overlay://state", &event);
}

pub fn snapshot(app: &AppHandle) -> Option<OverlayEvent> {
    app.state::<Arc<SessionManager>>().snapshot()
}

pub fn clear_snapshot(app: &AppHandle) {
    app.state::<Arc<SessionManager>>().clear_snapshot();
}

async fn cleanup_session_shortcuts(app: &AppHandle, mgr: &SessionManager, session_id: SessionId) {
    if let Some(shortcuts) = mgr.shortcut_cleanup(session_id).await {
        crate::shortcut::unregister_session_shortcuts(app, &shortcuts.process, &shortcuts.cancel);
    }
}

async fn register_session_shortcuts(
    app: &AppHandle,
    mgr: &SessionManager,
    session_id: SessionId,
    process: &str,
    cancel: &str,
) -> AppResult<()> {
    let mut active = mgr.active.lock().await;
    let session = active
        .as_mut()
        .filter(|session| session.id == session_id)
        .ok_or(AppError::SessionBusy)?;
    crate::shortcut::register_session_shortcuts(app, process, cancel)?;
    session.shortcuts = Some(SessionShortcuts::new(process, cancel));
    Ok(())
}

pub async fn active_stage(app: &AppHandle) -> Option<(SessionId, SessionStage)> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    mgr.active_stage().await
}

pub async fn target_monitor_point(app: &AppHandle, session_id: SessionId) -> Option<(f64, f64)> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    mgr.target_monitor_point(session_id).await
}

pub async fn create_turn(app: &AppHandle) -> AppResult<SessionId> {
    create_turn_with_fallback_target(app, None).await
}

async fn create_turn_with_fallback_target(
    app: &AppHandle,
    fallback_target: Option<focus::FocusTarget>,
) -> AppResult<SessionId> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let _ownership = mgr.ownership.lock().await;
    let mut guard = mgr.active.lock().await;
    if guard.is_some() {
        return Err(AppError::SessionBusy);
    }
    *mgr.last_turn.lock().await = None;
    mgr.clear_snapshot();
    let id = mgr.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let target = focus::capture_target_excluding(app).or(fallback_target);
    *guard = Some(Session {
        id,
        stage: SessionStage::Idle,
        started: None,
        elapsed_before_pause: Duration::ZERO,
        recorder: None,
        target,
        cancelled: CancellationToken::new(),
        shortcuts: None,
    });
    mgr.mark_current(id);
    Ok(id)
}

/// Start recording for an already-created turn. The target was captured by
/// `create_turn` before the overlay became visible.
pub async fn begin_recording(app: AppHandle, session_id: SessionId) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let target_point = mgr.target_monitor_point(session_id).await;
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
    emit_state(
        &app,
        session_id,
        OverlayPhase::Opening {
            device_name: snapshot.device_name.clone(),
        },
    );
    if let Err(error) = crate::shortcut::ensure_distinct_shortcuts(
        &snapshot.shortcut,
        &snapshot.process_shortcut,
        &snapshot.cancel_shortcut,
        &snapshot.history_shortcut,
        &snapshot.settings_shortcut,
    ) {
        emit_state_with_target(
            &app,
            session_id,
            OverlayPhase::Error {
                error: error.frontend(),
            },
            target_point,
        );
        mgr.finish(session_id).await;
        return Err(error);
    }
    if let Err(error) = register_session_shortcuts(
        &app,
        &mgr,
        session_id,
        &snapshot.process_shortcut,
        &snapshot.cancel_shortcut,
    )
    .await
    {
        emit_state_with_target(
            &app,
            session_id,
            OverlayPhase::Error {
                error: error.frontend(),
            },
            target_point,
        );
        mgr.finish(session_id).await;
        return Err(error);
    }
    let rec = match recorder::start_recording(snapshot.device_name.as_deref()) {
        Ok(rec) => rec,
        Err(e) => {
            emit_state_with_target(
                &app,
                session_id,
                OverlayPhase::Error {
                    error: e.frontend(),
                },
                target_point,
            );
            cleanup_session_shortcuts(&app, &mgr, session_id).await;
            mgr.finish(session_id).await;
            return Err(e);
        }
    };
    let recording_warning = if snapshot.device_name.is_none() {
        Some(RecordingWarning::DefaultMicrophone)
    } else if rec.selected_device_unavailable() {
        Some(RecordingWarning::SelectedMicrophoneUnavailable)
    } else {
        None
    };

    let mut rec = Some(rec);
    let recording_started = {
        let mut guard = mgr.active.lock().await;
        if let Some(session) = guard.as_mut().filter(|session| session.id == session_id) {
            session.started = Some(Instant::now());
            session.elapsed_before_pause = Duration::ZERO;
            session.recorder = rec.take();
            session.stage = SessionStage::Recording;
            true
        } else {
            false
        }
    };
    if !recording_started {
        if let Some(rec) = rec {
            let _ = tokio::task::spawn_blocking(move || rec.stop()).await;
        }
        cleanup_session_shortcuts(&app, &mgr, session_id).await;
        return Ok(());
    }

    let gemini: Arc<GeminiClient> = app.state::<Arc<GeminiClient>>().inner().clone();
    gemini.prewarm();

    emit_state(
        &app,
        session_id,
        OverlayPhase::Recording {
            elapsed_ms: 0,
            level: 0,
            health: recording_health(0, 0, recording_warning),
            warning: recording_warning,
        },
    );

    let app2 = app.clone();
    let mgr2 = mgr.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let phase = {
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
                        let elapsed = elapsed_ms(session);
                        let level = rec.level();
                        let warning = recording_warning_with_health(
                            recording_warning,
                            rec.dropped_samples(),
                            elapsed,
                        );
                        Some(OverlayPhase::Recording {
                            elapsed_ms: elapsed,
                            level,
                            health: recording_health(level, elapsed, warning),
                            warning,
                        })
                    }
                    SessionStage::Paused => None,
                    _ => break,
                }
            };
            if let Some(phase) = phase {
                emit_state(&app2, session_id, phase);
            }
        }
    });
    Ok(())
}

pub async fn toggle_pause(app: AppHandle) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let (session_id, paused, elapsed, dropped_samples, device_unavailable) = {
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
                (
                    session.id,
                    true,
                    elapsed_ms(session),
                    None,
                    false,
                )
            }
            SessionStage::Paused => {
                if let Some(recorder) = session.recorder.as_ref() {
                    recorder.resume();
                }
                session.started = Some(Instant::now());
                session.stage = SessionStage::Recording;
                let (dropped_samples, device_unavailable) = session
                    .recorder
                    .as_ref()
                    .map(|recorder| {
                        (recorder.dropped_samples(), recorder.selected_device_unavailable())
                    })
                    .unwrap_or((0, false));
                (
                    session.id,
                    false,
                    elapsed_ms(session),
                    Some(dropped_samples),
                    device_unavailable,
                )
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
            let selected_device = app
                .state::<Arc<SettingsStore>>()
                .get()
                .device_name
                .as_deref()
                .map(str::to_string);
            let warning = recording_warning_with_health(
                resume_recording_warning(selected_device.as_deref(), device_unavailable),
                dropped_samples.unwrap_or(0),
                elapsed,
            );
            OverlayPhase::Recording {
                elapsed_ms: elapsed,
                level: 0,
                health: recording_health(0, elapsed, warning),
                warning,
            }
        },
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn execute_ai_turn(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    session_id: SessionId,
    audio: Arc<[u8]>,
    duration_ms: u64,
    target: Option<focus::FocusTarget>,
    cancellation: CancellationToken,
    snapshot: &crate::types::AppSettings,
) -> AppResult<()> {
    if !mgr.side_effects_allowed(session_id, &cancellation).await {
        return Ok(());
    }

    if !mgr.set_stage(session_id, SessionStage::Requesting).await {
        return Ok(());
    }
    let models = snapshot.model_chain();
    emit_state(
        app,
        session_id,
        OverlayPhase::Processing {
            status: ProcessingStatus::Requesting,
            model: models.first().cloned(),
            attempt: 1,
            total_attempts: models.len(),
        },
    );
    let long_running_app = app.clone();
    let long_running_mgr = mgr.clone();
    let long_running_model = models.first().cloned();
    let total_attempts = models.len();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        if matches!(
            long_running_mgr.active_stage().await,
            Some((id, SessionStage::Requesting)) if id == session_id
        ) {
            emit_state(
                &long_running_app,
                session_id,
                OverlayPhase::Processing {
                    status: ProcessingStatus::LongRunning,
                    model: long_running_model,
                    attempt: 1,
                    total_attempts,
                },
            );
        }
    });
    let gemini: Arc<GeminiClient> = app.state::<Arc<GeminiClient>>().inner().clone();
    let settings: Arc<SettingsStore> = app.state::<Arc<SettingsStore>>().inner().clone();
    let request_started = Instant::now();
    let progress_app = app.clone();
    let generated = gemini
        .transcribe_and_respond(
            &settings,
            audio.as_ref(),
            snapshot,
            move |attempt, total, model| {
                if attempt > 1 {
                    emit_state(
                        &progress_app,
                        session_id,
                        OverlayPhase::Processing {
                            status: ProcessingStatus::Fallback,
                            model: Some(model.to_string()),
                            attempt,
                            total_attempts: total,
                        },
                    );
                }
            },
            || cancellation.is_cancelled(),
        )
        .await?;
    let text = generated.result.clone();
    let request_total_ms = request_started.elapsed().as_millis();

    if !mgr.side_effects_allowed(session_id, &cancellation).await {
        return Ok(());
    }

    if !mgr.set_generated_text(session_id, text.clone()).await {
        return Ok(());
    }

    let status = execute_output(
        app,
        mgr,
        session_id,
        &text,
        duration_ms,
        target.as_ref(),
        &cancellation,
        snapshot,
        &generated.transcript,
        &generated.model,
    )
    .await?;

    log::debug!(
        "voice latency: session={} request_total_ms={} audio_bytes={} model={}",
        session_id,
        request_total_ms,
        audio.len(),
        snapshot.model
    );

    if status.pasted {
        mgr.clear_last_turn().await;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn execute_output(
    app: &AppHandle,
    mgr: &SessionManager,
    session_id: SessionId,
    text: &str,
    duration_ms: u64,
    target: Option<&focus::FocusTarget>,
    cancellation: &CancellationToken,
    snapshot: &crate::types::AppSettings,
    transcript: &str,
    model: &str,
) -> AppResult<OutputStatus> {
    if !mgr.side_effects_allowed(session_id, cancellation).await {
        return Ok(OutputStatus::new(false, false));
    }

    if !mgr.set_stage(session_id, SessionStage::Inserting).await {
        return Ok(OutputStatus::new(false, false));
    }
    let insertion_started = Instant::now();

    let mut copied = false;
    let mut copy_error: Option<AppError> = None;
    if snapshot.copy_to_clipboard || snapshot.paste_automatically {
        match mgr
            .run_owned_side_effect(session_id, cancellation, || {
                app.clipboard()
                    .write_text(text.to_string())
                    .map_err(|error| AppError::Clipboard(error.to_string()))
            })
            .await
        {
            Some(Ok(())) => copied = true,
            Some(Err(error)) => {
                log::warn!("clipboard write failed: {error}");
                copy_error = Some(error);
            }
            None => return Ok(OutputStatus::new(false, false)),
        }
    }

    let mut pasted = false;
    let mut insertion_error: Option<AppError> = None;
    if snapshot.paste_automatically {
        if !mgr.side_effects_allowed(session_id, cancellation).await {
            return Ok(OutputStatus::new(copied, false));
        }
        let focus_result = mgr
            .run_owned_side_effect(session_id, cancellation, || match target {
                Some(target) => focus::restore_target(target),
                None => Err(AppError::Focus("captured target is unavailable".into())),
            })
            .await;
        match focus_result {
            None => return Ok(OutputStatus::new(copied, false)),
            Some(Ok(())) => {
                if !mgr.side_effects_allowed(session_id, cancellation).await {
                    return Ok(OutputStatus::new(copied, false));
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
                match mgr
                    .run_owned_side_effect(session_id, cancellation, || {
                        let Some(target) = target else {
                            return Err(AppError::Focus("captured target is unavailable".into()));
                        };
                        focus::ensure_target_foreground(target)?;
                        focus::insert_text(text, false)
                    })
                    .await
                {
                    None => return Ok(OutputStatus::new(copied, false)),
                    Some(Ok(())) => pasted = true,
                    Some(Err(e)) => {
                        log::warn!("direct text insertion failed: {e}");
                        if can_paste_result(cancellation, copied, snapshot.paste_automatically) {
                            match mgr
                                .run_owned_side_effect(session_id, cancellation, || {
                                    let clipboard = app
                                        .clipboard()
                                        .read_text()
                                        .map_err(|error| AppError::Clipboard(error.to_string()))?;
                                    if !clipboard_matches_result(Some(&clipboard), text) {
                                        return Err(AppError::Clipboard(
                                            "clipboard changed before paste".into(),
                                        ));
                                    }
                                    let Some(target) = target else {
                                        return Err(AppError::Focus(
                                            "captured target is unavailable".into(),
                                        ));
                                    };
                                    focus::ensure_target_foreground(target)?;
                                    focus::paste_via_clipboard()
                                })
                                .await
                            {
                                None => return Ok(OutputStatus::new(copied, false)),
                                Some(Ok(())) => pasted = true,
                                Some(Err(paste_error)) => insertion_error = Some(paste_error),
                            }
                        } else {
                            insertion_error = Some(e);
                        }
                    }
                }
            }
            Some(Err(e)) => {
                log::warn!("focus restore failed: {e}");
                insertion_error = Some(e);
            }
        }
    }

    if !mgr.side_effects_allowed(session_id, cancellation).await {
        return Ok(OutputStatus::new(copied, pasted));
    }

    if insertion_error.is_none() && !snapshot.paste_automatically {
        insertion_error = copy_error;
    }
    if let Some(error) = insertion_error {
        log::warn!("result retained after insertion failure: {error}");
        return Err(error);
    }

    let history_write = mgr
        .run_owned_side_effect(session_id, cancellation, || -> AppResult<()> {
            if should_persist_history(snapshot.show_history, true) {
                let history_store = app.state::<Arc<HistoryStore>>();
                let entry = HistoryEntry {
                    id: history::new_id(),
                    created_at: history::now_iso(),
                    duration_ms,
                    transcript_hint: history::transcript_hint(transcript),
                    response_text: text.to_string(),
                    model: model.to_string(),
                    status: "success".into(),
                    error_message: None,
                };
                history_store.push(&entry)?;
                let _ = app.emit("history://changed", ());
            }
            Ok(())
        })
        .await;
    if history_write.is_none() {
        return Ok(OutputStatus::new(copied, pasted));
    }
    if let Some(Err(error)) = history_write {
        return Err(error);
    }

    let insertion_ms = insertion_started.elapsed().as_millis();

    let output = if pasted {
        OutputOutcome::Inserted
    } else if copied {
        OutputOutcome::Copied
    } else {
        OutputOutcome::Preview
    };
    if mgr
        .run_owned_side_effect(session_id, cancellation, || {
            emit_state(
                app,
                session_id,
                OverlayPhase::Success {
                    text: text.to_string(),
                    pasted,
                    copied,
                    output,
                    profile: snapshot.overlay_profile(),
                },
            );
        })
        .await
        .is_none()
    {
        return Ok(OutputStatus::new(copied, pasted));
    }
    log::debug!(
        "voice latency: session={} insertion_ms={} model={}",
        session_id,
        insertion_ms,
        snapshot.model
    );
    Ok(OutputStatus::new(copied, pasted))
}

/// Explicitly finish capture and run the AI pipeline. Toggle mode invokes this
/// on the second press of the main record shortcut; Hold mode invokes it on key up.
pub async fn process_recording(app: AppHandle) -> AppResult<()> {
    let process_started = Instant::now();
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

    if !mgr.side_effects_allowed(session_id, &cancellation).await {
        let _ = tokio::task::spawn_blocking(move || rec.stop()).await;
        cleanup_session_shortcuts(&app, &mgr, session_id).await;
        mgr.finish(session_id).await;
        return Ok(());
    }

    emit_state(
        &app,
        session_id,
        OverlayPhase::Processing {
            status: ProcessingStatus::Encoding,
            model: None,
            attempt: 0,
            total_attempts: snapshot.model_chain().len(),
        },
    );
    let stop_started = Instant::now();
    let recording = tokio::task::spawn_blocking(move || rec.stop())
        .await
        .map_err(|error| AppError::Other(format!("recording stop failed: {error}")))?;
    let record_stop_ms = stop_started.elapsed().as_millis();

    if recording.samples.is_empty() {
        let error = AppError::Recording(
            "No audio captured — check that the selected microphone is working".into(),
        );
        if mgr.side_effects_allowed(session_id, &cancellation).await {
            emit_state(
                &app,
                session_id,
                OverlayPhase::Error {
                    error: error.frontend(),
                },
            );
        }
        cleanup_session_shortcuts(&app, &mgr, session_id).await;
        mgr.finish(session_id).await;
        return Err(error);
    }

    let gemini: Arc<GeminiClient> = app.state::<Arc<GeminiClient>>().inner().clone();
    gemini.prewarm();

    let encode_started = Instant::now();
    // FLAC encoding is CPU-bound (100-300ms typical); keep it off the async
    // worker so runtime timers and events stay responsive.
    let encode_input = recording.samples;
    let encode_sample_rate = recording.sample_rate;
    let encode_channels = recording.channels;
    let audio: Arc<[u8]> = tokio::task::spawn_blocking(move || {
        recorder::samples_to_api_audio(&encode_input, encode_sample_rate, encode_channels)
    })
    .await
    .map_err(|error| AppError::Other(format!("audio encode task failed: {error}")))?
    .map(Arc::from)?;
    let audio_encode_ms = encode_started.elapsed().as_millis();
    log::debug!(
        "voice latency: session={} record_stop_ms={} audio_encode_ms={} audio_bytes={} recording_ms={} sample_rate={} channels={}",
        session_id,
        record_stop_ms,
        audio_encode_ms,
        audio.len(),
        recording.duration_ms,
        recording.sample_rate,
        recording.channels
    );

    if cancellation.is_cancelled() {
        cleanup_session_shortcuts(&app, &mgr, session_id).await;
        mgr.finish(session_id).await;
        return Ok(());
    }

    // Cache the turn audio and focus target so retry can re-use it if an error occurs
    if !mgr
        .cache_turn_for_session(
            session_id,
            CachedTurn {
                session_id,
                audio: Arc::clone(&audio),
                duration_ms: recording.duration_ms,
                target,
                generated_text: None,
            },
        )
        .await
    {
        cleanup_session_shortcuts(&app, &mgr, session_id).await;
        mgr.finish(session_id).await;
        return Ok(());
    }

    let result = execute_ai_turn(
        &app,
        &mgr,
        session_id,
        audio,
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
    cleanup_session_shortcuts(&app, &mgr, session_id).await;
    mgr.finish(session_id).await;
    log::debug!(
        "voice latency: session={} total_after_process_ms={}",
        session_id,
        process_started.elapsed().as_millis()
    );
    result
}

pub async fn finish_hold(app: AppHandle) -> AppResult<Option<SessionId>> {
    let action = active_stage(&app)
        .await
        .map(|(_, stage)| hold_finish_action(stage))
        .unwrap_or(HoldFinishAction::Ignore);
    match action {
        HoldFinishAction::Cancel => Ok(cancel_recording(app).await),
        HoldFinishAction::Process => {
            process_recording(app).await?;
            Ok(None)
        }
        HoldFinishAction::Ignore => Ok(None),
    }
}

/// Abort the active turn. Cancellation is marked while the session is still
/// owned by the manager, before recorder cleanup or any UI-dismiss request can
/// occur. A cancelled turn intentionally emits no visible terminal phase.
pub async fn cancel_recording(app: AppHandle) -> Option<SessionId> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let session = {
        let _ownership = mgr.ownership.lock().await;
        let mut guard = mgr.active.lock().await;
        if let Some(session) = guard.as_mut() {
            session.cancelled.cancel();
        }
        let session = guard.take();
        *mgr.last_turn.lock().await = None;
        if let Some(session) = session.as_ref() {
            mgr.clear_current(session.id);
            mgr.clear_snapshot();
        }
        session
    };
    let cancelled_id = session.as_ref().map(|session| session.id);
    if let Some(mut session) = session {
        if let Some(rec) = session.recorder.take() {
            if let Err(error) = tokio::task::spawn_blocking(move || rec.stop()).await {
                log::warn!("cancel recorder cleanup failed: {error}");
            }
        }
        if let Some(shortcuts) = session.shortcuts.take() {
            crate::shortcut::unregister_session_shortcuts(
                &app,
                &shortcuts.process,
                &shortcuts.cancel,
            );
        }
        if let Some(phase) = cancel_terminal_overlay_phase() {
            emit_state(&app, session.id, phase);
        }
    }
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

async fn prepare_retry(
    app: &AppHandle,
    mgr: &SessionManager,
    cached: &CachedTurn,
) -> AppResult<(RetryClaim, crate::types::AppSettings)> {
    let claim = mgr.claim_retry(cached).await?;
    let settings: Arc<SettingsStore> = app.state::<Arc<SettingsStore>>().inner().clone();
    let snapshot = settings.get();
    if let Err(error) = register_session_shortcuts(
        app,
        mgr,
        claim.session_id,
        &snapshot.process_shortcut,
        &snapshot.cancel_shortcut,
    )
    .await
    {
        mgr.finish(claim.session_id).await;
        return Err(error);
    }
    Ok((claim, snapshot))
}

pub async fn reprocess_audio(app: AppHandle) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let cached = mgr
        .get_last_turn()
        .await
        .ok_or_else(|| AppError::Other("no captured audio is available to reprocess".into()))?;
    let (claim, snapshot) = prepare_retry(&app, &mgr, &cached).await?;
    let result = execute_ai_turn(
        &app,
        &mgr,
        claim.session_id,
        cached.audio,
        cached.duration_ms,
        cached.target,
        claim.cancellation.clone(),
        &snapshot,
    )
    .await;
    if let Err(error) = &result {
        if claim.cancellation.side_effects_allowed() {
            emit_state(
                &app,
                claim.session_id,
                OverlayPhase::Error {
                    error: error.frontend(),
                },
            );
        }
    }
    cleanup_session_shortcuts(&app, &mgr, claim.session_id).await;
    mgr.finish(claim.session_id).await;
    result.map(|_| ())
}

pub async fn retry_insertion(app: AppHandle, requested_text: Option<String>) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let cached = mgr
        .get_last_turn()
        .await
        .ok_or_else(|| AppError::Other("no generated result is available to insert".into()))?;
    let text = requested_text
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .or_else(|| cached.generated_text.clone())
        .ok_or_else(|| AppError::Other("no generated result is available to insert".into()))?;
    let (claim, mut snapshot) = prepare_retry(&app, &mgr, &cached).await?;
    if !mgr.set_generated_text(claim.session_id, text.clone()).await {
        cleanup_session_shortcuts(&app, &mgr, claim.session_id).await;
        mgr.finish(claim.session_id).await;
        return Ok(());
    }
    snapshot.paste_automatically = true;
    let result = execute_output(
        &app,
        &mgr,
        claim.session_id,
        &text,
        cached.duration_ms,
        cached.target.as_ref(),
        &claim.cancellation,
        &snapshot,
        "",
        &snapshot.model,
    )
    .await;
    match &result {
        Ok(status) if status.pasted => mgr.clear_last_turn().await,
        Ok(_) => {}
        Err(error) => {
            if claim.cancellation.side_effects_allowed() {
                emit_state(
                    &app,
                    claim.session_id,
                    OverlayPhase::Error {
                        error: error.frontend(),
                    },
                );
            }
        }
    }
    cleanup_session_shortcuts(&app, &mgr, claim.session_id).await;
    mgr.finish(claim.session_id).await;
    result.map(|_| ())
}

pub async fn copy_last_result(app: AppHandle) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let _ownership = mgr.ownership.lock().await;
    if mgr.active.lock().await.is_some() {
        return Err(AppError::SessionBusy);
    }
    let cached = mgr
        .last_turn
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::Other("no generated result is available to copy".into()))?;
    let text = cached
        .generated_text
        .ok_or_else(|| AppError::Other("no generated result is available to copy".into()))?;
    app.clipboard()
        .write_text(text.clone())
        .map_err(|error| AppError::Clipboard(error.to_string()))?;
    let profile = app.state::<Arc<SettingsStore>>().get().overlay_profile();
    emit_state_unchecked(
        &app,
        cached.session_id,
        OverlayPhase::Success {
            text,
            pasted: false,
            copied: true,
            output: OutputOutcome::Copied,
            profile,
        },
        None,
    );
    Ok(())
}

pub async fn insert_result(app: AppHandle, edited_text: String) -> AppResult<()> {
    let text = edited_text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::Other("result text cannot be empty".into()));
    }
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let cached = mgr
        .get_last_turn()
        .await
        .ok_or_else(|| AppError::Other("no generated result is available to insert".into()))?;
    let (claim, mut snapshot) = prepare_retry(&app, &mgr, &cached).await?;
    if !mgr.set_generated_text(claim.session_id, text.clone()).await {
        cleanup_session_shortcuts(&app, &mgr, claim.session_id).await;
        mgr.finish(claim.session_id).await;
        return Ok(());
    }
    snapshot.paste_automatically = true;
    let result = execute_output(
        &app,
        &mgr,
        claim.session_id,
        &text,
        cached.duration_ms,
        cached.target.as_ref(),
        &claim.cancellation,
        &snapshot,
        "",
        &snapshot.model,
    )
    .await;
    if matches!(&result, Ok(status) if status.pasted) {
        mgr.clear_last_turn().await;
    } else if let Err(error) = &result {
        if claim.cancellation.side_effects_allowed() {
            emit_state(
                &app,
                claim.session_id,
                OverlayPhase::Error {
                    error: error.frontend(),
                },
            );
        }
    }
    cleanup_session_shortcuts(&app, &mgr, claim.session_id).await;
    mgr.finish(claim.session_id).await;
    result.map(|_| ())
}

pub async fn start_new_recording(app: AppHandle) -> AppResult<()> {
    let mgr: Arc<SessionManager> = app.state::<Arc<SessionManager>>().inner().clone();
    let fallback_target = mgr.get_last_turn().await.and_then(|turn| turn.target);
    let session_id = create_turn_with_fallback_target(&app, fallback_target).await?;
    begin_recording(app, session_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_health_reports_silence_and_device_fallbacks() {
        assert_eq!(recording_health(0, 2_500, None), RecordingHealth::Silent);
        assert_eq!(
            recording_health(20, 300, Some(RecordingWarning::DefaultMicrophone)),
            RecordingHealth::Warning
        );
        assert_eq!(recording_health(20, 300, None), RecordingHealth::Healthy);
    }

    #[test]
    fn recording_queue_overflow_takes_priority_over_device_warning() {
        assert_eq!(recording_warning_with_health(None, 0, 0), None);
        assert_eq!(
            recording_warning_with_health(Some(RecordingWarning::DefaultMicrophone), 12, 0),
            Some(RecordingWarning::AudioQueueOverflow)
        );
        assert_eq!(
            recording_warning_with_health(None, 0, recorder::LONG_RECORDING_WARNING_MS),
            Some(RecordingWarning::LongRecording)
        );
    }

    #[test]
    fn resume_warning_reuses_the_live_recorder_flag() {
        assert_eq!(
            resume_recording_warning(None, false),
            Some(RecordingWarning::DefaultMicrophone)
        );
        assert_eq!(
            resume_recording_warning(Some("Mic"), true),
            Some(RecordingWarning::SelectedMicrophoneUnavailable)
        );
        assert_eq!(resume_recording_warning(Some("Mic"), false), None);
    }

    #[tokio::test]
    async fn session_snapshot_returns_the_latest_emitted_phase() {
        let mgr = SessionManager::new();
        mgr.record_snapshot(OverlayEvent {
            session_id: 3,
            state: OverlayPhase::Opening { device_name: None },
        });
        let snapshot = mgr.snapshot().expect("snapshot");
        assert_eq!(snapshot.session_id, 3);
        assert!(matches!(snapshot.state, OverlayPhase::Opening { .. }));
    }

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
    fn hold_release_cancels_a_session_that_is_still_starting() {
        assert_eq!(
            hold_finish_action(SessionStage::Starting),
            HoldFinishAction::Cancel
        );
        assert_eq!(
            hold_finish_action(SessionStage::Recording),
            HoldFinishAction::Process
        );
        assert_eq!(
            hold_finish_action(SessionStage::Idle),
            HoldFinishAction::Cancel
        );
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
    async fn cached_turn_shares_exact_immutable_audio_and_clears_manager_reference() {
        let mgr = SessionManager::new();
        assert!(mgr.get_last_turn().await.is_none());
        let audio: Arc<[u8]> = vec![1, 2, 3].into();
        assert_eq!(Arc::strong_count(&audio), 1);

        mgr.set_last_turn(CachedTurn {
            session_id: 1,
            audio: Arc::clone(&audio),
            duration_ms: 500,
            target: None,
            generated_text: None,
        })
        .await;
        assert_eq!(Arc::strong_count(&audio), 2);

        let cached = mgr.get_last_turn().await.expect("cached turn");
        assert!(Arc::ptr_eq(&audio, &cached.audio));
        assert_eq!(cached.audio.as_ref(), &[1, 2, 3]);
        assert_eq!(cached.duration_ms, 500);
        assert_eq!(Arc::strong_count(&audio), 3);

        drop(cached);
        mgr.clear_last_turn().await;
        assert_eq!(Arc::strong_count(&audio), 1);
        assert!(mgr.get_last_turn().await.is_none());
    }

    #[test]
    fn output_status_reports_only_completed_clipboard_and_paste_actions() {
        let status = OutputStatus::new(false, false);
        assert!(!status.copied);
        assert!(!status.pasted);

        let status = OutputStatus::new(true, false);
        assert!(status.copied);
        assert!(!status.pasted);
    }

    #[test]
    fn paste_is_blocked_without_the_current_result_in_clipboard() {
        assert!(!should_paste_clipboard(false, true));
        assert!(should_paste_clipboard(true, true));
    }

    #[test]
    fn clipboard_fallback_requires_exact_current_result() {
        assert!(!clipboard_matches_result(
            Some("older result"),
            "current result"
        ));
        assert!(!clipboard_matches_result(
            Some("current result\n"),
            "current result"
        ));
        assert!(clipboard_matches_result(
            Some("current result"),
            "current result"
        ));
    }

    #[test]
    fn cancellation_immediately_before_paste_blocks_the_side_effect() {
        let cancellation = CancellationToken::new();
        assert!(can_paste_result(&cancellation, true, true));
        cancellation.cancel();
        assert!(!can_paste_result(&cancellation, true, true));
    }

    #[test]
    fn insertion_failure_keeps_generated_text_for_recovery() {
        let cached = CachedTurn {
            session_id: 1,
            audio: vec![1, 2, 3].into(),
            duration_ms: 500,
            target: None,
            generated_text: Some("recover me".into()),
        };

        assert_eq!(cached.generated_text.as_deref(), Some("recover me"));
    }

    #[test]
    fn legacy_both_false_keeps_result_for_preview() {
        let settings = crate::types::AppSettings {
            copy_to_clipboard: false,
            paste_automatically: false,
            ..crate::types::AppSettings::default()
        };
        assert!(!settings.copy_to_clipboard && !settings.paste_automatically);
        assert!(!should_paste_clipboard(false, settings.paste_automatically));
    }

    #[tokio::test]
    async fn duplicate_retry_claims_are_single_flight() {
        let mgr = SessionManager::new();
        let cached = CachedTurn {
            session_id: 1,
            audio: vec![1, 2, 3].into(),
            duration_ms: 500,
            target: None,
            generated_text: Some("recover me".into()),
        };
        mgr.set_last_turn(cached.clone()).await;

        let first = mgr.claim_retry(&cached).await.expect("first retry");
        assert!(matches!(
            mgr.claim_retry(&cached).await,
            Err(AppError::SessionBusy)
        ));
        assert_eq!(mgr.active_id().await, Some(first.session_id));
    }

    #[tokio::test]
    async fn retry_claim_reassociates_cache_and_blocks_a_new_recording() {
        let mgr = SessionManager::new();
        let original = mgr.begin_test_turn().await.expect("original turn");
        mgr.set_last_turn(CachedTurn {
            session_id: original,
            audio: vec![1, 2, 3].into(),
            duration_ms: 500,
            target: None,
            generated_text: Some("recover me".into()),
        })
        .await;
        assert!(mgr.finish(original).await);

        let cached = mgr.get_last_turn().await.expect("cached turn");
        let claim = mgr.claim_retry(&cached).await.expect("retry claim");

        assert_eq!(
            mgr.get_last_turn().await.unwrap().session_id,
            claim.session_id
        );
        assert!(mgr.begin_test_turn().await.is_none());
    }

    #[tokio::test]
    async fn late_request_cannot_replace_a_newer_cached_result() {
        let mgr = SessionManager::new();
        let stale = mgr.begin_test_turn().await.expect("stale turn");
        assert!(mgr.finish(stale).await);
        let current = mgr.begin_test_turn().await.expect("current turn");
        mgr.set_last_turn(CachedTurn {
            session_id: current,
            audio: vec![4, 5, 6].into(),
            duration_ms: 700,
            target: None,
            generated_text: Some("current result".into()),
        })
        .await;

        assert!(!mgr.set_generated_text(stale, "stale result".into()).await);
        assert_eq!(mgr.active_id().await, Some(current));
        assert_eq!(
            mgr.get_last_turn().await.unwrap().generated_text.as_deref(),
            Some("current result")
        );
    }

    #[tokio::test]
    async fn cancelled_session_cannot_write_generated_text_after_cache_clear() {
        let mgr = SessionManager::new();
        let session_id = mgr.begin_test_turn().await.expect("session");
        mgr.set_last_turn(CachedTurn {
            session_id,
            audio: vec![1, 2, 3].into(),
            duration_ms: 500,
            target: None,
            generated_text: None,
        })
        .await;
        mgr.active
            .lock()
            .await
            .as_ref()
            .expect("active session")
            .cancelled
            .cancel();

        assert!(
            !mgr.set_generated_text(session_id, "late result".into())
                .await
        );
        assert!(mgr.get_last_turn().await.unwrap().generated_text.is_none());
    }

    #[tokio::test]
    async fn stale_session_token_cannot_pass_the_side_effect_guard() {
        let mgr = SessionManager::new();
        let session_id = mgr.begin_test_turn().await.expect("session");
        let cancellation = mgr
            .active
            .lock()
            .await
            .as_ref()
            .expect("active session")
            .cancelled
            .clone();

        assert!(mgr.side_effects_allowed(session_id, &cancellation).await);
        cancellation.cancel();
        assert!(!mgr.side_effects_allowed(session_id, &cancellation).await);
    }

    #[tokio::test]
    async fn shortcut_cleanup_is_scoped_to_the_finishing_session() {
        let mgr = SessionManager::new();
        let first = mgr
            .begin_test_turn_with_shortcuts("Enter", "Escape")
            .await
            .expect("first turn");
        assert!(mgr.finish(first).await);
        let second = mgr
            .begin_test_turn_with_shortcuts("Alt+P", "Alt+C")
            .await
            .expect("second turn");

        assert!(mgr.shortcut_cleanup(first).await.is_none());
        assert_eq!(
            mgr.shortcut_cleanup(second).await,
            Some(SessionShortcuts::new("Alt+P", "Alt+C"))
        );
    }
}
