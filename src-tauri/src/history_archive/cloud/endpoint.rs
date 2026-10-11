//! The archive on the user's own backup service: one URL (the `/backup` route) answering
//! `GET ?path=` with a file, `GET ?list=` with a directory's entries as JSON, and `POST ?path=`
//! by storing the body whole. `POST` with `If-None-Match: *` is the exclusive create; a service
//! that ignores the header gets an upload-then-list create instead.

use std::net::IpAddr;

use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{HeaderName, CONTENT_TYPE, IF_NONE_MATCH};
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::super::crypto::random_bytes;
use super::super::provider::{check_path, ArchiveProvider};
use super::super::ArchiveError;
use super::http::{Http, Reply};

/// Named in errors.
pub(crate) const SERVICE: &str = "the backup endpoint";
/// The route's last path segment.
const ROUTE: &str = "backup";
/// The probe's file name starts with this; a random suffix follows.
const PROBE_PREFIX: &str = ".rim-probe-";
/// A create's claim files end with this.
const CLAIM_SUFFIX: &str = ".claim";

/// What a failed endpoint check found, so the user is told the actual problem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EndpointProblem {
    /// Plain HTTP to a host that is not this computer, without the user allowing it.
    Insecure,
    /// 401: the credentials were refused.
    Unauthorized,
    /// 403: the credentials were accepted, the access refused.
    Forbidden,
    /// 404 or 405 on the route: the URL leads somewhere that is not a backup endpoint.
    NotFound,
    /// A listing that is not a JSON array of entries.
    NotJson,
    /// The service answered but did not keep or return what it was sent.
    Broken,
}

impl EndpointProblem {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Insecure => "ARCHIVE_ENDPOINT_INSECURE",
            Self::Unauthorized => "ARCHIVE_ENDPOINT_UNAUTHORIZED",
            Self::Forbidden => "ARCHIVE_ENDPOINT_FORBIDDEN",
            Self::NotFound => "ARCHIVE_ENDPOINT_NOT_FOUND",
            Self::NotJson => "ARCHIVE_ENDPOINT_NOT_JSON",
            Self::Broken => "ARCHIVE_ENDPOINT_BROKEN",
        }
    }
}

fn problem(problem: EndpointProblem, message: impl Into<String>) -> ArchiveError {
    ArchiveError::Endpoint(problem, message.into())
}

/// How requests prove who sends them. The password or token is the connection's secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub(crate) enum EndpointAuth {
    None,
    /// HTTP Basic: this user name and the secret as the password.
    #[serde(rename_all = "camelCase")]
    Basic {
        username: String,
    },
    /// `Authorization: Bearer <secret>`.
    Bearer,
    /// `<name>: <secret>`.
    #[serde(rename_all = "camelCase")]
    Header {
        name: String,
    },
}

impl EndpointAuth {
    pub(crate) fn needs_secret(&self) -> bool {
        !matches!(self, Self::None)
    }
}

/// What the user typed to set up an endpoint.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndpointSetup {
    pub url: String,
    pub auth: EndpointAuth,
    /// The password or token; unused when `auth` takes none.
    #[serde(default)]
    pub secret: Option<Zeroizing<String>>,
    /// Plain HTTP to a host that is not this computer is allowed.
    #[serde(default)]
    pub allow_insecure: bool,
}

/// An endpoint as the account's settings name it. Its password or token, if any, is in the
/// secret vault under the connection id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndpointConnection {
    pub connection_id: String,
    /// The route's URL.
    pub url: String,
    pub auth: EndpointAuth,
    #[serde(default)]
    pub allow_insecure: bool,
    /// The service answered a repeated exclusive create of the probe with 412.
    #[serde(default)]
    pub exclusive_create: bool,
}

/// The outcome of a successful check: a connection waiting for the passphrase.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndpointCheck {
    pub connection_id: String,
    /// The route's URL, as it will be used.
    pub url: String,
    pub has_archive: bool,
    pub version: Option<u32>,
    pub exclusive_create: bool,
}

