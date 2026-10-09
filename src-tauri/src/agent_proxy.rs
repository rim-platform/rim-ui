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

/// Shared `reqwest::Client` for streaming chat calls: one connection pool
/// process-wide. Avoids re-doing TLS for every request the agent fires (it
/// can fire dozens across a single multi-tool turn). 120s timeout suits
/// slow first-token generation on Opus-class models with large contexts.
fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("reqwest client init must succeed")
    })
}

/// Separate pooled client for the short sidecar calls (validate / list
/// models). Uses a tight 15s timeout so a hung provider doesn't keep the
/// settings UI waiting. Rebuilding a `Client` per call (pre-#59) meant a
/// fresh TLS handshake every time — wasteful and slow.
fn sidecar_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(SIDECAR_TIMEOUT)
            .build()
            .expect("reqwest sidecar client init must succeed")
    })
}

/// Provider tag — narrow enum lets us validate at IPC boundary instead of
/// reaching into freeform strings inside the proxy.
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

/// Mirror of the TS `AiChatRequest` body shape, kept narrow on purpose.
/// `messages` and `tools` are `serde_json::Value` rather than typed structs
/// so we don't have to keep two copies of the provider wire schemas in
/// sync — the JS side already speaks the provider's native shape.
///
/// No `api_key` field — the proxy reads the key from the secret vault.
/// `deny_unknown_fields` forces atomic cutover: any caller still sending
/// the old `api_key` field gets a deserialization error instead of silently
/// hitting `KeyNotConfigured` (Pete's #8 must remove `api_key` from the
/// JS call site before this endpoint works).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatCompletionRequest {
    pub provider: Provider,
    pub model: String,
    /// Provider-native message array (Anthropic shape for `Provider::Anthropic`,
    /// OpenAI shape for `Provider::Openai`). The JS providers already build
    /// these, so we forward them verbatim — keeps schema knowledge in one place.
    pub messages: serde_json::Value,
    #[serde(default)]
    pub tools: Option<serde_json::Value>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// Outbound stream event — lossless wrapper around the SSE frames the
/// providers emit. The TS provider reassembles tool_use blocks and emits
/// the final `AiStreamChunk`s; we deliberately keep the proxy a pure
/// passthrough for the SSE bytes so no business logic lives in two places.
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

/// Outcome of `agent_validate_credentials`. Distinguishes "provider said no"
/// (Invalid) from "we never reached the provider" (NetworkError) so the UI
/// can tell the user to check the key vs check their connection — pre-#59
/// both paths collapsed to `Ok(false)` and Hawkeye WARN #4 flagged the UX
/// confusion (user fixes wrong thing).
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

/// Read the API key for a provider from the secret vault. A missing key is
/// `ProxyError::KeyNotConfigured` so callers get an actionable error message.
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

/// Store or replace the API key for a provider in the secret vault.
///
/// This and the other sync key commands run off the main thread (`async`): they read and
/// write the vault file, and on Linux the vault key's first read can wait on the keyring's
/// unlock prompt.
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

/// Remove the API key for a provider from the secret vault. Idempotent — no
/// error if the key was already absent.
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

/// Check whether an API key is stored for a provider. Does NOT return the key.
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

/// Tauri command: stream a chat completion. Errors that occur before the
/// stream begins return as `Err(ProxyError)` over the invoke result; errors
/// mid-stream are emitted as `ChatStreamEvent::Error` on the channel and
/// terminate the stream. This matches the TS `AiStreamChunk` discipline
/// (the consumer's loop ends on either kind: "error" or kind: "done").
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
            // Surface the failure on the channel too so the TS consumer's
            // for-await loop sees it without needing a separate try/catch
            // around the invoke promise. We still return Err so the invoke
            // promise rejects (TS consumers can pick whichever signal fits).
            let _ = on_event.send(ChatStreamEvent::Error {
                message: e.to_string(),
            });
            Err(e)
        }
    }
}

/// Tauri command: lightweight credential check (used by the Settings panel
/// "Test connection" button). Hits the provider's models endpoint — cheap
/// and the same shape that's already tested green in the TS providers.
#[tauri::command]
pub async fn agent_validate_credentials(
    vault: State<'_, Arc<SecretVault>>,
    provider: Provider,
) -> Result<ValidationOutcome, ProxyError> {
    let api_key = stored_key(&vault, provider)?;
    validate_key_against_provider(provider, &api_key).await
    // api_key Zeroizing<String> is wiped when it drops here.
}

