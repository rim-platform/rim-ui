//! Talking to another server directly, from the desktop: a host when the relay is unreachable,
//! or a new relay while switching to it. Each server gets its own cookie jar here, so its
//! session never reaches the webview and the webview's own session stays with its relay.
//!
//! The webview checks everything a server signs; this module only carries bytes: the discovery
//! document, GraphQL requests with the server's session cookie and CSRF header, and a
//! WebSocket opened with that cookie.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use reqwest::header::{CONTENT_TYPE, COOKIE, SET_COOKIE};
use reqwest::{redirect, Client};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

const DISCOVERY_PATH: &str = "/.well-known/rim-server";
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const DISCOVERY_MAX_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
const CSRF_COOKIE: &str = "rim_csrf";
const CSRF_HEADER: &str = "x-csrf-token";

/// Why a direct request failed.
#[derive(Debug, thiserror::Error)]
pub(crate) enum DirectError {
    #[error("{0}")]
    Invalid(String),
    #[error("the server is unreachable: {0}")]
    Unreachable(String),
    #[error("no direct session with {0}")]
    NoSession(String),
}

impl Serialize for DirectError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            Self::Invalid(_) => "INVALID",
            Self::Unreachable(_) => "UNREACHABLE",
            Self::NoSession(_) => "NO_SESSION",
        };
        let mut s = serializer.serialize_struct("DirectError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

type Result<T> = std::result::Result<T, DirectError>;

/// Where a server answers and the cookies it set.
#[derive(Debug, Clone, Default)]
struct Session {
    graphql: String,
    websocket: String,
    cookies: BTreeMap<String, String>,
}

/// Direct sessions by server id, and the open sockets.
#[derive(Default)]
pub(crate) struct DirectState {
    sessions: Mutex<HashMap<String, Session>>,
    sockets: Mutex<HashMap<u64, mpsc::UnboundedSender<Outgoing>>>,
    next_socket: AtomicU64,
}

enum Outgoing {
    Text(String),
    Close(u16, String),
}

/// A server's answer to a direct request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectResponse {
    status: u16,
    body: String,
    content_type: Option<String>,
}

/// What a direct socket reports to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum SocketEvent {
    Open { protocol: String },
    Message { data: String },
    Close { code: u16, reason: String },
    Error { message: String },
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(redirect::Policy::none())
            .build()
            .unwrap_or_default()
    })
}

fn discovery_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(DISCOVERY_TIMEOUT)
            .redirect(redirect::Policy::none())
            .build()
            .unwrap_or_default()
    })
}

/// An origin as the webview names a server: `http(s)://host[:port]`, nothing after it.
pub(crate) fn checked_origin(origin: &str) -> Result<String> {
    let invalid = || DirectError::Invalid(format!("not a server origin: {origin}"));
    let url = reqwest::Url::parse(origin).map_err(|_| invalid())?;
    let bare = url.path() == "/" && url.query().is_none() && url.fragment().is_none();
    if !matches!(url.scheme(), "http" | "https") || !bare || url.host_str().is_none() {
        return Err(invalid());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid());
    }
    Ok(origin.trim_end_matches('/').to_string())
}

fn checked_url(url: &str, schemes: &[&str]) -> Result<String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| DirectError::Invalid(format!("not a URL: {url}")))?;
    if !schemes.contains(&parsed.scheme()) {
        return Err(DirectError::Invalid(format!(
            "not a server endpoint: {url}"
        )));
    }
    Ok(parsed.to_string())
}

/// The `name=value` a `Set-Cookie` field sets, or `None` with its value when it removes it.
pub(crate) fn parse_set_cookie(field: &str) -> Option<(String, Option<String>)> {
    let mut parts = field.split(';');
    let (name, value) = parts.next()?.trim().split_once('=')?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let expired = parts.any(|attr| {
        let attr = attr.trim().to_ascii_lowercase();
        attr == "max-age=0" || attr.starts_with("max-age=-")
    });
    let value = value.trim().trim_matches('"');
    Some((
        name.to_string(),
        (!expired && !value.is_empty()).then(|| value.to_string()),
    ))
}

fn cookie_header(cookies: &BTreeMap<String, String>) -> Option<String> {
    (!cookies.is_empty()).then(|| {
        cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ")
    })
}

impl DirectState {
    fn session(&self, server_id: &str) -> Result<Session> {
        self.sessions
            .lock()
            .map_err(|_| DirectError::Invalid("direct sessions are unavailable".into()))?
            .get(server_id)
            .cloned()
            .ok_or_else(|| DirectError::NoSession(server_id.to_string()))
    }

