//! Tauri-side LLM proxy and the AI provider key store.
//!
//! The webview never holds a provider API key: `set_provider_key` stores it in the secret
//! vault (`secret_store`) as `provider:{provider}`, and the proxy reads it from there on every
//! request and calls `api.anthropic.com` / `api.openai.com` itself. A markdown-render escape,
//! a malicious browser extension or a plugin panel finds no key in the JS heap or in the
//! webview's requests.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use zeroize::Zeroizing;

use crate::secret_store::SecretVault;

const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION: &str = "2023-06-01";

const OPENAI_CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";

/// Wall-clock cap on a single chat request — prevents a hung connection from
/// holding an IPC channel open forever. Generous enough for slow first-token
/// generation on Opus-class models with large contexts.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Cap on per-validation / per-models-list calls — these are short and a
/// stuck connect should fail fast.
const SIDECAR_TIMEOUT: Duration = Duration::from_secs(15);

/// Returns the shared `reqwest::Client` for streaming chat calls: one
/// connection pool process-wide, so the requests of a multi-tool turn reuse
/// TLS connections. Its timeout is [`REQUEST_TIMEOUT`].
///
/// # Panics
///
/// Panics when the client cannot be built.
fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("reqwest client init must succeed")
    })
}

/// Returns the separate pooled client for the short sidecar calls (validate,
/// list models). Its timeout is [`SIDECAR_TIMEOUT`], so a hung provider does
/// not keep the settings UI waiting.
///
/// # Panics
///
/// Panics when the client cannot be built.
fn sidecar_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(SIDECAR_TIMEOUT)
            .build()
            .expect("reqwest sidecar client init must succeed")
    })
}

/// The AI provider a request goes to, validated at the IPC boundary rather
/// than carried as a freeform string.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
}

impl Provider {
    fn as_str(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
        }
    }
}

/// A chat request from the UI, the body shape of the TS `AiChatRequest`.
/// `messages` and `tools` are `serde_json::Value` rather than typed structs:
/// the JS side builds the provider's native shape and the proxy forwards it.
///
/// There is no `api_key` field; the proxy reads the key from the secret vault.
/// `deny_unknown_fields` makes a body that carries an `api_key` fail to
/// deserialize instead of being accepted with the key ignored.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatCompletionRequest {
    pub provider: Provider,
    pub model: String,
    /// Provider-native message array (Anthropic shape for `Provider::Anthropic`,
    /// OpenAI shape for `Provider::Openai`), built by the JS providers and
    /// forwarded verbatim.
    pub messages: serde_json::Value,
    #[serde(default)]
    pub tools: Option<serde_json::Value>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// An event on the chat stream channel: a lossless wrapper around the
/// server-sent event (SSE) frames the providers emit. The proxy passes them
/// through; the TS provider reassembles tool_use blocks and emits the final
/// `AiStreamChunk`s.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ChatStreamEvent {
    /// One SSE event from the provider. `event_type` is the Anthropic
    /// `event:` line (or absent for OpenAI, which only uses `data:`),
    /// `data` is the parsed JSON payload of the `data:` line.
    SseEvent {
        event_type: Option<String>,
        data: serde_json::Value,
    },
    /// Stream completed normally — provider sent `[DONE]` (OpenAI) or the
    /// connection drained cleanly (Anthropic).
    Done,
    /// Hard error before or during the stream. The TS side maps this onto
    /// `AiStreamChunk { kind: "error" }`. `message` is safe to display
    /// to the user (no secrets, no internal paths).
    Error { message: String },
}

#[derive(Debug, thiserror::Error)]
pub enum ProxyError {
    #[error("network error: {0}")]
    Network(String),
    #[error("provider returned error {status}: {body}")]
    Provider { status: u16, body: String },
    #[error("response stream error: {0}")]
    Stream(String),
    #[error("no API key configured for provider {provider} — set one in Agent Settings")]
    KeyNotConfigured { provider: String },
    #[error("secret storage error: {0}")]
    Secrets(String),
}

/// Outcome of a credential check. Distinguishes "provider said no"
/// (`Invalid`) from "the provider was never reached" (`NetworkError`) so the UI
/// can tell the user whether to check the key or their connection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ValidationOutcome {
    Valid,
    Invalid,
    NetworkError { message: String },
}

impl serde::Serialize for ProxyError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// The secret name of a provider's API key.
fn secret_name(provider: Provider) -> String {
    format!("provider:{}", provider.as_str())
}

