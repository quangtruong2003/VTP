use serde::{Deserialize, Serialize};

pub type SessionId = u64;

fn default_ui_locale() -> String {
    "system".into()
}

fn default_process_shortcut() -> String {
    String::new()
}

fn default_shortcut_mode() -> String {
    "toggle".into()
}

fn default_cancel_shortcut() -> String {
    "Escape".into()
}

fn default_history_shortcut() -> String {
    "Alt+V".into()
}

fn default_settings_shortcut() -> String {
    "Alt+S".into()
}

fn default_prompt_profile_id() -> String {
    "natural".into()
}

fn default_legacy_prompt_profile_id() -> String {
    String::new()
}

fn default_prompt_profiles() -> Vec<PromptProfile> {
    vec![
        PromptProfile { id: "raw".into(), name: "Raw".into(), prompt: "Return a faithful transcription with only obvious speech disfluencies removed.".into() },
        PromptProfile { id: "natural".into(), name: "Natural".into(), prompt: "Rewrite the transcript into clear, natural text while preserving the speaker's meaning and tone.".into() },
        PromptProfile { id: "email".into(), name: "Email".into(), prompt: "Turn the transcript into a concise, polished email message.".into() },
        PromptProfile { id: "summary".into(), name: "Summary".into(), prompt: "Summarize the transcript into concise key points.".into() },
        PromptProfile { id: "code".into(), name: "Code".into(), prompt: "Turn the transcript into clean code or a precise coding instruction, preserving technical details.".into() },
    ]
}

/// Settings persisted to settings.json. The API key is deliberately NOT
/// part of this struct — it lives exclusively in the OS credential store.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    pub model: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_output_tokens: u32,
    pub language: String,
    pub shortcut: String,
    #[serde(default = "default_shortcut_mode")]
    pub shortcut_mode: String,
    #[serde(default = "default_process_shortcut")]
    pub process_shortcut: String,
    #[serde(default = "default_cancel_shortcut")]
    pub cancel_shortcut: String,
    #[serde(default = "default_history_shortcut")]
    pub history_shortcut: String,
    #[serde(default = "default_settings_shortcut")]
    pub settings_shortcut: String,
    pub copy_to_clipboard: bool,
    pub paste_automatically: bool,
    pub device_name: Option<String>,
    pub show_history: bool,
    #[serde(default = "default_ui_locale")]
    pub ui_locale: String,
    #[serde(default)]
    pub fallback_models: Vec<String>,
    // An omitted profile id identifies settings written before profiles existed.
    // Keep those settings on their existing system prompt instead of silently
    // switching them to the new Natural preset during deserialization.
    #[serde(default = "default_legacy_prompt_profile_id")]
    pub prompt_profile_id: String,
    #[serde(default = "default_prompt_profiles")]
    pub prompt_profiles: Vec<PromptProfile>,
    #[serde(default)]
    pub start_with_windows: bool,
}

impl AppSettings {
    pub fn overlay_profile(&self) -> Option<OverlayProfile> {
        let id = self.prompt_profile_id.trim();
        if id.is_empty() || id == default_prompt_profile_id() {
            return None;
        }
        self.prompt_profiles
            .iter()
            .find(|profile| profile.id == id)
            .map(|profile| OverlayProfile {
                id: profile.id.clone(),
                name: profile.name.clone(),
            })
    }

    pub fn model_chain(&self) -> Vec<String> {
        let mut chain = Vec::new();
        let primary = self.model.trim();
        if !primary.is_empty() {
            chain.push(primary.to_string());
        }
        for fallback in &self.fallback_models {
            let m = fallback.trim();
            if !m.is_empty() && !chain.iter().any(|c| c == m) {
                chain.push(m.to_string());
            }
        }
        if chain.is_empty() {
            chain.push("gemini-2.0-flash".to_string());
        }
        chain
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            model: "gemini-2.0-flash".into(),
            system_prompt: "You are a helpful assistant. The user speaks to you and their speech is transcribed by the model. Respond with text that can be directly inserted into the application they were typing in. Be concise and match the user's language. Do not add markdown formatting unless asked.".into(),
            temperature: 0.7,
            max_output_tokens: 2048,
            language: "auto".into(),
            shortcut: "CmdOrCtrl+Shift+Space".into(),
            shortcut_mode: default_shortcut_mode(),
            process_shortcut: default_process_shortcut(),
            cancel_shortcut: default_cancel_shortcut(),
            history_shortcut: default_history_shortcut(),
            settings_shortcut: default_settings_shortcut(),
            copy_to_clipboard: true,
            paste_automatically: true,
            device_name: None,
            show_history: true,
            ui_locale: "system".into(),
            fallback_models: Vec::new(),
            prompt_profile_id: default_prompt_profile_id(),
            prompt_profiles: default_prompt_profiles(),
            start_with_windows: false,
        }
    }
}

