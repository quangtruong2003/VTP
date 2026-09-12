# Voice to Prompt

A fast, lightweight desktop AI voice assistant. Press **CmdOrCtrl+Shift+Space** anywhere,
speak, press it again to finish, and the response from Google Gemini is typed directly at your cursor in
whatever app you were using — plus copied to the clipboard.

Built with **Rust + Tauri 2** (backend) and **React + TypeScript + shadcn/ui**
(frontend).

## Features

- Global shortcut (default `CmdOrCtrl+Shift+Space`, configurable) opens a compact,
  always-on-top overlay **without stealing focus** (Windows:
  `SWP_SHOWWINDOW | SWP_NOACTIVATE`)
- Instant recording with live elapsed-time + level meter, driven from Rust at
  10 Hz (100 ms events; no JS polling; the frontend smooths between updates)
- Native microphone capture on a dedicated thread, followed at encode time by
  downmixing/resampling to 16-bit PCM WAV at 16 kHz mono
- Gemini `generateContent` with inline base64 audio — one round trip, no
  separate transcription step
- Response is **typed at the caret** of the previously focused app, with an
  automatic **Ctrl+V fallback** when an app blocks synthetic input
  (elevated processes, some terminals, games)
- Always copied to the clipboard as well
- API key stored in the **OS credential manager** (Windows Credential
  Manager / macOS Keychain) — never written to disk, never sent to the
  webview
- Dynamic model listing from your key, model picker, system prompt,
  temperature, max tokens, response language, mic device, shortcut
  configuration
- Local history (JSONL, audio is never stored), tray menu, first-run
  onboarding, and three native windows: Overlay, Settings, and History

## Prerequisites

- Rust 1.77+ (rustup)
- Node 18+ and npm
- Windows 10/11 (WebView2) or macOS 12+
- A Google AI Studio API key (https://aistudio.google.com/apikey)

## Development

```bash
npm install
npm run tauri dev     # runs Vite + Cargo; Tauri owns Overlay, Settings, and History
```

> Note: `tauri dev` uses the npm-delivered `@tauri-apps/cli`. The
> `cargo tauri` subcommand is not required.

## Production build

```bash
npm run tauri build   # outputs installers in src-tauri/target/release/bundle
```

Icons: `src-tauri/icons/` contains generated placeholders. Replace with real
art via `npm run tauri icon path/to/icon.png` before shipping.

## First run

1. The Settings window opens automatically (no API key detected).
2. Paste your Gemini API key — it goes straight into the OS keyring.
3. Click **Fetch models**, pick a model (default `gemini-2.0-flash`).
4. Press `CmdOrCtrl+Shift+Space` anywhere, speak, then press it again to finish in Toggle mode. Settings can change the main shortcut to Hold-to-talk, where releasing it finishes the turn.

## Keyboard map (overlay)

| Key | Action |
|---|---|
| Main global shortcut — Toggle | press once to start recording; press again to finish |
| Main global shortcut — Hold | press and hold to record; release to finish |
| Done button | finish recording → process |
| `Esc` | cancel and dismiss |
| `Ctrl/Cmd+C` (on result) | copy the result again |

## Security model

- The API key never leaves the Rust process except to Google's endpoint,
  attached as the `x-goog-api-key` header (not a query parameter).
- The webview only ever receives `api_key_set: boolean`.
- All network calls go to `generativelanguage.googleapis.com`; outgoing URLs
  are validated against a deny-list of loopback/private/link-local hosts.
- Clipboard access and global shortcuts are gated by Tauri capability ACLs
  (`src-tauri/capabilities/default.json`), which currently applies one shared
  permission set to the Overlay, Settings, and History windows.

## OS-specific notes

- **Windows**: text injection via SendInput works in standard apps but is
  blocked by UIPI in elevated apps — the Ctrl+V fallback covers this.
  `SetForegroundWindow` can be denied by the foreground-lock; the result
  stays in the overlay and the clipboard for manual paste.
- **macOS**: the first microphone use triggers a TCC permission prompt
  (requires running as a bundled `.app`). Synthetic keyboard input requires
  the **Accessibility** permission (System Settings → Privacy & Security →
  Accessibility). On macOS avoid `Cmd+Space` because it conflicts with
  Spotlight. The default `CmdOrCtrl+Shift+Space` resolves to
  `Ctrl+Shift+Space` on Windows and `Cmd+Shift+Space` on macOS; change it in
  Settings if another application already uses it.

## Project layout

See [DESIGN.md](./DESIGN.md) for the full architecture, data flow, state and
event contracts, and the phase plan.
