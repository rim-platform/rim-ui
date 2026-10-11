//! The archive in a bucket of S3-compatible storage (Amazon S3, Cloudflare R2, Backblaze B2,
//! MinIO, Garage): one object per archive file under a prefix the user picks, every request
//! signed with Signature Version 4.
//!
//! Directories are the common prefixes of a listing delimited by `/`. The exclusive create is a
//! `PUT` with `If-None-Match: *`; storage without conditional writes gets claims, of which the
//! oldest (`LastModified`, then key) is kept.

use chrono::{DateTime, Utc};
use reqwest::header::{HeaderName, IF_NONE_MATCH};
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::super::crypto::random_bytes;
use super::super::provider::{check_path, ArchiveProvider};
use super::super::ArchiveError;
use super::claims;
use super::endpoint::service_url;
use super::http::{Http, Reply};
use super::sigv4;

/// Named in errors.
pub(crate) const SERVICE: &str = "the S3 storage";
/// The region when the user gives none; most S3-compatible storage accepts it.
const DEFAULT_REGION: &str = "us-east-1";
const PROBE_PREFIX: &str = ".rim-probe-";

/// What a failed request or check found, so the user is told the actual problem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum S3Problem {
    /// The access key id is unknown, or the secret does not match it.
    Credentials,
    /// The key is valid but may not do this here.
    Forbidden,
    NoSuchBucket,
    /// The bucket is in another region than the requests are signed for.
    WrongRegion,
    /// This computer's clock is too far from the storage's.
    Clock,
    /// Something answered, but not as S3 storage.
    NotS3,
    /// The storage answered but did not keep or return what it was sent.
    Broken,
}

impl S3Problem {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Credentials => "ARCHIVE_S3_CREDENTIALS",
            Self::Forbidden => "ARCHIVE_S3_FORBIDDEN",
            Self::NoSuchBucket => "ARCHIVE_S3_NO_BUCKET",
            Self::WrongRegion => "ARCHIVE_S3_REGION",
            Self::Clock => "ARCHIVE_S3_CLOCK",
            Self::NotS3 => "ARCHIVE_S3_NOT_S3",
            Self::Broken => "ARCHIVE_S3_BROKEN",
        }
    }
}

fn problem(problem: S3Problem, message: impl Into<String>) -> ArchiveError {
    ArchiveError::S3(problem, message.into())
}

/// Where the bucket goes in a request's URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Addressing {
    /// `https://<endpoint>/<bucket>/<key>`
    Path,
    /// `https://<bucket>.<endpoint>/<key>`
    VirtualHost,
}

impl Addressing {
    /// Virtual-host for Amazon's own endpoints, path-style for any other.
    pub(crate) fn default_for(endpoint: &Url) -> Self {
        let host = endpoint.host_str().unwrap_or_default();
        if host == "amazonaws.com" || host.ends_with(".amazonaws.com") {
            Self::VirtualHost
        } else {
            Self::Path
        }
    }
}

/// What the user typed to set up a bucket.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct S3Setup {
    pub endpoint: String,
    #[serde(default)]
    pub region: String,
    pub bucket: String,
    #[serde(default)]
    pub prefix: String,
    pub access_key_id: String,
    pub secret_access_key: Option<Zeroizing<String>>,
    /// `None`: the default for the endpoint.
    #[serde(default)]
    pub addressing: Option<Addressing>,
    /// Plain HTTP to a host that is not this computer is allowed.
    #[serde(default)]
    pub allow_insecure: bool,
}

/// A bucket as the account's settings name it. The secret access key is in the secret vault
/// under the connection id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct S3Connection {
    pub connection_id: String,
    /// The endpoint's URL, without a trailing `/`.
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    /// Prepended to every archive path: empty, or ending in `/`.
    pub prefix: String,
    pub access_key_id: String,
    pub addressing: Addressing,
    #[serde(default)]
    pub allow_insecure: bool,
    /// The storage answered a repeated `If-None-Match: *` write of the probe with 412.
    #[serde(default)]
    pub conditional_writes: bool,
}

