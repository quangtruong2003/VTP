# VoiceToPromptV2 — Premium UX/UI Redesign Specification

**Date:** 2026-09-04
**Status:** Design specification ready for implementation planning
**Scope:** Full UX/UI redesign + UX-critical lifecycle correctness
**Product direction:** Hybrid — near-invisible daily dictation + power-user settings
**Visual direction:** Apple-like premium utility
**Theme:** Dark-first

---

## 1. Executive summary

VoiceToPromptV2 already has a strong technical core: global shortcut, microphone capture, Gemini processing, clipboard/text insertion, history, settings, tray integration, and a compact overlay. The frontend also currently builds successfully. The redesign is therefore not a rewrite of the product. It is a redesign of the **interaction model, visual hierarchy, state feedback, settings information architecture, and lifecycle correctness** around the existing capabilities.
The target product should feel like a native premium desktop utility that disappears from the user's attention:

> Press shortcut → immediately know recording is live → speak → press the same shortcut → get a calm processing transition → text appears at the original caret → overlay confirms and disappears.

Power-user configuration remains available, but it moves out of the critical path. Users should never have to understand Tauri accelerator syntax, raw model IDs, technical API errors, or ambiguous save behavior to use the app successfully.
The redesign must prioritize, in this order:

1. **Correctness and trust** — never paste into the wrong app, never continue a cancelled action, never run two overlapping sessions accidentally.
2. **Speed of interaction** — one shortcut, minimal cognitive load, no unnecessary confirmations.
3. **State clarity** — recording, processing, success, and recovery must be obvious at a glance.
4. **Native-premium feel** — dark, calm, carefully spaced, motion with purpose, no generic dashboard look.
5. **Power without clutter** — advanced AI controls exist, but are progressively disclosed.

---

## 2. Current-state audit

### 2.1 What already works well

- Clear product concept: shortcut → voice → Gemini → insert.
- Rust owns microphone/network/clipboard/injection work; React is mostly presentation.
- Overlay and Settings are separate windows.
- Local history exists and audio is not stored.
- API key is isolated in the OS credential store.
- shadcn/Radix primitives provide a reasonable accessibility foundation.
- The current frontend passes `tsc --noEmit && vite build`.

### 2.2 Main UX/UI weaknesses

#### Settings feels like an engineering configuration panel

The current Settings screen exposes six horizontal tabs and presents implementation details directly to the user. Examples include raw model IDs, a manually typed Tauri accelerator string, explicit max-token controls, and a global Save button.
This creates several problems:

- Too much knowledge is required before the app feels usable.
- Horizontal tab density is high for a 760 px window.
- Primary settings and expert settings have the same visual weight.
- Save state is ambiguous: some operations save immediately, while the rest require the global Save button.
- The page lacks a strong status/overview screen.

#### The overlay is visually serviceable, not premium

The current overlay uses a fixed 360×260 window for every state. Recording, loading, success, and error all live inside essentially the same card. This wastes space during the most frequent recording state and makes the interaction feel like a small dialog rather than an ambient utility.
The live microphone feedback is a single scaling circle. It communicates activity but not speech energy particularly well. Processing uses a generic spinner. Success remains as a relatively large result card even when text was already inserted successfully.

#### Language is inconsistent

The overlay uses Vietnamese copy while Settings is mostly English. A premium product must never mix UI locales unintentionally.

#### Shortcut configuration is too technical

The user currently types strings such as `CmdOrCtrl+Shift+V`. This is inappropriate for a mainstream desktop utility. The interface should capture the actual key combination and validate it.

### 2.3 UX-critical correctness issues discovered during the audit

These items are part of this redesign because they directly determine whether users can trust the interface.

#### Focus capture ordering is inconsistent with the intended behavior

`src-tauri/src/overlay.rs` shows/focuses the overlay, then asynchronously starts recording. `begin_recording()` in `src-tauri/src/session.rs` captures the previous focus. This means the code path can capture the overlay itself rather than the application that originally owned the caret.
The target app must be captured **before any overlay window can become foreground**.

#### “Do not steal focus” and `set_focus()` contradict each other

The architecture describes a no-activate overlay, but `show_and_start()` explicitly calls `w.set_focus()`. The redesign must remove this contradiction. The default shortcut path must not steal focus.

#### Session single-flight only covers recording reliably

`stop_recording()` removes the session from `SessionManager.active` before Gemini processing completes. During network processing, another shortcut activation can therefore start a new session while the first request is still running.
Single-flight must cover the **entire lifecycle**, not just microphone capture.

#### Cancellation is not guaranteed across the full pipeline

Once processing has taken ownership of a recording, cancelling/hiding the overlay may not prevent the request from finishing and triggering clipboard or insertion side effects later.
A user-visible Cancel action must mean: **no later paste/copy caused by that cancelled turn**.

#### Clipboard fallback can use the wrong clipboard contents

