//! The agent bridge: a loopback HTTP server that hands requests from agents on this computer to
//! the page, and returns its answers. It decides nothing about agents.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use http_body_util::{BodyExt, Full, LengthLimitError, Limited};
use hyper::body::{Body, Bytes, Incoming};
use hyper::header::{self, HeaderMap, HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, OwnedSemaphorePermit, Semaphore};

use crate::desktop_shell;

const PORT: u16 = 47821;
/// The event that hands a request to the page, with a [`BridgeRequest`].
const REQUEST_EVENT: &str = "agent-bridge://request";
/// How long the page has to take a request before the bridge says it is not ready.
const ACK_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the page has to answer a request it took: long enough for a person to confirm a change.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(120);
/// Largest request body.
const MAX_BODY: usize = 1024 * 1024;
/// Most requests in progress at once; past that, the bridge answers 429.
const MAX_IN_FLIGHT: usize = 8;
/// Most open connections at once; past that, a new connection is closed with no response.
const MAX_CONNECTIONS: usize = 64;
/// How long a client has to send its request line and headers.
const HEADER_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a client has to send its body.
const BODY_TIMEOUT: Duration = Duration::from_secs(10);
/// How long stopping the server waits for the port to be released.
const STOP_TIMEOUT: Duration = Duration::from_secs(1);
/// How long the server waits after a failed accept before trying again.
const ACCEPT_RETRY_DELAY: Duration = Duration::from_millis(100);

/// The paths the bridge serves.
const PATHS: [&str; 3] = ["/mcp", "/pair", "/pair/poll"];

/// A request handed to the page. `authorization` is the header as sent, or `None`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeRequest {
    id: u64,
    path: String,
    authorization: Option<String>,
    body: String,
}

/// A request that passed every check, before the page has been told about it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct AdmittedRequest {
    path: String,
    authorization: Option<String>,
    body: String,
}

/// The page's answer: an HTTP status and a JSON body.
#[derive(Debug, Clone, PartialEq, Eq)]
struct BridgeAnswer {
    status: u16,
    body: String,
}

/// Why a request was turned away before the page answered it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refused {
    NotFound,
    MethodNotAllowed,
    BadHost,
    HasOrigin,
    BadContentType,
    TooLarge,
    /// The body did not arrive whole within its time.
    SlowBody,
    Busy,
    NotReady,
    TimedOut,
}

impl Refused {
    /// The HTTP status of this refusal.
    fn status(self) -> u16 {
        match self {
            Self::NotFound => 404,
            Self::MethodNotAllowed => 405,
            Self::BadHost | Self::HasOrigin => 403,
            Self::BadContentType => 415,
            Self::TooLarge => 413,
            Self::SlowBody => 408,
            Self::Busy => 429,
            Self::NotReady => 503,
            Self::TimedOut => 504,
        }
    }

    /// The code in this refusal's body.
    fn code(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::MethodNotAllowed => "method_not_allowed",
            Self::BadHost => "bad_host",
            Self::HasOrigin => "has_origin",
            Self::BadContentType => "bad_content_type",
            Self::TooLarge => "too_large",
            Self::SlowBody => "slow_body",
            Self::Busy => "busy",
            Self::NotReady => "not_ready",
            Self::TimedOut => "timed_out",
        }
    }

    /// The answer that says so.
    fn answer(self) -> BridgeAnswer {
        BridgeAnswer {
            status: self.status(),
            body: format!(r#"{{"error":"{}"}}"#, self.code()),
        }
    }
}

/// What the request line and headers allow: the path to hand to the page, or why not.
fn admit(
    port: u16,
    method: &str,
    url: &str,
    host: Option<&str>,
    origin: Option<&str>,
    content_type: Option<&str>,
    content_length: Option<u64>,
) -> Result<String, Refused> {
    let local = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    if !host.is_some_and(|host| local.iter().any(|allowed| allowed == host)) {
        return Err(Refused::BadHost);
    }
    if origin.is_some() {
        return Err(Refused::HasOrigin);
    }
    let path = url.split('?').next().unwrap_or(url);
    if !PATHS.contains(&path) {
        return Err(Refused::NotFound);
    }
    if method != "POST" {
        return Err(Refused::MethodNotAllowed);
    }
    let is_json = content_type.is_some_and(|value| {
        value
            .split(';')
            .next()
            .unwrap_or(value)
            .trim()
            .eq_ignore_ascii_case("application/json")
    });
    if !is_json {
        return Err(Refused::BadContentType);
    }
    if content_length.is_some_and(|length| length > MAX_BODY as u64) {
        return Err(Refused::TooLarge);
    }
    Ok(path.to_owned())
}

