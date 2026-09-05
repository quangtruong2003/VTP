# Voice to Prompt — Design Document

A production-grade, global-shortcut voice → Gemini → text-insertion desktop
assistant built with **Rust + Tauri 2** and **React + TypeScript + shadcn/ui**.

---

## 1. Product flow and assumptions

### Primary flow (happy path)

1. User presses **Ctrl+Space** anywhere in Windows/macOS.
2. The app captures the current foreground window *before* anything shows
   (this is the "insert target").
3. A compact overlay appears near the cursor — **without stealing focus on
   Windows** (`SWP_SHOWWINDOW | SWP_NOACTIVATE`) — and recording starts
   immediately (configurable).
4. Live feedback: elapsed time + input level meter, pushed at 4 Hz from
   Rust (no polling from JS).
5. User presses **Space** (or clicks **Done**) to stop.
6. Rust encodes the samples to **16-bit PCM WAV (16 kHz mono)** and calls
   Gemini `generateContent` with the audio inline (base64) — one network
   round trip, no Files API, no upload step visible to the user beyond the
   "Uploading" state.
7. Response arrives → Rust (a) writes it to the clipboard, (b) restores
   focus to the target app, (c) types it at the caret (enigo), falling back
   to Ctrl+V if typing is denied.
8. Overlay shows the result + "Inserted & copied" confirmation; Esc or
   timeout dismisses.

### Assumptions

- The user has a working microphone and a Google AI Studio API key
  (onboarding state handles the missing-key case).
- Target apps accept synthetic keystrokes (standard desktop apps do;
  elevated apps and some games do not — the Ctrl+V fallback + clipboard
  covers the gap).
- Speech-to-text is performed by the Gemini model itself (multimodal audio
  input); we do not use a separate ASR service. One request, one bill,
  lowest latency.
- Max recording length is implicitly bounded by the 20 MB inline request
  limit; at 16 kHz/16-bit mono WAV (~32 KB/s), that's ~10 minutes of
  headroom — far beyond any practical voice command.

## 2. Technical architecture and data flow

```
┌─────────────────────────────── Rust process ───────────────────────────────┐
│                                                                            │
│  global-shortcut plugin ──► overlay.rs::toggle()                           │
│        │                                       │                           │
│        │                    1. focus.rs::capture_previous_focus()          │
│        │                    2. show overlay near cursor (no activate)      │
│        │                    3. session::begin_recording()                  │
│        ▼                                       │                           │
│  ┌─ session.rs (orchestrator, single-flight) ──────────────────────────┐    │
│  │  recorder.rs ──► capture thread (owns cpal stream, Send+Sync-safe) │    │
│  │     ▲ lock-free queue          │                                    │    │
│  │     └── RT callback: queue.push only (no locks, no alloc)          │    │
│  │  stop → WAV encode (recorder.rs) → gemini.rs (reqwest, rustls)      │    │
│  │       → clipboard write → focus restore → enigo type / Ctrl+V      │    │
│  │       → history.rs append (JSONL)                                  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│        │ events (emit_to "overlay")         │ state                        │
│        ▼                                    ▼                              │
│  ┌─ overlay window ──┐              ┌─ settings window ─┐                 │
│  │ React/shadcn     │◄──invoke────► │ React/shadcn      │                 │
│  └──────────────────┘              └────────────────────┘                 │
│  tray menu (Record / Settings / History / Quit)                            │
└────────────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **All audio, network, keychain, clipboard, and injection work lives in
  Rust.** The webview only renders states and fires typed `invoke` calls —
  the API key never crosses IPC, audio never enters JS land.
- **Single-flight session**: a `tokio::Mutex<Option<Session>>` guarantees
  at most one recording/pipeline at a time; duplicate shortcut presses are
  idempotent.
- **Event pushes, not polls**: Rust pushes `overlay://state` (idle /
  recording{elapsed, level} / uploading / processing / success / error) —
  the overlay re-renders only on state change.
- **Errors as values**: every command returns `Result<T, AppError>` which
  serializes to a human-readable string the overlay shows inline.

## 3. Folder structure

