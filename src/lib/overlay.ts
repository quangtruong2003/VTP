import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ErrorCode, FrontendError, OverlayDismissEvent, OverlayEvent } from "@/lib/types";
import { RUST_EVENTS } from "@/lib/types";

/** Overlay-specific backend commands (window label "overlay"). */
export const overlayApi = {
  getSnapshot: () => invoke<OverlayEvent | null>("overlay_session_snapshot"),
  toggle: () => invoke<void>("overlay_toggle"),
  startRecording: () => invoke<void>("overlay_start_recording"),
  togglePause: () => invoke<void>("overlay_toggle_pause"),
  processRecording: () => invoke<void>("overlay_process_recording"),
  cancel: () => invoke<void>("overlay_cancel"),
  reprocessAudio: () => invoke<void>("overlay_reprocess_audio"),
  retryInsertion: (text?: string) =>
    invoke<void>("overlay_retry_insertion", text === undefined ? undefined : { text }),
  copyLastResult: () => invoke<void>("overlay_copy_last_result"),
  startNewRecording: () => invoke<void>("overlay_start_new_recording"),
  hide: () => invoke<void>("overlay_hide"),
  openSettings: (section?: string) =>
    invoke<void>("open_settings", { section: section ?? null }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  insertResult: (text: string) => invoke<void>("overlay_insert_result", { text }),
};

const ERROR_CODES = new Set<ErrorCode>([
  "microphone_permission",
  "microphone_device",
  "missing_api_key",
  "invalid_api_key",
  "network",
  "model_unavailable",
  "shortcut_conflict",
  "insertion_failed",
  "clipboard_failed",
  "unknown",
]);

export function frontendErrorFromRejection(error: unknown): FrontendError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<FrontendError>;
    if (typeof candidate.code === "string" && ERROR_CODES.has(candidate.code as ErrorCode)) {
      return {
        code: candidate.code as ErrorCode,
        recoverable: candidate.recoverable !== false,
        detail: candidate.detail ?? null,
      };
    }
  }

  return {
    code: "unknown",
    recoverable: true,
    detail: error instanceof Error ? error.message : String(error),
  };
}

/** Subscribe to backend overlay state pushes; returns an unlisten fn. */
export async function onOverlayState(cb: (event: OverlayEvent) => void) {
  return listen<OverlayEvent>(RUST_EVENTS.overlayState, (e) => cb(e.payload));
}

/** Request a visual exit after backend cancellation has already been marked. */
export async function onOverlayDismiss(cb: (event: OverlayDismissEvent) => void) {
  return listen<OverlayDismissEvent>(RUST_EVENTS.overlayDismiss, (e) => cb(e.payload));
}
