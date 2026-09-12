# Premium Redesign Release Smoke Matrix

Date: 2026-09-10
Platform target: Windows desktop

## Status

Automated gates and source regression scans were executed in the current workspace. The native end-to-end matrix below requires a real microphone, a working Gemini credential, target applications with editable fields, an elevated target, and a mixed-scaling multi-monitor setup. Those prerequisites were not all available and validated in this run.

**Manual native status: PARTIALLY VERIFIED IN CURRENT ENVIRONMENT**

Unchecked boxes below are intentionally not marked PASS. They must be completed on a release-candidate Windows machine before treating native trust/polish smoke as manually verified.

## Automated release evidence

- [x] `npm test` — 19 test files, 144 tests passed, 0 failed.
- [x] `npm run build` — exit code 0; Vite emitted `overlay.html`, `settings.html`, and `history.html`.
- [x] `npm run tauri dev` — dev profile compiled 465/465 units and launched the executable; a fresh Win32 run after the latest recovery changes also started cleanly.
- [x] Win32 visual smoke — the running Settings window rendered at 720×520; the Voice section showed the selected headset, device refresh, no-signal state, and Test microphone control. The full native behavior matrix remains open because the window was opened outside its normal Tauri lifecycle.
- [x] Win32 Toggle smoke — the persisted `Ctrl+Space` shortcut opened the 280×48 recording pill at bottom-center with a live timer, without taking foreground focus; `Escape` cancelled it and hid the pill. Earlier smoke also reached processing/long-running feedback. No insertion or Gemini result is claimed because the captured target was the desktop/Codex surface.
- [x] Controlled History insertion smoke — a temporary JSONL entry was backed up and restored; a visible native text target received the History response through the focus/clipboard paste path, and the History window hid afterward. The temporary target and test entry were removed.
- [x] Settings/Voice native smoke — the current Settings window rendered at 720×520, the Voice section showed the detected Realtek microphone and no-signal state, Test microphone entered `Receiving audio`, and Stop test returned cleanly. No speech/Gemini turn was run.
- [x] Hold-mode native smoke — Settings temporarily switched Toggle to Hold-to-talk; a real Ctrl+Space press/release opened the 280×48 pill and completed the release path, Escape cancelled the no-audio processing state, and the persisted setting was restored to Toggle.
- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — exit code 0.
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` — exit code 0 with a temporary target, one build job, and no warnings.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` — 87 passed, 0 failed, 1 ignored with a temporary target, one build job, and no incremental compilation.
- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — exit code 0.
- [x] `npm run tauri -- build --bundles nsis` — exit code 0; produced the x64 installer.
- [x] NSIS artifact inspection — `dist-bundles/Voice to Prompt_0.1.1_x64-setup.exe`, 2,574,441 bytes, PE signature valid, SHA-256 `B4EB99F86694113CC07B4947E8A5915E0D9016CF914C89A9207A7B6842070CA3`. The installer is unsigned.
- [x] Regression scan for `navigator\.clipboard|Enter =|Esc =|Tauri accelerator|TODO|TBD` in `src` and `src-tauri/src` — no matches.
- [x] Regression scan for `Loader2` in `src/features/overlay` — no matches.
- [x] Active contract scan for the removed recording-start setting across `src`, `src-tauri`, `README.md`, `DESIGN.md`, and the design/spec/smoke docs — no matches. The roadmap instruction in `.zcode/` remains unchanged.
- [x] History writer scan — the current session writer persists only `status: "success"` with `error_message: None`; no runtime error-entry writer remains.

## Current source-contract notes

- The app owns three native windows: `overlay`, `settings`, and `history`.
- Toggle mode starts on the first main-shortcut press and finishes on the
  second; Hold-to-talk starts on press and finishes on release.
- The overlay is placed bottom-center on the target app's monitor, falling back
  to the cursor monitor and then the primary monitor.
