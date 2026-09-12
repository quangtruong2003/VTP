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
  shortcut_mode: "toggle" | "hold";
  process_shortcut: string;
  cancel_shortcut: string;
  history_shortcut?: string;
  settings_shortcut?: string;
  copy_to_clipboard: boolean;
  paste_automatically: boolean;
  device_name: string | null;
  show_history: boolean;
  ui_locale: "system" | "vi" | "en";
  fallback_models?: string[];
  prompt_profile_id?: string;
  prompt_profiles?: PromptProfile[];
  start_with_windows?: boolean;
}

export interface PromptProfile {
  id: string;
  name: string;
  prompt: string;
}

export interface OverlayProfile {
  id: string;
  name: string;
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

export interface ApiKeySlot {
  index: number;
  is_primary: boolean;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
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

export type OutputOutcome = "inserted" | "copied" | "preview";

export type RecordingHealth = "healthy" | "silent" | "warning";
export type RecordingWarning =
  | "default_microphone"
  | "selected_microphone_unavailable"
  | "audio_queue_overflow"
  | "long_recording";
export type ProcessingStatus = "encoding" | "requesting" | "fallback" | "long_running";

export type OverlayState =
  | { phase: "idle" }
  | { phase: "opening"; device_name: string | null }
  | { phase: "recording"; elapsed_ms: number; level: number; health?: RecordingHealth; warning?: RecordingWarning | null }
  | { phase: "paused"; elapsed_ms: number }
  | { phase: "uploading" }
  | { phase: "processing"; status?: ProcessingStatus; model?: string | null; attempt?: number; total_attempts?: number }
  | { phase: "success"; text: string; pasted: boolean; copied: boolean; output: OutputOutcome; profile?: OverlayProfile | null }
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

/** Event names emitted by the Rust backend. */
export const RUST_EVENTS = {
  overlayState: "overlay://state",
  overlayDismiss: "overlay://dismiss",
  settingsSaved: "settings://saved",
  settingsMicLevel: "settings://mic-level",
  historyChanged: "history://changed",
  settingsSection: "app://settings-section",
} as const;