/// The route's URL for what the user typed: the URL itself when its path ends in `/backup`,
/// else `/backup` under it. Only `http` and `https` without credentials, query or fragment;
/// plain HTTP only to this computer unless `allow_insecure`.
pub(crate) fn route_url(typed: &str, allow_insecure: bool) -> Result<Url, ArchiveError> {
    let invalid = |why: &str| ArchiveError::Invalid(format!("backup endpoint URL: {why}"));
    let mut url = Url::parse(typed.trim()).map_err(|e| invalid(&e.to_string()))?;
    match url.scheme() {
        "https" => {}
        "http" if allow_insecure || is_loopback(&url) => {}
        "http" => {
            return Err(problem(
                EndpointProblem::Insecure,
                format!(
                    "{} is plain HTTP to another computer; use https:// or allow an unencrypted connection",
                    url.host_str().unwrap_or_default()
                ),
            ))
        }
        other => return Err(invalid(&format!("{other}: is not http or https"))),
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(invalid("it has no host"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid(
            "put the user name and password in their own fields",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid("it must not have a query (?) or a fragment (#)"));
    }
    let mut segments: Vec<String> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).map(str::to_string).collect())
        .unwrap_or_default();
    if segments.last().map(String::as_str) != Some(ROUTE) {
        segments.push(ROUTE.to_string());
    }
    url.set_path(&format!("/{}", segments.join("/")));
    Ok(url)
}

