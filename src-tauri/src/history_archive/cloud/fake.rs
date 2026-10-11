//! Test doubles for the cloud providers: an in-memory credential store, and a fake Google
//! Drive, Dropbox, OneDrive (Microsoft Graph), S3 bucket, backup endpoint and OAuth token
//! endpoint on a local HTTP server, holding files in memory. Only the API surface the
//! providers use is implemented, with the behaviors they rely on (Drive's duplicate names and
//! `appDataFolder`, Dropbox's upload modes and 409 errors, Graph's conflict behavior, upload
//! sessions and next links, S3's signatures, conditional writes and delimited listings, the
//! endpoint's `If-None-Match` and listing order, bearer tokens that expire, rate limits on
//! demand).

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::super::ArchiveError;
use super::endpoint::{EndpointAuth, EndpointSetup};
use super::http::RetryPolicy;
use super::s3::S3Setup;
use super::sigv4;
use super::{CloudConnections, CloudSettings, CredentialStore};

// ─── Credentials ────────────────────────────────────────────────────────────

#[derive(Default)]
pub(crate) struct MemoryCredentials(pub(crate) Mutex<HashMap<String, String>>);

impl CredentialStore for MemoryCredentials {
    fn get(&self, name: &str) -> Result<Option<Zeroizing<String>>, ArchiveError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(name)
            .cloned()
            .map(Zeroizing::new))
    }

    fn set(&self, name: &str, secret: &str) -> Result<(), ArchiveError> {
        self.0
            .lock()
            .unwrap()
            .insert(name.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), ArchiveError> {
        self.0.lock().unwrap().remove(name);
        Ok(())
    }
}

// ─── HTTP server ────────────────────────────────────────────────────────────

pub(crate) struct Request {
    pub method: String,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub(crate) fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub(crate) fn query(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    fn form(&self) -> HashMap<String, String> {
        reqwest::Url::parse(&format!(
            "http://x/?{}",
            String::from_utf8_lossy(&self.body)
        ))
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
    }

    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    /// The Dropbox argument header, parsed.
    fn dropbox_arg(&self) -> Value {
        self.header("Dropbox-API-Arg")
            .and_then(|a| serde_json::from_str(a).ok())
            .unwrap_or(Value::Null)
    }
}

pub(crate) struct Response {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Response {
    fn empty(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    fn json(status: u16, value: Value) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: value.to_string().into_bytes(),
        }
    }

    fn bytes(body: Vec<u8>) -> Self {
        Self {
            status: 200,
            headers: vec![("Content-Type".into(), "application/octet-stream".into())],
            body,
        }
    }
}

/// A local HTTP server answering with `handler`, until dropped.
pub(crate) struct FakeServer {
    pub url: String,
    server: Arc<tiny_http::Server>,
    thread: Option<JoinHandle<()>>,
}

impl FakeServer {
    pub(crate) fn start(handler: impl Fn(Request) -> Response + Send + 'static) -> Self {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
        let url = format!("http://{}", server.server_addr().to_ip().unwrap());
        let serving = server.clone();
        let thread = thread::spawn(move || {
            for mut request in serving.incoming_requests() {
                let mut body = Vec::new();
                let _ = request.as_reader().read_to_end(&mut body);
                let target = reqwest::Url::parse(&format!("http://x{}", request.url())).unwrap();
                let req = Request {
                    method: request.method().as_str().to_string(),
                    path: target.path().to_string(),
                    query: target
                        .query_pairs()
                        .map(|(k, v)| (k.into_owned(), v.into_owned()))
                        .collect(),
                    headers: request
                        .headers()
                        .iter()
                        .map(|h| (h.field.to_string(), h.value.to_string()))
                        .collect(),
                    body,
                };
                let response = handler(req);
                let mut reply =
                    tiny_http::Response::from_data(response.body).with_status_code(response.status);
                for (k, v) in response.headers {
                    reply.add_header(tiny_http::Header::from_bytes(k, v).unwrap());
                }
                let _ = request.respond(reply);
            }
        });
        Self {
            url,
            server,
            thread: Some(thread),
        }
    }
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.server.unblock();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

// ─── Fake cloud ─────────────────────────────────────────────────────────────

/// An injected failure: the next `times` requests whose log line (see [`log_line`]) contains
/// `matching` get `status` (with `Retry-After` and `body`).
pub(crate) struct Fault {
    pub matching: String,
    pub status: u16,
    pub retry_after: Option<u64>,
    pub body: Value,
    pub times: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct DriveFile {
    pub id: String,
    pub name: String,
    pub parents: Vec<String>,
    /// Seconds; the fake's clock ticks once per file.
    pub created: u64,
    pub bytes: Vec<u8>,
}

impl DriveFile {
    fn meta(&self) -> Value {
        let created = chrono::DateTime::from_timestamp(1_760_000_000 + self.created as i64, 0)
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        json!({ "id": self.id, "name": self.name, "createdTime": created })
    }
}

#[derive(Default)]
pub(crate) struct CloudState {
    /// The access token the APIs accept; anything else is a 401.
    pub access_token: String,
    pub refresh_token: String,
    /// The token endpoint refuses refreshes (the user revoked access).
    pub refresh_revoked: bool,
    /// Hand out a new refresh token with every refresh.
    pub rotate_refresh_tokens: bool,
    pub refreshes: usize,
    /// The forms the authorization code was traded with.
    pub exchanges: Vec<HashMap<String, String>>,
    pub revoked: usize,
    pub email: String,

