import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { OverlayDismissEvent, OverlayEvent } from "@/lib/types";
import { RUST_EVENTS } from "@/lib/types";

/** Overlay-specific backend commands (window label "overlay"). */
export const overlayApi = {
  toggle: () => invoke<void>("overlay_toggle"),
  startRecording: () => invoke<void>("overlay_start_recording"),
  togglePause: () => invoke<void>("overlay_toggle_pause"),
  processRecording: () => invoke<void>("overlay_process_recording"),
  cancel: () => invoke<void>("overlay_cancel"),
  retry: () => invoke<void>("overlay_retry"),
  hide: () => invoke<void>("overlay_hide"),
  openSettings: () => invoke<void>("open_settings"),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
};

/** Subscribe to backend overlay state pushes; returns an unlisten fn. */
export async function onOverlayState(cb: (event: OverlayEvent) => void) {
  return listen<OverlayEvent>(RUST_EVENTS.overlayState, (e) => cb(e.payload));
}

/** Request a visual exit after backend cancellation has already been marked. */
export async function onOverlayDismiss(cb: (event: OverlayDismissEvent) => void) {
  return listen<OverlayDismissEvent>(RUST_EVENTS.overlayDismiss, (e) => cb(e.payload));
}