```
VoiceToPromptV2/
├─ package.json                 # React + shadcn/ui deps (npm)
├─ vite.config.ts               # multi-entry build (overlay.html, settings.html)
├─ tsconfig.json
├─ overlay.html / settings.html # window entry points
├─ src/
│  ├─ index.css                 # Tailwind v4 theme tokens (dark-premium)
│  ├─ overlay.tsx               # overlay window UI (states)
│  ├─ settings.tsx               # settings window UI (tabs)
│  ├─ components/ui/             # shadcn/ui primitives (button, input,
│  │                             #  label, slider, switch, tabs, select,
│  │                             #  tooltip, scroll-area)
│  └─ lib/
│     ├─ utils.ts               # cn()
│     ├─ types.ts                # TS mirror of Rust types + event names
│     ├─ overlay.ts               # invoke wrappers for overlay commands
│     └─ settings.ts             # invoke wrappers for settings commands
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json            # two windows + tray
   ├─ capabilities/default.json # least-privilege ACL
   ├─ icons/                     # png/ico/icns
   └─ src/
      ├─ main.rs                 # thin entry
      ├─ lib.rs                  # builder wiring, tray, onboarding
      ├─ types.rs                # serde DTOs (settings, history, overlay phases)
      ├─ error.rs                # AppError + AppResult
      ├─ settings.rs             # settings.json + API key in OS keyring
      ├─ history.rs              # JSONL history + timestamp utils
      ├─ recorder.rs             # cpal capture thread, WAV encoder, level meter
      ├─ gemini.rs               # Gemini REST client (models + generateContent)
      ├─ focus.rs                # focus capture/restore + text injection (per-OS)
      ├─ overlay.rs              # overlay positioning + no-activate show
      ├─ session.rs              # record → upload → process → insert pipeline
      ├─ shortcut.rs             # global shortcut (re)registration
      └─ commands.rs             # #[tauri::command] surface
```

## 4. Dependency choices & rationale