The current pipeline calls the clipboard-paste fallback after direct insertion fails even when `copy_to_clipboard` is disabled. In that configuration the current result may never have been written to the clipboard, so the fallback can paste unrelated pre-existing clipboard contents into the target application.
Clipboard fallback is allowed only when the backend can prove the clipboard contains the **current session's result**. Otherwise the app must stop and show a manual recovery action.

#### “Keep history” must control persistence, not only visibility

The current session pipeline appends successful history entries without checking the `show_history` setting. If the UI says history is disabled, the backend must not persist new entries. This is a user-trust and local-privacy contract, not a cosmetic preference.

#### Clipboard actions must not silently depend on browser permission

The current success UI uses `navigator.clipboard` for some copy-again actions even though the application already has a Tauri/Rust clipboard path. Copy actions in the redesigned overlay must go through one reliable application API and surface failure instead of silently doing nothing.
These seven correctness items are release blockers for the premium redesign.

---

## 3. Product goals and non-goals

### 3.1 Goals

- Make the daily voice flow require effectively zero UI learning.
- Preserve the user's working context and caret target.
- Make the overlay compact enough to feel ambient rather than modal.
- Give recording feedback that feels alive without being distracting.
- Make success feedback proportional to what the user still needs to do.
- Replace raw shortcut syntax with a real shortcut recorder.
- Replace mixed immediate/manual persistence with one coherent settings model.
- Organize Settings around user intentions, not backend fields.
- Keep advanced Gemini controls available without making them first-run concepts.
- Provide high-quality recovery for microphone, API, network, model, shortcut, clipboard, and insertion failures.
- Provide consistent Vietnamese and English UI localization.
- Keep bundle/runtime complexity modest; do not introduce a heavy UI framework beyond what the app already uses.

### 3.2 Non-goals

This redesign does **not** include:

- Streaming Gemini responses.
- A general-purpose chat interface.
- Cloud history sync.
- Accounts, billing, or telemetry infrastructure.
- Audio history storage.
- Local speech recognition fallback.
- Full prompt-template marketplace.
- A major rewrite of the Rust architecture unrelated to session correctness.

---

## 4. Approaches considered

### Approach A — Pure dictation appliance

The app would expose almost no AI configuration and optimize entirely for shortcut → speak → insert.
**Strengths:** fastest mental model, simplest UI, smallest surface area.
**Weaknesses:** wastes the existing model/prompt controls and underserves advanced users.

### Approach B — AI voice control center

The app would foreground models, prompts, temperature, language, history, and processing options.
**Strengths:** maximum visibility and control.
**Weaknesses:** feels like a developer tool; too much configuration for a utility whose core value is speed.

### Approach C — Hybrid premium utility — selected

Daily use behaves like Approach A. Settings contains the depth of Approach B using progressive disclosure.
This is the selected architecture because it preserves the product's technical flexibility while making ordinary usage nearly invisible.

---

## 5. Experience principles

### 5.1 Instant acknowledgment

Every shortcut press must produce immediate visual feedback, even if microphone initialization takes slightly longer. Users should never wonder whether the shortcut registered.

### 5.2 The original app remains primary

VoiceToPromptV2 is an assistant to another application. The user's document, browser, editor, or chat box must remain the primary context. The overlay does not behave like a modal window.

### 5.3 One gesture should complete a turn

With auto-record enabled:

- Shortcut 1: begin recording.
- Shortcut 2: stop and process.

The user should not need to switch from keyboard to mouse.

### 5.4 Motion communicates state, not decoration

Motion is used to answer only three questions:

- Did recording begin?
- Is the app still working?
- Did the action succeed or fail?

No decorative looping gradients, floating particles, or gratuitous shimmer.

### 5.5 Success should get out of the way

If the result was inserted successfully, the user has already achieved the goal. The overlay should confirm briefly and leave.

### 5.6 Failure must always expose the next useful action

Error messages never end at “Something went wrong.” Each error category provides one direct recovery action when possible.

### 5.7 Expert controls are opt-in

Temperature, token limits, manual model identifiers, and similar implementation-level controls belong behind an Advanced disclosure.

---

## 6. Information architecture

VoiceToPromptV2 has three surfaces:

1. **Overlay** — transient, context-sensitive, used during a voice turn.
2. **Settings** — persistent control center.
3. **First-run onboarding** — a guided subset of Settings shown only until the app can complete its first turn.

The tray remains a launcher/status affordance and should not duplicate the full settings hierarchy.

---

# 7. Overlay specification

## 7.1 Core behavior

The overlay is a **dynamic floating utility**, not a fixed dialog.
Default placement remains near the pointer/current workspace, but it must be clamped to the active monitor and should prefer a position that does not cover the current pointer target.

### Target sizes

These are logical CSS sizes before platform scaling:

| State | Width | Typical height | Notes |
| --- | ---: | ---: | --- |
| Idle/manual start | 360 px | 112 px | Only when auto-record is disabled |
| Recording | 360 px | 96 px | Primary daily state |
| Processing | 360 px | 96 px | Same footprint as recording |
| Success, inserted | 360 px | 88–104 px | Auto-dismiss |
| Success, not inserted | 404 px | 180–260 px | Shows result and recovery |
| Error | 404 px | 160–240 px | Content-dependent, capped |

The native window should resize to match state rather than keeping a large empty 360×260 canvas.
When the size changes, position should be re-clamped to the same monitor so the card never grows off-screen.

## 7.2 Visual shell

The overlay shell should use:

- 16 px outer radius.
- 1 px low-contrast border.
- Deep near-black layered surface rather than pure black.
- Soft two-layer shadow, not a large generic `shadow-2xl`.
- Near-opaque background for reliability; the premium “glass” feeling comes from tonal layering and subtle internal highlights, not a dependency on fragile OS transparency.
- No permanent title bar.

Branding should be reduced to a small voice glyph/status indicator. “Voice to Prompt” does not need to be repeated in every turn.
A drag region may exist on unused shell space, but it must not increase visual chrome.

## 7.3 Recording state

### Layout

Left to right:

1. Recording orb / microphone status.
2. Live waveform/level strip.
3. Elapsed time.
4. Compact stop affordance only if pointer interaction is needed.

Secondary text below or integrated into the waveform area:

> `Ctrl+Shift+Space` để hoàn tất

The actual configured shortcut is rendered as platform-native keycaps, never as raw Tauri syntax.

### Voice visualization

Replace the current single scaling ring with an **8–12 bar smoothed voice meter**.
Requirements:

- Driven by the existing Rust level data.
- Apply frontend smoothing/interpolation so 4 Hz backend updates do not look stepped.
- Bars react with a short attack and slower decay.
- Avoid random motion when microphone level is zero.
- The live indicator remains visible even in silence.

Suggested behavior:

- Mic orb softly expands once when recording begins.
- Meter bars animate continuously from actual level.
- Recording dot uses a muted warm red semantic color; the overall product accent remains cool blue.

### Keyboard/focus semantics

In the default hotkey path, the overlay **does not receive focus**.
The same global shortcut toggles recording completion.
If a user intentionally clicks the overlay, the captured target application remains stored separately, so later insertion still goes to the original target.
Do not advertise `Enter` or `Esc` as universal controls when the overlay is intentionally not focused.

## 7.4 Idle/manual-start state

This state exists only if “Start recording immediately” is disabled.
Content:

- Quiet microphone icon.
- “Sẵn sàng ghi âm”.
- Primary button “Bắt đầu”.
- Hint that the configured global shortcut starts recording.

Pressing the global shortcut while the visible overlay is idle must start recording rather than reopening another idle state.

## 7.5 Processing state

The user does not benefit from separate visual “Uploading” and “Processing” screens. Backend phases may remain distinct for diagnostics, but the user-facing visual treatment is one calm state.

### Visual

- The live waveform contracts into a centered 3–5 bar processing mark.
- Animation speed is constant and subtle.
- Primary message: “Đang xử lý…” / localized equivalent.
- Do not use a generic large spinner as the main visual.

### Long-running thresholds

- `< 2.5 s`: only “Đang xử lý…”.
- `2.5–8 s`: secondary hint “Đang tạo nội dung từ giọng nói của bạn”.
- `> 8 s`: “Mất lâu hơn bình thường…” plus a genuine Cancel action.

Full-pipeline cancellation is required by this specification. During an incremental implementation, the Cancel control must stay hidden until that guarantee exists; the redesign is not release-ready until it does.

## 7.6 Success state

Success presentation depends on the outcome.

### Case A — inserted successfully

This is the dominant happy path.
Show a compact confirmation:

- Checkmark morph from the processing indicator.
- “Đã chèn”.
- Optional one-line faded preview, ellipsized.
- Auto-dismiss after approximately 1.4 s.

Do not force users to close a full result panel after every successful dictation.
If the pointer is deliberately interacting with the success card, dismissal may pause until interaction ends.

### Case B — copied but not inserted

The user's task is incomplete, so the overlay remains visible.
Show:

- Status: “Đã sao chép — chưa thể chèn tự động”.
- Up to ~5 lines of result preview.
- Primary recovery: “Dán thủ công”.
- Secondary actions: Copy again, Record again.

### Case C — neither inserted nor copied

Treat as a recoverable error, not a neutral success.

## 7.7 Error state

Errors use human language and an explicit category.
The visual hierarchy is:

1. Short title.
2. One-sentence explanation.
3. Primary recovery action.
4. Optional “Chi tiết” disclosure for technical error text.

Examples:

| Category | User title | Primary action |
| --- | --- | --- |
| Microphone unavailable | Không thể dùng micro | Chọn micro khác |
| Mic permission | Cần quyền dùng micro | Mở cài đặt hệ thống |
| Missing API key | Chưa kết nối Gemini | Thiết lập API key |
| Invalid/expired API key | API key không hợp lệ | Cập nhật API key |
| Network | Không có kết nối ổn định | Thử lại |
| Invalid model | Model hiện tại không khả dụng | Chọn model |
| Insertion | Không thể chèn vào ứng dụng | Copy kết quả |
| Shortcut conflict | Phím tắt đang được sử dụng | Đổi phím tắt |

Raw Rust/HTTP errors are never displayed as the primary message.

## 7.8 Overlay transitions

Target timings:

- Initial appearance: 120–160 ms opacity + 4 px scale/translate settle.
- Recording → processing: 160–220 ms meter morph.
- Processing → success: 180–240 ms checkmark transition.
- Error appearance: 160 ms fade/height expansion; no shake animation.
- Auto-dismiss: 120–160 ms fade/scale down.

All geometry animation must avoid visible native-window tearing. If native resizing cannot animate cleanly, resize the native window immediately and animate only the inner surface.
`prefers-reduced-motion` disables scaling/morph motion and retains simple fades under 120 ms.

---

# 8. Session and focus behavior — UX correctness contract

This section is mandatory even though much of it lives in Rust. The new UI cannot be considered correct unless these guarantees hold.

## 8.1 Capture target before showing UI

On global shortcut activation:

1. Capture foreground target/caret-owner identity.
2. Create a new session ID.
3. Store target in that session.
4. Show/reposition overlay without activation.
5. Start audio if configured.

The target must not be inferred later from “previous focus”.

## 8.2 Full-lifecycle single flight

One session remains active through:
`starting → recording → encoding → requesting → inserting → terminal`
A session is not removed from the single-flight guard when microphone capture ends.
Behavior for global shortcut while active:

| Current phase | Shortcut action |
| --- | --- |
| Recording | Stop and process |
| Processing | No second session; provide subtle acknowledgement |
| Success/error terminal | Start a fresh session |
| Idle/manual | Start recording |

## 8.3 Real cancellation

Every session owns a cancellation token / generation identifier.
When Cancel is invoked:

- Stop recording if active.
- Abort or logically cancel the network request.
- Prevent clipboard writes from that session.
- Prevent focus restoration/insertion from that session.
- Prevent success UI from that session.
- Mark/clear lifecycle deterministically.

Even if a network library cannot physically abort immediately, a cancelled session must check cancellation before every external side effect.

## 8.4 Stale event protection

All overlay state events should carry `session_id`.
The frontend ignores events belonging to an older session. This prevents late network responses from overwriting a newer recording UI.

## 8.5 Focus restoration

Restore/insert only into the target captured for the same session.
If the target is no longer valid:

- Do not guess another foreground application.
- Keep/copy the result according to settings.
- Show the non-inserted recovery state.

---

# 9. Settings redesign

## 9.1 Window architecture

Replace the six horizontal tabs with a **persistent left sidebar** and one scrollable content region.
Recommended window defaults:

- Width: ~860 px.
- Height: ~640 px.
- Min width: ~760 px.
- Min height: ~560 px.
- Sidebar: 176–192 px.
- Content column: max ~560 px for readable setting rows.

The screen should feel like a native preferences window, not a web dashboard.

## 9.2 Navigation

Recommended sections:

1. **Tổng quan / General**
2. **Giọng nói / Voice**
3. **AI & Prompt**
4. **Phím tắt / Shortcut**
5. **Đầu ra / Output**
6. **Lịch sử / History**

Advanced model-generation controls live inside AI & Prompt under an Advanced disclosure rather than becoming a separate top-level tab.

## 9.3 General / Overview

The first screen answers “Is my app ready?”
Top status card:

- Gemini: Connected / Needs setup.
- Microphone: selected device.
- Shortcut: rendered keycaps.
- Output: Auto insert on/off.

Below that:

- Start recording immediately toggle.
- UI language.
- Small “Try VoiceToPrompt” button that opens a test recording.

No technical identifiers are shown unless the user requests details.

## 9.4 Settings persistence model

Remove the global **Save** button.
Settings use coherent auto-save behavior:

- Switches/selects: save immediately.
- Text areas/numeric inputs: save after ~350–500 ms debounce or on blur.
- Shortcut: commit only after successful validation/registration.
- API key: explicit “Connect”/“Replace” action because it is a credential operation.

Header/footer shows a subtle persistence status when needed:

- “Đang lưu…”
- “Đã lưu” briefly.
- “Không thể lưu” with Retry on failure.

Frontend writes must be serialized or backend must support atomic partial setting updates so rapid changes cannot race and overwrite newer values.

## 9.5 Voice section

### Microphone picker

Display device names as a normal selector with:

