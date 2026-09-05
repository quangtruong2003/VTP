use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::settings::SettingsStore;
use crate::types::GeminiModelInfo;

const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const PREWARM_MIN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);

fn claim_prewarm(
    last: &mut Option<std::time::Instant>,
    now: std::time::Instant,
    min_interval: std::time::Duration,
) -> bool {
    if let Some(previous) = *last {
        if now.saturating_duration_since(previous) < min_interval {
            return false;
        }
    }
    *last = Some(now);
    true
}

/// Validate an outgoing URL: http/https only, and reject localhost /
/// loopback / private / reserved addresses. Defense-in-depth against a
/// mis-configured (or tampered) base URL.
fn validate_url(url: &str) -> AppResult<()> {
    let parsed: url::Url = url
        .parse()
        .map_err(|_| AppError::Network(format!("invalid URL: {url}")))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(AppError::Network(format!("scheme '{other}' not allowed"))),
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Network("URL has no host".into()))?;
    let blocked = matches!(
        host,
        "localhost" | "127.0.0.1" | "::1" | "[::1]" | "0.0.0.0" | "169.254.0.0"
    ) || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || host.starts_with("172.16.")
        || host.starts_with("172.17.")
        || host.starts_with("172.18.")
        || host.starts_with("172.19.")
        || host.starts_with("172.2")
        || host.starts_with("172.30.")
        || host.starts_with("172.31.")
        || host.ends_with(".local")
        || host.ends_with(".internal");
    if blocked {
        return Err(AppError::Network(format!("host '{host}' is not allowed")));
    }
    Ok(())
}

pub struct GeminiClient {
    http: reqwest::Client,
    api_base: String,
    last_prewarm: std::sync::Mutex<Option<std::time::Instant>>,
}