/// Reads the API key for a provider from the secret vault.
///
/// # Errors
///
/// Returns [`ProxyError::KeyNotConfigured`] when no key is stored, and
/// [`ProxyError::Secrets`] when the vault cannot be read.
fn stored_key(vault: &SecretVault, provider: Provider) -> Result<Zeroizing<String>, ProxyError> {
    let stored = vault
        .read(&secret_name(provider))
        .map_err(|e| ProxyError::Secrets(e.to_string()))?;
    stored.ok_or_else(|| {
        log::warn!(
            target: "audit",
            "event=provider_key_missing provider={}",
            provider.as_str()
        );
        ProxyError::KeyNotConfigured {
            provider: provider.as_str().to_string(),
        }
    })
}

/// Stores or replaces the API key for a provider in the secret vault.
///
/// This and the other sync key commands run off the main thread (`async`): they read and
/// write the vault file, and on Linux the vault key's first read can wait on the keyring's
/// unlock prompt.
///
/// # Errors
///
/// Returns [`ProxyError::Secrets`] when the vault cannot be written.
#[tauri::command(async)]
pub fn set_provider_key(
    vault: State<'_, Arc<SecretVault>>,
    provider: Provider,
    api_key: Zeroizing<String>,
) -> Result<(), ProxyError> {
    vault
        .write(&secret_name(provider), api_key.as_str())
        .map_err(|e| ProxyError::Secrets(e.to_string()))?;
    log::warn!(target: "audit", "event=provider_key_set provider={}", provider.as_str());
    Ok(())
}

/// Removes the API key for a provider from the secret vault. Idempotent: no
/// error if the key was already absent.
///
/// # Errors
///
/// Returns [`ProxyError::Secrets`] when the vault cannot be written.
#[tauri::command(async)]
pub fn clear_provider_key(
    vault: State<'_, Arc<SecretVault>>,
    provider: Provider,
) -> Result<(), ProxyError> {
    vault
        .delete(&secret_name(provider))
        .map_err(|e| ProxyError::Secrets(e.to_string()))?;
    log::warn!(target: "audit", "event=provider_key_cleared provider={}", provider.as_str());
    Ok(())
}

/// Checks whether an API key is stored for a provider. Does NOT return the key.
///
/// # Errors
///
/// Returns [`ProxyError::Secrets`] when the vault cannot be read.
#[tauri::command(async)]
pub fn is_provider_key_configured(
    vault: State<'_, Arc<SecretVault>>,
    provider: Provider,
) -> Result<bool, ProxyError> {
    vault
        .read(&secret_name(provider))
        .map(|stored| stored.is_some())
        .map_err(|e| ProxyError::Secrets(e.to_string()))
}

/// Streams a chat completion from the provider onto `on_event`, ending with
/// `ChatStreamEvent::Done` or `ChatStreamEvent::Error`, as the TS consumer's
/// loop expects.
///
/// # Errors
///
/// Returns a [`ProxyError`] when no key is stored, the request fails, the
/// provider answers with an error status or the stream breaks. A failure after
/// the key was read is also sent on the channel as `ChatStreamEvent::Error`.
#[tauri::command]
pub async fn agent_chat_completion(
    vault: State<'_, Arc<SecretVault>>,
    request: ChatCompletionRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), ProxyError> {
    let api_key = stored_key(&vault, request.provider)?;

    let client = http_client();
    let result = match request.provider {
        Provider::Anthropic => stream_anthropic(client, &request, &api_key, &on_event).await,
        Provider::Openai => stream_openai(client, &request, &api_key, &on_event).await,
    };
    // api_key Zeroizing<String> is wiped here when it drops.

    match result {
        Ok(()) => {
            let _ = on_event.send(ChatStreamEvent::Done);
            Ok(())
        }
        Err(e) => {
            // Send the failure on the channel too, so the TS consumer's
            // for-await loop sees it without a try/catch around the invoke
            // promise; the Err still rejects that promise for consumers that
            // use it.
            let _ = on_event.send(ChatStreamEvent::Error {
                message: e.to_string(),
            });
            Err(e)
        }
    }
}

/// Checks the stored key of `provider` against the provider's models endpoint,
/// for the Settings panel's "Test connection" button.
///
/// # Errors
///
/// Returns a [`ProxyError`] when no key is stored or the vault cannot be read.
/// A refused key or an unreachable provider is a [`ValidationOutcome`].
#[tauri::command]
pub async fn agent_validate_credentials(
    vault: State<'_, Arc<SecretVault>>,
    provider: Provider,
) -> Result<ValidationOutcome, ProxyError> {
    let api_key = stored_key(&vault, provider)?;
    validate_key_against_provider(provider, &api_key).await
    // api_key Zeroizing<String> is wiped when it drops here.
}