- The recorder opens the microphone in its native default format on a dedicated
  thread. Stop-time encoding downmixes/resamples to 16 kHz mono 16-bit PCM WAV.
- Overlay recording meter events are emitted every 100 ms (10 Hz); the Settings
  microphone test emits level events every 150 ms. The frontend smooths the
  overlay meter between events.
- Queue overflow and five-minute recordings produce typed overlay warnings while
  capture continues without an artificial hard stop.
- Cancel marks the session before recorder cleanup, aborts an in-flight Gemini
  request, clears the stale snapshot, and bounds recorder-result waiting.
- History writes happen only after output succeeds; clipboard recovery uses a
  copy-only command and never forces a paste.
- History insertion retains the captured external target for repeated inserts
  and fails safely when no valid target is available.
- `capabilities/default.json` applies one shared permission set to all three
  windows. It does not express per-window Rust command permissions.

## Native behavior checklist

For every target below, verify all nine behaviors:

1. Hotkey captures the original target before overlay display.
2. Overlay does not steal focus on normal open.
3. Same hotkey stops recording.
4. Repeated hotkey during processing cannot start another turn.
5. Cancel after 8 seconds causes no later clipboard write, paste, history entry, or success UI.
6. Clicking the overlay does not replace the stored insertion target.
7. With clipboard copy disabled, direct insertion failure never sends Ctrl/Cmd+V with stale clipboard contents.
8. With history disabled, no new JSONL history entry is produced.
9. Overlay remains on-screen at monitor edges after every native state resize.

For the shortcut mode selected in Settings, also verify the matching completion
gesture: Toggle uses a second press; Hold-to-talk uses release. In either mode,
the overlay meter should update from Rust at the documented 100 ms cadence
without announcing every meter tick to assistive technology.

### Notepad — NOT VERIFIED IN CURRENT ENVIRONMENT

- [ ] 1. Original Notepad target captured before overlay display.
- [ ] 2. Overlay opens without stealing focus.
- [ ] 3. Same hotkey stops recording.
- [ ] 4. Processing remains single-flight under repeated hotkey.
- [ ] 5. Cancel after 8s has no late clipboard/paste/history/success side effects.
- [ ] 6. Clicking overlay does not replace stored Notepad target.
- [ ] 7. Copy-disabled insertion failure does not paste stale clipboard data.
- [ ] 8. History-disabled turn creates no history entry.
- [ ] 9. Overlay remains on-screen through all state resizes at monitor edges.

### Browser text field — NOT VERIFIED IN CURRENT ENVIRONMENT

- [ ] 1. Original browser text-field target captured before overlay display.
- [ ] 2. Overlay opens without stealing focus.
- [ ] 3. Same hotkey stops recording.
- [ ] 4. Processing remains single-flight under repeated hotkey.
- [ ] 5. Cancel after 8s has no late clipboard/paste/history/success side effects.
- [ ] 6. Clicking overlay does not replace stored browser target.
- [ ] 7. Copy-disabled insertion failure does not paste stale clipboard data.
- [ ] 8. History-disabled turn creates no history entry.
- [ ] 9. Overlay remains on-screen through all state resizes at monitor edges.

### VS Code / editor — NOT VERIFIED IN CURRENT ENVIRONMENT

- [ ] 1. Original editor target captured before overlay display.
- [ ] 2. Overlay opens without stealing focus.
- [ ] 3. Same hotkey stops recording.
- [ ] 4. Processing remains single-flight under repeated hotkey.
- [ ] 5. Cancel after 8s has no late clipboard/paste/history/success side effects.
- [ ] 6. Clicking overlay does not replace stored editor target.
- [ ] 7. Copy-disabled insertion failure does not paste stale clipboard data.
- [ ] 8. History-disabled turn creates no history entry.
- [ ] 9. Overlay remains on-screen through all state resizes at monitor edges.

### Terminal — NOT VERIFIED IN CURRENT ENVIRONMENT

