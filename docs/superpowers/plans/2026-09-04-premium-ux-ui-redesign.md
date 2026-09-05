# VoiceToPromptV2 Premium UX/UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved premium dark-first VoiceToPromptV2 redesign while first making focus targeting, full-session single-flight, cancellation, clipboard fallback, history persistence, and stale-event handling trustworthy.

**Architecture:** Keep Rust/Tauri responsible for audio, focus targeting, session lifecycle, Gemini, clipboard, history, global shortcuts, native window sizing, and typed error data. Split the React frontend into focused overlay/settings feature components, use a small event-driven state layer plus serialized autosave, and keep all UI copy behind a lightweight `vi`/`en` localization module. Correctness work lands before visual work; every later UI task consumes the stable session/error/settings contracts established in the early tasks.

**Tech Stack:** Rust 1.77+, Tauri 2, Tokio, reqwest, cpal, enigo, React 18, TypeScript 5.7, Vite 6, Tailwind CSS 4, Radix/shadcn primitives, Lucide, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-04-premium-ux-ui-redesign-design.md`

## Global Constraints

- Product mode is **Hybrid**: near-invisible daily dictation with power-user configuration behind Settings.
- Theme is **Dark-first**; visual direction is a premium native utility inspired by Apple interaction principles, not an Apple UI clone.
- The normal global-shortcut path must **not steal focus**.
- The same configured global shortcut starts recording and finishes recording.
- One session remains single-flight through `starting → recording → encoding → requesting → inserting → terminal`.
- Cancel means no later clipboard write, focus restore, text insertion, success event, or history write from that session.
- Every overlay event carries `session_id`; the frontend rejects stale events.
- Clipboard-paste fallback is allowed only when the backend knows the current session result is already on the clipboard.
- Disabling local history prevents new entries from being persisted.
- User-triggered copy actions use the Tauri/Rust clipboard path, never `navigator.clipboard`.
- Settings auto-save switches/selects immediately; text/numeric fields debounce approximately 350–500 ms; shortcut and credential changes are explicit atomic commits.
- UI supports at least `vi` and `en`; UI locale remains separate from Gemini response language.
- Do not add a heavyweight state library or animation framework; CSS/React are sufficient.
- No custom font files; keep native/system font stacks.
- Respect `prefers-reduced-motion`, maintain WCAG AA body/help-text contrast, and preserve keyboard focus visibility in Settings.
- Current workspace audit on 2026-09-04 found no `.git` directory. The commit commands below are required once the project is restored/placed under Git; do not initialize a new repository merely to satisfy this plan.

---

## Target File Structure

Create or converge on the following responsibilities. Existing low-level `src/components/ui/*` primitives stay in place unless a task explicitly adds one.

```text
src/
  app/
    OverlayApp.tsx                 # overlay entry component only
    SettingsApp.tsx                # settings/onboarding entry component only
  features/
    overlay/
      overlayReducer.ts            # stale-session/state transition logic
      useOverlaySession.ts         # Tauri event subscription + timers/actions
      OverlayShell.tsx
      RecordingState.tsx
      ProcessingState.tsx
      SuccessState.tsx
      ErrorState.tsx
      VoiceMeter.tsx
    settings/
      SettingsShell.tsx
      SettingsSidebar.tsx
      GeneralSection.tsx
      VoiceSection.tsx
      AiPromptSection.tsx
      ShortcutSection.tsx
      OutputSection.tsx
      HistorySection.tsx
      Onboarding.tsx
      shortcut.ts                  # capture/canonicalization/keycap helpers
      autosave.ts                  # serialized save queue
      useSettingsStore.ts
      useAutosaveSettings.ts
  components/
    setting-row.tsx
    section-card.tsx
    status-badge.tsx
    shortcut-key.tsx
    inline-notice.tsx
  lib/
    i18n.ts
    overlay.ts
    settings.ts
    types.ts
  styles/
    tokens.css
    motion.css
  test/
    setup.ts
  overlay.tsx                      # thin createRoot bootstrap
  settings.tsx                     # thin createRoot bootstrap

src-tauri/src/
  commands.rs
  error.rs
  focus.rs
  gemini.rs
  history.rs
  lib.rs
  mic_test.rs                     # mic preview lifecycle, no Gemini
  overlay.rs
  recorder.rs
  session.rs
  settings.rs
  shortcut.rs
  tray.rs                         # localized tray labels/navigation
  types.rs
```

---

### Task 1: Make Focus Targeting Session-Scoped and Keep Single-Flight Through Processing

**Files:**
- Modify: `src-tauri/src/focus.rs`
- Modify: `src-tauri/src/session.rs`
- Modify: `src-tauri/src/overlay.rs`
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `focus::capture_target() -> Option<FocusTarget>`
- Produces: `focus::restore_target(target: &FocusTarget) -> AppResult<()>`
- Produces: `SessionId = u64`
- Produces: session stages `Idle | Starting | Recording | Encoding | Requesting | Inserting`
- Produces: `OverlayEvent { session_id: SessionId, ...OverlayPhase }`
- Consumed later by: stale-event reducer, overlay rendering, cancellation, typed error emission.

- [ ] **Step 1: Add failing Rust tests for one active turn across requesting and per-session target ownership**

Add tests at the bottom of `src-tauri/src/session.rs` around a test-only lifecycle constructor that does not require a real recorder:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn requesting_turn_blocks_a_second_turn() {
        let mgr = SessionManager::new();
        let first = mgr.begin_test_turn().await.expect("first turn");
        assert!(mgr.set_stage(first, SessionStage::Requesting).await);
        assert!(mgr.begin_test_turn().await.is_none());
        assert_eq!(mgr.active_stage().await, Some((first, SessionStage::Requesting)));
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
}
```

- [ ] **Step 2: Run the lifecycle tests and verify they fail before the refactor**

Run:

```bash
cd src-tauri
cargo test session::tests::requesting_turn_blocks_a_second_turn session::tests::finishing_only_clears_the_matching_turn
```

Expected: FAIL because `SessionStage`, `begin_test_turn`, and the full-lifecycle manager methods do not exist.

- [ ] **Step 3: Refactor focus capture from global mutable state into a session-owned value**

In `src-tauri/src/focus.rs`, replace `capture_previous_focus()/restore_focus()` with an explicit value contract. Keep platform internals behind `cfg` and store only Send/Sync-safe primitive identifiers:

```rust
#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusTarget {
    hwnd: isize,
}

#[cfg(target_os = "windows")]
pub fn capture_target() -> Option<FocusTarget> {
    let hwnd = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
    (hwnd as usize != 0).then_some(FocusTarget { hwnd: hwnd as isize })
}

#[cfg(target_os = "windows")]
pub fn restore_target(target: &FocusTarget) -> AppResult<()> {
    let ok = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow(target.hwnd as _)
    };
    if ok == 0 {
        return Err(AppError::Focus("Windows denied focus restore (foreground lock)".into()));
    }
    Ok(())
}
```

Implement the same public signatures for macOS using the platform identifier already available there. Remove the process-wide `PREVIOUS_HWND/PREVIOUS_PID` storage so clicking another VoiceToPrompt surface cannot overwrite the target of an in-flight turn.

- [ ] **Step 4: Keep the `Session` object in `SessionManager.active` until terminal completion**

Refactor `src-tauri/src/session.rs` to make the session lifecycle explicit:

```rust
pub type SessionId = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStage {
    Idle,
    Starting,
    Recording,
    Encoding,
    Requesting,
    Inserting,
}

pub struct Session {
    id: SessionId,
    stage: SessionStage,
    started: Option<Instant>,
    recorder: Option<RecorderHandle>,
    target: Option<focus::FocusTarget>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

pub struct SessionManager {
    pub active: AsyncMutex<Option<Session>>,
    next_id: std::sync::atomic::AtomicU64,
}
```

Add `SessionBusy` to `AppError` so the lifecycle has a non-string busy condition:

```rust
#[error("A voice session is already active")]
SessionBusy,
```

Create a new turn before the overlay is shown:

```rust
pub async fn create_turn(app: &AppHandle) -> AppResult<SessionId> {
    let mgr = app.state::<Arc<SessionManager>>();
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
        recorder: None,
        target,
        cancelled: Arc::new(AtomicBool::new(false)),
    });
    Ok(id)
}
```

Change `stop_recording()` so it only `take()`s the `RecorderHandle`, updates the active stage, releases the mutex, awaits Gemini, then finishes the matching session. It must never `take()` the whole session before network processing.

- [ ] **Step 5: Move target capture ahead of overlay display and remove default-path focus activation**

In `src-tauri/src/overlay.rs`, make the shortcut flow:

```rust
pub fn toggle(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match crate::session::active_stage(&app).await {
            Some((_id, SessionStage::Recording)) => {
                let _ = crate::session::stop_recording(app).await;
            }
            Some((_id, _)) => {
                crate::session::acknowledge_busy(&app).await;
            }
            None => {
                let session_id = match crate::session::create_turn(&app).await {
                    Ok(id) => id,
                    Err(_) => return,
                };
                show_without_activation(&app, session_id);
                if app.state::<Arc<SettingsStore>>().get().start_recording_on_open {
                    let _ = crate::session::begin_recording(app, session_id).await;
                }
            }
        }
    });
}
```

Delete the unconditional `w.set_focus()` call from the normal overlay path. Keep deliberate focus only for controls that the user explicitly clicks.

- [ ] **Step 6: Wrap every overlay state with `session_id` and rerun tests/checks**

In `src-tauri/src/types.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct OverlayEvent {
    pub session_id: SessionId,
    #[serde(flatten)]
    pub state: OverlayPhase,
}
```

Update the state emitter to accept a session id, then run:

```bash
cd src-tauri
cargo fmt -- --check
cargo check
cargo test session::tests
```

Expected: all pass; a second shortcut while the first turn is requesting cannot create session B.

- [ ] **Step 7: Commit once the workspace is under Git**

```bash
git add src-tauri/src/focus.rs src-tauri/src/session.rs src-tauri/src/overlay.rs src-tauri/src/types.rs src-tauri/src/error.rs src-tauri/src/commands.rs
git commit -m "fix: keep voice sessions single flight"
```

---

### Task 2: Add Full-Pipeline Cancellation, Safe Output Side Effects, History Gating, and Typed Errors

**Files:**
- Modify: `src-tauri/src/session.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/overlay.ts`

**Interfaces:**
- Consumes: session ID/token and session-scoped target from Task 1.
- Produces: `ErrorCode`, `FrontendError`, cancellation checks, backend clipboard copy command.
- Produces: overlay success semantics where `pasted` and `copied` always describe the current result.

- [ ] **Step 1: Write failing tests for cancellation and stale-clipboard prevention**

Add pure helper tests in `src-tauri/src/session.rs` so they do not require Gemini/audio:

```rust
#[test]
fn cancelled_token_blocks_side_effects() {
    let token = CancellationToken::new();
    assert!(token.side_effects_allowed());
    token.cancel();
    assert!(!token.side_effects_allowed());
}

#[test]
fn clipboard_fallback_requires_current_result_copy() {
    assert!(!should_paste_clipboard(false, true));
    assert!(!should_paste_clipboard(false, false));
    assert!(should_paste_clipboard(true, true));
}
```

Add a history-gating test around a tiny helper:

```rust
#[test]
fn history_disabled_never_persists() {
    assert!(!should_persist_history(false, true));
    assert!(should_persist_history(true, true));
}
```

- [ ] **Step 2: Run the tests and verify the helpers/contracts are missing**

```bash
cd src-tauri
cargo test session::tests
```

Expected: FAIL until cancellation/output policy helpers exist.

- [ ] **Step 3: Add a cancellation token owned by each session and check it before every external side effect**

Use an `Arc<AtomicBool>` rather than adding a new crate:

```rust
#[derive(Clone)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self { Self(Arc::new(AtomicBool::new(false))) }
    pub fn cancel(&self) { self.0.store(true, Ordering::Release); }
    pub fn is_cancelled(&self) -> bool { self.0.load(Ordering::Acquire) }
    pub fn side_effects_allowed(&self) -> bool { !self.is_cancelled() }
}
```

In the pipeline, check `is_cancelled()` immediately after Gemini returns and again before clipboard write, focus restore, insertion, history write, and success emission. `cancel_recording` marks the token cancelled, stops any recorder, and clears only the matching active turn. A late network result may finish internally but is discarded without side effects.

- [ ] **Step 4: Make clipboard fallback provably safe and gate history persistence**

Keep a boolean that means “the clipboard contains this session's result,” not merely “clipboard is enabled”:

```rust
fn should_paste_clipboard(current_result_copied: bool, paste_automatically: bool) -> bool {
    current_result_copied && paste_automatically
}

fn should_persist_history(show_history: bool, succeeded: bool) -> bool {
    show_history && succeeded
}
```

After direct insertion fails, call `focus::paste_via_clipboard()` only when `current_result_copied == true`. If copying is disabled or the clipboard write failed, emit an `insertion_failed` recovery state and never send Ctrl/Cmd+V. Wrap the existing `HistoryStore::push` call in `if snapshot.show_history`.

- [ ] **Step 5: Replace string-only frontend errors with a stable typed payload**

In Rust:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    MicrophonePermission,
    MicrophoneDevice,
    MissingApiKey,
    InvalidApiKey,
    Network,
    ModelUnavailable,
    ShortcutConflict,
    InsertionFailed,
    ClipboardFailed,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct FrontendError {
    pub code: ErrorCode,
    pub recoverable: bool,
    pub detail: Option<String>,
}
```

Add `AppError::frontend()` in `error.rs` that maps current variants/status codes to this payload. Change `OverlayPhase::Error` to contain `error: FrontendError`. Preserve raw error text only in `detail`.

Mirror exactly in `src/lib/types.ts`:

```ts
export type ErrorCode =
  | "microphone_permission" | "microphone_device" | "missing_api_key"
  | "invalid_api_key" | "network" | "model_unavailable"
  | "shortcut_conflict" | "insertion_failed" | "clipboard_failed" | "unknown";

export interface FrontendError {
  code: ErrorCode;
  recoverable: boolean;
  detail?: string | null;
}
```

- [ ] **Step 6: Route user copy actions through Rust/Tauri**

Add:

```rust
#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> AppResult<()> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| AppError::Other(format!("clipboard: {e}")))
}
```

Register the command in `lib.rs`, then add `copyText: (text: string) => invoke<void>("copy_text", { text })` to `src/lib/overlay.ts`. Remove all planned dependency on `navigator.clipboard`.

- [ ] **Step 7: Run Rust tests/check and frontend typecheck**

```bash
cd src-tauri
cargo fmt -- --check
cargo check
cargo test
cd ..
npm run build
```

Expected: all pass with typed error payloads and no browser clipboard calls in `src/overlay.tsx`/future overlay components.

- [ ] **Step 8: Commit once Git is available**

```bash
git add src-tauri/src/session.rs src-tauri/src/error.rs src-tauri/src/types.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/types.ts src/lib/overlay.ts
git commit -m "fix: cancel voice side effects safely"
```

---

### Task 3: Make Shortcut Replacement Atomic and Establish Persisted UI Locale/Platform Contracts

**Files:**
- Modify: `src-tauri/src/shortcut.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: `set_shortcut(shortcut) -> PublicSettings` with rollback semantics.
- Produces: `PlatformInfo { os, primary_modifier }`.
- Produces: persisted `ui_locale: "system" | "vi" | "en"`.
- Consumed later by shortcut recorder, keycap renderer, i18n, tray labels.

- [ ] **Step 1: Add a failing unit test for “new shortcut fails, old shortcut remains configured” at the pure validation layer**

Extract canonical parsing into `shortcut.rs` and test it independently:

```rust
#[test]
fn invalid_candidate_is_rejected_before_old_shortcut_changes() {
    let old = parse_shortcut("CmdOrCtrl+Shift+Space").unwrap();
    assert!(parse_shortcut("Shift").is_err());
    assert_eq!(old, parse_shortcut("CmdOrCtrl+Shift+Space").unwrap());
}
```

Also add a Settings default test:

```rust
#[test]
fn fresh_install_uses_safe_default_and_system_ui_locale() {
    let s = AppSettings::default();
    assert_eq!(s.shortcut, "CmdOrCtrl+Shift+Space");
    assert_eq!(s.ui_locale, "system");
}
```

Existing persisted settings continue loading their saved shortcut unchanged through serde defaults/migration.

- [ ] **Step 2: Run the targeted tests and verify the new contract is absent**

```bash
cd src-tauri
cargo test shortcut::tests types::tests
```

Expected: FAIL until `parse_shortcut`, the safer fresh default, and `ui_locale` exist.

- [ ] **Step 3: Implement exact atomic shortcut replacement order**

In `shortcut.rs`, expose:

```rust
pub fn parse_shortcut(value: &str) -> AppResult<Shortcut> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Shortcut("shortcut cannot be empty".into()));
    }
    Shortcut::from_str(trimmed).map_err(|e| AppError::Shortcut(e.to_string()))
}

pub fn register(app: &AppHandle, shortcut: Shortcut) -> AppResult<()> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                crate::overlay::toggle(app.clone());
            }
        })
        .map_err(|e| AppError::Shortcut(e.to_string()))
}

pub fn unregister(app: &AppHandle, shortcut: Shortcut) -> AppResult<()> {
    app.global_shortcut()
        .unregister(shortcut)
        .map_err(|e| AppError::Shortcut(e.to_string()))
}
```

In `commands.rs`, make a dedicated command that does **not** reuse full `save_settings` ordering:

```rust
#[tauri::command]
pub async fn set_shortcut(
    app: AppHandle,
    store: State<'_, Arc<SettingsStore>>,
    shortcut: String,
) -> AppResult<PublicSettings> {
    let old_text = store.get().shortcut;
    let old = crate::shortcut::parse_shortcut(&old_text)?;
    let new = crate::shortcut::parse_shortcut(&shortcut)?;

    crate::shortcut::register(&app, new)?;
    if let Err(e) = crate::shortcut::unregister(&app, old) {
        let _ = crate::shortcut::unregister(&app, new);
        return Err(e);
    }

    match store.update(|s| s.shortcut = shortcut.clone()) {
        Ok(snapshot) => Ok(PublicSettings { api_key_set: store.api_key_set(), settings: snapshot }),
        Err(e) => {
            let _ = crate::shortcut::unregister(&app, new);
            let _ = crate::shortcut::register(&app, old);
            Err(e)
        }
    }
}
```

Handle `new == old` as a no-op. If the global-shortcut plugin reports a conflict during registration, return `ErrorCode::ShortcutConflict` without touching persistence or the old registration.

Also make the generic `save_settings` path incapable of replacing the shortcut. Before persisting a generic settings snapshot, restore the currently persisted shortcut:

```rust
let current_shortcut = store.get().shortcut;
settings.shortcut = current_shortcut;
```

This guarantees all shortcut changes go through `set_shortcut`, including later autosave calls.

- [ ] **Step 4: Add `ui_locale` with migration-safe serde default and a platform helper command**

Use a serde default so old `settings.json` files load without migration failures:

```rust
fn default_ui_locale() -> String { "system".into() }

#[serde(default = "default_ui_locale")]
pub ui_locale: String,
```

Add:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub primary_modifier: String,
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.into(),
        primary_modifier: if cfg!(target_os = "macos") { "Meta".into() } else { "Ctrl".into() },
    }
}
```

- [ ] **Step 5: Mirror APIs/types in TypeScript and run checks**

Add to `settingsApi`:

```ts
setShortcut: (shortcut: string) => invoke<PublicSettings>("set_shortcut", { shortcut }),
platformInfo: () => invoke<PlatformInfo>("platform_info"),
```

Update `AppSettings` with `ui_locale: "system" | "vi" | "en"` and add `PlatformInfo`.

Run:

```bash
cd src-tauri
cargo fmt -- --check
cargo check
cargo test shortcut::tests types::tests
cd ..
npm run build
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src-tauri/src/shortcut.rs src-tauri/src/commands.rs src-tauri/src/settings.rs src-tauri/src/types.rs src-tauri/src/lib.rs src/lib/settings.ts src/lib/types.ts
git commit -m "fix: commit global shortcuts atomically"
```

---

### Task 4: Add Native Overlay Layout Control and Microphone Test Mode

**Files:**
- Create: `src-tauri/src/mic_test.rs`
- Modify: `src-tauri/src/overlay.rs`
- Modify: `src-tauri/src/recorder.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/types.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: `overlay::apply_layout(app, &OverlayPhase)` using logical sizes from the spec.
- Produces: `mic_test_start(device_name)`, `mic_test_stop()`, `settings://mic-level` events.
- Consumed later by Voice settings and dynamic overlay rendering.

- [ ] **Step 1: Add tests for deterministic overlay size mapping and mic-test isolation policy**

In `overlay.rs`:

```rust
#[test]
fn phase_layout_matches_spec() {
    assert_eq!(layout_for(&OverlayPhase::Recording { elapsed_ms: 0, level: 0 }), (360.0, 96.0));
    assert_eq!(layout_for(&OverlayPhase::Processing), (360.0, 96.0));
    assert_eq!(layout_for(&OverlayPhase::Success { text: "x".into(), pasted: true, copied: true }), (360.0, 96.0));
    assert_eq!(
        layout_for(&OverlayPhase::Error {
            error: FrontendError {
                code: ErrorCode::Unknown,
                recoverable: true,
                detail: None,
            },
        }),
        (404.0, 220.0),
    );
}
```

In `mic_test.rs`, test that a second mic test cannot start while one is active.

- [ ] **Step 2: Implement native state-sized overlay layout and monitor reclamping**

Use the spec's logical target sizes:

```rust
fn layout_for(phase: &OverlayPhase) -> (f64, f64) {
    match phase {
        OverlayPhase::Idle => (360.0, 112.0),
        OverlayPhase::Recording { .. } | OverlayPhase::Uploading | OverlayPhase::Processing => (360.0, 96.0),
        OverlayPhase::Success { pasted: true, .. } => (360.0, 96.0),
        OverlayPhase::Success { .. } => (404.0, 220.0),
        OverlayPhase::Error { .. } | OverlayPhase::Info { .. } => (404.0, 220.0),
    }
}
```

`apply_layout` calls `set_size(LogicalSize)` and immediately reuses the existing cursor/monitor clamping logic. Do not attempt to animate the native window geometry; later frontend CSS animates only the inner surface.

Update `tauri.conf.json` overlay default to the frequent recording footprint (`360×96`) and Settings to `860×640`, min `760×560`.

- [ ] **Step 3: Reuse the recorder for mic test without creating a Gemini session**

Create `MicTestManager`:

```rust
pub struct MicTestManager {
    active: tokio::sync::Mutex<Option<RecorderHandle>>,
}

impl MicTestManager {
    pub fn new() -> Self { Self { active: tokio::sync::Mutex::new(None) } }
}
```

`mic_test_start` starts `recorder::start_recording(device_name.as_deref())`, stores the handle, and emits `MicLevelPayload { level }` to the Settings window at 100–250 ms intervals. `mic_test_stop` stops/discards samples and emits level `0`. It must never call WAV encoding, Gemini, history, clipboard, or insertion.

- [ ] **Step 4: Register commands/state and mirror the event contract in TypeScript**

Add `Arc<MicTestManager>` to `.manage(...)`, register `mic_test_start`/`mic_test_stop`, and add:

```ts
export interface MicLevelPayload { level: number }

micTestStart: (deviceName: string | null) => invoke<void>("mic_test_start", { deviceName }),
micTestStop: () => invoke<void>("mic_test_stop"),
```

Add `onMicLevel(cb)` listening on `settings://mic-level`.

- [ ] **Step 5: Run backend tests and frontend build**

```bash
cd src-tauri
cargo fmt -- --check
cargo check
cargo test overlay::tests mic_test::tests
cd ..
npm run build
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src-tauri/src/mic_test.rs src-tauri/src/overlay.rs src-tauri/src/recorder.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/types.rs src-tauri/tauri.conf.json src/lib/settings.ts src/lib/types.ts
git commit -m "feat: add dynamic overlay and mic test"
```

---

### Task 5: Establish Frontend Test Harness, Localization, Design Tokens, Motion Tokens, and Shared Preference Components

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/lib/i18n.ts`
- Create: `src/lib/i18n.test.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/motion.css`
- Modify: `src/index.css`
- Create: `src/components/setting-row.tsx`
- Create: `src/components/section-card.tsx`
- Create: `src/components/status-badge.tsx`
- Create: `src/components/shortcut-key.tsx`
- Create: `src/components/inline-notice.tsx`

**Interfaces:**
- Produces: `resolveUiLocale`, `t(locale, key, vars?)`, shared visual tokens, reusable setting-row/status/keycap components.
- Consumed by all overlay/settings UI tasks.

- [ ] **Step 1: Install only the minimal testing/dialog dependencies**

Run:

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install @radix-ui/react-alert-dialog
```

Add scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Create `vitest.config.ts` with `environment: "jsdom"`, alias `@ -> ./src`, and setup file `src/test/setup.ts` importing `@testing-library/jest-dom/vitest`.

- [ ] **Step 2: Write failing locale tests before implementing translations**

```ts
import { describe, expect, it } from "vitest";
import { resolveUiLocale, t } from "@/lib/i18n";

describe("i18n", () => {
  it("uses explicit locale over OS locale", () => {
    expect(resolveUiLocale("vi", "en-US")).toBe("vi");
  });

  it("falls back unsupported system locale to English", () => {
    expect(resolveUiLocale("system", "ko-KR")).toBe("en");
  });

  it("never returns mixed fallback keys for core overlay copy", () => {
    expect(t("vi", "overlay.processing")).toBe("Đang xử lý…");
    expect(t("en", "overlay.processing")).toBe("Processing…");
  });
});
```

Run `npm test -- src/lib/i18n.test.ts` and expect failure.

- [ ] **Step 3: Implement a lightweight typed translation table**

Use one key union derived from the English table and require Vietnamese to satisfy the same shape:

```ts
export const en = {
  "overlay.processing": "Processing…",
  "overlay.inserted": "Inserted",
  "overlay.ready": "Ready to record",
  "settings.general": "General",
  "settings.voice": "Voice",
  "settings.aiPrompt": "AI & Prompt",
  "settings.shortcut": "Shortcut",
  "settings.output": "Output",
  "settings.history": "History",
} as const;

type TranslationKey = keyof typeof en;
export type UiLocale = "vi" | "en";
```

Populate the complete copy set as each later feature is added; do not hardcode visible strings in feature components.

- [ ] **Step 4: Create semantic design/motion tokens and import them from `index.css`**

`tokens.css` defines `--surface-1`, `--surface-2`, `--text-secondary`, cool-blue accent, separate recording/destructive colors, radius tiers (`8/10/12-14/16px`), and the 4px spacing scale. `motion.css` defines:

```css
:root {
  --motion-instant: 90ms;
  --motion-fast: 140ms;
  --motion-standard: 200ms;
  --motion-emphasis: 300ms;
  --ease-out-premium: cubic-bezier(.2,.8,.2,1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-standard: 100ms;
    --motion-emphasis: 100ms;
  }
}
```

Update `src/index.css` to use the dark-first tokens and raise helper-text contrast above the current muted value.

- [ ] **Step 5: Implement focused shared preference components**

`SettingRow` accepts `{ label, description, children }`; `SectionCard` is tonal, not dashboard-heavy; `StatusBadge` supports neutral/success/warning/error; `ShortcutKey` renders one keycap with `aria-label`; `InlineNotice` renders typed feedback without raw technical styling.

Add at least one rendering test proving `SettingRow` exposes its visible label and description.

- [ ] **Step 6: Run tests and production build**

```bash
npm test
npm run build
```

Expected: PASS; no mixed locale in the new shared surfaces and no new animation library.

- [ ] **Step 7: Commit once Git is available**

```bash
git add package.json package-lock.json vitest.config.ts src/test src/lib/i18n.ts src/lib/i18n.test.ts src/styles src/index.css src/components
git commit -m "feat: add premium ui foundations"
```

---

### Task 6: Implement Session-Aware Overlay Reducer, Timers, Stale-Event Rejection, and Auto-Dismiss Rules

**Files:**
- Create: `src/features/overlay/overlayReducer.ts`
- Create: `src/features/overlay/overlayReducer.test.ts`
- Create: `src/features/overlay/useOverlaySession.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/overlay.ts`

**Interfaces:**
- Consumes: `OverlayEvent { session_id, phase... }` and typed errors from Tasks 1–2.
- Produces: `OverlayViewModel` including `processingElapsedMs`, `showLongProcessingHint`, `showCancel`, `autoDismissEligible`.
- Consumed by overlay visual components.

- [ ] **Step 1: Write reducer tests for stale events and terminal auto-dismiss eligibility**

```ts
import { describe, expect, it } from "vitest";
import { initialOverlayModel, reduceOverlayEvent } from "./overlayReducer";

describe("overlay reducer", () => {
  it("ignores an older session event", () => {
    const current = reduceOverlayEvent(initialOverlayModel, {
      session_id: 9,
      phase: "recording",
      elapsed_ms: 250,
      level: 80,
    });
    const stale = reduceOverlayEvent(current, {
      session_id: 8,
      phase: "success",
      text: "old",
      pasted: true,
      copied: true,
    });
    expect(stale).toEqual(current);
  });

  it("auto dismisses only inserted success", () => {
    const inserted = reduceOverlayEvent(initialOverlayModel, {
      session_id: 1, phase: "success", text: "ok", pasted: true, copied: true,
    });
    const copiedOnly = reduceOverlayEvent(initialOverlayModel, {
      session_id: 2, phase: "success", text: "ok", pasted: false, copied: true,
    });
    expect(inserted.autoDismissEligible).toBe(true);
    expect(copiedOnly.autoDismissEligible).toBe(false);
  });
});
```

- [ ] **Step 2: Run the reducer tests and confirm failure**

```bash
npm test -- src/features/overlay/overlayReducer.test.ts
```

- [ ] **Step 3: Implement reducer and processing threshold state**

Keep the reducer pure. It accepts only backend events and derives terminal flags. `useOverlaySession` owns time-based UI behavior:

```ts
const PROCESSING_HINT_MS = 2500;
const PROCESSING_CANCEL_MS = 8000;
const INSERTED_DISMISS_MS = 1400;
```

When processing begins, start one local monotonic timer. At 2.5s show the explanatory hint; at 8s expose Cancel because backend cancellation is now guaranteed. Reset timers on session or phase change.

- [ ] **Step 4: Subscribe once to Tauri events and expose actions from the hook**

`useOverlaySession()` returns:

```ts
{
  model,
  startRecording,
  stopRecording,
  cancel,
  retry,
  hide,
  openSettings,
  copyText,
  pointerInteracting,
  setPointerInteracting,
}
```

The 1.4s auto-dismiss timer pauses while `pointerInteracting === true` and resumes when interaction ends.

- [ ] **Step 5: Run reducer tests and frontend build**

```bash
npm test -- src/features/overlay/overlayReducer.test.ts
npm run build
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src/features/overlay/overlayReducer.ts src/features/overlay/overlayReducer.test.ts src/features/overlay/useOverlaySession.ts src/lib/types.ts src/lib/overlay.ts
git commit -m "feat: add session aware overlay state"
```

---

### Task 7: Build the Premium Compact Overlay States and Voice Meter

**Files:**
- Create: `src/app/OverlayApp.tsx`
- Create: `src/features/overlay/OverlayShell.tsx`
- Create: `src/features/overlay/RecordingState.tsx`
- Create: `src/features/overlay/ProcessingState.tsx`
- Create: `src/features/overlay/SuccessState.tsx`
- Create: `src/features/overlay/ErrorState.tsx`
- Create: `src/features/overlay/VoiceMeter.tsx`
- Create: `src/features/overlay/OverlayApp.test.tsx`
- Modify: `src/overlay.tsx`

**Interfaces:**
- Consumes: `useOverlaySession`, `t`, shared tokens/components.
- Produces: final state-sized overlay UI with no focus-dependent keyboard instructions.

- [ ] **Step 1: Write component tests for recording, processing, inserted success, copied-only success, and typed errors**

Mock `useOverlaySession` and assert the visible contract:

```tsx
it("renders the configured shortcut hint while recording", () => {
  render(<RecordingState level={120} elapsedMs={3200} shortcut="CmdOrCtrl+Shift+Space" locale="vi" onStop={() => {}} />);
  expect(screen.getByText(/hoàn tất/i)).toBeInTheDocument();
  expect(screen.queryByText(/Enter/)).not.toBeInTheDocument();
});

it("keeps copied-only success visible with recovery actions", () => {
  render(<SuccessState text="hello" pasted={false} copied={true} locale="vi" onCopy={() => {}} onRetry={() => {}} />);
  expect(screen.getByText(/chưa thể chèn/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /copy|sao chép/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement `VoiceMeter` with real-level smoothing only**

Use 10 decorative bars and a `requestAnimationFrame` loop. Map incoming `0..255` level to a target amplitude; use a faster attack coefficient and slower decay coefficient. Do not generate random activity at zero. Mark bars `aria-hidden="true"` and expose one screen-reader status string on the parent.

A simple smoothing core is sufficient:

```ts
const next = target > current
  ? current + (target - current) * 0.45
  : current + (target - current) * 0.18;
```

- [ ] **Step 3: Implement each state according to completion status, not one generic card**

- `RecordingState`: muted warm-red record orb, live meter, 20–22px tabular timer, actual configured shortcut rendered as keycaps, compact pointer Stop action.
- `ProcessingState`: 3–5 bar calm processing indicator; `<2.5s` title only, `2.5–8s` helper, `>8s` helper + real Cancel.
- `SuccessState`: inserted success is compact “Inserted/Đã chèn” plus optional one-line preview; copied-only has up to ~5 lines and recovery buttons; neither inserted nor copied routes to error rendering.
- `ErrorState`: map `ErrorCode` to localized title/description/primary action and a collapsible technical detail.
- `Idle`: only when auto-record is disabled; “Ready to record/Sẵn sàng ghi âm” + Start.

- [ ] **Step 4: Build `OverlayShell` with near-opaque tonal surfaces and purposeful transitions**

Use a 16px outer radius, hairline border, two-layer shadow, no permanent title bar, no oversized spinner, and only inner-surface animations. Apply `motion-*` tokens and reduced-motion behavior. Keep unused shell space draggable via `data-tauri-drag-region` without adding chrome.

- [ ] **Step 5: Make `src/overlay.tsx` a thin bootstrap and remove browser keyboard/clipboard assumptions**

Final bootstrap:

```tsx
import { createRoot } from "react-dom/client";
import { OverlayApp } from "@/app/OverlayApp";
import "@/index.css";

createRoot(document.getElementById("root")!).render(<OverlayApp />);
```

Do not register global `Enter`, `Space`, or `Escape` handlers for the normal overlay path. Shortcut completion comes from the global shortcut; clicked buttons remain available.

- [ ] **Step 6: Run overlay tests and build**

```bash
npm test -- src/features/overlay
npm run build
```

Expected: all overlay states are covered and no `navigator.clipboard`, `Loader2`-as-primary-processing, or fixed large success panel remains.

- [ ] **Step 7: Commit once Git is available**

```bash
git add src/app/OverlayApp.tsx src/features/overlay src/overlay.tsx
git commit -m "feat: redesign compact voice overlay"
```

---

### Task 8: Build Serialized Autosave and the Sidebar Settings Shell

**Files:**
- Create: `src/features/settings/autosave.ts`
- Create: `src/features/settings/autosave.test.ts`
- Create: `src/features/settings/useSettingsStore.ts`
- Create: `src/features/settings/useAutosaveSettings.ts`
- Create: `src/features/settings/SettingsShell.tsx`
- Create: `src/features/settings/SettingsSidebar.tsx`
- Create: `src/app/SettingsApp.tsx`
- Modify: `src/settings.tsx`
- Modify: `src/lib/settings.ts`

**Interfaces:**
- Produces: serialized `enqueueSave(snapshot)` semantics; status `idle | saving | saved | error`.
- Produces: section navigation `general | voice | ai_prompt | shortcut | output | history`.
- Consumed by every settings section.

- [ ] **Step 1: Write failing tests proving saves are serialized and latest state wins**

```ts
const base: AppSettings = {
  api_key_set: true,
  model: "gemini-2.0-flash",
  system_prompt: "",
  temperature: 0.7,
  max_output_tokens: 2048,
  language: "auto",
  shortcut: "CmdOrCtrl+Shift+Space",
  copy_to_clipboard: true,
  paste_automatically: true,
  device_name: null,
  show_history: true,
  start_recording_on_open: true,
  ui_locale: "system",
};

it("never lets an older save resolve over a newer snapshot", async () => {
  const calls: string[] = [];
  const save = vi.fn(async (s: AppSettings) => {
    calls.push(s.system_prompt);
    await Promise.resolve();
    return s;
  });
  const queue = createAutosaveQueue(save);
  queue.enqueue({ ...base, system_prompt: "a" });
  queue.enqueue({ ...base, system_prompt: "b" });
  await queue.flush();
  expect(calls.at(-1)).toBe("b");
});
```

Also use fake timers to verify text fields debounce at 400ms while immediate fields bypass the debounce.

- [ ] **Step 2: Implement the save queue and hook**

`createAutosaveQueue` holds at most one in-flight save and merges/replaces pending snapshots with the newest state. `useAutosaveSettings` exposes:

```ts
saveImmediate(next: AppSettings): void;
saveDebounced(next: AppSettings): void;
retry(): void;
status: "idle" | "saving" | "saved" | "error";
```

Keep credential and shortcut operations outside this queue.

- [ ] **Step 3: Build the 860px preferences shell with persistent left navigation**

`SettingsShell` has a 176–192px sidebar and max ~560px content column. Sidebar sections are General, Voice, AI & Prompt, Shortcut, Output, History. Use buttons/links with visible keyboard focus and icon sizes from the spec; no horizontal tabs.

Header shows only the current section title and subtle autosave status (`Saving…`, brief `Saved`, or retryable failure); remove the global Save button.

- [ ] **Step 4: Move entry bootstrapping out of the 488-line `settings.tsx`**

Make `src/settings.tsx` only mount `<SettingsApp />`. `SettingsApp` loads public settings, platform info, devices, and routes onboarding vs settings shell. Keep business logic in the feature hooks.

- [ ] **Step 5: Test shell navigation/autosave and run build**

```bash
npm test -- src/features/settings/autosave.test.ts src/features/settings/SettingsShell.test.tsx
npm run build
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src/features/settings/autosave.ts src/features/settings/autosave.test.ts src/features/settings/useSettingsStore.ts src/features/settings/useAutosaveSettings.ts src/features/settings/SettingsShell.tsx src/features/settings/SettingsSidebar.tsx src/app/SettingsApp.tsx src/settings.tsx src/lib/settings.ts
git commit -m "feat: add autosaving settings shell"
```

---

### Task 9: Implement General, Voice, and Output Settings Including Live Mic Test

**Files:**
- Create: `src/features/settings/GeneralSection.tsx`
- Create: `src/features/settings/VoiceSection.tsx`
- Create: `src/features/settings/OutputSection.tsx`
- Create: `src/features/settings/VoiceSection.test.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `src/features/settings/useSettingsStore.ts`

**Interfaces:**
- Consumes: autosave hook, platform info, mic-test APIs/events, shared SettingRow/StatusBadge/ShortcutKey.
- Produces: readiness overview, device test UI, output behavior rows.

- [ ] **Step 1: Write Voice section tests for system-default device, live signal, and stop cleanup**

```tsx
it("shows system default first and reports detected audio", async () => {
  render(<VoiceSection {...props} devices={[{ name: "Mic A", is_default: true }]} micLevel={140} />);
  expect(screen.getByText(/Mặc định hệ thống|System default/)).toBeInTheDocument();
  expect(screen.getByText(/Đang nhận âm thanh|Receiving audio/)).toBeInTheDocument();
});
```

Assert that unmounting an active mic test calls `micTestStop()`.

- [ ] **Step 2: Build General as a readiness/status screen**

Show four concise statuses: Gemini connection, selected microphone, rendered shortcut keycaps, auto-insert on/off. Below: immediate autosave for “start recording immediately”, UI language selector (`system`, `vi`, `en`), and a small “Try VoiceToPrompt” action. Keep raw model IDs off this page.

- [ ] **Step 3: Build Voice with device refresh and live test**

Device selector begins with System default and badges the actual default device. “Test microphone” calls `micTestStart(settings.device_name)`, renders the same level-meter visual language as the overlay at smaller scale, and stops explicitly or on cleanup. State copy distinguishes silence from active input without claiming permission state the backend cannot prove.

- [ ] **Step 4: Build Output as three plain setting rows**

Rows:

```text
Insert result automatically
Keep result in clipboard
Save local history
```

Use localized descriptions. When clipboard retention is off, explain that an insertion failure may require clicking Copy manually. Switches save immediately.

- [ ] **Step 5: Run tests and build**

```bash
npm test -- src/features/settings/VoiceSection.test.tsx
npm run build
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src/features/settings/GeneralSection.tsx src/features/settings/VoiceSection.tsx src/features/settings/OutputSection.tsx src/features/settings/VoiceSection.test.tsx src/lib/i18n.ts src/features/settings/useSettingsStore.ts
git commit -m "feat: add general voice and output preferences"
```

---

### Task 10: Implement Validated Gemini Connection and Progressive AI & Prompt Settings

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/gemini.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/settings/AiPromptSection.tsx`
- Create: `src/features/settings/AiPromptSection.test.tsx`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Produces: `connect_api_key(key)` that validates before credential persistence.
- Consumes: autosave for normal AI settings; explicit credential operation for API key.

- [ ] **Step 1: Add a backend validation path that does not store a bad credential**

Expose a Gemini validation method that takes a candidate key and performs the existing model-list request. Then add:

```rust
#[tauri::command]
pub async fn connect_api_key(
    store: State<'_, Arc<SettingsStore>>,
    gemini: State<'_, Arc<GeminiClient>>,
    key: String,
) -> AppResult<()> {
    let trimmed = key.trim();
    if trimmed.is_empty() { return Err(AppError::MissingApiKey); }
    gemini.list_models(trimmed).await?;
    store.set_api_key(trimmed)
}
```

Replace frontend credential setup with this command so invalid/expired keys never become the “connected” persisted state.

- [ ] **Step 2: Write AI section tests for disconnected vs connected states and Advanced disclosure**

```tsx
it("hides the password input after connection", () => {
  render(<AiPromptSection {...props} apiKeySet />);
  expect(screen.queryByPlaceholderText(/AIza/)).not.toBeInTheDocument();
  expect(screen.getByText(/Connected|Đã kết nối/)).toBeInTheDocument();
});

it("keeps temperature and max tokens collapsed by default", () => {
  render(<AiPromptSection {...props} apiKeySet />);
  expect(screen.queryByLabelText(/temperature/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Build the Gemini connection card and automatic model loading**

Disconnected: one-sentence explanation, password input, primary Connect action, API-key acquisition link via Tauri opener, credential-store security note. Connected: success status, Replace action, Disconnect in a secondary/destructive affordance. Automatically load models once `api_key_set` becomes true.

Model selector shows `display_name` first and model ID/description only as secondary menu copy. Manual model ID appears only inside Advanced.

- [ ] **Step 4: Build prompt/language/advanced generation controls**

System prompt card uses a fixed 6–8 line textarea, clear explanation, and “Restore default”. Response language uses localized language names and explains Auto as matching spoken language. Advanced contains temperature with “Precise ↔ Creative” labels, numeric detail, max output tokens, and optional manual model ID.

Text/numeric edits use 400ms debounced autosave; select/slider commits can use immediate or debounced behavior according to interaction frequency, but never produce overlapping writes because Task 8 serializes them.

- [ ] **Step 5: Run Rust checks, AI component tests, and build**

```bash
cd src-tauri
cargo fmt -- --check
cargo check
cargo test
cd ..
npm test -- src/features/settings/AiPromptSection.test.tsx
npm run build
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src-tauri/src/commands.rs src-tauri/src/gemini.rs src-tauri/src/lib.rs src/features/settings/AiPromptSection.tsx src/features/settings/AiPromptSection.test.tsx src/lib/settings.ts src/lib/i18n.ts
git commit -m "feat: add validated gemini preferences"
```

---

### Task 11: Replace Raw Accelerator Syntax with a Real Shortcut Recorder

**Files:**
- Create: `src/features/settings/shortcut.ts`
- Create: `src/features/settings/shortcut.test.ts`
- Create: `src/features/settings/ShortcutSection.tsx`
- Create: `src/features/settings/ShortcutSection.test.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes: atomic `settingsApi.setShortcut`, `PlatformInfo`.
- Produces: browser key event → canonical Tauri accelerator conversion and platform-native keycap labels.

- [ ] **Step 1: Write canonicalization tests before implementing capture**

```ts
it("canonicalizes Ctrl+Shift+Space for Tauri", () => {
  expect(toTauriAccelerator({ ctrl: true, shift: true, alt: false, meta: false, key: "Space" }, "windows"))
    .toBe("Ctrl+Shift+Space");
});

it("rejects modifier-only input", () => {
  expect(validateCandidate({ ctrl: true, shift: false, alt: false, meta: false, key: null }))
    .toEqual({ ok: false, reason: "modifier_only" });
});
```

Add coverage for Escape cancelling capture, macOS Meta label `⌘`, and common non-character keys.

- [ ] **Step 2: Implement shortcut capture helpers with no raw text input**

`shortcut.ts` owns:

```ts
export interface ShortcutCandidate {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string | null;
}

export function candidateFromKeyboardEvent(e: KeyboardEvent): ShortcutCandidate;
export function validateCandidate(c: ShortcutCandidate): { ok: true } | { ok: false; reason: "modifier_only" | "missing_modifier" | "unsupported" };
export function toTauriAccelerator(c: ShortcutCandidate, os: PlatformInfo["os"]): string;
export function displayShortcut(accelerator: string, os: PlatformInfo["os"]): string[];
```

Do not expose a free-form accelerator input in normal UI.

- [ ] **Step 3: Build the deliberate-focus capture UI**

Default view shows keycaps plus “Change”. Capture mode deliberately focuses its card and says “Press a new key combination…”. `Escape` cancels only this capture mode. On a valid combination, call `settingsApi.setShortcut(candidate)` and update the displayed shortcut only from the successful returned settings snapshot.

On conflict/error, keep the old keycaps visible and show a localized inline notice; never optimistically replace them.

- [ ] **Step 4: Add platform-specific conflict hints**

Use `PlatformInfo.os` to show concise hints only after a conflict. Keep hints informational; backend registration remains authoritative.

- [ ] **Step 5: Run helper/component tests and build**

```bash
npm test -- src/features/settings/shortcut.test.ts src/features/settings/ShortcutSection.test.tsx
npm run build
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src/features/settings/shortcut.ts src/features/settings/shortcut.test.ts src/features/settings/ShortcutSection.tsx src/features/settings/ShortcutSection.test.tsx src/lib/i18n.ts
git commit -m "feat: add global shortcut recorder"
```

---

### Task 12: Finish History, First-Run Onboarding, and Localized Tray Navigation

**Files:**
- Create: `src/features/settings/HistorySection.tsx`
- Create: `src/features/settings/HistorySection.test.tsx`
- Create: `src/features/settings/Onboarding.tsx`
- Create: `src/features/settings/Onboarding.test.tsx`
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `src/app/SettingsApp.tsx`

**Interfaces:**
- Consumes: connection status, mic test, shortcut recorder, output settings, history APIs.
- Produces: polished history list/confirmation, 3-step onboarding, tray labels/navigation matching selected UI locale.

- [ ] **Step 1: Write history and onboarding behavior tests**

History:

```tsx
it("requires confirmation before clearing history", async () => {
  const user = userEvent.setup();
  render(<HistorySection entries={[entry]} onClear={onClear} />);
  await user.click(screen.getByRole("button", { name: /clear|xóa/i }));
  expect(onClear).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /confirm|xác nhận/i }));
  expect(onClear).toHaveBeenCalledTimes(1);
});
```

Onboarding:

```tsx
it("does not advance past AI connection when api key validation failed", async () => {
  render(<Onboarding apiKeySet={false} connectApiKey={vi.fn().mockRejectedValue(new Error("invalid"))} />);
  // enter key + click connect
  expect(screen.queryByText(/Microphone|Micro/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Build History as a native-style list with local confirmation**

Rows show localized relative time, 1–3 line response preview, duration, secondary model metadata, and a copy action on hover/focus using Rust clipboard. Empty state is icon + “No content yet/Chưa có nội dung nào” + one sentence. Use Radix AlertDialog for irreversible Clear History confirmation.

Do not add remote search/indexing. If a filter is implemented, keep it local over the loaded entries only.

- [ ] **Step 3: Build the three-step onboarding inside Settings**

Flow:

1. **Connect AI** — validated API key required to advance.
2. **Microphone** — select + optional live test; device errors stay inline.
3. **Shortcut & Output** — keycaps/recorder, “press once to record, press again to finish”, auto-insert default on.

Final “Try now/Thử ngay” focuses a small test textarea inside Settings, then invokes the same overlay-start path while that textarea owns the caret. Because the overlay no longer activates, the first real test result can insert into this field and demonstrate the full path without guessing an external target.

Do not persist a separate completion flag merely because the window closes; render onboarding whenever the required Gemini connection is absent. Once the key is valid, subsequent opens go to General.

- [ ] **Step 4: Extract tray construction into `tray.rs` and localize labels**

Create a small locale-to-label function in Rust for the tray's four labels and update it when `ui_locale` changes. Keep only:

```text
Start recording / Open overlay (shortcut shown)
Settings
History
Quit
```

Tray start calls the same `overlay::toggle` semantics as the global shortcut, so processing never launches a second session. History emits a dedicated `app://settings-section` event with payload `"history"`; `SettingsApp` selects that sidebar section.

- [ ] **Step 5: Run component tests, Rust checks, and build**

```bash
npm test -- src/features/settings/HistorySection.test.tsx src/features/settings/Onboarding.test.tsx
npm run build
cd src-tauri
cargo fmt -- --check
cargo check
cargo test
```

- [ ] **Step 6: Commit once Git is available**

```bash
git add src/features/settings/HistorySection.tsx src/features/settings/HistorySection.test.tsx src/features/settings/Onboarding.tsx src/features/settings/Onboarding.test.tsx src-tauri/src/tray.rs src-tauri/src/lib.rs src-tauri/src/commands.rs src/lib/settings.ts src/lib/i18n.ts src/app/SettingsApp.tsx
git commit -m "feat: finish onboarding history and tray"
```

---

### Task 13: Run Full Quality Gates and Native Trust/Polish Smoke Matrix

**Files:**
- Create: `docs/qa/premium-redesign-smoke.md`
- Modify only if failures are found: files owned by Tasks 1–12.

**Interfaces:**
- Consumes: completed redesign.
- Produces: release evidence for lifecycle correctness, accessibility, localization, window geometry, and production builds.

- [ ] **Step 1: Run all automated frontend and Rust gates**

Run:

```bash
npm test
npm run build
cd src-tauri
cargo fmt -- --check
cargo check
cargo test
```

Expected: zero failures. Do not mark the redesign complete with skipped/failing lifecycle tests.

- [ ] **Step 2: Scan production source for forbidden regressions**

Run searches equivalent to:

```bash
rg "navigator\.clipboard|Enter =|Esc =|Tauri accelerator|TODO|TBD" src src-tauri/src
rg "Loader2" src/features/overlay
```

Expected: no browser clipboard usage, no focus-dependent universal overlay hints, no raw accelerator instructions, no placeholder copy, and no generic large spinner as the overlay processing experience.

- [ ] **Step 3: Record and execute the Windows native smoke matrix**

Create `docs/qa/premium-redesign-smoke.md` with checkboxes for:

```text
Notepad
Browser text field
VS Code/editor
Terminal
Elevated app insertion fallback
Multi-monitor / mixed scaling
```

For every target verify:

1. Hotkey captures the original target before overlay display.
2. Overlay does not steal focus on normal open.
3. Same hotkey stops recording.
4. Repeated hotkey during processing cannot start another turn.
5. Cancel after 8s causes no later clipboard write/paste/history/success.
6. Clicking the overlay does not replace the stored insertion target.
7. Copy-disabled + direct insertion failure never sends Ctrl/Cmd+V with stale clipboard contents.
8. History-disabled produces no new JSONL entry.
9. Overlay remains on-screen at monitor edges after every state resize.

- [ ] **Step 4: Run accessibility/localization/reduced-motion manual checks**

Verify keyboard traversal through all Settings sections, visible focus rings, icon-only accessible names, status live regions that do not announce meter ticks, AA contrast for helper text, both `vi` and `en` with no mixed screen copy, and reduced-motion behavior using OS/browser preference emulation.

- [ ] **Step 5: Verify performance budgets with lightweight timestamp logging only if needed**

Measure shortcut handler entry to overlay visibility and recorder start on a warm app. Target ideally ≤100ms visible acknowledgement and ≤250ms recording active. Remove temporary measurement logs before completion.

- [ ] **Step 6: Fix any gate failures in the owning task's file boundary, then rerun the complete gate set**

After any fix, rerun:

```bash
npm test && npm run build
cd src-tauri && cargo fmt -- --check && cargo check && cargo test
```

Do not accept a partial pass after lifecycle/focus/cancellation changes.

- [ ] **Step 7: Final commit once Git is available**

```bash
git add docs/qa/premium-redesign-smoke.md src src-tauri
git commit -m "chore: verify premium redesign release gates"
```

---

## Plan Self-Review Notes

- **Spec coverage:** lifecycle focus ordering, non-activation, full single-flight, cancellation, session IDs, stale-event rejection, safe clipboard fallback, history gating, Rust clipboard actions, dynamic overlay sizes, mic test, typed errors, sidebar settings, autosave, AI credential state, advanced disclosure, shortcut recorder, output/history/onboarding, localization, tray behavior, accessibility, motion, performance budgets, automated tests, and native smoke tests all map to Tasks 1–13.
- **Dependency restraint:** only Vitest/RTL/jsdom/user-event and Radix AlertDialog are added; no global state or animation library is introduced.
- **Type consistency:** `session_id` is established in Task 1 and consumed by Task 6; `FrontendError/ErrorCode` are established in Task 2 and consumed by Task 7; `ui_locale/PlatformInfo` are established in Task 3 and consumed by Tasks 5/9/11/12; mic-level contracts are established in Task 4 and consumed by Task 9.
- **Repository state:** the current approved workspace is not a Git repository. Commit steps remain in the plan for the eventual source-controlled checkout, but implementation should not create Git metadata unless the user explicitly asks.