impl S3Connection {
    /// A new connection from what the user typed, checked and normalized.
    pub(crate) fn from_setup(setup: &S3Setup) -> Result<Self, ArchiveError> {
        let invalid = |why: String| ArchiveError::Invalid(why);
        let endpoint = service_url(&setup.endpoint, setup.allow_insecure, "S3 endpoint URL")?;
        let region = match setup.region.trim() {
            "" => DEFAULT_REGION.to_string(),
            region => region.to_string(),
        };
        if !region
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(invalid(format!("{region:?} is not a region")));
        }
        let bucket = setup.bucket.trim().to_string();
        let bucket_ok = !bucket.is_empty()
            && bucket.len() <= 255
            && bucket
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
        if !bucket_ok {
            return Err(invalid(format!("{bucket:?} is not a bucket name")));
        }
        let prefix = setup.prefix.trim().trim_matches('/');
        if !prefix.is_empty() {
            check_path(prefix).map_err(|_| invalid(format!("{prefix:?} is not a prefix")))?;
        }
        let access_key_id = setup.access_key_id.trim().to_string();
        if access_key_id.is_empty() {
            return Err(invalid("enter the access key id".into()));
        }
        Ok(Self {
            connection_id: uuid::Uuid::new_v4().to_string(),
            endpoint: endpoint.as_str().trim_end_matches('/').to_string(),
            region,
            bucket,
            prefix: if prefix.is_empty() {
                String::new()
            } else {
                format!("{prefix}/")
            },
            access_key_id,
            addressing: setup
                .addressing
                .unwrap_or_else(|| Addressing::default_for(&endpoint)),
            allow_insecure: setup.allow_insecure,
            conditional_writes: false,
        })
    }

    /// What the user sees: `bucket/prefix on host`.
    pub(crate) fn location(&self) -> String {
        let host = Url::parse(&self.endpoint)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default();
        let place = format!("{}/{}", self.bucket, self.prefix);
        format!("{} on {host}", place.trim_end_matches('/'))
    }
}

/// The outcome of a successful check: a connection waiting for the passphrase.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct S3Check {
    pub connection_id: String,
    /// `bucket/prefix on host`.
    pub location: String,
    pub has_archive: bool,
    pub version: Option<u32>,
    pub conditional_writes: bool,
}

/// S3 answers 409 `ConditionalRequestConflict` while another conditional write of the same key
/// is in flight, and asks for a retry.
pub(crate) fn is_retryable_conflict(status: StatusCode, body: &[u8]) -> bool {
    status == StatusCode::CONFLICT && error_code(body) == "ConditionalRequestConflict"
}

// ─── XML ────────────────────────────────────────────────────────────────────

/// The contents of every `<tag>` element in `xml`, in order, entities not decoded. S3's
/// answers are small, flat documents; this is all of XML they need.
fn elements<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut found = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        let Some(end) = after.find('>') else { break };
        let head = &after[..end];
        let body = &after[end + 1..];
        if !(head.is_empty() || head.starts_with(char::is_whitespace) || head == "/") {
            // A longer tag name that starts with this one.
            rest = after;
            continue;
        }
        if head.ends_with('/') {
            found.push("");
            rest = body;
            continue;
        }
        let Some(stop) = body.find(&close) else { break };
        found.push(&body[..stop]);
        rest = &body[stop + close.len()..];
    }
    found
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// The first `<tag>`'s text.
fn text(xml: &str, tag: &str) -> Option<String> {
    elements(xml, tag).first().map(|t| unescape(t))
}

/// The `<Code>` of an S3 error document; empty when the body is none.
fn error_code(body: &[u8]) -> String {
    let body = String::from_utf8_lossy(body);
    elements(&body, "Error")
        .first()
        .and_then(|error| text(error, "Code"))
        .unwrap_or_default()
}

/// One object of a listing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Object {
    pub key: String,
    pub last_modified: Option<DateTime<Utc>>,
}

