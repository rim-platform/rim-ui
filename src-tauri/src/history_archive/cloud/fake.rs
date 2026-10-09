//! Test doubles for the cloud providers: an in-memory credential store, and a fake Google
//! Drive, Dropbox and OAuth token endpoint on a local HTTP server, holding files in memory.
//! Only the API surface the providers use is implemented, with the behaviors they rely on
//! (Drive's duplicate names and `appDataFolder`, Dropbox's upload modes and 409 errors,
//! bearer tokens that expire, rate limits on demand).

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::super::ArchiveError;
use super::http::RetryPolicy;
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

/// An injected failure: the next `times` requests whose "METHOD /path Dropbox-API-Arg" line
/// contains `matching` get `status` (with `Retry-After` and `body`).
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
    /// Entries per `list_folder` page (Drive pages are `pageSize` or this).
    pub page_size: usize,

    pub faults: Vec<Fault>,
    /// "METHOD /path" of every request.
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
}

/// A fake Google Drive, Dropbox and token endpoint, and settings pointing at them.
pub(crate) struct FakeCloud {
    pub state: Arc<Mutex<CloudState>>,
    server: FakeServer,
}

pub(crate) const GOOD_CODE: &str = "good-code";

impl FakeCloud {
    pub(crate) fn start() -> Self {
        let state = Arc::new(Mutex::new(CloudState {
            access_token: "access-0".into(),
            refresh_token: "refresh-0".into(),
            email: "ada@example.com".into(),
            page_size: 1000,
            ..CloudState::default()
        }));
        let handler_state = state.clone();
        let server = FakeServer::start(move |req| handle(&mut handler_state.lock().unwrap(), req));
        Self { state, server }
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
        for service in [&mut settings.google, &mut settings.dropbox] {
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
        settings.drive.revoke = format!("{url}/revoke");
        settings.dropbox_api.api = format!("{url}/dbx/api/2");
        settings.dropbox_api.content = format!("{url}/dbx/content/2");
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

fn handle(state: &mut CloudState, req: Request) -> Response {
    let arg = req.header("Dropbox-API-Arg").unwrap_or("").to_string();
    let line = format!("{} {} {arg}", req.method, req.path);
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
        ("POST", "/revoke") => {
            state.revoked += 1;
            return Response::json(200, json!({}));
        }
        _ => {}
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
            Response {
                status: 204,
                headers: Vec::new(),
                body: Vec::new(),
            }
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