/// Checks a candidate key against the provider before it is written to the
/// secret vault, for the "Verify & Save" button: the UI calls
/// `set_provider_key` only when the outcome is `Valid`.
///
/// The key parameter is `Zeroizing<String>` so the raw bytes are wiped from
/// the Rust heap as soon as the function returns, regardless of outcome. It is
/// never logged, echoed back or stored.
///
/// # Errors
///
/// Never returns `Err`; a refused key or an unreachable provider is a
/// [`ValidationOutcome`].
#[tauri::command]
pub async fn agent_validate_provided_key(
    provider: Provider,
    api_key: Zeroizing<String>,
) -> Result<ValidationOutcome, ProxyError> {
    validate_key_against_provider(provider, &api_key).await
    // api_key Zeroizing<String> is wiped when it drops here.
}

/// Calls the provider's cheapest authenticated endpoint with `api_key` and maps
/// the HTTP outcome to a [`ValidationOutcome`], for both the stored-key and the
/// provided-key check.
async fn validate_key_against_provider(
    provider: Provider,
    api_key: &Zeroizing<String>,
) -> Result<ValidationOutcome, ProxyError> {
    let client = sidecar_client();

    let req = match provider {
        Provider::Anthropic => client
            .get(ANTHROPIC_MODELS_URL)
            .header("x-api-key", api_key.as_str())
            .header("anthropic-version", ANTHROPIC_VERSION),
        Provider::Openai => client
            .get(OPENAI_MODELS_URL)
            .header("Authorization", format!("Bearer {}", api_key.as_str())),
    };

    match req.send().await {
        Ok(resp) if resp.status().is_success() => Ok(ValidationOutcome::Valid),
        Ok(_) => Ok(ValidationOutcome::Invalid),
        Err(e) => {
            log::warn!("validate_key_against_provider network error: {e}");
            Ok(ValidationOutcome::NetworkError {
                message: e.to_string(),
            })
        }
    }
}

/// Lists the models the provider offers, for the model dropdown in Agent
/// Settings, which falls back to its static list when this fails. Returns the
/// provider's JSON response as is.
///
/// # Errors
///
/// Returns a [`ProxyError`] when no key is stored, the request fails, the
/// provider answers with an error status or the body is not JSON.
#[tauri::command]
pub async fn agent_list_models(
    vault: State<'_, Arc<SecretVault>>,
    provider: Provider,
) -> Result<serde_json::Value, ProxyError> {
    let api_key = stored_key(&vault, provider)?;
    let client = sidecar_client();

    let req = match provider {
        Provider::Anthropic => client
            .get(format!("{ANTHROPIC_MODELS_URL}?limit=100"))
            .header("x-api-key", api_key.as_str())
            .header("anthropic-version", ANTHROPIC_VERSION),
        Provider::Openai => client
            .get(OPENAI_MODELS_URL)
            .header("Authorization", format!("Bearer {}", api_key.as_str())),
    };

    let resp = req
        .send()
        .await
        .map_err(|e| ProxyError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(ProxyError::Provider { status, body });
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| ProxyError::Stream(e.to_string()))
    // api_key Zeroizing<String> is wiped when it drops here.
}

async fn stream_anthropic(
    client: &Client,
    request: &ChatCompletionRequest,
    api_key: &Zeroizing<String>,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), ProxyError> {
    // No "anthropic-dangerous-direct-browser-access" header: that header marks
    // requests made from a browser, and this request comes from the app.
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "max_tokens": request.max_tokens.unwrap_or(4096),
        "stream": true,
    });
    if let Some(sys) = &request.system_prompt {
        body["system"] = serde_json::Value::String(sys.clone());
    }
    if let Some(tools) = &request.tools {
        body["tools"] = tools.clone();
    }

    let resp = client
        .post(ANTHROPIC_MESSAGES_URL)
        .header("content-type", "application/json")
        .header("x-api-key", api_key.as_str())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|e| ProxyError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(ProxyError::Provider { status, body });
    }

    forward_sse(resp, on_event, /* parse_event_lines */ true).await
}