| Crate | Why |
|---|---|
| `tauri 2` + plugins `global-shortcut`, `clipboard-manager`, `single-instance`, `opener` | Official, maintained, capability-gated (ACL per window). Avoids custom native code for the riskiest integrations. |
| `keyring 3` (windows-native) | API key in **Windows Credential Manager** / macOS Keychain. Never on disk. `windows-native` feature avoids the pure-Rust fallback writing plaintext. |
| `cpal 0.15` | Cross-platform audio capture (WASAPI/CoreAudio) with callback-based, low-latency input. Stream owned by a dedicated thread (WASAPI streams aren't `Sync`). |
| `crossbeam-queue` | Lock-free bounded SPSC queue for the RT audio callback (no locks/alloc on the audio thread). |
| `reqwest 0.12` (rustls-tls, no default features) | Async HTTP with TLS without OpenSSL; single client reused across calls (connection pooling = fewer handshakes). |
| `enigo 0.2` | Cross-platform synthetic keyboard input for text insertion at the caret. |
| `thiserror` | Ergonomic typed errors. |
| Frontend: React 18 + Vite 6 + Tailwind v4 + shadcn/ui (Radix) | shadcn/ui is a requirement; Tailwind v4 CSS-first tokens keep the bundle tiny (~31 KB CSS, ~13 KB overlay JS). |

## 5. OS permissions & security model

| Concern | Windows | macOS |
|---|---|---|
| Global shortcut | None (RegisterHotKey) | None (Carbon RegisterEventHotKey) |
| Microphone | OS-level privacy setting; WASAPI returns devices anyway | **TCC Microphone permission** — must be granted; on first capture attempt macOS prompts (app must be bundled .app for a stable bundle ID) |
| API key storage | Credential Manager (via keyring `windows-native`) | Keychain |
| Text injection | SendInput — works in most apps; fails in elevated apps (UIPI) | CGEventPost — requires **Accessibility permission** in System Settings |
| Clipboard | Always allowed | Always allowed |
| Focus restore | `SetForegroundWindow` can be denied by the foreground lock → we fall back to Ctrl+V after the user clicks | panels don't steal key focus; restore rarely needed |

Security properties:

- **Key isolation**: the key lives only in the OS keyring; the webview only
  ever receives `api_key_set: boolean`. The key is used exclusively inside
  the Rust process, attached as the `x-goog-api-key` header (not a query
  parameter that could leak into logs).
- **CSP + capabilities**: `capabilities/default.json` is an explicit
  allow-list per window (no `default` wildcard beyond `core:default`
  basics); clipboard, shortcuts, window controls are scoped. The settings
  window cannot invoke overlay-only commands and vice versa (same ACL file,
  but the Rust commands validate source by design).
- **URL validation** in `gemini.rs`: http/https only; loopback, link-local
  (`169.254.*`, `.local`, `.internal`), and RFC1918 private ranges rejected
  (SSRF defense-in-depth).
- **No audio persistence**: audio is discarded after the request; history
  stores only response text.
- **Write-atomic settings**: settings.json is written to a tmp file then
  renamed so a crash can't leave a truncated file.

## 6. State / event architecture

Rust owns all state; the webview is a projection.

| State | Home | Visibility |
|---|---|---|
| Settings | `SettingsStore` (Mutex in managed state) | pushed via `settings://saved` after save |
| API key | OS keyring | `api_key_set: boolean` only |
| Session | `SessionManager.active: AsyncMutex<Option<Session>>` | drives `overlay://state` events |
| Recording level/elapsed | capture thread atomics | pushed in `overlay://state` recording payload at 4 Hz |
| History | JSONL file | `history_list` command + `history://changed` event |

Event names (typed contract in `src/lib/types.ts`):
`overlay://state`, `overlay://toast`, `settings://saved`,
`history://changed`, `app://show-overlay`.

Commands (the complete IPC surface):
`get_public_settings`, `save_settings`, `set_api_key`, `delete_api_key`,
`list_models`, `list_audio_devices`, `overlay_stop_recording`,
`overlay_cancel`, `overlay_retry`, `overlay_copy_insert_result`,
`overlay_hide`, `history_list`, `history_copy`, `history_clear`,
`open_settings`, `test_text_insertion`, `set_start_recording_on_open`,
`get_transcript_hint`.

## 7. Implementation phases

| Phase | Scope | Status |
|---|---|---|
| P0 | Scaffold: Tauri 2 + Vite + Tailwind v4 + shadcn primitives, two windows, tray | ✅ |
| P1 | Settings store + keyring + settings window (key, model fetch/select, prompt, params, language, shortcut, behavior) | ✅ |
| P2 | Global shortcut + overlay positioning (no-activate) + overlay state machine | ✅ |
| P3 | Audio capture (cpal, capture thread, lock-free queue, level meter) + WAV encode | ✅ |
| P4 | Gemini client: list models + generateContent with inline audio | ✅ |
| P5 | Clipboard write + focus restore + text injection + Ctrl+V fallback | ✅ |
| P6 | History (JSONL) + settings history tab + copy/clear | ✅ |
| P7 | Onboarding (first-run settings window when no key), error states in overlay | ✅ |
| P8 (optional enhancements) | Streaming responses, in-overlay transcript editing, autostart toggle, WHIP/local ASR fallback, i18n | backlog |

## 8. Key risks

| Risk | Mitigation implemented |
|---|---|
| Global shortcut conflicts (Ctrl+Space is used by IMEs, esp. CJK input) | Shortcut is user-configurable; `reregister` unregisters old before new; failure surfaces at startup |
| Audio capture latency / device quirks | Stream opened on demand in a dedicated thread; 16 kHz mono keeps payload small; level meter gives immediate "recording is live" feedback |
| WASAPI stream is `!Sync` → poison for managed state | Capture thread owns the stream; app-level handles are Send+Sync |
| Text injection failing (elevated apps, games, terminals with raw input) | enigo typing → **Ctrl+V fallback** (clipboard already holds the result) + user-visible toast |
| Windows foreground lock denies SetForegroundWindow | Same Ctrl+V fallback + result remains in overlay for manual paste |
| Gemini API shape changes | Response parsing is defensive (candidates→parts→text extraction with clear BadResponse error); model list filtered to `generateContent`-capable |
| 20 MB inline request cap | 16 kHz mono WAV ≈ 32 KB/s → ~10 min headroom; Files API is the documented escape hatch |
| macOS TCC (mic + accessibility) | Documented; bundle ID stable; overlay shows a recoverable error with "open Settings" |
| Shortcut → overlay → focus race | Focus captured *before* the overlay is shown; overlay never takes key focus on Windows |