    pub drive: Vec<DriveFile>,
    clock: u64,
    /// When a Drive upload names this, another device's older file of that name lands first.
    pub drive_race: Option<String>,

    pub dropbox: BTreeMap<String, Vec<u8>>,

    /// The OneDrive app folder's files by path.
    pub onedrive: BTreeMap<String, Vec<u8>>,
    /// Open upload sessions by id: the path, whether a taken name fails it, and the bytes so
    /// far.
    onedrive_sessions: HashMap<String, (String, bool, Vec<u8>)>,
    /// Upload session chunks received, and how many of them carried an access token.
    pub onedrive_chunks: usize,
    pub onedrive_chunks_with_token: usize,
    /// Where the fake is, for the URLs it hands out.
    base_url: String,
    /// Entries per `list_folder` page (Drive pages are `pageSize` or this).
    pub page_size: usize,

    /// The backup endpoint's files, in the order they were first stored.
    pub endpoint: Vec<(String, Vec<u8>)>,
    /// The header the endpoint asks for, name and value; `None` lets anyone in.
    pub endpoint_auth: Option<(String, String)>,
    /// The endpoint ignores `If-None-Match`, as a service without exclusive create does.
    pub endpoint_ignores_conditions: bool,
    /// When a claim for this name is stored, another device's claim lands first.
    pub endpoint_race: Option<String>,

    /// The S3 bucket's objects: bytes, and `LastModified` in seconds after the fake's epoch.
    pub s3: BTreeMap<String, (Vec<u8>, i64)>,
    pub s3_bucket: String,
    pub s3_region: String,
    pub s3_secret: String,
    pub s3_conditional: S3Conditional,
    /// `LastModified` of the objects stored from now on.
    pub s3_clock: i64,
    /// When a claim for this name is stored, another device's older claim lands first.
    pub s3_race: Option<String>,

    pub faults: Vec<Fault>,
    /// The log line of every request.
    pub log: Vec<String>,
}

impl CloudState {
    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    pub(crate) fn drive_names(&self) -> Vec<String> {
        let mut names: Vec<_> = self.drive.iter().map(|f| f.name.clone()).collect();
        names.sort();
        names
    }

    pub(crate) fn count(&self, line: &str) -> usize {
        self.log.iter().filter(|l| l.contains(line)).count()
    }

    pub(crate) fn s3_keys(&self) -> Vec<String> {
        self.s3.keys().cloned().collect()
    }

    /// The endpoint's paths, sorted, without the probes its checks left.
    pub(crate) fn endpoint_paths(&self) -> Vec<String> {
        let mut paths: Vec<_> = self
            .endpoint
            .iter()
            .map(|(p, _)| p.clone())
            .filter(|p| !p.starts_with(".rim-probe-"))
            .collect();
        paths.sort();
        paths
    }
}

/// A fake Google Drive, Dropbox and token endpoint, and settings pointing at them.
pub(crate) struct FakeCloud {
    pub state: Arc<Mutex<CloudState>>,
    server: FakeServer,
}

pub(crate) const GOOD_CODE: &str = "good-code";
/// The token the fake backup endpoint takes unless a test says otherwise.
pub(crate) const ENDPOINT_TOKEN: &str = "endpoint-token";
/// The fake S3's access key id and, unless a test says otherwise, its secret.
pub(crate) const S3_ACCESS_KEY: &str = "AKIDFAKE";
pub(crate) const S3_SECRET: &str = "s3-secret";

/// How the fake S3 treats `If-None-Match: *`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum S3Conditional {
    /// 412 when the key exists, as AWS, R2 and MinIO do.
    #[default]
    Honour,
    /// Writes anyway.
    Ignore,
    /// 501, as storage without conditional writes may.
    NotImplemented,
}

impl FakeCloud {
    pub(crate) fn start() -> Self {
        let state = Arc::new(Mutex::new(CloudState {
            access_token: "access-0".into(),
            refresh_token: "refresh-0".into(),
            email: "ada@example.com".into(),
            page_size: 1000,
            endpoint_auth: Some(("Authorization".into(), format!("Bearer {ENDPOINT_TOKEN}"))),
            s3_bucket: "rim".into(),
            s3_region: "us-east-1".into(),
            s3_secret: S3_SECRET.into(),
            ..CloudState::default()
        }));
        let handler_state = state.clone();
        let server = FakeServer::start(move |req| handle(&mut handler_state.lock().unwrap(), req));
        state.lock().unwrap().base_url = server.url.clone();
        Self { state, server }
    }

    pub(crate) fn url(&self) -> &str {
        &self.server.url
    }