/// What happens to an admitted request: the page's answer, or why there is none.
type Forward = Arc<dyn Fn(AdmittedRequest) -> Result<BridgeAnswer, Refused> + Send + Sync>;

/// A running server. Dropping it stops the server, ends its open connections and releases the port.
struct Listener {
    shutdown: watch::Sender<bool>,
    stopped: mpsc::Receiver<()>,
    #[cfg(test)]
    port: u16,
}

impl Listener {
    /// Starts a server on `127.0.0.1:port`.
    ///
    /// # Errors
    ///
    /// A message saying the port is in use, or why it could not be bound otherwise.
    fn start(port: u16, forward: Forward) -> Result<Self, String> {
        Self::start_with(port, forward, BODY_TIMEOUT)
    }

    /// Starts a server on `127.0.0.1:port` that gives a client `body_timeout` to send its body.
    fn start_with(port: u16, forward: Forward, body_timeout: Duration) -> Result<Self, String> {
        let listener = std::net::TcpListener::bind(("127.0.0.1", port)).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                format!("port {port} is in use")
            } else {
                error.to_string()
            }
        })?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let runtime = tauri::async_runtime::handle();
        let listener = {
            let _entered = runtime.inner().enter();
            TcpListener::from_std(listener).map_err(|e| e.to_string())?
        };
        let (shutdown, shutdown_seen) = watch::channel(false);
        let (stopped_sender, stopped) = mpsc::channel();
        let serving = Arc::new(Serving {
            port,
            forward,
            body_timeout,
            in_flight: Arc::new(AtomicUsize::new(0)),
        });
        runtime.spawn(accept_loop(
            listener,
            serving,
            shutdown_seen,
            stopped_sender,
        ));
        Ok(Self {
            shutdown,
            stopped,
            #[cfg(test)]
            port,
        })
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
        if self.stopped.recv_timeout(STOP_TIMEOUT).is_err() {
            log::warn!("the agent bridge did not stop in time");
        }
    }
}

/// What every connection of a running server shares.
struct Serving {
    port: u16,
    forward: Forward,
    body_timeout: Duration,
    in_flight: Arc<AtomicUsize>,
}

/// Accepts connections until told to stop, then releases the port and says so.
async fn accept_loop(
    listener: TcpListener,
    serving: Arc<Serving>,
    mut shutdown: watch::Receiver<bool>,
    stopped: mpsc::Sender<()>,
) {
    let connections = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    loop {
        let accepted = tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => accepted,
        };
        match accepted {
            Ok((stream, _)) => {
                if let Ok(permit) = connections.clone().try_acquire_owned() {
                    tokio::spawn(serve_connection(
                        stream,
                        permit,
                        serving.clone(),
                        shutdown.clone(),
                    ));
                }
            }
            Err(error) => {
                log::warn!("the agent bridge could not accept a connection: {error}");
                tokio::time::sleep(ACCEPT_RETRY_DELAY).await;
            }
        }
    }
    drop(listener);
    let _ = stopped.send(());
}

/// Serves one request on one connection, and drops the connection when the server stops.
async fn serve_connection(
    stream: TcpStream,
    _permit: OwnedSemaphorePermit,
    serving: Arc<Serving>,
    mut shutdown: watch::Receiver<bool>,
) {
    let service = service_fn(move |request| {
        let serving = serving.clone();
        async move { Ok::<_, Infallible>(respond(request, &serving).await) }
    });
    let connection = http1::Builder::new()
        .keep_alive(false)
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_TIMEOUT)
        .serve_connection(TokioIo::new(stream), service);
    tokio::select! {
        _ = connection => {}
        _ = shutdown.changed() => {}
    }
}