fn is_loopback(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// One entry of a listing.
#[derive(Debug, Clone, Deserialize)]
struct Entry {
    name: String,
    dir: bool,
}

/// `dir/name`, or `name` in the root.
fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

pub(crate) struct EndpointProvider {
    http: Http,
    url: Url,
    auth: EndpointAuth,
    secret: Option<Zeroizing<String>>,
    exclusive_create: bool,
}

impl EndpointProvider {
    pub(crate) fn new(
        http: Http,
        connection: &EndpointConnection,
        secret: Option<Zeroizing<String>>,
    ) -> Result<Self, ArchiveError> {
        let url = route_url(&connection.url, connection.allow_insecure)?;
        if connection.auth.needs_secret() && secret.as_ref().is_none_or(|s| s.is_empty()) {
            return Err(ArchiveError::Invalid(
                "enter the backup endpoint's password or token".into(),
            ));
        }
        if let EndpointAuth::Header { name } = &connection.auth {
            HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| ArchiveError::Invalid(format!("{name:?} is not a header name")))?;
        }
        Ok(Self {
            http,
            url,
            auth: connection.auth.clone(),
            secret,
            exclusive_create: connection.exclusive_create,
        })
    }

    fn request(&self, client: &Client, method: Method, param: &str, value: &str) -> RequestBuilder {
        let builder = client
            .request(method, self.url.clone())
            .query(&[(param, value)]);
        let Some(secret) = &self.secret else {
            return builder;
        };
        match &self.auth {
            EndpointAuth::None => builder,
            EndpointAuth::Basic { username } => builder.basic_auth(username, Some(secret.as_str())),
            EndpointAuth::Bearer => builder.bearer_auth(secret.as_str()),
            EndpointAuth::Header { name } => builder.header(name.as_str(), secret.as_str()),
        }
    }

    fn get(&self, param: &str, value: &str) -> Result<Reply, ArchiveError> {
        self.http
            .send(|c| self.request(c, Method::GET, param, value))
    }

    fn post(&self, path: &str, bytes: &[u8], exclusive: bool) -> Result<Reply, ArchiveError> {
        self.http.send(|c| {
            let request = self
                .request(c, Method::POST, "path", path)
                .header(CONTENT_TYPE, "application/octet-stream")
                .body(bytes.to_vec());
            if exclusive {
                request.header(IF_NONE_MATCH, "*")
            } else {
                request
            }
        })
    }

    /// The error for an answer the caller did not expect.
    fn failure(&self, what: &str, reply: &Reply) -> ArchiveError {
        match reply.status {
            StatusCode::UNAUTHORIZED => problem(
                EndpointProblem::Unauthorized,
                "the backup endpoint refused the credentials (401)",
            ),
            StatusCode::FORBIDDEN => problem(
                EndpointProblem::Forbidden,
                "the backup endpoint accepted the credentials but refuses access (403)",
            ),
            StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED => problem(
                EndpointProblem::NotFound,
                format!(
                    "no backup endpoint answers at {} ({})",
                    self.url, reply.status
                ),
            ),
            StatusCode::PAYLOAD_TOO_LARGE => ArchiveError::NotWritable(
                "the backup endpoint refuses files this large (413)".into(),
            ),
            StatusCode::INSUFFICIENT_STORAGE => {
                ArchiveError::NotWritable("the backup endpoint is full (507)".into())
            }
            _ => self.http.failure(what, reply),
        }
    }

    fn upload(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        let reply = self.post(path, bytes, false)?;
        if reply.ok() {
            Ok(())
        } else {
            Err(self.failure("upload", &reply))
        }
    }

    /// The entries directly in `dir` (`""` is the root), in the order the service lists them;
    /// `None` when there is no such directory.
    fn list(&self, dir: &str) -> Result<Option<Vec<Entry>>, ArchiveError> {
        let reply = self.get("list", dir)?;
        if reply.status == StatusCode::NOT_FOUND && !dir.is_empty() {
            return Ok(None);
        }
        if !reply.ok() {
            return Err(self.failure("listing", &reply));
        }
        let entries: Vec<Entry> = serde_json::from_slice(&reply.body).map_err(|e| {
            problem(
                EndpointProblem::NotJson,
                format!("the backup endpoint's listing is not a JSON array of entries: {e}"),
            )
        })?;
        // A name that is not one path segment breaks the protocol; it is ignored like any
        // other unexpected name.
        Ok(Some(
            entries
                .into_iter()
                .filter(|e| check_path(&e.name).is_ok() && !e.name.contains('/'))
                .collect(),
        ))
    }

    /// Store a random file, list the root, read the file back, and store it again
    /// exclusively. Returns whether the service honours `If-None-Match: *` (412).
    pub(crate) fn probe(&self) -> Result<bool, ArchiveError> {
        let name = format!("{PROBE_PREFIX}{}", hex::encode(random_bytes::<8>()?));
        let body = random_bytes::<32>()?;
        self.upload(&name, &body)?;
        self.list("")?;
        let reply = self.get("path", &name)?;
        if reply.status == StatusCode::NOT_FOUND {
            return Err(problem(
                EndpointProblem::Broken,
                "the backup endpoint took a file but does not return it",
            ));
        }
        if !reply.ok() {
            return Err(self.failure("download", &reply));
        }
        if reply.body != body {
            return Err(problem(
                EndpointProblem::Broken,
                "the backup endpoint returns other bytes than it was sent",
            ));
        }
        let reply = self.post(&name, &body, true)?;
        match reply.status {
            StatusCode::PRECONDITION_FAILED => Ok(true),
            StatusCode::NOT_IMPLEMENTED => Ok(false),
            status if status.is_success() => Ok(false),
            _ => Err(self.failure("upload", &reply)),
        }
    }

    /// Create without the service's help: store the bytes under a claim name of their own,
    /// list the directory, and keep the claim it names first (the oldest, since such a
    /// service lists in the order it stored). Every device copies the kept claim to `path`,
    /// so all of them write the same bytes there.
    fn create_by_claim(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        if self.read(path)?.is_some() {
            return Ok(false);
        }
        let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
        let prefix = format!(".{name}.");
        let claim = format!(
            "{prefix}{}{CLAIM_SUFFIX}",
            hex::encode(random_bytes::<6>()?)
        );
        self.upload(&join(dir, &claim), bytes)?;
        let first = self
            .list(dir)?
            .unwrap_or_default()
            .into_iter()
            .find(|e| !e.dir && e.name.starts_with(&prefix) && e.name.ends_with(CLAIM_SUFFIX))
            .ok_or_else(|| {
                problem(
                    EndpointProblem::Broken,
                    "the backup endpoint's listing does not name the file just stored",
                )
            })?;
        if first.name == claim {
            self.upload(path, bytes)?;
            return Ok(true);
        }
        let kept = self.read(&join(dir, &first.name))?.ok_or_else(|| {
            problem(
                EndpointProblem::Broken,
                "the backup endpoint lists a file it does not return",
            )
        })?;
        self.upload(path, &kept)?;
        Ok(false)
    }
}