    /// What the user types to use the fake backup endpoint: its base URL (the route is
    /// appended) and its bearer token.
    pub(crate) fn endpoint_setup(&self) -> EndpointSetup {
        EndpointSetup {
            url: format!("{}/ep", self.server.url),
            auth: EndpointAuth::Bearer,
            secret: Some(Zeroizing::new(ENDPOINT_TOKEN.into())),
            allow_insecure: false,
        }
    }

    /// What the user types to use the fake S3: its endpoint (path-style, as for any endpoint
    /// not on amazonaws.com), region, bucket, a prefix, and the key.
    pub(crate) fn s3_setup(&self) -> S3Setup {
        S3Setup {
            endpoint: format!("{}/s3", self.server.url),
            region: "us-east-1".into(),
            bucket: "rim".into(),
            prefix: "backups/ada".into(),
            access_key_id: S3_ACCESS_KEY.into(),
            secret_access_key: Some(Zeroizing::new(S3_SECRET.into())),
            addressing: None,
            allow_insecure: false,
        }
    }

    pub(crate) fn state(&self) -> std::sync::MutexGuard<'_, CloudState> {
        self.state.lock().unwrap()
    }

    pub(crate) fn fault(
        &self,
        matching: &str,
        status: u16,
        retry_after: Option<u64>,
        body: Value,
        times: usize,
    ) {
        self.state().faults.push(Fault {
            matching: matching.to_string(),
            status,
            retry_after,
            body,
            times,
        });
    }

    /// Settings with both services configured and pointing here, and quick retries.
    pub(crate) fn settings(&self) -> CloudSettings {
        let url = &self.server.url;
        let mut settings = CloudSettings::from_env();
        for service in [
            &mut settings.google,
            &mut settings.dropbox,
            &mut settings.microsoft,
        ] {
            service.authorize_url = format!("{url}/authorize");
            service.token_url = format!("{url}/token");
            service.redirect_port = 0;
        }
        settings.google.client_id = Some("google-client".into());
        settings.google.client_secret = Some("google-not-secret".into());
        settings.dropbox.client_id = Some("dropbox-app".into());
        settings.dropbox.client_secret = None;
        settings.drive.api = format!("{url}/drive/v3");
        settings.drive.upload = format!("{url}/upload/drive/v3");
        settings.dropbox_api.api = format!("{url}/dbx/api/2");
        settings.dropbox_api.content = format!("{url}/dbx/content/2");
        settings.microsoft.client_id = Some("onedrive-client".into());
        settings.microsoft.client_secret = None;
        settings.onedrive.api = format!("{url}/graph/v1.0");
        settings.retry = RetryPolicy {
            attempts: 4,
            base_delay: Duration::from_millis(1),
            max_delay: Duration::from_millis(4),
            max_retry_after: Duration::from_millis(5),
        };
        settings.sign_in_timeout = Duration::from_secs(20);
        settings
    }

    pub(crate) fn connections(&self) -> (CloudConnections, Arc<MemoryCredentials>) {
        let credentials = Arc::new(MemoryCredentials::default());
        (
            CloudConnections::new(self.settings(), credentials.clone()),
            credentials,
        )
    }
}

/// Play the user in the browser: approve, and let the provider redirect back.
pub(crate) fn approve(url: &str) -> Result<(), ArchiveError> {
    redirect(url, &format!("code={GOOD_CODE}"));
    Ok(())
}

/// Play the user in the browser: refuse.
pub(crate) fn deny(url: &str) -> Result<(), ArchiveError> {
    redirect(url, "error=access_denied");
    Ok(())
}

fn redirect(url: &str, outcome: &str) {
    let url = reqwest::Url::parse(url).unwrap();
    let param = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
            .unwrap()
    };
    let (redirect_uri, state) = (param("redirect_uri"), param("state"));
    assert_eq!(param("code_challenge_method"), "S256");
    let query = format!("{outcome}&state={state}");
    thread::spawn(move || super::oauth::tests::browser_returns(&redirect_uri, &query));
}

fn unauthorized() -> Response {
    Response::json(401, json!({ "error": "invalid_token" }))
}

/// "METHOD /path" and then Dropbox's argument header, or the backup endpoint's, S3's or
/// Graph's query followed by the method again, so a fault can match one method on one file
/// (`head.rimx POST`).
fn log_line(req: &Request) -> String {
    let arg = if ["/ep/", "/s3/", "/graph"]
        .iter()
        .any(|p| req.path.starts_with(p))
    {
        let query: Vec<String> = req.query.iter().map(|(k, v)| format!("{k}={v}")).collect();
        if query.is_empty() {
            req.method.clone()
        } else {
            format!("{} {}", query.join("&"), req.method)
        }
    } else {
        req.header("Dropbox-API-Arg").unwrap_or("").to_string()
    };
    format!("{} {} {arg}", req.method, req.path)
}