/// The response to a request: the page's answer, or a refusal, whose code is logged.
async fn respond(request: Request<Incoming>, serving: &Serving) -> Response<Full<Bytes>> {
    let answer = handle(request, serving).await.unwrap_or_else(|refused| {
        log::info!("the agent bridge refused a request: {}", refused.code());
        refused.answer()
    });
    let mut response = Response::new(Full::new(Bytes::from(answer.body)));
    *response.status_mut() =
        StatusCode::from_u16(answer.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

/// Checks a request, reads its body and forwards it.
async fn handle(request: Request<Incoming>, serving: &Serving) -> Result<BridgeAnswer, Refused> {
    let (parts, body) = request.into_parts();
    let path = admit(
        serving.port,
        parts.method.as_str(),
        &parts.uri.to_string(),
        header_text(&parts.headers, &header::HOST).as_deref(),
        header_text(&parts.headers, &header::ORIGIN).as_deref(),
        header_text(&parts.headers, &header::CONTENT_TYPE).as_deref(),
        body.size_hint().exact(),
    )?;
    let authorization = header_text(&parts.headers, &header::AUTHORIZATION);
    let slot = InFlightSlot::take(&serving.in_flight).ok_or(Refused::Busy)?;
    let body = read_body(body, serving.body_timeout).await?;
    let forward = serving.forward.clone();
    let admitted = AdmittedRequest {
        path,
        authorization,
        body,
    };
    tokio::task::spawn_blocking(move || {
        let _slot = slot;
        forward(admitted)
    })
    .await
    .unwrap_or(Err(Refused::NotReady))
}

/// A header's value as text. A present header stays present, whatever its bytes are.
fn header_text(headers: &HeaderMap, name: &HeaderName) -> Option<String> {
    headers
        .get(name)
        .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned())
}

/// Reads a body of at most [`MAX_BODY`] bytes of UTF-8, giving the client `timeout` to send it.
async fn read_body(body: Incoming, timeout: Duration) -> Result<String, Refused> {
    let collected = tokio::time::timeout(timeout, Limited::new(body, MAX_BODY).collect())
        .await
        .map_err(|_| Refused::SlowBody)?
        .map_err(|error| {
            if error.is::<LengthLimitError>() {
                Refused::TooLarge
            } else {
                Refused::SlowBody
            }
        })?;
    String::from_utf8(collected.to_bytes().to_vec()).map_err(|_| Refused::BadContentType)
}

/// One of the [`MAX_IN_FLIGHT`] places for a request in progress, released on drop.
struct InFlightSlot(Arc<AtomicUsize>);

impl InFlightSlot {
    /// Takes a place, or `None` when all are taken.
    fn take(in_flight: &Arc<AtomicUsize>) -> Option<Self> {
        in_flight
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |taken| {
                (taken < MAX_IN_FLIGHT).then_some(taken + 1)
            })
            .ok()
            .map(|_| Self(in_flight.clone()))
    }
}

impl Drop for InFlightSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The agent bridge's state, managed by the app.
#[derive(Default)]
pub(crate) struct AgentBridge {
    listener: Mutex<Option<Listener>>,
    error: Mutex<Option<String>>,
    waiting: Arc<Mutex<HashMap<u64, Waiting>>>,
    next_id: Arc<AtomicU64>,
}

/// A request the page was handed and has not answered.
struct Waiting {
    acknowledged: Arc<AtomicBool>,
    answer: mpsc::Sender<BridgeAnswer>,
}

impl AgentBridge {
    /// Starts or stops the listener to match `enabled`. A port that cannot be bound is logged and
    /// kept as the error.
    fn apply<R: Runtime>(&self, app: &AppHandle<R>, enabled: bool) {
        let mut listener = lock(&self.listener);
        let mut error = lock(&self.error);
        if !enabled {
            *listener = None;
            *error = None;
            return;
        }
        if listener.is_some() {
            return;
        }
        let forward = page_forward(app.clone(), self.waiting.clone(), self.next_id.clone());
        match Listener::start(PORT, forward) {
            Ok(started) => {
                *listener = Some(started);
                *error = None;
            }
            Err(message) => {
                log::warn!("could not start the agent bridge: {message}");
                *error = Some(message);
            }
        }
    }

    /// Records that the page took request `id`. An unknown id is ignored.
    fn acknowledge(&self, id: u64) {
        if let Some(waiting) = lock(&self.waiting).get(&id) {
            waiting.acknowledged.store(true, Ordering::SeqCst);
        }
    }