- [ ] 1. Original terminal target captured before overlay display.
- [ ] 2. Overlay opens without stealing focus.
- [ ] 3. Same hotkey stops recording.
- [ ] 4. Processing remains single-flight under repeated hotkey.
- [ ] 5. Cancel after 8s has no late clipboard/paste/history/success side effects.
- [ ] 6. Clicking overlay does not replace stored terminal target.
- [ ] 7. Copy-disabled insertion failure does not paste stale clipboard data.
- [ ] 8. History-disabled turn creates no history entry.
- [ ] 9. Overlay remains on-screen through all state resizes at monitor edges.

### Elevated app insertion fallback — NOT VERIFIED IN CURRENT ENVIRONMENT

- [ ] 1. Original elevated-app target captured before overlay display.
- [ ] 2. Overlay opens without stealing focus.
- [ ] 3. Same hotkey stops recording.
- [ ] 4. Processing remains single-flight under repeated hotkey.
- [ ] 5. Cancel after 8s has no late clipboard/paste/history/success side effects.
- [ ] 6. Clicking overlay does not replace stored elevated target.
- [ ] 7. Copy-disabled insertion failure does not paste stale clipboard data.
- [ ] 8. History-disabled turn creates no history entry.
- [ ] 9. Overlay remains on-screen through all state resizes at monitor edges.

### Multi-monitor / mixed scaling — NOT VERIFIED IN CURRENT ENVIRONMENT

- [ ] 1. Original target is captured before overlay display on each monitor.
- [ ] 2. Overlay opens without stealing focus on each monitor.
- [ ] 3. Same hotkey stops recording.
- [ ] 4. Processing remains single-flight under repeated hotkey.
- [ ] 5. Cancel after 8s has no late clipboard/paste/history/success side effects.
- [ ] 6. Clicking overlay does not replace the stored cross-monitor target.
- [ ] 7. Copy-disabled insertion failure does not paste stale clipboard data.
- [ ] 8. History-disabled turn creates no history entry.
- [ ] 9. Overlay remains on-screen after every resize at monitor edges and across mixed scaling.

## Accessibility, localization, and reduced motion

**Manual status: NOT VERIFIED IN CURRENT ENVIRONMENT**

- [ ] Keyboard traversal reaches every Settings section and interactive control in a sensible order.
- [ ] Focus-visible treatment is clearly visible on keyboard focus.
- [ ] Icon-only controls expose accessible names.
- [ ] Status live regions announce meaningful state changes without announcing microphone meter ticks.
- [ ] Helper/secondary text meets AA contrast in the shipping theme.
- [ ] Vietnamese (`vi`) UI is complete with no mixed English screen copy.
- [ ] English (`en`) UI is complete with no mixed Vietnamese screen copy.
- [ ] `system` locale resolves consistently to the OS UI language.
- [ ] Reduced-motion preference suppresses non-essential motion while preserving understandable state changes.

## Performance budget

**PARTIALLY VERIFIED IN CURRENT ENVIRONMENT**

No temporary performance instrumentation was added. On a warm release-candidate app, measure shortcut-handler entry to visible overlay acknowledgement and recording-active state only if launch responsiveness is in question. Targets from the implementation plan are ideally <=100 ms for visible acknowledgement and <=250 ms for recording active. Remove any temporary timestamp logging after measurement.

- [x] Release audio-path benchmark — for 30 seconds of 48 kHz stereo input:
  resample 7.185 ms, WAV encode 9.691 ms, base64 encode 0.846 ms per run;
  shared `Arc` clone 9.5 ns. This covers CPU preparation only, not microphone,
  network, native focus, or UI acknowledgement latency.

## Release sign-off

Automated gates and static regression scans are PASS in this workspace. Native trust/polish, accessibility, localization, reduced-motion, and performance checks remain explicitly **NOT VERIFIED IN CURRENT ENVIRONMENT** until the unchecked release-candidate matrix above is executed on suitable Windows hardware and applications.