impl GeminiClient {
    pub fn new() -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(8))
            .timeout(std::time::Duration::from_secs(60))
            .tcp_nodelay(true)
            .tcp_keepalive(Some(std::time::Duration::from_secs(60)))
            .pool_idle_timeout(Some(std::time::Duration::from_secs(120)))
            .pool_max_idle_per_host(8)
            .build()?;
        Ok(Self {
            http,
            api_base: API_BASE.to_string(),
            last_prewarm: std::sync::Mutex::new(None),
        })
    }

    /// Pre-warm DNS/TLS and the pooled connection to Google Gemini API in the background.
    /// Closely repeated lifecycle calls share one warm-up attempt instead of issuing
    /// overlapping HEAD requests for the same recording turn.
    pub fn prewarm(&self) {
        {
            let mut last = self.last_prewarm.lock().unwrap();
            if !claim_prewarm(&mut last, std::time::Instant::now(), PREWARM_MIN_INTERVAL) {
                return;
            }
        }

        let client = self.http.clone();
        let url = format!("{}/models?pageSize=1", self.api_base.trim_end_matches('/'));
        tauri::async_runtime::spawn(async move {
            let _ = client.head(&url).send().await;
        });
    }

    fn url(&self, path: &str) -> AppResult<String> {
        let url = format!("{}/{}", self.api_base.trim_end_matches('/'), path);
        validate_url(&url)?;
        Ok(url)
    }

    /// POST generateContent with inline base64 WAV audio. The API key is
    /// sent via the `x-goog-api-key` header (not a query param, which could
    /// leak into logs). If the primary model encounters an error, it tries
    /// configured fallback models in sequence.
    pub async fn transcribe_and_respond(
        &self,
        settings: &SettingsStore,
        audio_wav: &[u8],
        settings_snapshot: &crate::types::AppSettings,
    ) -> AppResult<String> {
        let key_lookup_started = std::time::Instant::now();
        let api_key = settings.get_api_key()?;
        let key_lookup_ms = key_lookup_started.elapsed().as_millis();
        let models = settings_snapshot.model_chain();
        let base64_started = std::time::Instant::now();
        let audio_b64 =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, audio_wav);
        let base64_ms = base64_started.elapsed().as_millis();
        let primary_model = models.first().map(String::as_str).unwrap_or("<none>");
        log::debug!(
            "gemini latency: model={} key_lookup_ms={} base64_ms={} wav_bytes={} base64_bytes={}",
            primary_model,
            key_lookup_ms,
            base64_ms,
            audio_wav.len(),
            audio_b64.len()
        );

        let mut last_error = AppError::BadResponse;
        for (index, model_name) in models.iter().enumerate() {
            match self
                .generate_with_model(&api_key, model_name, &audio_b64, settings_snapshot)
                .await
            {
                Ok(text) => {
                    if index > 0 {
                        log::info!(
                            "Fallback model '{model_name}' succeeded on attempt {}",
                            index + 1
                        );
                    }
                    return Ok(text);
                }
                Err(err) => {
                    log::warn!(
                        "Model '{model_name}' failed: {err}. Attempting next model if available."
                    );
                    last_error = err;
                }
            }
        }
        Err(last_error)
    }

    async fn generate_with_model(
        &self,
        api_key: &str,
        model: &str,
        audio_b64: &str,
        settings_snapshot: &crate::types::AppSettings,
    ) -> AppResult<String> {
        let request_build_started = std::time::Instant::now();
        let url = self.url(&format!(
            "models/{}:generateContent",
            urlencoding::encode(model)
        ))?;

        let mut generation_config = json!({
            "temperature": settings_snapshot.temperature,
            "maxOutputTokens": settings_snapshot.max_output_tokens
        });

        // For Gemini 2.5 models (e.g. gemini-2.5-flash) which default to "thinking" mode,
        // setting thinkingBudget to 0 eliminates 2 - 4 seconds of internal reasoning delay,
        // giving instant voice-to-text response while preserving maximum output quality.
        if model.contains("2.5") || model.contains("thinking") {
            generation_config["thinkingConfig"] = json!({
                "thinkingBudget": 0
            });
        }

        let mut body = json!({
            "contents": [{
                "role": "user",
                "parts": [
                    { "text": instructions_for(&settings_snapshot.language) },
                    { "inline_data": { "mime_type": "audio/wav", "data": audio_b64 } }
                ]
            }],
            "generationConfig": generation_config
        });
        if !settings_snapshot.system_prompt.trim().is_empty() {
            body["systemInstruction"] = json!({
                "parts": [{ "text": settings_snapshot.system_prompt }]
            });
        }
        let request_build_ms = request_build_started.elapsed().as_millis();

        let http_started = std::time::Instant::now();
        let resp = self
            .http
            .post(&url)
            .header("x-goog-api-key", api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;
        let http_api_ms = http_started.elapsed().as_millis();

        let response_parse_started = std::time::Instant::now();
        let status = resp.status();
        let payload: Value = resp.json().await.map_err(|_| AppError::BadResponse)?;
        let response_parse_ms = response_parse_started.elapsed().as_millis();
        log::debug!(
            "gemini latency: model={} request_build_ms={} http_api_ms={} response_parse_ms={}",
            model,
            request_build_ms,
            http_api_ms,
            response_parse_ms
        );
        if !status.is_success() {
            // If thinkingConfig caused a 400 rejection on an unsupported model variant,
            // retry once immediately without thinkingConfig.
            if status.as_u16() == 400 && body["generationConfig"].get("thinkingConfig").is_some() {
                if let Some(obj) = body["generationConfig"].as_object_mut() {
                    obj.remove("thinkingConfig");
                }
                let retry_resp = self
                    .http
                    .post(&url)
                    .header("x-goog-api-key", api_key)
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send()
                    .await?;
                let retry_status = retry_resp.status();
                let retry_payload: Value =
                    retry_resp.json().await.map_err(|_| AppError::BadResponse)?;
                if retry_status.is_success() {
                    return extract_text(&retry_payload);
                }
            }

            let message = payload["error"]["message"]
                .as_str()
                .unwrap_or("unknown Gemini API error")
                .to_string();
            return Err(AppError::Api {
                status: status.as_u16(),
                message,
            });
        }

        extract_text(&payload)
    }

    /// Human-friendly Vietnamese wording for API failures, so the overlay
    /// doesn't dump raw English API text at the user.
    pub fn friendly_api_error(err: &AppError) -> Option<String> {
        if let AppError::Api { status, message } = err {
            let hint = match *status {
                429 => "Vượt quá hạn mức (rate limit). Đợi khoảng một phút rồi thử lại, hoặc đổi sang model khác trong Cài đặt.",
                503 => "Model này đang quá tải (lượng cầu lớn, thường chỉ tạm thời). Bấm 'Thử lại' hoặc đổi sang model khác trong Cài đặt (ví dụ gemini-2.5-flash).",
                500 | 502 | 504 => "Lỗi tạm thời từ máy chủ Google. Bấm 'Thử lại' sau ít phút.",
                400 => "Yêu cầu bị từ chối — kiểm tra lại model trong Cài đặt (model có thể không tồn tại hoặc không hỗ trợ âm thanh).",
                401 | 403 => "API key không hợp lệ hoặc chưa được cấp quyền. Mở Cài đặt và kiểm tra lại API key.",
                404 => "Model không tồn tại — mở Cài đặt, bấm 'Fetch models' và chọn model khác.",
                _ => return Some(format!("Lỗi Gemini API ({status}): {message}")),
            };
            return Some(format!("{hint} Chi tiết: {message}"));
        }
        None
    }

    /// GET the list of models the key can access; filter to those that
    /// support generateContent.
    pub async fn list_models(&self, api_key: &str) -> AppResult<Vec<GeminiModelInfo>> {
        let url = self.url("models")?;
        let resp = self
            .http
            .get(&url)
            .header("x-goog-api-key", api_key)
            .query(&[("pageSize", "100")])
            .send()
            .await?;
        let status = resp.status();
        let payload: Value = resp.json().await.map_err(|_| AppError::BadResponse)?;
        if !status.is_success() {
            let message = payload["error"]["message"]
                .as_str()
                .unwrap_or("failed to list models")
                .to_string();
            return Err(AppError::Api {
                status: status.as_u16(),
                message,
            });
        }
        let mut models = Vec::new();
        if let Some(arr) = payload["models"].as_array() {
            for m in arr {
                let name = m["name"].as_str().unwrap_or_default();
                let Some(methods) = m["supportedGenerationMethods"].as_array() else {
                    continue;
                };
                let supports_generate = methods
                    .iter()
                    .any(|x| x.as_str() == Some("generateContent"));
                if !supports_generate {
                    continue;
                }
                // name looks like "models/gemini-2.0-flash"
                let display_name = m["displayName"].as_str().unwrap_or(name).to_string();
                models.push(GeminiModelInfo {
                    name: name.trim_start_matches("models/").to_string(),
                    display_name,
                    description: m["description"].as_str().unwrap_or("").to_string(),
                    input_token_limit: m["inputTokenLimit"].as_u64(),
                });
            }
        }
        Ok(models)
    }
}