    /// Passes on the page's answer to request `id`. An unknown id is ignored, and a status outside
    /// 200..=599 becomes 500.
    fn answer(&self, id: u64, status: u16, body: String) {
        if let Some(waiting) = lock(&self.waiting).remove(&id) {
            let status = if (200..=599).contains(&status) {
                status
            } else {
                500
            };
            let _ = waiting.answer.send(BridgeAnswer { status, body });
        }
    }
}

/// Locks `mutex`, going on with its contents if another thread panicked while holding it.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The forward of the real app: hands a request to the page and waits for its answer.
fn page_forward<R: Runtime>(
    app: AppHandle<R>,
    waiting: Arc<Mutex<HashMap<u64, Waiting>>>,
    next_id: Arc<AtomicU64>,
) -> Forward {
    Arc::new(move |request| {
        let id = next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (answer, receiver) = mpsc::channel();
        let acknowledged = Arc::new(AtomicBool::new(false));
        lock(&waiting).insert(
            id,
            Waiting {
                acknowledged: acknowledged.clone(),
                answer,
            },
        );
        let payload = BridgeRequest {
            id,
            path: request.path,
            authorization: request.authorization,
            body: request.body,
        };
        let result = match app.emit_to(desktop_shell::MAIN_WINDOW, REQUEST_EVENT, payload) {
            Ok(()) => await_answer(&receiver, &acknowledged, ACK_TIMEOUT, ANSWER_TIMEOUT),
            Err(_) => Err(Refused::NotReady),
        };
        lock(&waiting).remove(&id);
        result
    })
}

/// Waits for the page's answer. A page that has not taken the request within `ack_timeout` is not
/// ready; one that took it has until `answer_timeout`, counted from the start.
fn await_answer(
    receiver: &mpsc::Receiver<BridgeAnswer>,
    acknowledged: &AtomicBool,
    ack_timeout: Duration,
    answer_timeout: Duration,
) -> Result<BridgeAnswer, Refused> {
    if let Ok(answer) = receiver.recv_timeout(ack_timeout) {
        return Ok(answer);
    }
    if !acknowledged.load(Ordering::SeqCst) {
        return Err(Refused::NotReady);
    }
    receiver
        .recv_timeout(answer_timeout.saturating_sub(ack_timeout))
        .map_err(|_| Refused::TimedOut)
}

/// Whether the bridge should run, whether it does, and why it could not start.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBridgeStatus {
    enabled: bool,
    listening: bool,
    error: Option<String>,
    port: u16,
}

/// The status as it is now.
fn status_of<R: Runtime>(app: &AppHandle<R>, bridge: &AgentBridge) -> AgentBridgeStatus {
    AgentBridgeStatus {
        enabled: desktop_shell::agents_enabled(app),
        listening: lock(&bridge.listener).is_some(),
        error: lock(&bridge.error).clone(),
        port: PORT,
    }
}

/// Puts the bridge in the app's state, and starts it if the setting asks for it. Call it after the
/// desktop shell's setup.
pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) {
    let bridge = AgentBridge::default();
    if desktop_shell::agents_enabled(app) {
        bridge.apply(app, true);
    }
    app.manage(bridge);
}

/// Whether the bridge should run, whether it does, and why it could not start.
#[tauri::command]
pub fn agent_bridge_status<R: Runtime>(
    app: AppHandle<R>,
    bridge: State<'_, AgentBridge>,
) -> AgentBridgeStatus {
    status_of(&app, &bridge)
}

/// Saves whether agents may connect, then starts or stops the bridge. A port that cannot be bound
/// is not an error: the setting stays on and the status says why it is not listening.
///
/// # Errors
///
/// A message when the setting could not be saved; nothing then changes.
#[tauri::command]
pub fn agent_bridge_set_enabled<R: Runtime>(
    app: AppHandle<R>,
    bridge: State<'_, AgentBridge>,
    enabled: bool,
) -> Result<AgentBridgeStatus, String> {
    desktop_shell::save_agents_enabled(&app, enabled)?;
    bridge.apply(&app, enabled);
    Ok(status_of(&app, &bridge))
}

/// Records that the page took request `id`.
#[tauri::command]
pub fn agent_bridge_ack(bridge: State<'_, AgentBridge>, id: u64) {
    bridge.acknowledge(id);
}