/// One page of a `ListObjectsV2` answer: the common prefixes, the objects, and the token of
/// the next page.
fn parse_listing(body: &[u8]) -> Option<(Vec<String>, Vec<Object>, Option<String>)> {
    let xml = String::from_utf8_lossy(body);
    let result = *elements(&xml, "ListBucketResult").first()?;
    let prefixes = elements(result, "CommonPrefixes")
        .into_iter()
        .filter_map(|p| text(p, "Prefix"))
        .collect();
    let objects = elements(result, "Contents")
        .into_iter()
        .filter_map(|o| {
            Some(Object {
                key: text(o, "Key")?,
                last_modified: text(o, "LastModified")
                    .and_then(|t| DateTime::parse_from_rfc3339(&t).ok())
                    .map(|t| t.with_timezone(&Utc)),
            })
        })
        .collect();
    let truncated = text(result, "IsTruncated").as_deref() == Some("true");
    let next = text(result, "NextContinuationToken").filter(|_| truncated);
    Some((prefixes, objects, next))
}

/// The claim to keep: the oldest, then the first key, so every device picks the same one.
pub(crate) fn oldest_claim(claims: &[Object]) -> Option<&Object> {
    claims
        .iter()
        .min_by(|a, b| (a.last_modified, &a.key).cmp(&(b.last_modified, &b.key)))
}

// ─── Provider ───────────────────────────────────────────────────────────────

pub(crate) struct S3Provider {
    http: Http,
    endpoint: Url,
    connection: S3Connection,
    secret: Zeroizing<String>,
}

impl S3Provider {
    pub(crate) fn new(
        http: Http,
        connection: &S3Connection,
        secret: Zeroizing<String>,
    ) -> Result<Self, ArchiveError> {
        let endpoint = service_url(
            &connection.endpoint,
            connection.allow_insecure,
            "S3 endpoint URL",
        )?;
        if secret.is_empty() {
            return Err(ArchiveError::Invalid("enter the secret access key".into()));
        }
        Ok(Self {
            http,
            endpoint,
            connection: connection.clone(),
            secret,
        })
    }

    /// The object key of an archive path.
    fn key(&self, path: &str) -> String {
        format!("{}{path}", self.connection.prefix)
    }

    /// The URL of `key` (the bucket itself when empty) with `query`, and the `Host` it is sent
    /// to.
    fn url(&self, key: &str, query: &[(String, String)]) -> Result<(Url, String), ArchiveError> {
        let base_path = self.endpoint.path().trim_end_matches('/');
        let encoded_key = sigv4::uri_encode(key, true);
        let host = self.endpoint.host_str().unwrap_or_default();
        let (host, path) = match self.connection.addressing {
            Addressing::Path if key.is_empty() => (
                host.to_string(),
                format!("{base_path}/{}", self.connection.bucket),
            ),
            Addressing::Path => (
                host.to_string(),
                format!("{base_path}/{}/{encoded_key}", self.connection.bucket),
            ),
            Addressing::VirtualHost => (
                format!("{}.{host}", self.connection.bucket),
                format!("{base_path}/{encoded_key}"),
            ),
        };
        let host = match self.endpoint.port() {
            Some(port) => format!("{host}:{port}"),
            None => host,
        };
        let mut url = format!("{}://{host}{path}", self.endpoint.scheme());
        if !query.is_empty() {
            url.push('?');
            url.push_str(&sigv4::canonical_query(query));
        }
        let url = Url::parse(&url)
            .map_err(|e| ArchiveError::Invalid(format!("S3 request URL {url}: {e}")))?;
        Ok((url, host))
    }