fn handle(state: &mut CloudState, req: Request) -> Response {
    let line = log_line(&req);
    state.log.push(line.clone());
    if let Some(fault) = state
        .faults
        .iter_mut()
        .find(|f| f.times > 0 && line.contains(&f.matching))
    {
        fault.times -= 1;
        let mut response = Response::json(fault.status, fault.body.clone());
        if let Some(seconds) = fault.retry_after {
            response
                .headers
                .push(("Retry-After".into(), seconds.to_string()));
        }
        return response;
    }

    match (req.method.as_str(), req.path.as_str()) {
        ("POST", "/token") => return token(state, &req),
        // Google's revoke ends the user's whole grant to the client, on every device.
        ("POST", "/revoke") => {
            state.revoked += 1;
            state.refresh_revoked = true;
            return Response::json(200, json!({}));
        }
        _ => {}
    }
    if let Some(rest) = req.path.strip_prefix("/ep/") {
        return endpoint(state, &req, rest);
    }
    if let Some(rest) = req.path.strip_prefix("/s3/") {
        return s3(state, &req, rest);
    }
    // An upload session's URL is its own authorization.
    if let Some(session) = req.path.strip_prefix("/graph-upload/") {
        return onedrive_chunk(state, &req, session);
    }
    let bearer = format!("Bearer {}", state.access_token);
    if req.header("Authorization") != Some(bearer.as_str()) {
        return unauthorized();
    }
    if let Some(rest) = req.path.strip_prefix("/drive/v3") {
        drive_api(state, &req, rest)
    } else if let Some(rest) = req.path.strip_prefix("/upload/drive/v3/files") {
        drive_upload(state, &req, rest)
    } else if let Some(rest) = req.path.strip_prefix("/dbx/") {
        dropbox(state, &req, rest)
    } else if let Some(rest) = req.path.strip_prefix("/graph/v1.0") {
        onedrive(state, &req, rest)
    } else {
        Response::json(404, json!({ "error": "no such endpoint" }))
    }
}

fn token(state: &mut CloudState, req: &Request) -> Response {
    let form = req.form();
    let issue = |state: &mut CloudState, refresh: Option<String>| {
        state.access_token = format!("access-{}", state.refreshes + state.exchanges.len());
        let mut body = json!({ "access_token": state.access_token, "expires_in": 3600, "token_type": "bearer" });
        if let Some(refresh) = refresh {
            body["refresh_token"] = json!(refresh);
        }
        Response::json(200, body)
    };
    match form.get("grant_type").map(String::as_str) {
        Some("authorization_code") => {
            if form.get("code").map(String::as_str) != Some(GOOD_CODE)
                || form.get("code_verifier").is_none_or(|v| v.len() < 43)
            {
                return Response::json(400, json!({ "error": "invalid_grant" }));
            }
            state.exchanges.push(form);
            let refresh = state.refresh_token.clone();
            issue(state, Some(refresh))
        }
        Some("refresh_token") => {
            if state.refresh_revoked || form.get("refresh_token") != Some(&state.refresh_token) {
                return Response::json(
                    400,
                    json!({ "error": "invalid_grant", "error_description": "Token has been expired or revoked." }),
                );
            }
            state.refreshes += 1;
            let rotated = state.rotate_refresh_tokens.then(|| {
                state.refresh_token = format!("refresh-{}", state.refreshes);
                state.refresh_token.clone()
            });
            issue(state, rotated)
        }
        _ => Response::json(400, json!({ "error": "unsupported_grant_type" })),
    }
}

// ─── Drive ──────────────────────────────────────────────────────────────────

fn drive_api(state: &mut CloudState, req: &Request, rest: &str) -> Response {
    if rest == "/about" {
        return Response::json(200, json!({ "user": { "emailAddress": state.email } }));
    }
    if rest == "/files" && req.method == "GET" {
        assert_eq!(req.query("spaces"), Some("appDataFolder"));
        let q = req.query("q").unwrap_or("");
        assert!(q.contains("'appDataFolder' in parents"), "{q}");
        let name = q
            .split("name = '")
            .nth(1)
            .map(|rest| rest.trim_end_matches('\'').replace("\\'", "'"));
        let page_size = req
            .query("pageSize")
            .and_then(|p| p.parse::<usize>().ok())
            .unwrap_or(100)
            .min(state.page_size);
        let start: usize = req.query("pageToken").map_or(0, |t| t.parse().unwrap());
        let matching: Vec<&DriveFile> = state
            .drive
            .iter()
            .filter(|f| f.parents == ["appDataFolder"])
            .filter(|f| name.as_ref().is_none_or(|n| &f.name == n))
            .collect();
        let page: Vec<Value> = matching
            .iter()
            .skip(start)
            .take(page_size)
            .map(|f| f.meta())
            .collect();
        let mut body = json!({ "files": page });
        if start + page_size < matching.len() {
            body["nextPageToken"] = json!((start + page_size).to_string());
        }
        return Response::json(200, body);
    }
    let Some(id) = rest.strip_prefix("/files/") else {
        return Response::json(404, json!({}));
    };
    let Some(index) = state.drive.iter().position(|f| f.id == id) else {
        return Response::json(404, json!({ "error": { "code": 404 } }));
    };
    match req.method.as_str() {
        "GET" if req.query("alt") == Some("media") => {
            Response::bytes(state.drive[index].bytes.clone())
        }
        "DELETE" => {
            state.drive.remove(index);
            Response::empty(204)
        }
        _ => Response::json(400, json!({})),
    }
}