/// Passes on the page's answer to request `id`.
#[tauri::command]
pub fn agent_bridge_answer(bridge: State<'_, AgentBridge>, id: u64, status: u16, body: String) {
    bridge.answer(id, status, body);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{ErrorKind, Read, Write};
    use std::net::TcpStream as StdTcpStream;
    use std::thread;
    use std::time::Instant;

    const JSON: Option<&str> = Some("application/json");

    /// `admit` with everything allowed except what the test passes.
    fn admit_post(url: &str, host: &str, content_type: Option<&str>) -> Result<String, Refused> {
        admit(PORT, "POST", url, Some(host), None, content_type, None)
    }

    fn local_host() -> String {
        format!("127.0.0.1:{PORT}")
    }

    #[test]
    fn admits_a_local_post_with_json() {
        for path in PATHS {
            for host in [format!("127.0.0.1:{PORT}"), format!("localhost:{PORT}")] {
                for content_type in [
                    "application/json",
                    "application/json; charset=utf-8",
                    "Application/JSON",
                ] {
                    assert_eq!(
                        admit_post(path, &host, Some(content_type)),
                        Ok(path.to_owned())
                    );
                }
            }
        }
    }

    #[test]
    fn a_query_is_not_part_of_the_path() {
        assert_eq!(
            admit_post("/mcp?session=1", &local_host(), JSON),
            Ok("/mcp".to_owned())
        );
    }

    #[test]
    fn refuses_another_host() {
        for host in [
            format!("evil.example:{PORT}"),
            "127.0.0.1:1".to_owned(),
            "127.0.0.1".to_owned(),
        ] {
            assert_eq!(admit_post("/mcp", &host, JSON), Err(Refused::BadHost));
        }
        assert_eq!(
            admit(PORT, "POST", "/mcp", None, None, JSON, None),
            Err(Refused::BadHost)
        );
    }

    #[test]
    fn refuses_any_origin() {
        for origin in ["https://evil.example", "null"] {
            assert_eq!(
                admit(
                    PORT,
                    "POST",
                    "/mcp",
                    Some(&local_host()),
                    Some(origin),
                    JSON,
                    None
                ),
                Err(Refused::HasOrigin)
            );
        }
    }

    #[test]
    fn refuses_other_paths() {
        for path in ["/", "/mcp/x", "/MCP"] {
            assert_eq!(
                admit_post(path, &local_host(), JSON),
                Err(Refused::NotFound)
            );
        }
    }

    #[test]
    fn refuses_an_absolute_form_url() {
        let url = format!("http://127.0.0.1:{PORT}/mcp");
        assert_eq!(
            admit_post(&url, &local_host(), JSON),
            Err(Refused::NotFound)
        );
    }

    #[test]
    fn refuses_other_methods() {
        for method in ["GET", "DELETE", "OPTIONS"] {
            assert_eq!(
                admit(PORT, method, "/mcp", Some(&local_host()), None, JSON, None),
                Err(Refused::MethodNotAllowed)
            );
        }
    }

    #[test]
    fn refuses_other_content_types() {
        for content_type in [
            Some("text/plain"),
            Some("application/x-www-form-urlencoded"),
            None,
        ] {
            assert_eq!(
                admit_post("/mcp", &local_host(), content_type),
                Err(Refused::BadContentType)
            );
        }
    }

    #[test]
    fn refuses_an_oversized_body_by_its_length() {
        let admitted = |length: u64| {
            admit(
                PORT,
                "POST",
                "/mcp",
                Some(&local_host()),
                None,
                JSON,
                Some(length),
            )
        };
        assert_eq!(admitted(MAX_BODY as u64), Ok("/mcp".to_owned()));
        assert_eq!(admitted(MAX_BODY as u64 + 1), Err(Refused::TooLarge));
    }

    #[test]
    fn the_host_is_checked_first() {
        assert_eq!(
            admit(
                PORT,
                "GET",
                "/nothing",
                Some("evil.example"),
                Some("https://evil.example"),
                None,
                None
            ),
            Err(Refused::BadHost)
        );
    }

    /// A forward that answers 200 with `{}`.
    fn ok() -> Result<BridgeAnswer, Refused> {
        Ok(BridgeAnswer {
            status: 200,
            body: "{}".to_owned(),
        })
    }

    /// A forward that counts its calls and answers 200.
    fn counting() -> (Forward, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        let forward: Forward = Arc::new(move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            ok()
        });
        (forward, calls)
    }

    /// A forward that blocks until the returned sender is dropped, and the count of calls that
    /// have reached it.
    fn blocking() -> (Forward, Arc<AtomicUsize>, mpsc::Sender<()>) {
        let entered = Arc::new(AtomicUsize::new(0));
        let (release, gate) = mpsc::channel::<()>();
        let gate = Arc::new(Mutex::new(gate));
        let counted = entered.clone();
        let forward: Forward = Arc::new(move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            let _ = gate.lock().unwrap().recv();
            ok()
        });
        (forward, entered, release)
    }

    /// Waits until `count` reaches `expected`.
    fn wait_for(count: &AtomicUsize, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while count.load(Ordering::SeqCst) < expected {
            assert!(Instant::now() < deadline, "only {count:?} of {expected}");
            thread::sleep(Duration::from_millis(5));
        }
    }

    /// Connects and writes `raw`. Reading it later fails rather than hangs.
    fn send(port: u16, raw: &[u8]) -> StdTcpStream {
        let mut stream = StdTcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(30)))
            .unwrap();
        stream.write_all(raw).unwrap();
        stream
    }

    /// Reads until the server closes the connection. A reset counts as closing; a read that times
    /// out fails the test.
    fn read_response(stream: &mut StdTcpStream) -> String {
        let mut response = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => response.extend_from_slice(&buffer[..read]),
                Err(error)
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
                {
                    panic!("the server did not close the connection: {error}")
                }
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&response).into_owned()
    }

    fn status_line_code(response: &str) -> u16 {
        response
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or_else(|| panic!("not a response: {response:?}"))
    }

    /// The bytes of a well-formed request with `extra` headers.
    fn request_bytes(port: u16, extra: &str, body: &str) -> Vec<u8> {
        format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\n{extra}\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    /// Sends a well-formed request and returns the response.
    fn post(port: u16, extra: &str, body: &str) -> String {
        read_response(&mut send(port, &request_bytes(port, extra, body)))
    }

    #[test]
    fn hands_a_request_over_and_returns_the_answer() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let recorded = seen.clone();
        let listener = Listener::start(
            0,
            Arc::new(move |request| {
                recorded.lock().unwrap().push(request);
                Ok(BridgeAnswer {
                    status: 200,
                    body: r#"{"ok":true}"#.to_owned(),
                })
            }),
        )
        .unwrap();

        let response = post(listener.port, "Authorization: Bearer abc\r\n", "{\"a\":1}");

        assert_eq!(status_line_code(&response), 200);
        assert!(response.ends_with(r#"{"ok":true}"#), "{response}");
        let headers = response.to_lowercase();
        assert!(
            headers.contains("content-type: application/json"),
            "{response}"
        );
        assert!(
            !headers.contains("access-control-allow-origin"),
            "{response}"
        );
        assert_eq!(
            *seen.lock().unwrap(),
            [AdmittedRequest {
                path: "/mcp".to_owned(),
                authorization: Some("Bearer abc".to_owned()),
                body: "{\"a\":1}".to_owned(),
            }]
        );
    }

    #[test]
    fn a_refusal_has_a_json_body_with_its_code() {
        let (forward, _) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let response = post(listener.port, "Origin: https://evil.example\r\n", "{}");
        assert!(
            response.ends_with(r#"{"error":"has_origin"}"#),
            "{response}"
        );
        assert!(
            response
                .to_lowercase()
                .contains("content-type: application/json"),
            "{response}"
        );
    }

    #[test]
    fn a_browser_style_request_never_reaches_the_forward() {
        let (forward, calls) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let response = post(listener.port, "Origin: https://evil.example\r\n", "{}");
        assert_eq!(status_line_code(&response), 403);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn an_undecodable_origin_is_refused() {
        let (forward, calls) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let mut raw = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\n\
             Content-Length: 2\r\nOrigin: ",
            listener.port
        )
        .into_bytes();
        raw.push(0xff);
        raw.extend_from_slice(b"\r\n\r\n{}");
        let response = read_response(&mut send(listener.port, &raw));
        assert_eq!(status_line_code(&response), 403, "{response}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn an_absolute_form_url_is_not_found() {
        let (forward, calls) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        let raw = format!(
            "POST http://127.0.0.1:{port}/mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
             Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}"
        );
        let response = read_response(&mut send(port, raw.as_bytes()));
        assert_eq!(status_line_code(&response), 404, "{response}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_body_over_the_limit_is_refused() {
        let (forward, calls) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        let size = MAX_BODY + 1;
        let mut raw = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
             Transfer-Encoding: chunked\r\n\r\n{size:x}\r\n"
        )
        .into_bytes();
        raw.resize(raw.len() + size, b'x');
        let response = read_response(&mut send(port, &raw));
        assert_eq!(status_line_code(&response), 413, "{response}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_body_that_is_not_utf8_is_refused() {
        let (forward, calls) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        let mut raw = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
             Content-Length: 1\r\n\r\n"
        )
        .into_bytes();
        raw.push(0xff);
        let response = read_response(&mut send(port, &raw));
        assert_eq!(status_line_code(&response), 415, "{response}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_huge_declared_length_is_refused_and_the_bridge_lives() {
        let (forward, calls) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        for (length, status) in [("70368744177664", 413), ("18446744073709551615", 431)] {
            let raw = format!(
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
                 Content-Type: application/json\r\nContent-Length: {length}\r\n\r\n"
            );
            let response = read_response(&mut send(port, raw.as_bytes()));
            assert_eq!(status_line_code(&response), status, "{response}");
            assert_eq!(status_line_code(&post(port, "", "{}")), 200);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_stalled_declared_body_does_not_hold_up_others() {
        let (forward, _) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        let raw = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\n\
             Content-Type: application/json\r\nContent-Length: 2048\r\n\r\n"
        );
        let mut stalled = send(port, raw.as_bytes());
        assert_eq!(status_line_code(&read_response(&mut stalled)), 403);
        assert_eq!(status_line_code(&post(port, "", "{}")), 200);
        drop(stalled);
    }

    #[test]
    fn a_stalled_body_gives_up_and_frees_its_slot() {
        let (forward, calls) = counting();
        let listener = Listener::start_with(0, forward, Duration::from_millis(100)).unwrap();
        let port = listener.port;
        let raw = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
             Content-Length: 10\r\n\r\n"
        );
        let mut stalled: Vec<_> = (0..MAX_IN_FLIGHT)
            .map(|_| send(port, raw.as_bytes()))
            .collect();
        for stream in &mut stalled {
            assert_eq!(status_line_code(&read_response(stream)), 408);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(status_line_code(&post(port, "", "{}")), 200);
    }

    #[test]
    fn past_the_limit_it_answers_busy() {
        let (forward, entered, release) = blocking();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        let mut held: Vec<_> = (0..MAX_IN_FLIGHT)
            .map(|_| send(port, &request_bytes(port, "", "{}")))
            .collect();
        wait_for(&entered, MAX_IN_FLIGHT);

        assert_eq!(status_line_code(&post(port, "", "{}")), 429);

        drop(release);
        for stream in &mut held {
            assert_eq!(status_line_code(&read_response(stream)), 200);
        }
    }

    #[test]
    fn a_client_that_leaves_keeps_its_slot_until_the_forward_ends() {
        let (forward, entered, release) = blocking();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        let held: Vec<_> = (0..MAX_IN_FLIGHT)
            .map(|_| send(port, &request_bytes(port, "", "{}")))
            .collect();
        wait_for(&entered, MAX_IN_FLIGHT);
        drop(held);

        assert_eq!(status_line_code(&post(port, "", "{}")), 429);

        drop(release);
        let deadline = Instant::now() + Duration::from_secs(10);
        while status_line_code(&post(port, "", "{}")) != 200 {
            assert!(Instant::now() < deadline, "the slots were not released");
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn not_ready_and_timeout_map_to_their_statuses() {
        for (refused, status) in [(Refused::NotReady, 503), (Refused::TimedOut, 504)] {
            let listener = Listener::start(0, Arc::new(move |_| Err(refused))).unwrap();
            let response = post(listener.port, "", "{}");
            assert_eq!(status_line_code(&response), status, "{response}");
        }
    }

    #[test]
    fn dropping_it_stops_the_server_and_frees_the_port() {
        let (forward, _) = counting();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        drop(listener);
        std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
    }

    #[test]
    fn dropping_it_ends_a_request_in_progress() {
        let (forward, entered, release) = blocking();
        let listener = Listener::start(0, forward).unwrap();
        let port = listener.port;
        let mut in_progress = send(port, &request_bytes(port, "", "{}"));
        wait_for(&entered, 1);

        drop(listener);

        assert_eq!(read_response(&mut in_progress), "");
        drop(release);
    }

    #[test]
    fn a_taken_port_is_reported() {
        let taken = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = taken.local_addr().unwrap().port();
        let (forward, _) = counting();
        let error = Listener::start(port, forward).err().unwrap();
        assert_eq!(error, format!("port {port} is in use"));
    }

    fn waiting_channel() -> (
        AtomicBool,
        mpsc::Sender<BridgeAnswer>,
        mpsc::Receiver<BridgeAnswer>,
    ) {
        let (sender, receiver) = mpsc::channel();
        (AtomicBool::new(false), sender, receiver)
    }

    const SHORT: Duration = Duration::from_millis(10);
    const LONGER: Duration = Duration::from_millis(30);

    #[test]
    fn an_answer_comes_back() {
        let (acknowledged, sender, receiver) = waiting_channel();
        let answer = BridgeAnswer {
            status: 201,
            body: "{}".to_owned(),
        };
        sender.send(answer.clone()).unwrap();
        assert_eq!(
            await_answer(&receiver, &acknowledged, SHORT, LONGER),
            Ok(answer)
        );
    }

    #[test]
    fn no_ack_is_not_ready() {
        let (acknowledged, _sender, receiver) = waiting_channel();
        assert_eq!(
            await_answer(&receiver, &acknowledged, SHORT, LONGER),
            Err(Refused::NotReady)
        );
    }

    #[test]
    fn an_ack_with_no_answer_times_out() {
        let (acknowledged, _sender, receiver) = waiting_channel();
        acknowledged.store(true, Ordering::SeqCst);
        assert_eq!(
            await_answer(&receiver, &acknowledged, SHORT, LONGER),
            Err(Refused::TimedOut)
        );
    }

    #[test]
    fn an_answer_after_the_ack_comes_back() {
        let (acknowledged, sender, receiver) = waiting_channel();
        acknowledged.store(true, Ordering::SeqCst);
        let answer = BridgeAnswer {
            status: 200,
            body: "{}".to_owned(),
        };
        let sent = answer.clone();
        let late = thread::spawn(move || {
            thread::sleep(SHORT * 2);
            sender.send(sent).unwrap();
        });
        assert_eq!(
            await_answer(&receiver, &acknowledged, SHORT, Duration::from_secs(5)),
            Ok(answer)
        );
        late.join().unwrap();
    }

    /// A bridge with request `id` waiting, and the receiver of its answer.
    fn bridge_waiting_on(id: u64) -> (AgentBridge, Arc<AtomicBool>, mpsc::Receiver<BridgeAnswer>) {
        let bridge = AgentBridge::default();
        let acknowledged = Arc::new(AtomicBool::new(false));
        let (answer, receiver) = mpsc::channel();
        lock(&bridge.waiting).insert(
            id,
            Waiting {
                acknowledged: acknowledged.clone(),
                answer,
            },
        );
        (bridge, acknowledged, receiver)
    }

    #[test]
    fn an_answer_is_passed_on_once() {
        let (bridge, _, receiver) = bridge_waiting_on(1);
        bridge.answer(1, 200, "{}".to_owned());
        bridge.answer(1, 201, "later".to_owned());
        assert_eq!(
            receiver.try_recv(),
            Ok(BridgeAnswer {
                status: 200,
                body: "{}".to_owned()
            })
        );
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn a_status_out_of_range_becomes_500() {
        for status in [0, 199, 600] {
            let (bridge, _, receiver) = bridge_waiting_on(1);
            bridge.answer(1, status, "{}".to_owned());
            assert_eq!(receiver.try_recv().unwrap().status, 500);
        }
    }

    #[test]
    fn an_unknown_id_is_ignored() {
        let (bridge, acknowledged, receiver) = bridge_waiting_on(1);
        bridge.acknowledge(2);
        bridge.answer(2, 200, "{}".to_owned());
        assert!(!acknowledged.load(Ordering::SeqCst));
        assert!(receiver.try_recv().is_err());
        bridge.acknowledge(1);
        assert!(acknowledged.load(Ordering::SeqCst));
    }
}
