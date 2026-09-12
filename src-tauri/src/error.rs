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
    #[error("Clipboard operation failed: {0}")]
    Clipboard(String),
    #[error("Shortcut parse error: {0}")]
    Shortcut(String),
    #[error("A voice session is already active")]
    SessionBusy,
    #[error("Voice session cancelled")]
    Cancelled,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    fn frontend_detail(&self) -> String {
        let message = match self {
            AppError::Api { message, .. } => message,
            _ => return self.to_string(),
        };
        match self {
            AppError::Api { status: 429, .. } => format!(
                "Vượt quá hạn mức (rate limit). Đợi khoảng một phút rồi thử lại, hoặc đổi model. Chi tiết: {message}"
            ),
            AppError::Api { status: 503, .. } => format!(
                "Model đang quá tải. Hãy thử lại hoặc đổi model. Chi tiết: {message}"
            ),
            AppError::Api {
                status: 500 | 502 | 504,
                ..
            } => format!("Lỗi tạm thời từ máy chủ Google. Hãy thử lại sau. Chi tiết: {message}"),
            AppError::Api { status: 400, .. } => format!(
                "Yêu cầu bị từ chối. Hãy kiểm tra model trong Cài đặt. Chi tiết: {message}"
            ),
            AppError::Api {
                status: 401 | 403,
                ..
            } => format!("API key không hợp lệ hoặc chưa được cấp quyền. Chi tiết: {message}"),
            AppError::Api { status: 404, .. } => format!(
                "Model không tồn tại. Hãy tải lại danh sách model trong Cài đặt. Chi tiết: {message}"
            ),
            _ => self.to_string(),
        }
    }

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
            AppError::Clipboard(_) => ErrorCode::ClipboardFailed,
            AppError::Shortcut(_) => ErrorCode::ShortcutConflict,
            _ => ErrorCode::Unknown,
        };
        FrontendError {
            code,
            recoverable: !matches!(self, AppError::MissingApiKey),
            detail: Some(self.frontend_detail()),
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        serde::Serialize::serialize(&self.frontend(), s)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_error_has_a_stable_typed_frontend_code() {
        let error = AppError::Clipboard("write failed".into());
        assert!(matches!(error.frontend().code, ErrorCode::ClipboardFailed));
    }

    #[test]
    fn friendly_api_detail_does_not_erase_the_api_error_type() {
        let error = AppError::Api {
            status: 429,
            message: "quota exhausted".into(),
        };
        let frontend = error.frontend();

        assert!(matches!(error, AppError::Api { status: 429, .. }));
        assert!(matches!(frontend.code, ErrorCode::Unknown));
        assert!(frontend.detail.as_deref().unwrap().contains("rate limit"));
    }

    #[test]
    fn command_errors_serialize_as_typed_frontend_errors() {
        let value = serde_json::to_value(AppError::Clipboard("write failed".into())).unwrap();

        assert_eq!(value["code"], "clipboard_failed");
        assert_eq!(value["recoverable"], true);
        assert_eq!(value["detail"], "Clipboard operation failed: write failed");
    }
}
