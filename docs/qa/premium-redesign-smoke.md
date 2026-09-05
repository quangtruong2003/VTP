# Premium Redesign Release Smoke Matrix

Date: 2026-09-05
Platform target: Windows desktop

## Status

Automated gates and source regression scans were executed in the current workspace. The native end-to-end matrix below requires a real microphone, a working Gemini credential, target applications with editable fields, an elevated target, and a mixed-scaling multi-monitor setup. Those prerequisites were not all available and validated in this run.

**Manual native status: NOT VERIFIED IN CURRENT ENVIRONMENT**

Unchecked boxes below are intentionally not marked PASS. They must be completed on a release-candidate Windows machine before treating native trust/polish smoke as manually verified.

## Automated release evidence

- [x] `npm test` — 13 test files, 36 tests passed, 0 failed.
- [x] `npm run build` — exit code 0.
- [x] `cargo fmt -- --check` — exit code 0.
- [x] `cargo check` — exit code 0.
- [x] `cargo test` — 14 tests passed, 0 failed.
- [x] Regression scan for `navigator\.clipboard|Enter =|Esc =|Tauri accelerator|TODO|TBD` in `src` and `src-tauri/src` — no matches.
- [x] Regression scan for `Loader2` in `src/features/overlay` — no matches.

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

**NOT VERIFIED IN CURRENT ENVIRONMENT**

No temporary performance instrumentation was added. On a warm release-candidate app, measure shortcut-handler entry to visible overlay acknowledgement and recording-active state only if launch responsiveness is in question. Targets from the implementation plan are ideally <=100 ms for visible acknowledgement and <=250 ms for recording active. Remove any temporary timestamp logging after measurement.

## Release sign-off

Automated gates and static regression scans are PASS in this workspace. Native trust/polish, accessibility, localization, reduced-motion, and performance checks remain explicitly **NOT VERIFIED IN CURRENT ENVIRONMENT** until the unchecked release-candidate matrix above is executed on suitable Windows hardware and applications.
