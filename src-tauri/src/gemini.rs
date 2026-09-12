use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::settings::SettingsStore;
use crate::types::{GeminiModelInfo, GeminiResult};

const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const PREWARM_MIN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);

async fn wait_for_cancellation<F>(is_cancelled: F)
where
    F: Fn() -> bool + Copy,
{
    while !is_cancelled() {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

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

    /// POST generateContent with inline base64 FLAC audio. The API key is
    /// sent via the `x-goog-api-key` header (not a query param, which could
    /// leak into logs). Keys are tried first: every configured key is
    /// attempted on the primary model before falling back to the next model.
    /// A rejected key is dropped for the rest of the turn (and pruned from
    /// storage); a model-scoped failure moves to the next model immediately.
    pub async fn transcribe_and_respond<C>(
        &self,
        settings: &SettingsStore,
        audio: &[u8],
        settings_snapshot: &crate::types::AppSettings,
        mut on_attempt: impl FnMut(usize, usize, &str),
        is_cancelled: C,
    ) -> AppResult<GeminiResult>
    where
        C: Fn() -> bool + Copy + Send + Sync,
    {
        let key_lookup_started = std::time::Instant::now();
        let mut keys = settings.get_api_keys()?;
        if keys.is_empty() {
            return Err(AppError::MissingApiKey);
        }
        let key_lookup_ms = key_lookup_started.elapsed().as_millis();
        let models = settings_snapshot.model_chain();
        let base64_started = std::time::Instant::now();
        let audio_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, audio);
        let base64_ms = base64_started.elapsed().as_millis();
        let primary_model = models.first().map(String::as_str).unwrap_or("<none>");
        log::debug!(
            "gemini latency: model={} keys={} key_lookup_ms={} base64_ms={} audio_bytes={} base64_bytes={}",
            primary_model,
            keys.len(),
            key_lookup_ms,
            base64_ms,
            audio.len(),
            audio_b64.len()
        );

        let total_attempts = models.len() * keys.len();
        let mut attempt = 0;
        let mut dead_keys: Vec<String> = Vec::new();
        let mut last_error = AppError::BadResponse;
        for (model_index, model_name) in models.iter().enumerate() {
            if is_cancelled() {
                return Err(AppError::Cancelled);
            }
            let mut key_index = 0;
            while key_index < keys.len() {
                if is_cancelled() {
                    return Err(AppError::Cancelled);
                }
                attempt += 1;
                on_attempt(attempt, total_attempts, model_name);
                let result = tokio::select! {
                    _ = wait_for_cancellation(is_cancelled) => Err(AppError::Cancelled),
                    result = self.generate_with_model(&keys[key_index], model_name, &audio_b64, settings_snapshot) => result,
                };
                match result {
                    Ok(mut result) => {
                        result.model = model_name.clone();
                        if model_index > 0 {
                            log::info!(
                                "Fallback model '{model_name}' succeeded on attempt {}",
                                model_index + 1
                            );
                        }
                        prune_dead_keys(settings, &dead_keys);
                        return Ok(result);
                    }
                    Err(error) if is_dead_key_error(&error) => {
                        log::warn!(
                            "API key #{} rejected ({error}); dropping it for this turn",
                            key_index + 1
                        );
                        dead_keys.push(keys.remove(key_index));
                        last_error = error;
                    }
                    Err(error) if is_model_scoped_error(&error) => {
                        log::warn!(
                            "Model '{model_name}' failed: {error}. Attempting next model if available."
                        );
                        last_error = error;
                        break;
                    }
                    Err(error) => {
                        log::warn!(
                            "Model '{model_name}' failed with key #{}: {error}. Trying next key if available.",
                            key_index + 1
                        );
                        last_error = error;
                        key_index += 1;
                    }
                }
            }
        }
        prune_dead_keys(settings, &dead_keys);
        Err(last_error)
    }

    async fn generate_with_model(
        &self,
        api_key: &str,
        model: &str,
        audio_b64: &str,
        settings_snapshot: &crate::types::AppSettings,
    ) -> AppResult<GeminiResult> {
        let request_build_started = std::time::Instant::now();
        let url = self.url(&format!(
            "models/{}:generateContent",
            urlencoding::encode(model)
        ))?;

        let mut body = build_request_body(model, audio_b64, settings_snapshot);
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
                    return parse_payload(&retry_payload);
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

        parse_payload(&payload)
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

/// The only instruction ever sent next to the audio: an explicit
/// response-language override. With language "auto" no text part is sent at
/// all, so a custom system prompt (e.g. verbatim transcription) is never
/// fought by a competing hardcoded instruction.
fn language_instruction(language: &str) -> Option<String> {
    if language == "auto" {
        None
    } else {
        Some(format!("Reply in {language}."))
    }
}

fn build_request_body(
    model: &str,
    audio_b64: &str,
    settings: &crate::types::AppSettings,
) -> Value {
    let mut generation_config = json!({
        "temperature": settings.temperature,
        "maxOutputTokens": settings.max_output_tokens
    });

    // For Gemini 2.5 models (e.g. gemini-2.5-flash) which default to "thinking" mode,
    // setting thinkingBudget to 0 eliminates 2 - 4 seconds of internal reasoning delay,
    // giving instant voice-to-text response while preserving maximum output quality.
    if model.contains("2.5") || model.contains("thinking") {
        generation_config["thinkingConfig"] = json!({
            "thinkingBudget": 0
        });
    }

    let mut parts = Vec::new();
    if let Some(instruction) = language_instruction(&settings.language) {
        parts.push(json!({ "text": instruction }));
    }
    parts.push(json!({ "inline_data": { "mime_type": "audio/flac", "data": audio_b64 } }));

    let mut body = json!({
        "contents": [{
            "role": "user",
            "parts": parts
        }],
        "generationConfig": generation_config
    });
    let system_prompt = selected_prompt(settings);
    if !system_prompt.is_empty() {
        body["systemInstruction"] = json!({
            "parts": [{ "text": system_prompt }]
        });
    }
    body
}

/// A 401 (or a 400 complaining about the key itself) means the key is
/// dead: no other model will accept it either.
fn is_dead_key_error(error: &AppError) -> bool {
    match error {
        AppError::Api { status: 401, .. } => true,
        AppError::Api { status: 400, message } => {
            message.to_ascii_lowercase().contains("api key")
        }
        _ => false,
    }
}

/// Malformed-model and server-side failures are model-scoped: switching keys
/// cannot fix them, so the turn moves to the next model immediately.
fn is_model_scoped_error(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Api {
            status: 400 | 404 | 500 | 502 | 503 | 504,
            ..
        }
    )
}

fn prune_dead_keys(settings: &SettingsStore, dead_keys: &[String]) {
    if dead_keys.is_empty() {
        return;
    }
    if let Err(error) = settings.prune_api_keys(dead_keys) {
        log::warn!("failed to prune rejected API keys: {error}");
    }
}

fn selected_prompt(settings: &crate::types::AppSettings) -> String {
    let profile_prompt = settings
        .prompt_profiles
        .iter()
        .find(|profile| profile.id == settings.prompt_profile_id)
        .map(|profile| profile.prompt.trim())
        .filter(|prompt| !prompt.is_empty());
    let system_prompt = settings.system_prompt.trim();

    match (profile_prompt, system_prompt.is_empty()) {
        (Some(profile), false) => format!("{profile}\n\n{system_prompt}"),
        (Some(profile), true) => profile.to_string(),
        (None, _) => system_prompt.to_string(),
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

fn parse_payload(payload: &Value) -> AppResult<GeminiResult> {
    parse_model_text(&extract_text(payload)?)
}

fn parse_model_text(text: &str) -> AppResult<GeminiResult> {
    let trimmed = text.trim();
    let json_text = strip_json_fence(trimmed);
    if let Ok(value) = serde_json::from_str::<Value>(json_text) {
        if let (Some(transcript), Some(result)) = (
            value.get("transcript").and_then(Value::as_str),
            value.get("result").and_then(Value::as_str),
        ) {
            return Ok(GeminiResult {
                transcript: transcript.to_string(),
                result: result.to_string(),
                model: String::new(),
            });
        }
        return Ok(GeminiResult {
            transcript: value
                .get("transcript")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            result: trimmed.to_string(),
            model: String::new(),
        });
    }
    if trimmed.is_empty() {
        return Err(AppError::BadResponse);
    }
    Ok(GeminiResult {
        transcript: trimmed.to_string(),
        result: trimmed.to_string(),
        model: String::new(),
    })
}

fn strip_json_fence(text: &str) -> &str {
    let Some(body) = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```JSON"))
    else {
        return text;
    };
    body.strip_suffix("```").unwrap_or(body).trim()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn parses_structured_result_and_preserves_legacy_string() {
        let structured =
            parse_model_text(r#"{"transcript":"hello there","result":"Hello there!"}"#).unwrap();
        assert_eq!(structured.transcript, "hello there");
        assert_eq!(structured.result, "Hello there!");

        let fenced =
            parse_model_text("```json\n{\"transcript\":\"hello\",\"result\":\"Hi!\"}\n```")
                .unwrap();
        assert_eq!(fenced.transcript, "hello");
        assert_eq!(fenced.result, "Hi!");

        let incomplete = parse_model_text(r#"{"result":"missing transcript"}"#).unwrap();
        assert_eq!(incomplete.transcript, "");
        assert_eq!(incomplete.result, r#"{"result":"missing transcript"}"#);

        let legacy = parse_model_text("legacy plain text").unwrap();
        assert_eq!(legacy.transcript, "legacy plain text");
        assert_eq!(legacy.result, "legacy plain text");
    }

    #[test]
    fn selected_prompt_preserves_legacy_instructions_without_a_profile() {
        let mut settings = crate::types::AppSettings {
            system_prompt: "legacy instructions".into(),
            ..Default::default()
        };
        settings.prompt_profile_id.clear();
        assert_eq!(selected_prompt(&settings), "legacy instructions");

        settings.prompt_profile_id = "email".into();
        assert_eq!(
            selected_prompt(&settings),
            "Turn the transcript into a concise, polished email message.\n\nlegacy instructions"
        );

        settings.prompt_profile_id = "missing".into();
        assert_eq!(selected_prompt(&settings), "legacy instructions");
    }

    #[test]
    fn selected_prompt_keeps_profile_and_editable_system_instructions_effective() {
        let settings = crate::types::AppSettings {
            prompt_profile_id: "email".into(),
            system_prompt: "Use a warm, professional tone.".into(),
            ..Default::default()
        };

        assert_eq!(
            selected_prompt(&settings),
            "Turn the transcript into a concise, polished email message.\n\nUse a warm, professional tone."
        );
    }

    #[test]
    fn dead_key_and_model_errors_route_to_key_or_model_fallback() {
        assert!(is_dead_key_error(&AppError::Api {
            status: 401,
            message: "invalid".into()
        }));
        assert!(is_dead_key_error(&AppError::Api {
            status: 400,
            message: "API key not valid. Pass a valid key.".into()
        }));
        assert!(!is_dead_key_error(&AppError::Api {
            status: 400,
            message: "thinking config unsupported".into()
        }));
        assert!(!is_dead_key_error(&AppError::Api {
            status: 429,
            message: "quota".into()
        }));

        assert!(is_model_scoped_error(&AppError::Api {
            status: 404,
            message: "not found".into()
        }));
        assert!(is_model_scoped_error(&AppError::Api {
            status: 503,
            message: "overloaded".into()
        }));
        assert!(!is_model_scoped_error(&AppError::Api {
            status: 429,
            message: "quota".into()
        }));
        assert!(!is_model_scoped_error(&AppError::Network(
            "down".into()
        )));
    }

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

    fn request_test_settings(system_prompt: &str, language: &str) -> crate::types::AppSettings {
        crate::types::AppSettings {
            system_prompt: system_prompt.into(),
            language: language.into(),
            prompt_profile_id: String::new(),
            temperature: 0.5,
            max_output_tokens: 8192,
            ..Default::default()
        }
    }

    #[test]
    fn auto_language_sends_audio_and_system_prompt_only() {
        let settings = request_test_settings("Custom verbatim rules", "auto");

        let body = build_request_body("gemini-2.0-flash", "AAA", &settings);

        let parts = body["contents"][0]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["inline_data"]["mime_type"], "audio/flac");
        assert_eq!(parts[0]["inline_data"]["data"], "AAA");
        assert_eq!(
            body["systemInstruction"]["parts"][0]["text"],
            "Custom verbatim rules"
        );
        assert_eq!(body["generationConfig"]["temperature"], 0.5);
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 8192);
    }

    #[test]
    fn explicit_language_keeps_only_the_language_override() {
        let settings = request_test_settings("Custom verbatim rules", "Vietnamese");

        let body = build_request_body("gemini-2.0-flash", "AAA", &settings);

        let parts = body["contents"][0]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0]["text"], "Reply in Vietnamese.");
        assert!(parts[1].get("inline_data").is_some());
        assert_eq!(
            body["systemInstruction"]["parts"][0]["text"],
            "Custom verbatim rules"
        );
    }

    #[test]
    fn empty_system_prompt_sends_audio_only() {
        let settings = request_test_settings("   ", "auto");

        let body = build_request_body("gemini-2.0-flash", "AAA", &settings);

        let parts = body["contents"][0]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 1);
        assert!(body.get("systemInstruction").is_none());
    }
}