fn drive_upload(state: &mut CloudState, req: &Request, rest: &str) -> Response {
    if req.method == "PATCH" {
        assert_eq!(req.query("uploadType"), Some("media"));
        let id = rest.trim_start_matches('/');
        return match state.drive.iter_mut().find(|f| f.id == id) {
            Some(file) => {
                file.bytes = req.body.clone();
                Response::json(200, json!({ "id": id }))
            }
            None => Response::json(404, json!({ "error": { "code": 404 } })),
        };
    }
    assert_eq!(req.method, "POST");
    assert_eq!(req.query("uploadType"), Some("multipart"));
    let content_type = req.header("Content-Type").unwrap();
    let boundary = content_type
        .split("boundary=")
        .nth(1)
        .expect("multipart/related boundary");
    let (metadata, media) = parse_related(&req.body, boundary);
    let name = metadata["name"].as_str().unwrap().to_string();
    let parents: Vec<String> = serde_json::from_value(metadata["parents"].clone()).unwrap();
    if state.drive_race.as_deref() == Some(name.as_str()) {
        state.drive_race = None;
        let created = state.tick();
        state.drive.push(DriveFile {
            id: format!("other-{created}"),
            name: name.clone(),
            parents: parents.clone(),
            created,
            bytes: b"the other device's".to_vec(),
        });
    }
    let created = state.tick();
    let file = DriveFile {
        id: format!("file-{created}"),
        name,
        parents,
        created,
        bytes: media,
    };
    let meta = file.meta();
    state.drive.push(file);
    Response::json(200, meta)
}

/// A two-part multipart/related body: JSON metadata, then the media.
fn parse_related(body: &[u8], boundary: &str) -> (Value, Vec<u8>) {
    let delimiter = format!("--{boundary}");
    let find = |from: usize, needle: &[u8]| {
        body[from..]
            .windows(needle.len())
            .position(|w| w == needle)
            .map(|p| p + from)
            .unwrap()
    };
    let headers_end = |from: usize| find(from, b"\r\n\r\n") + 4;
    let first = headers_end(find(0, delimiter.as_bytes()));
    let second_delim = find(first, format!("\r\n{delimiter}").as_bytes());
    let metadata: Value = serde_json::from_slice(&body[first..second_delim]).unwrap();
    let media_start = headers_end(second_delim + 2);
    let media_end = find(media_start, format!("\r\n{delimiter}--").as_bytes());
    (metadata, body[media_start..media_end].to_vec())
}

// ─── Dropbox ────────────────────────────────────────────────────────────────

fn dropbox_error(summary: &str) -> Response {
    Response::json(
        409,
        json!({ "error_summary": format!("{summary}/..."), "error": {} }),
    )
}

fn dropbox(state: &mut CloudState, req: &Request, rest: &str) -> Response {
    match rest {
        "api/2/users/get_current_account" => Response::json(
            200,
            json!({ "email": state.email, "name": { "display_name": "Ada" } }),
        ),
        "api/2/auth/token/revoke" => {
            state.revoked += 1;
            Response::json(200, Value::Null)
        }
        "content/2/files/download" => {
            let path = req.dropbox_arg()["path"].as_str().unwrap().to_lowercase();
            match state.dropbox.get(&path) {
                Some(bytes) => Response::bytes(bytes.clone()),
                None => dropbox_error("path/not_found"),
            }
        }
        "content/2/files/upload" => {
            let arg = req.dropbox_arg();
            let path = arg["path"].as_str().unwrap().to_lowercase();
            assert_eq!(arg["autorename"], false);
            if arg["mode"] == "add" && state.dropbox.contains_key(&path) {
                return dropbox_error("path/conflict/file");
            }
            assert!(arg["mode"] == "add" || arg["mode"] == "overwrite");
            state.dropbox.insert(path.clone(), req.body.clone());
            Response::json(200, json!({ "path_display": path }))
        }
        "api/2/files/delete_v2" => {
            let path = req.json()["path"].as_str().unwrap().to_lowercase();
            match state.dropbox.remove(&path) {
                Some(_) => Response::json(200, json!({})),
                None => dropbox_error("path_lookup/not_found"),
            }
        }
        "api/2/files/list_folder" | "api/2/files/list_folder/continue" => {
            let arg = req.json();
            let (dir, start) = match arg["cursor"].as_str() {
                Some(cursor) => {
                    let (start, dir) = cursor.split_once(':').unwrap();
                    (dir.to_string(), start.parse::<usize>().unwrap())
                }
                None => (arg["path"].as_str().unwrap().to_lowercase(), 0),
            };
            let prefix = format!("{dir}/");
            let mut entries = std::collections::BTreeSet::new();
            for path in state.dropbox.keys() {
                let Some(rest) = path.strip_prefix(&prefix) else {
                    continue;
                };
                match rest.split_once('/') {
                    Some((sub, _)) => entries.insert((sub.to_string(), "folder")),
                    None => entries.insert((rest.to_string(), "file")),
                };
            }
            if entries.is_empty() {
                return dropbox_error("path/not_found");
            }
            let page: Vec<Value> = entries
                .iter()
                .skip(start)
                .take(state.page_size)
                .map(|(name, tag)| json!({ ".tag": tag, "name": name }))
                .collect();
            let next = start + state.page_size;
            Response::json(
                200,
                json!({
                    "entries": page,
                    "cursor": format!("{next}:{dir}"),
                    "has_more": next < entries.len(),
                }),
            )
        }
        _ => Response::json(404, json!({ "error_summary": "no such endpoint" })),
    }
}