impl ArchiveProvider for EndpointProvider {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, ArchiveError> {
        check_path(path)?;
        let reply = self.get("path", path)?;
        if reply.ok() {
            return Ok(Some(reply.body));
        }
        if reply.status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Err(self.failure("download", &reply))
    }

    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        check_path(path)?;
        self.upload(path, bytes)
    }

    fn create(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        check_path(path)?;
        if !self.exclusive_create {
            return self.create_by_claim(path, bytes);
        }
        let reply = self.post(path, bytes, true)?;
        if reply.ok() {
            return Ok(true);
        }
        if reply.status == StatusCode::PRECONDITION_FAILED {
            return Ok(false);
        }
        Err(self.failure("upload", &reply))
    }

    fn list_dirs(&self, dir: &str) -> Result<Vec<String>, ArchiveError> {
        check_path(dir)?;
        let mut dirs: Vec<String> = self
            .list(dir)?
            .unwrap_or_default()
            .into_iter()
            .filter(|e| e.dir)
            .map(|e| e.name)
            .collect();
        dirs.sort();
        dirs.dedup();
        Ok(dirs)
    }

    fn check_writable(&self) -> Result<(), ArchiveError> {
        self.probe().map(|_| ())
    }

    fn describe(&self) -> String {
        self.url.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_route_is_appended_unless_the_url_names_it() {
        for (typed, route) in [
            ("https://example.com", "https://example.com/backup"),
            ("https://example.com/", "https://example.com/backup"),
            ("https://example.com/rim", "https://example.com/rim/backup"),
            (
                "https://example.com/rim/backup/",
                "https://example.com/rim/backup",
            ),
            (
                " https://example.com:8443/backup ",
                "https://example.com:8443/backup",
            ),
            ("http://127.0.0.1:9000", "http://127.0.0.1:9000/backup"),
            ("http://localhost/x", "http://localhost/x/backup"),
            ("http://[::1]:9000", "http://[::1]:9000/backup"),
        ] {
            assert_eq!(route_url(typed, false).unwrap().as_str(), route, "{typed}");
        }
    }

    #[test]
    fn plain_http_needs_loopback_or_the_users_consent() {
        assert!(matches!(
            route_url("http://nas.home.arpa/backup", false),
            Err(ArchiveError::Endpoint(EndpointProblem::Insecure, _))
        ));
        assert_eq!(
            route_url("http://nas.home.arpa/backup", true)
                .unwrap()
                .as_str(),
            "http://nas.home.arpa/backup"
        );
        for bad in [
            "ftp://example.com",
            "https://ada:pw@example.com",
            "https://example.com/backup?x=1",
            "https://example.com/#top",
            "not a url",
        ] {
            assert!(
                matches!(route_url(bad, true), Err(ArchiveError::Invalid(_))),
                "{bad}"
            );
        }
    }

    #[test]
    fn auth_settings_are_saved_without_the_secret() {
        let connection = EndpointConnection {
            connection_id: "c1".into(),
            url: "https://example.com/backup".into(),
            auth: EndpointAuth::Header {
                name: "X-Api-Key".into(),
            },
            allow_insecure: false,
            exclusive_create: true,
        };
        let saved = serde_json::to_value(&connection).unwrap();
        assert_eq!(
            saved,
            serde_json::json!({
                "connectionId": "c1",
                "url": "https://example.com/backup",
                "auth": { "mode": "header", "name": "X-Api-Key" },
                "allowInsecure": false,
                "exclusiveCreate": true,
            })
        );
        let setup: EndpointSetup = serde_json::from_value(serde_json::json!({
            "url": "https://example.com",
            "auth": { "mode": "basic", "username": "ada" },
            "secret": "pw",
        }))
        .unwrap();
        assert_eq!(
            setup.auth,
            EndpointAuth::Basic {
                username: "ada".into()
            }
        );
        assert!(!setup.allow_insecure);
    }
}