- “Mặc định hệ thống” first.
- Selected device.
- Default badge where relevant.
- Refresh action if devices change.

### Microphone test

Add a compact live level test.
Behavior:

- Click “Kiểm tra micro”.
- Show a short live meter for a few seconds or until Stop.
- No audio is uploaded.
- Clearly show “Đang nhận âm thanh” when signal is detected.

This should reuse recorder infrastructure without creating a Gemini session.

### Recording behavior

“Bắt đầu ghi âm ngay khi mở overlay” remains available, with plain-language explanation.

## 9.6 AI & Prompt section

### Gemini connection card

When no key exists:

- Product explanation in one sentence.
- Password input.
- “Kết nối Gemini” primary action.
- Link/button to open Google AI Studio key page.
- Security note: stored in OS credential manager.

When connected:

- Green status dot + “Đã kết nối”.
- Replace key action.
- Disconnect action under secondary/destructive menu, not beside the primary model control.

Do not leave an empty password field permanently visible after connection.

### Model selector

After a valid key is present, model list loads automatically.
Display:

- Friendly display name as primary label.
- Model ID as smaller secondary text when needed.
- Optional compact description in selection menu.

Manual model ID entry moves into Advanced.

### System prompt

Use a dedicated editor card:

- Label: “Hướng dẫn cho AI”.
- Clear description of its effect.
- 6–8 line textarea.
- “Khôi phục mặc định” action.
- No resize handle unless it behaves cleanly inside the settings window.

### Response language

Use localized names and explain Auto as “Theo ngôn ngữ bạn nói”.

### Advanced generation controls

Collapsed by default:

- Temperature with human labels (`Chính xác` ↔ `Sáng tạo`) plus numeric detail.
- Max output tokens.
- Manual model ID override if needed.

These controls must not dominate the section.

## 9.7 Shortcut section

Replace the raw text field with a **shortcut recorder**.
Default appearance:
`[ Ctrl ] + [ Shift ] + [ Space ]`   `Thay đổi`
When recording:

- Card receives deliberate input focus.
- Text: “Nhấn tổ hợp phím mới…”.
- Captures modifiers + non-modifier key.
- Escape cancels shortcut capture only because this field intentionally owns focus.
- Prevent invalid single-modifier combinations.

Before replacing the active shortcut:

1. Canonicalize to backend format.
2. Validate parser.
3. Attempt registration atomically.
4. Only then persist and update displayed shortcut.

If registration fails, keep the previous shortcut active and show a clear conflict message.
Common-conflict hints should be platform-specific. Existing users keep their configured shortcut; safer defaults apply only to fresh installs.

## 9.8 Output section

Use setting rows with label, description, and trailing switch.
Rows:

- Chèn kết quả tự động.
- Giữ kết quả trong clipboard.
- Lưu lịch sử cục bộ.

If automatic insertion is disabled, success state should not claim insertion.
If clipboard retention is disabled, explain that insertion failure may require clicking Copy manually.

## 9.9 History section

History becomes a first-class list rather than plain bordered cards.
Each row shows:

- Relative/localized time.
- One-to-three-line response preview.
- Recording duration.
- Copy action on hover/focus.
- Model metadata only as secondary detail.

Add lightweight local search/filter if history volume justifies it; do not add remote indexing.
Empty state:

- Small history icon.
- “Chưa có nội dung nào”.
- One sentence explaining that successful results appear here.

Clear History requires a confirmation because it is destructive and irreversible.

---

# 10. First-run onboarding

First run should no longer dump the user into the full Settings window with no guidance.
Use a focused onboarding surface inside the same settings application.

## Step 1 — Connect AI

- Short product value statement.
- Gemini API key input.
- Link to obtain a key.
- Explain credential-store security in one line.
- Validate connection before proceeding.

## Step 2 — Microphone

- Select microphone.
- Show a live level test.
- Surface permission/device issues inline.

## Step 3 — Shortcut and output

- Show current shortcut as keycaps.
- Allow shortcut capture.
- Explain “Press once to record, press again to finish.”
- Auto-insert enabled by default.

Final CTA: **“Thử ngay”**.
It starts a real test turn while keeping onboarding recoverable if the first attempt fails.
The onboarding completion flag should not be set merely because the window was closed. It is complete once the required configuration is valid; users may skip optional microphone testing but not the API connection requirement if Gemini is the only provider.

---

# 11. Visual design system

## 11.1 Aesthetic

The visual system is dark-first, quiet, and tactile.
Avoid:

- Pure `#000` as the only background.
- Excessive neon glow.
- Heavy gradients.
- Large dashboard cards for simple setting rows.
- Strong outlines around every element.
- Web-app-like tab pills everywhere.

Prefer:

- Tonal surface separation.
- Hairline borders.
- Soft shadows.
- Crisp typography.
- Rounded geometry with disciplined radius tiers.
- One primary accent plus semantic status colors.