// ─── Backup endpoint ────────────────────────────────────────────────────────

fn endpoint(state: &mut CloudState, req: &Request, rest: &str) -> Response {
    if rest != "backup" {
        return Response::empty(404);
    }
    if let Some((name, value)) = &state.endpoint_auth {
        if req.header(name) != Some(value.as_str()) {
            return Response::empty(401);
        }
    }
    match (req.method.as_str(), req.query("path"), req.query("list")) {
        ("GET", Some(path), _) => match state.endpoint.iter().find(|(p, _)| p == path) {
            Some((_, bytes)) => Response::bytes(bytes.clone()),
            None => Response::empty(404),
        },
        ("GET", None, Some(dir)) => {
            let prefix = if dir.is_empty() {
                String::new()
            } else {
                format!("{dir}/")
            };
            let mut entries: Vec<(String, bool)> = Vec::new();
            for (path, _) in &state.endpoint {
                let Some(rest) = path.strip_prefix(&prefix) else {
                    continue;
                };
                let entry = match rest.split_once('/') {
                    Some((sub, _)) => (sub.to_string(), true),
                    None => (rest.to_string(), false),
                };
                if !entries.contains(&entry) {
                    entries.push(entry);
                }
            }
            if entries.is_empty() && !dir.is_empty() {
                return Response::empty(404);
            }
            let listing = entries
                .into_iter()
                .map(|(name, dir)| json!({ "name": name, "dir": dir }))
                .collect();
            Response::json(200, Value::Array(listing))
        }
        ("POST", Some(path), _) => {
            let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
            if let Some(race) = state.endpoint_race.clone() {
                if name.starts_with(&format!(".{race}.")) {
                    state.endpoint_race = None;
                    let other = format!(".{race}.0123456789ab.claim");
                    let other = if dir.is_empty() {
                        other
                    } else {
                        format!("{dir}/{other}")
                    };
                    state.endpoint.push((other, b"the other device's".to_vec()));
                }
            }
            let existing = state.endpoint.iter().position(|(p, _)| p == path);
            let exclusive = req.header("If-None-Match") == Some("*");
            match existing {
                Some(_) if exclusive && !state.endpoint_ignores_conditions => Response::empty(412),
                Some(i) => {
                    state.endpoint[i].1 = req.body.clone();
                    Response::empty(204)
                }
                None => {
                    state.endpoint.push((path.to_string(), req.body.clone()));
                    Response::empty(201)
                }
            }
        }
        _ => Response::empty(400),
    }
}

// ─── S3 ─────────────────────────────────────────────────────────────────────

fn s3_xml(status: u16, body: String) -> Response {
    Response {
        status,
        headers: vec![("Content-Type".into(), "application/xml".into())],
        body: format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{body}").into_bytes(),
    }
}

fn s3_error(status: u16, code: &str) -> Response {
    s3_xml(
        status,
        format!("<Error><Code>{code}</Code><Message>{code}</Message></Error>"),
    )
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap()
}