    /// Send a signed request, signing each attempt anew.
    fn send(
        &self,
        method: Method,
        key: &str,
        query: &[(String, String)],
        body: &[u8],
        if_none_match: bool,
    ) -> Result<Reply, ArchiveError> {
        let (url, host) = self.url(key, query)?;
        let payload_hash = sigv4::payload_hash(body);
        let signing_key = sigv4::Key {
            access_key_id: &self.connection.access_key_id,
            secret: &self.secret,
            region: &self.connection.region,
            service: "s3",
        };
        self.http.send(|client| {
            let now = Utc::now();
            let date = now.format(sigv4::AMZ_DATE).to_string();
            let mut headers = vec![
                ("host", host.as_str()),
                ("x-amz-content-sha256", payload_hash.as_str()),
                ("x-amz-date", date.as_str()),
            ];
            if if_none_match {
                headers.push(("if-none-match", "*"));
            }
            let authorization = sigv4::authorization(
                &sigv4::Request {
                    method: method.as_str(),
                    path: url.path(),
                    query,
                    headers: &headers,
                    payload_hash: &payload_hash,
                },
                &signing_key,
                now,
            );
            let mut request = client
                .request(method.clone(), url.clone())
                .header(reqwest::header::AUTHORIZATION, authorization)
                .header(
                    HeaderName::from_static("x-amz-content-sha256"),
                    &payload_hash,
                )
                .header(HeaderName::from_static("x-amz-date"), &date);
            if if_none_match {
                request = request.header(IF_NONE_MATCH, "*");
            }
            if method == Method::PUT {
                request = request.body(body.to_vec());
            }
            request
        })
    }

    /// The error for an answer the caller did not expect.
    fn failure(&self, what: &str, reply: &Reply) -> ArchiveError {
        let code = error_code(&reply.body);
        let bucket = &self.connection.bucket;
        match (reply.status, code.as_str()) {
            (_, "InvalidAccessKeyId" | "SignatureDoesNotMatch") => problem(
                S3Problem::Credentials,
                format!("the storage refused the access key or secret ({code})"),
            ),
            (_, "AccessDenied") | (StatusCode::FORBIDDEN, "") => problem(
                S3Problem::Forbidden,
                format!("the access key may not {what} in {bucket}"),
            ),
            (_, "NoSuchBucket") => problem(
                S3Problem::NoSuchBucket,
                format!(
                    "there is no bucket {bucket} at {}",
                    self.connection.endpoint
                ),
            ),
            (
                _,
                "AuthorizationHeaderMalformed"
                | "PermanentRedirect"
                | "IllegalLocationConstraintException",
            )
            | (StatusCode::MOVED_PERMANENTLY, _) => problem(
                S3Problem::WrongRegion,
                format!(
                    "{bucket} is not in region {} ({code})",
                    self.connection.region
                ),
            ),
            (_, "RequestTimeTooSkewed") => problem(
                S3Problem::Clock,
                "this computer's clock is too far off for the storage",
            ),
            (StatusCode::PAYLOAD_TOO_LARGE, _) | (_, "EntityTooLarge") => {
                ArchiveError::NotWritable("the storage refuses objects this large".into())
            }
            (status, "") if status.is_client_error() && status != StatusCode::TOO_MANY_REQUESTS => {
                problem(
                    S3Problem::NotS3,
                    format!(
                        "{} answered {status}, not as S3 storage",
                        self.connection.endpoint
                    ),
                )
            }
            _ => self.http.failure(what, reply),
        }
    }

    fn get_object(&self, key: &str) -> Result<Option<Vec<u8>>, ArchiveError> {
        let reply = self.send(Method::GET, key, &[], b"", false)?;
        if reply.ok() {
            return Ok(Some(reply.body));
        }
        if reply.status == StatusCode::NOT_FOUND && error_code(&reply.body) != "NoSuchBucket" {
            return Ok(None);
        }
        Err(self.failure("read", &reply))
    }

    fn put_object(&self, key: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        let reply = self.send(Method::PUT, key, &[], bytes, false)?;
        if reply.ok() {
            Ok(())
        } else {
            Err(self.failure("write", &reply))
        }
    }