/// What the frontend receives — includes a flag describing whether an API
/// key exists in the keyring, never the key itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PublicSettings {
    pub api_key_set: bool,
    #[serde(flatten)]
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: String,
    pub duration_ms: u64,
    pub transcript_hint: String,
    pub response_text: String,
    pub model: String,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeminiResult {
    pub transcript: String,
    pub result: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct PromptProfile {
    pub id: String,
    pub name: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct OverlayProfile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiModelInfo {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub input_token_limit: Option<u64>,
}

/// Key slot for the frontend list. Never carries key material — the index
/// plus primary flag is all the UI needs to manage the ordered keychain.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiKeySlot {
    pub index: usize,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MicLevelPayload {
    pub level: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub primary_modifier: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    #[allow(dead_code)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FrontendError {
    pub code: ErrorCode,
    pub recoverable: bool,
    pub detail: Option<String>,
}

/// States pushed to the overlay window via `overlay://state`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingHealth {
    Healthy,
    Silent,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingWarning {
    DefaultMicrophone,
    SelectedMicrophoneUnavailable,
    AudioQueueOverflow,
    LongRecording,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessingStatus {
    Encoding,
    Requesting,
    Fallback,
    LongRunning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputOutcome {
    Inserted,
    Copied,
    Preview,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum OverlayPhase {
    #[allow(dead_code)]
    Idle,
    Opening {
        device_name: Option<String>,
    },
    Recording {
        elapsed_ms: u64,
        level: u8,
        health: RecordingHealth,
        warning: Option<RecordingWarning>,
    },
    Paused {
        elapsed_ms: u64,
    },
    #[allow(dead_code)]
    Uploading,
    Processing {
        status: ProcessingStatus,
        model: Option<String>,
        attempt: usize,
        total_attempts: usize,
    },
    Success {
        text: String,
        pasted: bool,
        copied: bool,
        output: OutputOutcome,
        profile: Option<OverlayProfile>,
    },
    Error {
        error: FrontendError,
    },
    Info {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct OverlayEvent {
    pub session_id: SessionId,
    #[serde(flatten)]
    pub state: OverlayPhase,
}

#[derive(Debug, Clone, Serialize)]
pub struct OverlayDismissEvent {
    pub session_id: SessionId,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_opening_and_processing_progress_use_stable_shared_tags() {
        let opening = serde_json::to_value(OverlayPhase::Opening {
            device_name: Some("Studio Mic".into()),
        })
        .unwrap();
        assert_eq!(opening["phase"], "opening");
        assert_eq!(opening["device_name"], "Studio Mic");

        let fallback = serde_json::to_value(OverlayPhase::Processing {
            status: ProcessingStatus::Fallback,
            model: Some("gemini-fallback".into()),
            attempt: 2,
            total_attempts: 3,
        })
        .unwrap();
        assert_eq!(fallback["status"], "fallback");
        assert_eq!(fallback["attempt"], 2);
    }

    #[test]
    fn fresh_install_uses_safe_default_and_system_ui_locale() {
        let s = AppSettings::default();
        assert_eq!(s.shortcut, "CmdOrCtrl+Shift+Space");
        assert_eq!(s.shortcut_mode, "toggle");
        assert_eq!(s.process_shortcut, "");
        assert_eq!(s.cancel_shortcut, "Escape");
        assert_eq!(s.ui_locale, "system");
        assert!(!s.start_with_windows);
    }

    #[test]
    fn default_settings_include_all_prompt_profiles() {
        let settings = AppSettings::default();
        assert_eq!(settings.prompt_profile_id, "natural");
        assert_eq!(
            settings
                .prompt_profiles
                .iter()
                .map(|profile| profile.id.as_str())
                .collect::<Vec<_>>(),
            vec!["raw", "natural", "email", "summary", "code"]
        );
    }

    #[test]
    fn success_event_carries_explicit_output_outcome_and_non_default_profile() {
        let mut settings = AppSettings::default();
        assert!(settings.overlay_profile().is_none());
        settings.prompt_profile_id = "email".into();

        let event = serde_json::to_value(OverlayPhase::Success {
            text: "hello".into(),
            pasted: false,
            copied: false,
            output: OutputOutcome::Preview,
            profile: settings.overlay_profile(),
        })
        .unwrap();

        assert_eq!(event["output"], "preview");
        assert_eq!(event["profile"]["id"], "email");
        assert_eq!(event["profile"]["name"], "Email");
    }

    #[test]
    fn legacy_settings_keep_system_prompt_when_profile_fields_are_missing() {
        let original = AppSettings::default();
        let mut json = serde_json::to_value(&original).unwrap();
        let object = json.as_object_mut().unwrap();
        object.remove("prompt_profile_id");
        object.remove("prompt_profiles");

        let restored: AppSettings = serde_json::from_value(json).unwrap();
        assert_eq!(restored.prompt_profile_id, "");
        assert_eq!(restored.system_prompt, original.system_prompt);
        assert_eq!(restored.prompt_profiles.len(), 5);
    }
}