fn s3_time(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(1_760_000_000 + seconds, 0)
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The signature check of S3: the same Signature Version 4 over what arrived, with the
/// fake's secret.
fn s3_verify(state: &CloudState, req: &Request) -> Result<(), Response> {
    let auth = req
        .header("Authorization")
        .ok_or_else(|| s3_error(403, "AccessDenied"))?;
    let field = |name: &str| {
        auth.split([' ', ','])
            .find_map(|part| part.strip_prefix(&format!("{name}=")))
            .unwrap_or("")
            .to_string()
    };
    let credential = field("Credential");
    let scope: Vec<&str> = credential.split('/').collect();
    if scope.len() != 5 || scope[0] != S3_ACCESS_KEY {
        return Err(s3_error(403, "InvalidAccessKeyId"));
    }
    if scope[2] != state.s3_region {
        return Err(s3_error(400, "AuthorizationHeaderMalformed"));
    }
    let payload_hash = sigv4::payload_hash(&req.body);
    if req.header("x-amz-content-sha256") != Some(payload_hash.as_str()) {
        return Err(s3_error(400, "XAmzContentSHA256Mismatch"));
    }
    let time = chrono::NaiveDateTime::parse_from_str(
        req.header("x-amz-date").unwrap_or(""),
        sigv4::AMZ_DATE,
    )
    .map_err(|_| s3_error(403, "AccessDenied"))?
    .and_utc();
    let signed_headers = field("SignedHeaders");
    let mut headers = Vec::new();
    for name in signed_headers.split(';') {
        let value = req
            .header(name)
            .ok_or_else(|| s3_error(403, "SignatureDoesNotMatch"))?;
        headers.push((name, value));
    }
    let expected = sigv4::authorization(
        &sigv4::Request {
            method: &req.method,
            path: &req.path,
            query: &req.query,
            headers: &headers,
            payload_hash: &payload_hash,
        },
        &sigv4::Key {
            access_key_id: S3_ACCESS_KEY,
            secret: &state.s3_secret,
            region: scope[2],
            service: scope[3],
        },
        time,
    )
    .unwrap();
    if expected != auth {
        return Err(s3_error(403, "SignatureDoesNotMatch"));
    }
    Ok(())
}

fn s3(state: &mut CloudState, req: &Request, rest: &str) -> Response {
    if let Err(refused) = s3_verify(state, req) {
        return refused;
    }
    let (bucket, key) = rest.split_once('/').unwrap_or((rest, ""));
    if bucket != state.s3_bucket {
        return s3_error(404, "NoSuchBucket");
    }
    let key = percent_decode(key);
    match (req.method.as_str(), key.is_empty()) {
        ("GET", true) if req.query("list-type") == Some("2") => s3_list(state, req),
        ("GET", false) => match state.s3.get(&key) {
            Some((bytes, _)) => Response::bytes(bytes.clone()),
            None => s3_error(404, "NoSuchKey"),
        },
        ("PUT", false) => {
            if req.header("If-None-Match") == Some("*") {
                match state.s3_conditional {
                    S3Conditional::NotImplemented => return s3_error(501, "NotImplemented"),
                    S3Conditional::Honour if state.s3.contains_key(&key) => {
                        return s3_error(412, "PreconditionFailed")
                    }
                    _ => {}
                }
            }
            let (dir, name) = key.rsplit_once('/').unwrap_or(("", &key));
            if let Some(race) = state.s3_race.clone() {
                if super::claims::is_claim(name, &race) {
                    state.s3_race = None;
                    let other = format!("{dir}/.{race}.ffffffffffff.claim");
                    let older = state.s3_clock - 1;
                    state
                        .s3
                        .insert(other, (b"the other device's".to_vec(), older));
                }
            }
            let now = state.s3_clock;
            state.s3.insert(key, (req.body.clone(), now));
            Response::empty(200)
        }
        ("DELETE", false) => {
            state.s3.remove(&key);
            Response::empty(204)
        }
        _ => s3_error(400, "InvalidRequest"),
    }
}

/// `ListObjectsV2`: keys and common prefixes in key order, paged by `page_size`.
fn s3_list(state: &CloudState, req: &Request) -> Response {
    let prefix = req.query("prefix").unwrap_or("");
    let delimited = req.query("delimiter") == Some("/");
    let start: usize = req
        .query("continuation-token")
        .map_or(0, |t| t.parse().unwrap());
    let mut items: Vec<(String, Option<i64>)> = Vec::new();
    for (key, (_, modified)) in &state.s3 {
        let Some(rest) = key.strip_prefix(prefix) else {
            continue;
        };
        match rest.find('/') {
            Some(slash) if delimited => {
                let common = format!("{prefix}{}", &rest[..=slash]);
                if !items.iter().any(|(k, _)| *k == common) {
                    items.push((common, None));
                }
            }
            _ => items.push((key.clone(), Some(*modified))),
        }
    }
    let page: Vec<_> = items.iter().skip(start).take(state.page_size).collect();
    let next = start + state.page_size;
    let mut xml = format!(
        "<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Name>{}</Name><Prefix>{prefix}</Prefix><KeyCount>{}</KeyCount>",
        state.s3_bucket,
        page.len()
    );
    for (key, modified) in page {
        match modified {
            Some(modified) => xml.push_str(&format!(
                "<Contents><Key>{key}</Key><LastModified>{}</LastModified><Size>0</Size></Contents>",
                s3_time(*modified)
            )),
            None => xml.push_str(&format!(
                "<CommonPrefixes><Prefix>{key}</Prefix></CommonPrefixes>"
            )),
        }
    }
    if next < items.len() {
        xml.push_str(&format!(
            "<IsTruncated>true</IsTruncated><NextContinuationToken>{next}</NextContinuationToken>"
        ));
    } else {
        xml.push_str("<IsTruncated>false</IsTruncated>");
    }
    xml.push_str("</ListBucketResult>");
    s3_xml(200, xml)
}

// ─── OneDrive ───────────────────────────────────────────────────────────────

fn graph_error(status: u16, code: &str) -> Response {
    Response::json(
        status,
        json!({ "error": { "code": code, "message": code } }),
    )
}

fn onedrive_item(path: &str) -> Value {
    json!({ "id": format!("item-{path}"), "name": path.rsplit('/').next().unwrap() })
}

fn onedrive(state: &mut CloudState, req: &Request, rest: &str) -> Response {
    if rest == "/me" {
        // A personal account: no `mail`, the sign-in name is the address.
        return Response::json(
            200,
            json!({ "mail": null, "userPrincipalName": state.email }),
        );
    }
    let Some(rest) = rest.strip_prefix("/me/drive/special/approot") else {
        return graph_error(404, "itemNotFound");
    };
    let (path, action) = match rest.strip_prefix(":/") {
        Some(addressed) => {
            let (path, action) = addressed.rsplit_once(':').unwrap();
            (percent_decode(path), action)
        }
        None => (String::new(), rest),
    };
    let fail_on_conflict = |value: Option<&str>| value == Some("fail");
    match (req.method.as_str(), action) {
        ("GET", "/content") => match state.onedrive.get(&path) {
            Some(bytes) => Response::bytes(bytes.clone()),
            None => graph_error(404, "itemNotFound"),
        },
        ("PUT", "/content") => {
            if req.body.len() > super::onedrive::SIMPLE_UPLOAD_MAX {
                return graph_error(413, "requestBodyTooLarge");
            }
            let fail = fail_on_conflict(req.query("@microsoft.graph.conflictBehavior"));
            if fail && state.onedrive.contains_key(&path) {
                return graph_error(409, "nameAlreadyExists");
            }
            let created = state
                .onedrive
                .insert(path.clone(), req.body.clone())
                .is_none();
            Response::json(if created { 201 } else { 200 }, onedrive_item(&path))
        }
        ("POST", "/createUploadSession") => {
            let fail =
                fail_on_conflict(req.json()["item"]["@microsoft.graph.conflictBehavior"].as_str());
            if fail && state.onedrive.contains_key(&path) {
                return graph_error(409, "nameAlreadyExists");
            }
            let id = format!("session-{}", state.onedrive_sessions.len());
            state
                .onedrive_sessions
                .insert(id.clone(), (path, fail, Vec::new()));
            Response::json(
                200,
                json!({ "uploadUrl": format!("{}/graph-upload/{id}", state.base_url) }),
            )
        }
        ("GET", "/children") => {
            let prefix = if path.is_empty() {
                String::new()
            } else {
                format!("{path}/")
            };
            let mut entries: Vec<(String, bool)> = Vec::new();
            for key in state.onedrive.keys() {
                let Some(rest) = key.strip_prefix(&prefix) else {
                    continue;
                };
                let entry = match rest.split_once('/') {
                    Some((sub, _)) => (sub.to_string(), true),
                    None => (rest.to_string(), false),
                };
                if !entries.contains(&entry) {
                    entries.push(entry);
                }
            }
            if entries.is_empty() && !path.is_empty() {
                return graph_error(404, "itemNotFound");
            }
            let start: usize = req.query("$skiptoken").map_or(0, |t| t.parse().unwrap());
            let top = req
                .query("$top")
                .and_then(|t| t.parse::<usize>().ok())
                .unwrap_or(200)
                .min(state.page_size);
            let page: Vec<Value> = entries
                .iter()
                .skip(start)
                .take(top)
                .map(|(name, folder)| {
                    if *folder {
                        json!({ "name": name, "folder": { "childCount": 1 } })
                    } else {
                        json!({ "name": name, "file": {} })
                    }
                })
                .collect();
            let mut body = json!({ "value": page });
            if start + top < entries.len() {
                let item = if path.is_empty() {
                    String::new()
                } else {
                    format!(":/{path}:")
                };
                body["@odata.nextLink"] = json!(format!(
                    "{}/graph/v1.0/me/drive/special/approot{item}/children?$top={top}&$skiptoken={}",
                    state.base_url,
                    start + top
                ));
            }
            Response::json(200, body)
        }
        ("DELETE", "") => match state.onedrive.remove(&path) {
            Some(_) => Response::empty(204),
            None => graph_error(404, "itemNotFound"),
        },
        _ => graph_error(400, "invalidRequest"),
    }
}

/// One chunk of an upload session: `Content-Range: bytes <first>-<last>/<total>`, in order,
/// each but the last a multiple of 320 KiB.
fn onedrive_chunk(state: &mut CloudState, req: &Request, session: &str) -> Response {
    state.onedrive_chunks += 1;
    if req.header("Authorization").is_some() {
        state.onedrive_chunks_with_token += 1;
    }
    let range = req.header("Content-Range").unwrap().to_string();
    let (span, total) = range
        .strip_prefix("bytes ")
        .unwrap()
        .split_once('/')
        .unwrap();
    let (first, last) = span.split_once('-').unwrap();
    let (first, last, total): (usize, usize, usize) = (
        first.parse().unwrap(),
        last.parse().unwrap(),
        total.parse().unwrap(),
    );
    let Some((_, _, received)) = state.onedrive_sessions.get_mut(session) else {
        return graph_error(404, "itemNotFound");
    };
    assert_eq!(first, received.len(), "chunks out of order");
    assert_eq!(req.body.len(), last - first + 1);
    if last + 1 < total {
        assert_eq!(req.body.len() % (320 * 1024), 0);
    }
    received.extend_from_slice(&req.body);
    if last + 1 < total {
        return Response::json(
            202,
            json!({ "nextExpectedRanges": [format!("{}-", last + 1)] }),
        );
    }
    let (path, fail, bytes) = state.onedrive_sessions.remove(session).unwrap();
    if fail && state.onedrive.contains_key(&path) {
        return graph_error(409, "nameAlreadyExists");
    }
    state.onedrive.insert(path.clone(), bytes);
    Response::json(201, onedrive_item(&path))
}