async fn stream_openai(
    client: &Client,
    request: &ChatCompletionRequest,
    api_key: &Zeroizing<String>,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), ProxyError> {
    let messages = request.messages.clone();
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "max_tokens": request.max_tokens.unwrap_or(4096),
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    if let Some(tools) = &request.tools {
        body["tools"] = tools.clone();
    }
    // OpenAI takes the system prompt as a `system` role in the message array,
    // which the JS provider puts into `messages`, so `request.system_prompt` is
    // unused here.

    let resp = client
        .post(OPENAI_CHAT_URL)
        .header("Authorization", format!("Bearer {}", api_key.as_str()))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| ProxyError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(ProxyError::Provider { status, body });
    }

    forward_sse(resp, on_event, /* parse_event_lines */ false).await
}

/// Drains an SSE response body and forwards each `data:` payload as a
/// [`ChatStreamEvent::SseEvent`] on the channel. The buffer is split on `\n\n`
/// (the SSE event delimiter); each event yields its `data:` JSON and, when
/// `parse_event_lines` is set, its `event:` type line.
///
/// The parser does not reassemble tool_use blocks, count tokens or interpret
/// `event_type`; the TS provider does that.
///
/// # Errors
///
/// Returns [`ProxyError::Stream`] when the body breaks off or an event's data
/// is not JSON.
async fn forward_sse(
    resp: reqwest::Response,
    on_event: &Channel<ChatStreamEvent>,
    parse_event_lines: bool,
) -> Result<(), ProxyError> {
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| ProxyError::Stream(e.to_string()))?;
        // Each chunk is decoded on its own, lossily: a multi-byte codepoint
        // split across two chunks becomes replacement characters.
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // SSE events are separated by a blank line. Split eagerly and keep
        // the trailing partial event for the next iteration.
        while let Some(idx) = buffer.find("\n\n") {
            let raw_event = buffer[..idx].to_string();
            buffer.drain(..idx + 2);
            if let Some(event) = parse_sse_event(&raw_event, parse_event_lines)? {
                if on_event.send(event).is_err() {
                    // The receiver is gone (window closed, request cancelled):
                    // stop pulling from the provider rather than spend tokens
                    // on a stream nobody reads.
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}

/// Parses one SSE event block, already stripped of its trailing `\n\n`.
/// Returns `None` for keepalive comments, `[DONE]` markers, or events with
/// no `data:` line, and `Some(SseEvent { ... })` for real payloads.
///
/// # Errors
///
/// Returns [`ProxyError::Stream`] when the joined `data:` lines are not JSON.
fn parse_sse_event(
    block: &str,
    parse_event_lines: bool,
) -> Result<Option<ChatStreamEvent>, ProxyError> {
    let mut event_type: Option<String> = None;
    let mut data_lines: Vec<&str> = Vec::new();

    for line in block.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start());
        } else if parse_event_lines {
            if let Some(rest) = line.strip_prefix("event:") {
                event_type = Some(rest.trim().to_string());
            }
        }
    }

    if data_lines.is_empty() {
        return Ok(None);
    }

    let joined = data_lines.join("\n");
    if joined == "[DONE]" {
        return Ok(None);
    }

    let data: serde_json::Value = serde_json::from_str(&joined)
        .map_err(|e| ProxyError::Stream(format!("malformed SSE data JSON: {e}")))?;

    Ok(Some(ChatStreamEvent::SseEvent { event_type, data }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_event_anthropic_with_event_type() {
        let block = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}";
        let parsed = parse_sse_event(block, true).unwrap().unwrap();
        match parsed {
            ChatStreamEvent::SseEvent { event_type, data } => {
                assert_eq!(event_type.as_deref(), Some("content_block_delta"));
                assert_eq!(data["delta"]["text"], "hi");
            }
            _ => panic!("expected SseEvent"),
        }
    }

    #[test]
    fn parse_sse_event_openai_no_event_line() {
        let block = "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}";
        let parsed = parse_sse_event(block, false).unwrap().unwrap();
        match parsed {
            ChatStreamEvent::SseEvent { event_type, data } => {
                // With `parse_event_lines = false` an `event:` line is not read
                // as event_type, even if the provider sent one.
                assert_eq!(event_type, None);
                assert_eq!(data["choices"][0]["delta"]["content"], "hi");
            }
            _ => panic!("expected SseEvent"),
        }
    }

    #[test]
    fn parse_sse_event_done_marker_is_none() {
        let block = "data: [DONE]";
        assert!(parse_sse_event(block, false).unwrap().is_none());
    }

    #[test]
    fn parse_sse_event_keepalive_comment_is_none() {
        let block = ": keepalive";
        assert!(parse_sse_event(block, true).unwrap().is_none());
    }

    #[test]
    fn parse_sse_event_blank_block_is_none() {
        // A spurious extra "\n\n" inside a stream produces an empty block,
        // which is a no-op rather than an error so it does not kill the stream.
        assert!(parse_sse_event("", false).unwrap().is_none());
    }

    #[test]
    fn parse_sse_event_multiline_data_is_joined_with_newlines() {
        // Multiple data: lines in one event are joined with \n, as SSE
        // defines.
        let block = "data: line1\ndata: line2";
        // line1\nline2 is not valid JSON, so the parser reports it rather than
        // swallowing it.
        let err = parse_sse_event(block, false).unwrap_err();
        assert!(matches!(err, ProxyError::Stream(_)));
    }

    #[test]
    fn parse_sse_event_malformed_json_errors() {
        let block = "data: not json";
        let err = parse_sse_event(block, false).unwrap_err();
        assert!(matches!(err, ProxyError::Stream(_)));
    }

    #[test]
    fn proxy_error_serialize_is_human_readable() {
        // The UI shows `ProxyError` strings to the user in a toast, so the wire
        // string must carry the status and the body.
        let err = ProxyError::Provider {
            status: 401,
            body: "invalid_api_key".to_string(),
        };
        let s = serde_json::to_string(&err).unwrap();
        assert!(s.contains("401"), "wire form should mention status code");
        assert!(
            s.contains("invalid_api_key"),
            "wire form should mention body"
        );
    }

    #[test]
    fn provider_as_str_matches_serde_rename() {
        // secret_name builds the secret's name from provider.as_str(), which
        // must match the serde rename so a key is read under the name it was
        // written under.
        assert_eq!(Provider::Anthropic.as_str(), "anthropic");
        assert_eq!(Provider::Openai.as_str(), "openai");
    }

    #[test]
    fn secret_name_is_namespaced() {
        // The secret's name must be prefixed with "provider:" so it can't
        // collide with the app's other secrets in the vault (secret_store).
        for provider in [Provider::Anthropic, Provider::Openai] {
            assert!(
                secret_name(provider).starts_with("provider:"),
                "must be namespaced"
            );
        }
    }

    #[test]
    fn api_key_is_zeroized_on_drop() {
        // Zeroizing<String>, the type stored_key returns, wipes the key bytes
        // when it drops.
        fn assert_zeroize_on_drop<T: zeroize::ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<Zeroizing<String>>();
    }

    #[test]
    fn proxy_error_key_not_configured_is_actionable() {
        let err = ProxyError::KeyNotConfigured {
            provider: "anthropic".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("anthropic"), "message must name the provider");
        assert!(
            msg.contains("Agent Settings"),
            "message must point to where to fix it"
        );
    }

    #[test]
    fn agent_validate_provided_key_accepts_zeroizing_string() {
        // Zeroizing<String>, the type of the api_key parameter, implements
        // ZeroizeOnDrop.
        fn assert_zeroize_on_drop<T: zeroize::ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<Zeroizing<String>>();
    }

    #[test]
    fn validation_outcome_valid_serializes_correctly() {
        let s = serde_json::to_string(&ValidationOutcome::Valid).unwrap();
        assert_eq!(s, r#"{"kind":"valid"}"#);
    }

    #[test]
    fn validation_outcome_invalid_serializes_to_tagged_json() {
        // The UI distinguishes the three outcomes by the `kind` tag, so the
        // wire shape is fixed here.
        let s = serde_json::to_string(&ValidationOutcome::Invalid).unwrap();
        assert_eq!(s, r#"{"kind":"invalid"}"#);
    }

    #[test]
    fn validation_outcome_network_error_preserves_message() {
        let s = serde_json::to_string(&ValidationOutcome::NetworkError {
            message: "connection refused".to_string(),
        })
        .unwrap();
        assert!(s.contains("network_error"), "tag must be snake_case");
        assert!(
            s.contains("connection refused"),
            "payload message must survive"
        );
    }

    #[test]
    fn chat_completion_request_rejects_residual_api_key_field() {
        let body = r#"{"provider":"anthropic","model":"x","messages":[],"api_key":"leak"}"#;
        assert!(
            serde_json::from_str::<ChatCompletionRequest>(body).is_err(),
            "deny_unknown_fields must reject api_key: the key never crosses IPC"
        );
    }
}