    fn take_cookies(&self, server_id: &str, fields: Vec<String>) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        let Some(session) = sessions.get_mut(server_id) else {
            return;
        };
        for field in fields {
            match parse_set_cookie(&field) {
                Some((name, Some(value))) => {
                    session.cookies.insert(name, value);
                }
                Some((name, None)) => {
                    session.cookies.remove(&name);
                }
                None => {}
            }
        }
    }
}

/// Fetch a server's discovery document directly: 5 seconds, 64 KiB, no redirects.
#[tauri::command]
pub async fn relay_direct_discovery(origin: String) -> Result<String> {
    let origin = checked_origin(&origin)?;
    let response = discovery_client()
        .get(format!("{origin}{DISCOVERY_PATH}"))
        .send()
        .await
        .map_err(|e| DirectError::Unreachable(e.to_string()))?;
    if !response.status().is_success() {
        return Err(DirectError::Unreachable(format!(
            "the discovery document answered {}",
            response.status()
        )));
    }
    let bytes = read_capped(response, DISCOVERY_MAX_BYTES).await?;
    String::from_utf8(bytes)
        .map_err(|_| DirectError::Invalid("the discovery document is not text".into()))
}

async fn read_capped(response: reqwest::Response, max: usize) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| DirectError::Unreachable(e.to_string()))?;
        if body.len() + chunk.len() > max {
            return Err(DirectError::Invalid("the answer is too large".into()));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Start (or keep) a direct session with `server_id` at its verified endpoints.
#[tauri::command]
pub async fn relay_direct_open(
    state: State<'_, DirectState>,
    server_id: String,
    graphql: String,
    websocket: String,
) -> Result<()> {
    let graphql = checked_url(&graphql, &["http", "https"])?;
    let websocket = checked_url(&websocket, &["ws", "wss"])?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| DirectError::Invalid("direct sessions are unavailable".into()))?;
    let session = sessions.entry(server_id).or_default();
    if session.graphql != graphql || session.websocket != websocket {
        *session = Session {
            graphql,
            websocket,
            cookies: BTreeMap::new(),
        };
    }
    Ok(())
}

/// End the direct session with `server_id`: its cookies go.
#[tauri::command]
pub async fn relay_direct_close(state: State<'_, DirectState>, server_id: String) -> Result<()> {
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&server_id);
    }
    Ok(())
}

/// POST a GraphQL body to `server_id` with its session cookie and CSRF header.
#[tauri::command]
pub async fn relay_direct_graphql(
    state: State<'_, DirectState>,
    server_id: String,
    body: String,
) -> Result<DirectResponse> {
    let session = state.session(&server_id)?;
    let mut request = client()
        .post(&session.graphql)
        .header(CONTENT_TYPE, "application/json")
        .body(body);
    if let Some(cookies) = cookie_header(&session.cookies) {
        request = request.header(COOKIE, cookies);
    }
    if let Some(csrf) = session.cookies.get(CSRF_COOKIE) {
        request = request.header(CSRF_HEADER, csrf);
    }
    let response = request
        .send()
        .await
        .map_err(|e| DirectError::Unreachable(e.to_string()))?;
    let set: Vec<String> = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(str::to_string))
        .collect();
    state.take_cookies(&server_id, set);
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = read_capped(response, MAX_BODY_BYTES).await?;
    Ok(DirectResponse {
        status,
        body: String::from_utf8_lossy(&body).into_owned(),
        content_type,
    })
}

/// Open a WebSocket to `server_id`'s endpoint with its session cookie, in `protocol`. Events
/// arrive on `on_event`; the id names the socket to send on and close.
#[tauri::command]
pub async fn relay_direct_socket_open(
    state: State<'_, DirectState>,
    server_id: String,
    protocol: String,
    on_event: Channel<SocketEvent>,
) -> Result<u64> {
    let session = state.session(&server_id)?;
    let mut request = session
        .websocket
        .as_str()
        .into_client_request()
        .map_err(|e| DirectError::Invalid(e.to_string()))?;
    let headers = request.headers_mut();
    let header = |text: &str| {
        HeaderValue::from_str(text)
            .map_err(|_| DirectError::Invalid("a header is malformed".into()))
    };
    headers.insert("Sec-WebSocket-Protocol", header(&protocol)?);
    if let Some(cookies) = cookie_header(&session.cookies) {
        headers.insert("Cookie", header(&cookies)?);
    }
    let (stream, response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| DirectError::Unreachable(e.to_string()))?;
    let chosen = response
        .headers()
        .get("Sec-WebSocket-Protocol")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let id = state.next_socket.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, mut rx) = mpsc::unbounded_channel::<Outgoing>();
    state
        .sockets
        .lock()
        .map_err(|_| DirectError::Invalid("direct sockets are unavailable".into()))?
        .insert(id, tx);
    let _ = on_event.send(SocketEvent::Open { protocol: chosen });

    let (mut sink, mut source) = stream.split();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                outgoing = rx.recv() => match outgoing {
                    Some(Outgoing::Text(text)) => {
                        if let Err(e) = sink.send(Message::text(text)).await {
                            let _ = on_event.send(SocketEvent::Error { message: e.to_string() });
                            break;
                        }
                    }
                    Some(Outgoing::Close(code, reason)) => {
                        let frame = CloseFrame { code: CloseCode::from(code), reason: reason.into() };
                        let _ = sink.send(Message::Close(Some(frame))).await;
                    }
                    None => {
                        let _ = sink.close().await;
                        break;
                    }
                },
                incoming = source.next() => match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let _ = on_event.send(SocketEvent::Message { data: text.to_string() });
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame
                            .map(|f| (u16::from(f.code), f.reason.to_string()))
                            .unwrap_or((1005, String::new()));
                        let _ = on_event.send(SocketEvent::Close { code, reason });
                        return;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        let _ = on_event.send(SocketEvent::Error { message: e.to_string() });
                        break;
                    }
                    None => break,
                },
            }
        }
        let _ = on_event.send(SocketEvent::Close {
            code: 1006,
            reason: String::new(),
        });
    });
    Ok(id)
}