    /// Every page of a listing of `prefix`, delimited by `/` when `delimited`: the common
    /// prefixes and the objects.
    fn list(
        &self,
        prefix: &str,
        delimited: bool,
    ) -> Result<(Vec<String>, Vec<Object>), ArchiveError> {
        let mut prefixes = Vec::new();
        let mut objects = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut query = vec![
                ("list-type".to_string(), "2".to_string()),
                ("prefix".to_string(), prefix.to_string()),
            ];
            if delimited {
                query.push(("delimiter".to_string(), "/".to_string()));
            }
            if let Some(token) = token.take() {
                query.push(("continuation-token".to_string(), token));
            }
            let reply = self.send(Method::GET, "", &query, b"", false)?;
            if !reply.ok() {
                return Err(self.failure("list", &reply));
            }
            let (page_prefixes, page_objects, next) =
                parse_listing(&reply.body).ok_or_else(|| {
                    problem(
                        S3Problem::NotS3,
                        format!(
                            "{} answered a listing that is not S3's",
                            self.connection.endpoint
                        ),
                    )
                })?;
            prefixes.extend(page_prefixes);
            objects.extend(page_objects);
            match next {
                Some(next) => token = Some(next),
                None => return Ok((prefixes, objects)),
            }
        }
    }

    /// Write a random object, read it back, write it again with `If-None-Match: *`, list the
    /// prefix, and delete the object. Returns whether the storage takes conditional writes
    /// (412). A storage that refuses the delete still passes: the archive never deletes.
    pub(crate) fn probe(&self) -> Result<bool, ArchiveError> {
        let key = self.key(&format!(
            "{PROBE_PREFIX}{}",
            hex::encode(random_bytes::<8>()?)
        ));
        let body = random_bytes::<32>()?;
        self.put_object(&key, &body)?;
        match self.get_object(&key)? {
            Some(read) if read == body => {}
            Some(_) => {
                return Err(problem(
                    S3Problem::Broken,
                    "the storage returns other bytes than it was sent",
                ))
            }
            None => {
                return Err(problem(
                    S3Problem::Broken,
                    "the storage took an object but does not return it",
                ))
            }
        }
        let reply = self.send(Method::PUT, &key, &[], &body, true)?;
        let conditional = match reply.status {
            StatusCode::PRECONDITION_FAILED => true,
            StatusCode::NOT_IMPLEMENTED => false,
            status if status.is_success() => false,
            _ => return Err(self.failure("write", &reply)),
        };
        self.list(&self.connection.prefix, true)?;
        let reply = self.send(Method::DELETE, &key, &[], b"", false)?;
        if !reply.ok() {
            log::warn!(
                "[history_archive] the S3 probe {key} could not be deleted: {}",
                reply.status
            );
        }
        Ok(conditional)
    }

    /// Create without a conditional write: store the bytes under a claim, list the claims,
    /// and copy the oldest to `path`. Every device copies the same claim, so they all write
    /// the same bytes there.
    fn create_by_claim(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        if self.read(path)?.is_some() {
            return Ok(false);
        }
        let (dir, name) = claims::split(path);
        let claim = self.key(&claims::join(dir, &claims::new_claim(name)?));
        self.put_object(&claim, bytes)?;
        let dir_prefix = self.key(&claims::join(dir, ""));
        let (_, objects) = self.list(&format!("{dir_prefix}.{name}."), false)?;
        let candidates: Vec<Object> = objects
            .into_iter()
            .filter(|o| {
                o.key
                    .strip_prefix(&dir_prefix)
                    .is_some_and(|n| !n.contains('/') && claims::is_claim(n, name))
            })
            .collect();
        let kept = oldest_claim(&candidates).ok_or_else(|| {
            problem(
                S3Problem::Broken,
                "the storage's listing does not name the object just stored",
            )
        })?;
        if kept.key == claim {
            self.put_object(&self.key(path), bytes)?;
            return Ok(true);
        }
        let kept_bytes = self.get_object(&kept.key)?.ok_or_else(|| {
            problem(
                S3Problem::Broken,
                "the storage lists an object it does not return",
            )
        })?;
        self.put_object(&self.key(path), &kept_bytes)?;
        Ok(false)
    }
}

