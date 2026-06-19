use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Emitter;

const DEFAULT_TIMEOUT_MS: u64 = 180_000;

// --- Request/Response DTOs ---

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: serde_json::Value,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub enable_thinking: Option<bool>,
    pub response_format: Option<serde_json::Value>,
}

fn default_temperature() -> f64 {
    0.2
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StreamChatRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: serde_json::Value,
    #[serde(default = "default_stream_temperature")]
    pub temperature: f64,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub enable_thinking: Option<bool>,
}

fn default_stream_temperature() -> f64 {
    0.4
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

// --- URL normalization (ported from Node.js proxy.js) ---

fn normalize_chat_completion_url(base_url: &str) -> Result<String, String> {
    if base_url.trim().is_empty() {
        return Err("Base URL 不能为空".to_string());
    }

    let trimmed = base_url.trim().trim_end_matches('/');

    // Parse the URL to validate
    let parsed = url::Url::parse(trimmed).map_err(|_| "Base URL 格式不正确".to_string())?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Base URL 必须以 http:// 或 https:// 开头".to_string());
    }

    // Check if path already ends with /chat/completions
    if parsed
        .path()
        .to_lowercase()
        .ends_with("/chat/completions")
    {
        return Ok(trimmed.to_string());
    }

    // Check if path ends with /v\d+
    let path = parsed.path();
    let has_version_suffix = path
        .split('/')
        .last()
        .map(|seg| {
            seg.len() >= 2
                && seg.starts_with('v')
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false);

    if has_version_suffix {
        return Ok(format!("{}/chat/completions", trimmed));
    }

    Ok(format!("{}/v1/chat/completions", trimmed))
}

// --- Error Classification ---

fn classify_api_error(status: u16, text: &str) -> String {
    let lower = text.to_lowercase();

    if status == 401 || status == 403 || lower.contains("api key") {
        "api_key_error".to_string()
    } else if status == 404 || lower.contains("model") || lower.contains("not found") {
        "model_or_url_error".to_string()
    } else if status == 400
        && (lower.contains("response_format") || lower.contains("unsupported parameter"))
    {
        "response_format_not_supported".to_string()
    } else if status == 400
        && (lower.contains("image")
            || lower.contains("vision")
            || lower.contains("multimodal")
            || lower.contains("content type"))
    {
        "vision_not_supported".to_string()
    } else {
        "api_error".to_string()
    }
}

fn classify_fetch_failure(error: &reqwest::Error) -> ApiResponse {
    let detail = error.to_string();
    let detail_lower = detail.to_lowercase();

    if error.is_timeout() || detail_lower.contains("timed out") {
        ApiResponse {
            ok: false,
            data: None,
            error_type: Some("timeout".to_string()),
            message: Some("网络超时，请稍后重试或调大超时时间".to_string()),
            raw: None,
        }
    } else if error.is_connect() || detail_lower.contains("connection refused") {
        ApiResponse {
            ok: false,
            data: None,
            error_type: Some("base_url_unavailable".to_string()),
            message: Some("Base URL 不可用或网络连接失败".to_string()),
            raw: Some(detail),
        }
    } else if error.is_request() {
        ApiResponse {
            ok: false,
            data: None,
            error_type: Some("base_url_unavailable".to_string()),
            message: Some("Base URL 不可用或网络连接失败".to_string()),
            raw: Some(detail),
        }
    } else {
        ApiResponse {
            ok: false,
            data: None,
            error_type: Some("base_url_unavailable".to_string()),
            message: Some("Base URL 不可用或网络连接失败".to_string()),
            raw: Some(detail),
        }
    }
}

// --- Tauri Commands ---

#[tauri::command]
async fn chat_completions(request: ChatCompletionRequest) -> Result<ApiResponse, String> {
    // Validate inputs
    if request.api_key.trim().is_empty() {
        return Ok(ApiResponse {
            ok: false,
            data: None,
            error_type: Some("missing_api_key".to_string()),
            message: Some("API Key 不能为空".to_string()),
            raw: None,
        });
    }

    if request.model.trim().is_empty() {
        return Ok(ApiResponse {
            ok: false,
            data: None,
            error_type: Some("missing_model".to_string()),
            message: Some("模型名称不能为空".to_string()),
            raw: None,
        });
    }

    let url = match normalize_chat_completion_url(&request.base_url) {
        Ok(u) => u,
        Err(e) => {
            return Ok(ApiResponse {
                ok: false,
                data: None,
                error_type: Some("invalid_base_url".to_string()),
                message: Some(e),
                raw: None,
            });
        }
    };

    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", request.api_key))
            .map_err(|e| format!("Invalid API key: {}", e))?,
    );

    let mut payload = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "temperature": request.temperature,
    });

    if let Some(rf) = &request.response_format {
        payload["response_format"] = rf.clone();
    }

    if let Some(enable_thinking) = request.enable_thinking {
        payload["enable_thinking"] = serde_json::Value::Bool(enable_thinking);
    }

    let response = client
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let is_success = resp.status().is_success();
            let text = resp.text().await.unwrap_or_default();

            let data: serde_json::Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(ApiResponse {
                        ok: false,
                        data: None,
                        error_type: Some("invalid_api_response".to_string()),
                        message: Some("模型服务返回内容不是合法 JSON".to_string()),
                        raw: Some(
                            text.chars().take(800).collect(),
                        ),
                    });
                }
            };

            if !is_success {
                let error_msg = data["error"]["message"]
                    .as_str()
                    .or(data["message"].as_str())
                    .unwrap_or(&format!("模型服务返回 HTTP {}", status))
                    .to_string();

                Ok(ApiResponse {
                    ok: false,
                    data: Some(data.clone()),
                    error_type: Some(classify_api_error(status, &text)),
                    message: Some(error_msg),
                    raw: None,
                })
            } else {
                Ok(ApiResponse {
                    ok: true,
                    data: Some(data),
                    error_type: None,
                    message: None,
                    raw: None,
                })
            }
        }
        Err(e) => Ok(classify_fetch_failure(&e)),
    }
}