/// Send a text frame on a direct socket.
#[tauri::command]
pub async fn relay_direct_socket_send(
    state: State<'_, DirectState>,
    socket_id: u64,
    data: String,
) -> Result<()> {
    let sockets = state
        .sockets
        .lock()
        .map_err(|_| DirectError::Invalid("direct sockets are unavailable".into()))?;
    let socket = sockets
        .get(&socket_id)
        .ok_or_else(|| DirectError::Invalid("that socket is closed".into()))?;
    socket
        .send(Outgoing::Text(data))
        .map_err(|_| DirectError::Invalid("that socket is closed".into()))
}

/// Close a direct socket.
#[tauri::command]
pub async fn relay_direct_socket_close(
    state: State<'_, DirectState>,
    socket_id: u64,
    code: Option<u16>,
    reason: Option<String>,
) -> Result<()> {
    let socket = state
        .sockets
        .lock()
        .map_err(|_| DirectError::Invalid("direct sockets are unavailable".into()))?
        .remove(&socket_id);
    if let Some(socket) = socket {
        let _ = socket.send(Outgoing::Close(
            code.unwrap_or(1000),
            reason.unwrap_or_default(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_are_bare_http_urls() {
        assert_eq!(
            checked_origin("https://host.example").unwrap(),
            "https://host.example"
        );
        assert_eq!(
            checked_origin("http://localhost:8080/").unwrap(),
            "http://localhost:8080"
        );
        for bad in [
            "https://host.example/api",
            "ftp://host.example",
            "https://user@host.example",
            "https://host.example?x=1",
            "host.example",
        ] {
            assert!(checked_origin(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn set_cookie_fields_set_and_remove() {
        assert_eq!(
            parse_set_cookie("rim_session=abc; Path=/; HttpOnly; SameSite=Lax"),
            Some(("rim_session".into(), Some("abc".into())))
        );
        assert_eq!(
            parse_set_cookie("rim_csrf=; Max-Age=0; Path=/"),
            Some(("rim_csrf".into(), None))
        );
        assert_eq!(
            parse_set_cookie("rim_csrf=x; Max-Age=0"),
            Some(("rim_csrf".into(), None))
        );
        assert_eq!(parse_set_cookie("garbage"), None);
        let mut jar = BTreeMap::new();
        jar.insert("b".to_string(), "2".to_string());
        jar.insert("a".to_string(), "1".to_string());
        assert_eq!(cookie_header(&jar).as_deref(), Some("a=1; b=2"));
        assert_eq!(cookie_header(&BTreeMap::new()), None);
    }

    #[test]
    fn a_session_keeps_its_cookies_until_its_endpoints_change() {
        let state = DirectState::default();
        state.sessions.lock().unwrap().insert(
            "rims1_a".into(),
            Session {
                graphql: "https://host.example/api".into(),
                websocket: "wss://host.example/api/ws".into(),
                cookies: BTreeMap::new(),
            },
        );
        state.take_cookies(
            "rims1_a",
            vec!["rim_session=s1; HttpOnly".into(), "rim_csrf=c1".into()],
        );
        let session = state.session("rims1_a").unwrap();
        assert_eq!(
            session.cookies.get("rim_csrf").map(String::as_str),
            Some("c1")
        );
        state.take_cookies("rims1_a", vec!["rim_session=; Max-Age=0".into()]);
        assert!(!state
            .session("rims1_a")
            .unwrap()
            .cookies
            .contains_key("rim_session"));
        assert!(matches!(
            state.session("rims1_b"),
            Err(DirectError::NoSession(_))
        ));
    }
}
