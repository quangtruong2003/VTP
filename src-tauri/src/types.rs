use serde::{Deserialize, Serialize};

pub type SessionId = u64;

fn default_ui_locale() -> String {
    "system".into()
}

fn default_process_shortcut() -> String {
    "Enter".into()
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
    pub start_recording_on_open: bool,
    #[serde(default = "default_ui_locale")]
    pub ui_locale: String,
    #[serde(default)]
    pub fallback_models: Vec<String>,
    #[serde(default)]
    pub start_with_windows: bool,
}

impl AppSettings {
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
            process_shortcut: default_process_shortcut(),
            cancel_shortcut: default_cancel_shortcut(),
            history_shortcut: default_history_shortcut(),
            settings_shortcut: default_settings_shortcut(),
            copy_to_clipboard: true,
            paste_automatically: true,
            device_name: None,
            show_history: true,
            start_recording_on_open: true,
            ui_locale: "system".into(),
            fallback_models: Vec::new(),
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiModelInfo {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub input_token_limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
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

#[derive(Debug, Clone, Serialize)]
pub struct FrontendError {
    pub code: ErrorCode,
    pub recoverable: bool,
    pub detail: Option<String>,
}

/// States pushed to the overlay window via `overlay://state`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum OverlayPhase {
    Idle,
    Recording {
        elapsed_ms: u64,
        level: u8,
    },
    Paused {
        elapsed_ms: u64,
    },
    Uploading,
    Processing,
    Success {
        text: String,
        pasted: bool,
        copied: bool,
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
    fn fresh_install_uses_safe_default_and_system_ui_locale() {
        let s = AppSettings::default();
        assert_eq!(s.shortcut, "CmdOrCtrl+Shift+Space");
        assert_eq!(s.process_shortcut, "Enter");
        assert_eq!(s.cancel_shortcut, "Escape");
        assert_eq!(s.ui_locale, "system");
        assert_eq!(s.start_with_windows, false);
    }
}