// --- Streaming command ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamToken {
    pub token: String,
    pub full_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[tauri::command]
async fn chat_completions_stream(
    app: tauri::AppHandle,
    request: StreamChatRequest,
) -> Result<(), String> {
    // Validate inputs
    if request.api_key.trim().is_empty() {
        let _ = app.emit("stream-error", StreamEvent {
            event_type: "error".to_string(),
            token: None,
            full_text: None,
            error_type: Some("missing_api_key".to_string()),
            message: Some("API Key 不能为空".to_string()),
        });
        return Ok(());
    }

    if request.model.trim().is_empty() {
        let _ = app.emit("stream-error", StreamEvent {
            event_type: "error".to_string(),
            token: None,
            full_text: None,
            error_type: Some("missing_model".to_string()),
            message: Some("模型名称不能为空".to_string()),
        });
        return Ok(());
    }

    let url = match normalize_chat_completion_url(&request.base_url) {
        Ok(u) => u,
        Err(e) => {
            let _ = app.emit("stream-error", StreamEvent {
                event_type: "error".to_string(),
                token: None,
                full_text: None,
                error_type: Some("invalid_base_url".to_string()),
                message: Some(e),
            });
            return Ok(());
        }
    };

    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", request.api_key))
            .map_err(|e| format!("Invalid API key: {}", e))?,
    );

    let mut payload = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "temperature": request.temperature,
        "stream": true,
    });

    if let Some(enable_thinking) = request.enable_thinking {
        payload["enable_thinking"] = serde_json::Value::Bool(enable_thinking);
    }

    let response = client
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                let error_type = classify_api_error(status, &text);
                let data: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                let error_msg = data["error"]["message"]
                    .as_str()
                    .or(data["message"].as_str())
                    .unwrap_or(&format!("模型服务返回 HTTP {}", status))
                    .to_string();

                let _ = app.emit("stream-error", StreamEvent {
                    event_type: "error".to_string(),
                    token: None,
                    full_text: None,
                    error_type: Some(error_type),
                    message: Some(error_msg),
                });
                return Ok(());
            }

            let mut stream = resp.bytes_stream();
            let mut buffer = String::new();
            let mut full_text = String::new();

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        let chunk_str = String::from_utf8_lossy(&chunk);
                        buffer.push_str(&chunk_str);

                        // Process lines
                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim().to_string();
                            buffer = buffer[pos + 1..].to_string();

                            let line = line.trim();
                            if !line.starts_with("data:") {
                                continue;
                            }

                            let payload_str = line[5..].trim();
                            if payload_str.is_empty() || payload_str == "[DONE]" {
                                continue;
                            }

                            if let Ok(data) =
                                serde_json::from_str::<serde_json::Value>(payload_str)
                            {
                                let token = data["choices"][0]["delta"]["content"]
                                    .as_str()
                                    .or(data["choices"][0]["message"]["content"].as_str())
                                    .unwrap_or("");

                                if !token.is_empty() {
                                    full_text.push_str(token);
                                    let _ = app.emit("stream-token", StreamEvent {
                                        event_type: "token".to_string(),
                                        token: Some(token.to_string()),
                                        full_text: Some(full_text.clone()),
                                        error_type: None,
                                        message: None,
                                    });
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let api_response = classify_fetch_failure(&e);
                        let _ = app.emit("stream-error", StreamEvent {
                            event_type: "error".to_string(),
                            token: None,
                            full_text: None,
                            error_type: api_response.error_type,
                            message: api_response.message,
                        });
                        return Ok(());
                    }
                }
            }

            // Signal completion
            let _ = app.emit("stream-done", StreamEvent {
                event_type: "done".to_string(),
                token: None,
                full_text: Some(full_text),
                error_type: None,
                message: None,
            });
        }
        Err(e) => {
            let api_response = classify_fetch_failure(&e);
            let _ = app.emit("stream-error", StreamEvent {
                event_type: "error".to_string(),
                token: None,
                full_text: None,
                error_type: api_response.error_type,
                message: api_response.message,
            });
        }
    }

    Ok(())
}

#[tauri::command]
async fn greet(name: String) -> String {
    format!("Hello, {}! QuizNest 已就绪。", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            chat_completions,
            chat_completions_stream,
            greet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url_with_v1_path() {
        let result = normalize_chat_completion_url("https://api.openai.com/v1").unwrap();
        assert_eq!(result, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn test_normalize_url_with_full_path() {
        let result =
            normalize_chat_completion_url("https://api.openai.com/v1/chat/completions").unwrap();
        assert_eq!(result, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn test_normalize_url_with_trailing_slash() {
        let result = normalize_chat_completion_url("https://api.example.com/v1/").unwrap();
        assert_eq!(result, "https://api.example.com/v1/chat/completions");
    }

    #[test]
    fn test_normalize_url_simple() {
        let result = normalize_chat_completion_url("https://api.example.com").unwrap();
        assert_eq!(result, "https://api.example.com/v1/chat/completions");
    }

    #[test]
    fn test_normalize_url_invalid() {
        let result = normalize_chat_completion_url("not-a-url");
        assert!(result.is_err());
    }

    #[test]
    fn test_classify_api_key_error() {
        assert_eq!(classify_api_error(401, ""), "api_key_error");
        assert_eq!(classify_api_error(403, ""), "api_key_error");
    }

    #[test]
    fn test_classify_model_not_found() {
        assert_eq!(classify_api_error(404, "model not found"), "model_or_url_error");
    }
}
