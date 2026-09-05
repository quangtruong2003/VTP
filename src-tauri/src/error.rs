use thiserror::Error;

use crate::types::{ErrorCode, FrontendError};

#[derive(Debug, Error)]
pub enum AppError {
    #[error("No API key configured. Open Settings and add your Google AI Studio key.")]
    MissingApiKey,
    #[error("Credential store error: {0}")]
    Keyring(String),
    #[error("Settings file error: {0}")]
    Settings(String),
    #[error("No audio input device available")]
    NoInputDevice,
    #[error("Audio device '{0}' not found")]
    DeviceNotFound(String),
    #[error("Recording failed: {0}")]
    Recording(String),
    #[error("Network request failed: {0}")]
    Network(String),
    #[error("Gemini API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("Gemini returned an unexpected response shape")]
    BadResponse,
    #[error("Focus restore failed: {0}")]
    Focus(String),
    #[error("Shortcut parse error: {0}")]
    Shortcut(String),
    #[error("A voice session is already active")]
    SessionBusy,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn frontend(&self) -> FrontendError {
        let code = match self {
            AppError::MissingApiKey => ErrorCode::MissingApiKey,
            AppError::NoInputDevice | AppError::DeviceNotFound(_) | AppError::Recording(_) => {
                ErrorCode::MicrophoneDevice
            }
            AppError::Network(_) => ErrorCode::Network,
            AppError::Api { status, .. } if *status == 401 || *status == 403 => {
                ErrorCode::InvalidApiKey
            }
            AppError::Api { status, message }
                if *status == 404 || message.to_ascii_lowercase().contains("model") =>
            {
                ErrorCode::ModelUnavailable
            }
            AppError::Focus(_) => ErrorCode::InsertionFailed,
            AppError::Shortcut(_) => ErrorCode::ShortcutConflict,
            AppError::Other(message) if message.to_ascii_lowercase().contains("clipboard") => {
                ErrorCode::ClipboardFailed
            }
            _ => ErrorCode::Unknown,
        };
        FrontendError {
            code,
            recoverable: !matches!(self, AppError::MissingApiKey),
            detail: Some(self.to_string()),
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
