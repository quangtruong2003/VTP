/**
 * Shared type contract between the Rust backend and the frontend.
 *
 * Every struct here mirrors a serde type in src-tauri/src/types.rs or the
 * payload of a Tauri event. Keep both sides in sync when changing anything.
 */

export interface AppSettings {
  api_key_set: boolean;
  model: string;
  system_prompt: string;
  temperature: number;
  max_output_tokens: number;
  language: string;
  shortcut: string;
  process_shortcut: string;
  cancel_shortcut: string;
  copy_to_clipboard: boolean;
  paste_automatically: boolean;
  device_name: string | null;
  show_history: boolean;
  start_recording_on_open: boolean;
  ui_locale: "system" | "vi" | "en";
  fallback_models?: string[];
}

export interface PublicSettings extends AppSettings {
  api_key_set: boolean;
}

export interface HistoryEntry {
  id: string;
  created_at: string;
  duration_ms: number;
  transcript_hint: string;
  response_text: string;
  model: string;
  status: "success" | "error";
  error_message: string | null;
}

export interface GeminiModelInfo {
  name: string;
  display_name: string;
  description: string;
  input_token_limit: number | null;
}

export interface AudioDeviceInfo {
  name: string;
  is_default: boolean;
}

export interface MicLevelPayload {
  level: number;
}

export interface PlatformInfo {
  os: string;
  primary_modifier: string;
}

export type ErrorCode =
  | "microphone_permission"
  | "microphone_device"
  | "missing_api_key"
  | "invalid_api_key"
  | "network"
  | "model_unavailable"
  | "shortcut_conflict"
  | "insertion_failed"
  | "clipboard_failed"
  | "unknown";

export interface FrontendError {
  code: ErrorCode;
  recoverable: boolean;
  detail?: string | null;
}

export type OverlayState =
  | { phase: "idle" }
  | { phase: "recording"; elapsed_ms: number; level: number }
  | { phase: "paused"; elapsed_ms: number }
  | { phase: "uploading" }
  | { phase: "processing" }
  | { phase: "success"; text: string; pasted: boolean; copied: boolean }
  | { phase: "error"; error: FrontendError }
  | { phase: "info"; message: string };

export type OverlayEvent = { session_id: number } & OverlayState;
export interface OverlayDismissEvent {
  session_id: number;
}

export type OverlayLifecycle = "hidden" | "visible" | "exiting";

export interface OverlayViewModel {
  sessionId: number;
  state: OverlayState;
  lifecycle: OverlayLifecycle;
  dismissedSessionId: number;
  processingElapsedMs: number;
  showLongProcessingHint: boolean;
  showCancel: boolean;
  autoDismissEligible: boolean;
}

export type ToastMessage =
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

/** Overlay-specific commands (window label "overlay"). */
export interface OverlayApi {
  overlayStopRecording: () => Promise<boolean>;
  overlayCancel: () => Promise<void>;
  overlayCopyResult: () => Promise<void>;
  overlayCopyInsertResult: () => Promise<void>;
  overlayRetry: () => Promise<void>;
}

/** Event names emitted by the Rust backend. */
export const RUST_EVENTS = {
  overlayState: "overlay://state",
  overlayDismiss: "overlay://dismiss",
  overlayToast: "overlay://toast",
  settingsSaved: "settings://saved",
  settingsMicLevel: "settings://mic-level",
  settingsToast: "settings://toast",
  historyChanged: "history://changed",
  shortcutChanged: "shortcut://changed",
  settingsSection: "app://settings-section",
} as const;