impl ArchiveProvider for S3Provider {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, ArchiveError> {
        check_path(path)?;
        self.get_object(&self.key(path))
    }

    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        check_path(path)?;
        self.put_object(&self.key(path), bytes)
    }

    fn create(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        check_path(path)?;
        if self.connection.conditional_writes {
            let reply = self.send(Method::PUT, &self.key(path), &[], bytes, true)?;
            match reply.status {
                status if status.is_success() => return Ok(true),
                StatusCode::PRECONDITION_FAILED => return Ok(false),
                StatusCode::NOT_IMPLEMENTED => {}
                _ => return Err(self.failure("write", &reply)),
            }
        }
        self.create_by_claim(path, bytes)
    }

    fn list_dirs(&self, dir: &str) -> Result<Vec<String>, ArchiveError> {
        check_path(dir)?;
        let prefix = self.key(&format!("{dir}/"));
        let (prefixes, _) = self.list(&prefix, true)?;
        let mut dirs: Vec<String> = prefixes
            .iter()
            .filter_map(|p| p.strip_prefix(&prefix)?.strip_suffix('/'))
            .filter(|name| !name.is_empty() && !name.contains('/'))
            .map(str::to_string)
            .collect();
        dirs.sort();
        dirs.dedup();
        Ok(dirs)
    }

    fn check_writable(&self) -> Result<(), ArchiveError> {
        self.probe().map(|_| ())
    }

    fn describe(&self) -> String {
        self.connection.location()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(endpoint: &str) -> S3Setup {
        S3Setup {
            endpoint: endpoint.into(),
            region: String::new(),
            bucket: "rim".into(),
            prefix: "/backups/ada/".into(),
            access_key_id: " AKID ".into(),
            secret_access_key: Some(Zeroizing::new("secret".into())),
            addressing: None,
            allow_insecure: false,
        }
    }

    fn provider(connection: &S3Connection) -> S3Provider {
        let http = Http::new(SERVICE, super::super::http::RetryPolicy::ONCE, |_, _| false).unwrap();
        S3Provider::new(http, connection, Zeroizing::new("secret".into())).unwrap()
    }

    #[test]
    fn a_setup_is_normalized_with_addressing_by_endpoint() {
        let aws =
            S3Connection::from_setup(&setup("https://s3.eu-central-1.amazonaws.com/")).unwrap();
        assert_eq!(aws.endpoint, "https://s3.eu-central-1.amazonaws.com");
        assert_eq!(aws.region, "us-east-1");
        assert_eq!(aws.prefix, "backups/ada/");
        assert_eq!(aws.access_key_id, "AKID");
        assert_eq!(aws.addressing, Addressing::VirtualHost);
        assert_eq!(
            aws.location(),
            "rim/backups/ada on s3.eu-central-1.amazonaws.com"
        );

        let mut minio = setup("http://localhost:9000");
        minio.prefix = String::new();
        minio.region = "garage".into();
        let minio = S3Connection::from_setup(&minio).unwrap();
        assert_eq!(minio.addressing, Addressing::Path);
        assert_eq!(minio.prefix, "");
        assert_eq!(minio.location(), "rim on localhost");

        let mut chosen = setup("https://s3.amazonaws.com");
        chosen.addressing = Some(Addressing::Path);
        assert_eq!(
            S3Connection::from_setup(&chosen).unwrap().addressing,
            Addressing::Path
        );

        for (field, bad) in [
            ("bucket", "has space"),
            ("bucket", ""),
            ("prefix", "a/../b"),
            ("region", "eu central"),
            ("key", " "),
        ] {
            let mut s = setup("https://s3.example.com");
            match field {
                "bucket" => s.bucket = bad.into(),
                "prefix" => s.prefix = bad.into(),
                "region" => s.region = bad.into(),
                _ => s.access_key_id = bad.into(),
            }
            assert!(
                matches!(S3Connection::from_setup(&s), Err(ArchiveError::Invalid(_))),
                "{field} {bad:?}"
            );
        }
        assert!(matches!(
            S3Connection::from_setup(&setup("http://minio.home.arpa:9000")),
            Err(ArchiveError::Endpoint(_, _))
        ));
    }

    #[test]
    fn requests_go_to_the_bucket_by_path_or_by_host() {
        let mut connection =
            S3Connection::from_setup(&setup("https://storage.example.com:8443/s3")).unwrap();
        let provider_path = provider(&connection);
        let (url, host) = provider_path
            .url("backups/ada/a b/c", &[("prefix".into(), "x/".into())])
            .unwrap();
        assert_eq!(
            url.as_str(),
            "https://storage.example.com:8443/s3/rim/backups/ada/a%20b/c?prefix=x%2F"
        );
        assert_eq!(host, "storage.example.com:8443");
        assert_eq!(
            provider_path.url("", &[]).unwrap().0.as_str(),
            "https://storage.example.com:8443/s3/rim"
        );

        connection.addressing = Addressing::VirtualHost;
        let provider_host = provider(&connection);
        let (url, host) = provider_host.url("backups/ada/k", &[]).unwrap();
        assert_eq!(
            url.as_str(),
            "https://rim.storage.example.com:8443/s3/backups/ada/k"
        );
        assert_eq!(host, "rim.storage.example.com:8443");
    }

    #[test]
    fn listings_and_errors_are_read_from_s3_xml() {
        let listing = br#"<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>rim</Name><Prefix>p/</Prefix><KeyCount>3</KeyCount>
  <IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;2</NextContinuationToken>
  <Contents><Key>p/a&amp;b</Key><LastModified>2026-10-12T08:00:00.000Z</LastModified></Contents>
  <Contents><Key>p/c</Key><LastModified>2026-10-12T08:00:01.000Z</LastModified></Contents>
  <CommonPrefixes><Prefix>p/d1/</Prefix></CommonPrefixes>
  <CommonPrefixes><Prefix>p/d2/</Prefix></CommonPrefixes>
</ListBucketResult>"#;
        let (prefixes, objects, next) = parse_listing(listing).unwrap();
        assert_eq!(prefixes, vec!["p/d1/", "p/d2/"]);
        assert_eq!(objects.len(), 2);
        assert_eq!(objects[0].key, "p/a&b");
        assert_eq!(next.as_deref(), Some("t&2"));
        assert!(parse_listing(b"<html><body>Welcome</body></html>").is_none());

        let error =
            b"<?xml version=\"1.0\"?><Error><Code>NoSuchBucket</Code><Message>x</Message></Error>";
        assert_eq!(error_code(error), "NoSuchBucket");
        assert_eq!(error_code(b"not xml"), "");
        assert!(is_retryable_conflict(
            StatusCode::CONFLICT,
            b"<Error><Code>ConditionalRequestConflict</Code></Error>"
        ));
        assert!(!is_retryable_conflict(
            StatusCode::CONFLICT,
            b"<Error><Code>BucketAlreadyExists</Code></Error>"
        ));
    }

    #[test]
    fn the_oldest_claim_wins_and_the_key_breaks_ties() {
        let at = |s: &str| Some(DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc));
        let claim = |key: &str, time: &str| Object {
            key: key.into(),
            last_modified: at(time),
        };
        let claims = [
            claim(".m.bbb.claim", "2026-10-12T08:00:01Z"),
            claim(".m.ccc.claim", "2026-10-12T08:00:00Z"),
            claim(".m.aaa.claim", "2026-10-12T08:00:01Z"),
        ];
        assert_eq!(oldest_claim(&claims).unwrap().key, ".m.ccc.claim");
        assert_eq!(oldest_claim(&claims[..1]).unwrap().key, ".m.bbb.claim");
        assert_eq!(
            oldest_claim(&[claims[0].clone(), claims[2].clone()])
                .unwrap()
                .key,
            ".m.aaa.claim"
        );
    }
}