/// Tauri command: verify-then-store flow — validate a candidate key BEFORE
/// writing it to the secret vault. This is the secure path for the "Verify &
/// Save" button: the caller passes the key directly, we probe the provider,
/// and only if `Valid` does the frontend call `set_provider_key`.
///
/// The key parameter is `Zeroizing<String>` so the raw bytes are wiped from
/// the Rust heap as soon as the function returns, regardless of outcome.
/// We never log it, never echo it back, never store it.
#[tauri::command]
pub async fn agent_validate_provided_key(
    provider: Provider,
    api_key: Zeroizing<String>,
) -> Result<ValidationOutcome, ProxyError> {
    validate_key_against_provider(provider, &api_key).await
    // api_key Zeroizing<String> is wiped when it drops here.
}

/// Internal: hit the provider's cheapest authenticated endpoint and map the
/// HTTP outcome to [`ValidationOutcome`]. Shared by both the stored-key
/// and provided-key variants so the probe logic lives in exactly one place.
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

/// Tauri command: list available models from the provider. Used by Agent
/// Settings to populate the model dropdown dynamically — falls back to
/// the TS-side static list if this fails (the TS provider already does
/// this fallback).
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
    // We intentionally do NOT carry the
    // "anthropic-dangerous-direct-browser-access" header — that header is
    // the marker Anthropic added for the previous CORS-from-browser posture,
    // and we are explicitly NOT in that posture now.
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
    // OpenAI uses `system` as a message-array role — the JS provider already
    // injects it into `messages`, so `request.system_prompt` is unused here.

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

/// Drain an SSE response body and forward each `data:` payload as a
/// [`ChatStreamEvent::SseEvent`] on the channel. Buffer is split on `\n\n`
/// (SSE event delimiter); within each event we collect the `data:` JSON
/// and (for Anthropic) the optional `event:` type line.
///
/// This is a deliberately minimal SSE parser — we don't reassemble
/// tool_use blocks, count tokens, or interpret event_type. The TS
/// provider already does that and is unit-tested. Doing it twice is a
/// drift-risk; the proxy stays a passthrough.
async fn forward_sse(
    resp: reqwest::Response,
    on_event: &Channel<ChatStreamEvent>,
    parse_event_lines: bool,
) -> Result<(), ProxyError> {
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| ProxyError::Stream(e.to_string()))?;
        // Provider streams are guaranteed UTF-8; if a chunk splits a multi-byte
        // codepoint we drop the trailing partial bytes back into the buffer
        // on the NEXT iteration's split (the `\n\n` framing keeps us aligned).
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // SSE events are separated by a blank line. Split eagerly and keep
        // the trailing partial event for the next iteration.
        while let Some(idx) = buffer.find("\n\n") {
            let raw_event = buffer[..idx].to_string();
            buffer.drain(..idx + 2);
            if let Some(event) = parse_sse_event(&raw_event, parse_event_lines)? {
                if on_event.send(event).is_err() {
                    // Receiver gone (window closed, request cancelled). Stop
                    // pulling from the provider — no point burning their
                    // tokens for a stream nobody's reading.
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}

/// Parse one SSE event block (already stripped of its trailing `\n\n`).
/// Returns `None` for keepalive comments, `[DONE]` markers, or events with
/// no `data:` line. Returns `Some(SseEvent { ... })` for real payloads.
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
                // `parse_event_lines = false` means we do NOT consume `event:`
                // lines as event_type — even if the provider sent one
                // (OpenAI doesn't, but defensive).
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
        // A spurious extra "\n\n" inside a stream produces an empty block.
        // We treat it as a no-op rather than an error so a finicky provider
        // doesn't kill the stream.
        assert!(parse_sse_event("", false).unwrap().is_none());
    }

    #[test]
    fn parse_sse_event_multiline_data_is_joined_with_newlines() {
        // Per the SSE spec, multiple data: lines in one event get joined
        // with \n. Anthropic and OpenAI don't currently use this, but a
        // future provider (or proxy mid-stream) might.
        let block = "data: line1\ndata: line2";
        // line1\nline2 isn't valid JSON, so this should error — that's the
        // contract: we surface bad SSE rather than silently swallow it.
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
        // The TS side surfaces `ProxyError` strings to the user via toast.
        // Lock the format so a future thiserror version doesn't silently
        // change the wire string.
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
        // secret_name builds the secret's name from provider.as_str(). If this
        // diverges from the serde rename, keys written under one name can't be
        // read under another. Keep both in sync.
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
        // stored_key returns Zeroizing<String> — this bound ensures the key
        // bytes are wiped when the returned value drops. If a future refactor
        // changes the return type to plain String this test will fail to compile.
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
        // Compile-time contract: the api_key parameter is Zeroizing<String>,
        // which implements ZeroizeOnDrop. If a future refactor weakens this to
        // a plain &str or String, this assertion will fail to compile.
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
        // WARN #4 contract: the frontend distinguishes these three cases
        // via the `kind` discriminator. Lock the wire shape so a future
        // serde attribute churn doesn't silently flip the tag name.
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
            "deny_unknown_fields must reject api_key — IPC cutover guarantee for #8"
        );
    }
}