## 11.2 Color tokens

Exact production values should be tuned in OKLCH for contrast, but the semantic system is:

- `background`: deep neutral near-black.
- `surface-1`: slightly raised neutral.
- `surface-2`: hover/selected surface.
- `text-primary`: near-white, not pure white.
- `text-secondary`: high enough contrast for body help text.
- `text-tertiary`: metadata only.
- `accent`: cool luminous blue.
- `recording`: warm red/coral semantic indicator.
- `success`: restrained green.
- `warning`: amber.
- `destructive`: red distinct from recording state.

The current muted foreground is too dim for important explanatory copy; body help text must meet WCAG AA contrast against its surface.

## 11.3 Radius scale

- Small controls: 8 px.
- Inputs/buttons: 10 px.
- Cards/sections: 12–14 px.
- Overlay shell: 16 px.
- Circular status controls: full radius.

Do not use one radius value for every component.

## 11.4 Spacing scale

Base 4 px grid:
`4 / 8 / 12 / 16 / 20 / 24 / 32`
Settings sections should use 24–32 px separation; setting rows should generally use 12–16 px internal spacing.

## 11.5 Typography

Continue using native/system fonts first:

- Windows: Segoe UI Variable.
- macOS: SF Pro system fallback.

Do not ship custom font files solely for visual resemblance.
Hierarchy:

- Window title: 15–16 px semibold.
- Section title: 14–15 px semibold.
- Setting label: 13–14 px medium/semibold.
- Body/helper: 12–13 px regular.
- Metadata: 11–12 px.
- Overlay timer: 20–22 px tabular numerals.

Avoid excessive bold text.

## 11.6 Iconography

Continue with Lucide for bundle consistency, but standardize:

- 14–16 px in settings rows.
- 16–18 px for primary actions.
- 20–22 px for empty states/status moments.
- Stroke weight appears consistent; avoid mixing oversized icons with tiny text.

---

# 12. Motion system

Define shared motion tokens rather than per-component arbitrary durations.

| Token | Duration | Purpose |
| --- | ---: | --- |
| `motion-instant` | 80–100 ms | pressed/hover state |
| `motion-fast` | 120–160 ms | tooltip, button, small fade |
| `motion-standard` | 180–220 ms | panel/state transition |
| `motion-emphasis` | 260–320 ms | one-time recording/success morph |

Easing:

- Standard transitions: smooth cubic out.
- State entry: gentle spring-like curve without overshoot larger than ~2–3%.
- Exit: faster than entry.

Rules:

- Never animate layout in a way that delays interaction.
- No bounce on errors.
- No animation longer than ~350 ms in the critical voice path.
- Respect reduced-motion preference.

---

# 13. Localization

The current mixed English/Vietnamese UI is not acceptable for the redesign.
Implement a lightweight localization layer with at least:

- Vietnamese (`vi`).
- English (`en`).

Default locale follows the OS/application locale. Users can override it in General.
The existing `language` setting remains the **AI response language** and must not be confused with UI locale.
All user-facing Rust errors should be converted into typed error codes/data; translation happens at the presentation layer whenever possible. Technical detail may remain in English inside an explicitly expanded diagnostics section.

---

# 14. Accessibility and input quality

## 14.1 Contrast

- Body and control labels meet WCAG AA.
- Placeholder text is never the only label.
- Selected/active states do not rely only on color.

## 14.2 Focus

- Every interactive Settings control has a visible keyboard focus ring.
- Focus rings are subtle but clearly visible on dark surfaces.
- Overlay does not force focus during normal hotkey activation.

## 14.3 Targets

- Primary buttons: minimum ~34–36 px height.
- Icon-only actions: minimum 30–32 px clickable area.
- Destructive actions have text labels or tooltips and confirmation where irreversible.

## 14.4 Screen readers

- Recording meter has a textual accessible state; individual bars are decorative.
- Status changes use appropriate live-region behavior without announcing every 250 ms level update.
- Icon-only actions have accessible names.

## 14.5 Reduced motion

Honor `prefers-reduced-motion`; replace waveform interpolation/morph emphasis with simpler state changes while retaining meaningful level indication.

---

# 15. Error and recovery architecture

Do not send arbitrary strings as the only error contract.
Introduce typed frontend-facing error information such as:

```text
code: microphone_permission | microphone_device | missing_api_key |
      invalid_api_key | network | model_unavailable | shortcut_conflict |
      insertion_failed | clipboard_failed | unknown
recoverable: boolean
detail?: string
```

The UI maps each code to localized title, description, and action.
Unknown errors use:

- Friendly generic title.
- Retry when safe.
- “Chi tiết” disclosure with the original technical message.

This gives the UI stable behavior while preserving diagnostics.

---

# 16. Frontend component architecture

The current `settings.tsx` is large and mixes state, effects, API operations, layout, and every settings section. The redesign should split by responsibility without creating excessive abstraction.
Recommended structure:

```text
src/
  app/
    SettingsApp.tsx
    OverlayApp.tsx
  features/
    overlay/
      OverlayShell.tsx
      RecordingState.tsx
      ProcessingState.tsx
      SuccessState.tsx
      ErrorState.tsx
      VoiceMeter.tsx
      useOverlaySession.ts
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
      useSettingsStore.ts
      useAutosaveSettings.ts
  components/
    ui/                  # existing low-level shadcn/Radix primitives
    setting-row.tsx
    section-card.tsx
    status-badge.tsx
    shortcut-key.tsx
    inline-notice.tsx
  styles/
    tokens.css
    motion.css
  lib/
    i18n.ts
    overlay.ts
    settings.ts
    types.ts
```

Principles:

- Low-level UI primitives remain generic.
- Feature components own feature semantics.
- Tauri IPC wrappers remain in `lib`.
- State transitions are testable without rendering the entire app.
- Avoid a giant global state library; React state/hooks are enough for this app.

---

# 17. Backend changes required by the UX

These are not general backend rewrites. Each item exists because the new interaction contract requires it.

## Required

1. Capture insertion target before overlay activation.
2. Remove unconditional overlay focus from default shortcut flow.
3. Keep one session active across recording + request + insertion.
4. Add full-pipeline cancellation semantics.
5. Attach session IDs to overlay state events.
6. Prevent stale session events/side effects.
7. Expose stable error codes/categories to frontend.
8. Provide atomic shortcut validation/registration behavior.
9. Support native-window resizing/repositioning per overlay state.
10. Support microphone test mode or equivalent live-level preview without Gemini upload.
11. Honor history-disabled state by not persisting new history entries.
12. Only use clipboard paste fallback when the current session result is known to be on the clipboard.
13. Route user-triggered clipboard copy actions through one reliable application clipboard API with explicit success/failure.

## Recommended

14. Expose platform information for shortcut key rendering and conflict hints.
15. Expose permission/status helpers where platform APIs permit reliable checks.
16. Add a command to open the API-key acquisition URL using the existing opener capability.

---

# 18. Tray behavior

Keep tray behavior minimal:

- Start recording / open overlay, with current shortcut shown.
- Settings.
- History.
- Quit.

Copy should use the selected UI locale.
If the active voice session is processing, the tray start action should not create a second session.
The tray is not a substitute for onboarding or error recovery.

---

# 19. Performance budgets

The premium feeling depends on latency as much as visuals.
Targets on a typical supported desktop:

- Shortcut → visible acknowledgement: ideally ≤ 100 ms.
- Shortcut → microphone recording active: ideally ≤ 250 ms after warm app startup.
- UI rendering should not poll Rust for session state.
- Level updates remain event-driven.
- Overlay JS should remain small; do not add animation libraries unless CSS/React cannot meet the interaction reliably.
- Settings may be larger, but avoid expensive effects on initial render.
- No animation may block recording start or text insertion.

These are UX budgets, not hard guarantees for every machine/network.

---

# 20. Testing strategy

## 20.1 Pure logic tests

Add tests for:

- Overlay lifecycle/state reducer.
- Stale `session_id` rejection.
- Auto-dismiss eligibility.
- Error-code → recovery-action mapping.
- Shortcut capture/canonicalization.
- Settings autosave serialization/debounce logic.
- Locale fallback.

## 20.2 Rust lifecycle tests

Extract enough session lifecycle logic to test without real audio/network where possible.
Required scenarios:

- Cannot start session B while session A is requesting.
- Cancelled session never reaches insertion side effect.
- Old session completion cannot overwrite a new session.
- Target is captured before overlay show path.
- Invalid shortcut does not unregister/persist over the last working shortcut.

## 20.3 Component tests

Test each overlay state independently with mocked payloads:

- Idle.
- Recording low/high level.
- Processing normal/long-running.
- Inserted success.
- Copied-only success.
- Each primary error category.

Settings tests cover sidebar navigation, key connection states, shortcut recording, advanced disclosure, autosave status, and History empty/non-empty states.

## 20.4 Manual native smoke matrix

Some behavior must be tested in real desktop applications.
At minimum on Windows:

- Notepad.
- Browser text field.
- VS Code/editor.
- Terminal.
- An elevated app to exercise insertion fallback.
- Multi-monitor with different scaling if available.

Verify:

- Original target receives text.
- Overlay does not steal focus on hotkey open.
- Clicking overlay does not lose stored target.
- Cancel during processing causes no later paste.
- Repeated shortcut during processing does not create duplicate sessions.
- Overlay remains fully visible near screen edges.

macOS builds should additionally verify microphone and Accessibility permission recovery, Spotlight/shortcut conflicts, and focus behavior.

## 20.5 Quality gates

Before the redesign is considered release-ready:

- `npm run build` passes.
- Rust formatter/check/tests pass.
- No raw placeholder/TODO copy appears in production UI.
- No mixed UI locales on one screen.
- Keyboard traversal works throughout Settings.
- Reduced-motion mode is usable.
- Contrast review passes for text/control states.
- Native smoke matrix passes for target focus, cancellation, and single-flight lifecycle.

---

# 21. Acceptance criteria

The redesign is accepted only when all of the following are true.

## Core voice flow

- Opening via global shortcut does not steal focus in the default auto-record path.
- The app captures the insertion target before showing/focusing any VoiceToPrompt window.
- Recording feedback appears immediately and visibly reacts to microphone level.
- Pressing the configured global shortcut again stops recording and begins processing.
- Processing cannot create overlapping voice sessions.
- Cancelling a session guarantees no later paste/copy from that session.
- Successful auto-insertion produces a compact confirmation and auto-dismisses.
- Failed insertion produces actionable recovery rather than a misleading generic success.
- Clipboard fallback can never paste unrelated pre-existing clipboard contents.
- Stale backend events cannot overwrite the currently active overlay session.

## Settings

- No raw Tauri accelerator syntax is required from the user.
- The sidebar hierarchy replaces crowded horizontal tabs.
- Primary settings are visible; expert Gemini controls are progressively disclosed.
- There is no ambiguous global Save model; persistence state is coherent.
- API key connection state is clear without permanently exposing a password input.
- Microphone can be selected and tested.
- Shortcut replacement is validated atomically and preserves the old shortcut on failure.
- History empty/non-empty/destructive-clear states are polished and clear.
- Disabling history prevents new history entries from being persisted.

## Visual quality

- Dark-first token system is used consistently across overlay and Settings.
- Typography, radius, spacing, shadows, and motion use shared tokens.
- Overlay dimensions adapt to state.
- No generic oversized spinner is the primary processing experience.
- Motion respects reduced-motion preferences.
- Body/help text contrast meets accessibility requirements.

## Localization

- UI never mixes Vietnamese and English unintentionally.
- At least `vi` and `en` are supported.
- AI response language is separate from UI language.

## Reliability

- Frontend production build passes.
- Rust check/tests pass.
- Focus/cancel/single-flight native smoke tests pass.
- Copy-disabled + direct-insertion-failure never pastes stale clipboard content.
- History-disabled mode creates no new persisted history entry.

---

# 22. Implementation boundaries

This specification should be implemented as one coordinated redesign, but in a safe order:

1. **UX correctness foundation** — focus capture, lifecycle, cancellation, session IDs.
2. **Design tokens and component structure** — establish shared primitives before redesigning screens.
3. **Overlay redesign** — highest-frequency interaction first.
4. **Settings shell + autosave model**.
5. **Individual settings sections + shortcut recorder + mic test**.
6. **Onboarding**.
7. **Localization and error taxonomy completion**.
8. **Native smoke testing and polish pass**.

Implementation must not begin by merely restyling the current JSX while leaving focus/session contradictions intact. Visual polish without lifecycle correctness would make the product feel more trustworthy than it actually is, which is worse than the current state.

---

# 23. Definition of “10/10” for VoiceToPromptV2

A 10/10 version is not the version with the most visual effects. It is the version in which the user stops noticing the app itself.
The intended emotional sequence is:

- **Shortcut:** immediate certainty.
- **Recording:** calm confidence that the app hears them.
- **Processing:** clear progress without anxiety.
- **Insertion:** no context switch and no wrong target.
- **Success:** one quiet confirmation, then disappearance.
- **Failure:** one understandable reason and one obvious next action.
- **Settings:** simple by default, powerful when deliberately explored.

If any visual decision competes with speed, correctness, or clarity, it should be removed.

---

# 24. Design decisions locked by this spec

The following decisions are intentionally fixed so implementation does not drift:

- Product mode: **Hybrid**.
- Visual personality: **premium native utility inspired by Apple interaction principles**, not a clone of Apple UI.
- Theme: **Dark-first**.
- Daily overlay: **compact, state-sized, non-modal**.
- Default interaction: **same global shortcut starts and finishes recording**.
- Normal shortcut flow: **does not steal focus**.
- Settings navigation: **left sidebar**.
- Settings persistence: **auto-save**, except explicit credential/shortcut commit operations.
- Shortcut configuration: **key capture**, never raw syntax as the primary UI.
- Success after insertion: **compact + auto-dismiss**.
- Processing: **custom calm state indicator**, not a generic large spinner.
- Error handling: **typed categories + actionable localized recovery**.
- Localization: **Vietnamese + English minimum; no mixed locale**.
- Advanced Gemini parameters: **progressive disclosure**.
- Full session lifecycle: **single-flight and cancellable**.
- Stale events: **protected by session ID**.
- UI reliability: **near-opaque tonal surfaces preferred over fragile transparency tricks**.