fn instructions_for(language: &str) -> String {
    match language {
        "auto" => "Transcribe the attached speech, then respond to it as instructed by your system role. Reply in the same language the user spoke.".into(),
        other => format!(
            "Transcribe the attached speech, then respond to it as instructed by your system role. Reply in {other}."
        ),
    }
}

fn extract_text(payload: &Value) -> AppResult<String> {
    let candidates = payload["candidates"]
        .as_array()
        .ok_or(AppError::BadResponse)?;
    let mut text = String::new();
    for c in candidates {
        if let Some(parts) = c["content"]["parts"].as_array() {
            for p in parts {
                if let Some(t) = p["text"].as_str() {
                    text.push_str(t);
                }
            }
        }
    }
    if text.trim().is_empty() {
        return Err(AppError::BadResponse);
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn prewarm_throttle_allows_first_skips_recent_and_allows_later() {
        let start = Instant::now();
        let mut last = None;

        assert!(claim_prewarm(&mut last, start, Duration::from_secs(5)));
        assert!(!claim_prewarm(
            &mut last,
            start + Duration::from_secs(1),
            Duration::from_secs(5)
        ));
        assert!(claim_prewarm(
            &mut last,
            start + Duration::from_secs(5),
            Duration::from_secs(5)
        ));
    }
}
