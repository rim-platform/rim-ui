//! The archive in the OneDrive app folder (`Apps/<app name>/`, Microsoft Graph's special folder
//! `approot`): with the scope `Files.ReadWrite.AppFolder` the app sees nothing else in the
//! user's OneDrive.
//!
//! Graph addresses items by their path under the folder, uploads a file whole (in one request
//! up to 4 MiB, through an upload session beyond that), and fails an upload whose name is taken
//! when asked to (`@microsoft.graph.conflictBehavior=fail`), which is everything the archive
//! asks of a provider.

use std::sync::Arc;

use reqwest::header::{CONTENT_RANGE, CONTENT_TYPE};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};

use super::super::provider::{check_path, ArchiveProvider};
use super::super::ArchiveError;
use super::http::{percent_encode, Reply};
use super::oauth::TokenSource;
use super::Authorized;

pub(crate) const SERVICE: &str = "OneDrive";
/// The app folder, the signed-in user's address, and a refresh token.
pub(crate) const SCOPES: &str = "Files.ReadWrite.AppFolder User.Read offline_access";
pub(crate) const AUTHORIZE_EXTRA: &[(&str, &str)] = &[];
/// Files larger than this go through an upload session.
pub(crate) const SIMPLE_UPLOAD_MAX: usize = 4 * 1024 * 1024;
/// An upload session's chunk: a multiple of 320 KiB, as Graph asks.
pub(crate) const CHUNK: usize = 10 * 320 * 1024;
const WRITE_CHECK: &str = "rim-write-check";
const CONFLICT_BEHAVIOR: &str = "@microsoft.graph.conflictBehavior";

/// Where Microsoft Graph is.
#[derive(Debug, Clone)]
pub(crate) struct OneDriveEndpoints {
    /// `https://graph.microsoft.com/v1.0`
    pub api: String,
}

/// What an upload does when the name is taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Conflict {
    Replace,
    Fail,
}

impl Conflict {
    fn as_str(self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::Fail => "fail",
        }
    }
}

pub(crate) struct OneDriveProvider {
    api: Authorized,
    endpoints: OneDriveEndpoints,
    account: String,
}

impl OneDriveProvider {
    pub(crate) fn new(
        tokens: Arc<TokenSource>,
        endpoints: OneDriveEndpoints,
        account: String,
    ) -> Self {
        Self {
            api: Authorized::new(tokens),
            endpoints,
            account,
        }
    }

    /// The signed-in user's email address (a personal account's sign-in name is one).
    pub(crate) fn account_email(
        tokens: Arc<TokenSource>,
        endpoints: &OneDriveEndpoints,
    ) -> Result<String, ArchiveError> {
        let api = Authorized::new(tokens);
        let url = format!("{}/me", endpoints.api);
        let reply = api.send(|c, token| {
            c.get(&url)
                .bearer_auth(token)
                .query(&[("$select", "mail,userPrincipalName,displayName")])
        })?;
        if !reply.ok() {
            return Err(api.http().failure("account lookup", &reply));
        }
        let me: Value = reply.json()?;
        Ok(["mail", "userPrincipalName", "displayName"]
            .iter()
            .find_map(|field| me[field].as_str().filter(|v| !v.is_empty()))
            .unwrap_or("Microsoft account")
            .to_string())
    }

    /// The Graph address of an archive path: `…/approot:/<path>:`.
    fn item(&self, path: &str) -> String {
        format!(
            "{}/me/drive/special/approot:/{}:",
            self.endpoints.api,
            percent_encode(path, true)
        )
    }

    /// Upload `bytes` to `path` whole: in one request, or through an upload session when they
    /// are larger than [`SIMPLE_UPLOAD_MAX`]. Returns the final answer.
    fn upload(&self, path: &str, bytes: &[u8], conflict: Conflict) -> Result<Reply, ArchiveError> {
        if bytes.len() > SIMPLE_UPLOAD_MAX {
            return self.upload_session(path, bytes, conflict);
        }
        let url = format!("{}/content", self.item(path));
        self.api.send(|c, token| {
            c.put(&url)
                .bearer_auth(token)
                .query(&[(CONFLICT_BEHAVIOR, conflict.as_str())])
                .header(CONTENT_TYPE, "application/octet-stream")
                .body(bytes.to_vec())
        })
    }

    /// A large upload: open a session, then send the bytes in [`CHUNK`]s. The session's URL
    /// carries its own authorization, so the chunks are sent without the access token.
    fn upload_session(
        &self,
        path: &str,
        bytes: &[u8],
        conflict: Conflict,
    ) -> Result<Reply, ArchiveError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Session {
            upload_url: String,
        }
        let url = format!("{}/createUploadSession", self.item(path));
        let body = json!({ "item": { CONFLICT_BEHAVIOR: conflict.as_str() } });
        let reply = self
            .api
            .send(|c, token| c.post(&url).bearer_auth(token).json(&body))?;
        if !reply.ok() {
            return Ok(reply);
        }
        let session: Session = reply.json()?;
        let total = bytes.len();
        let mut start = 0;
        loop {
            let end = (start + CHUNK).min(total);
            let range = format!("bytes {start}-{}/{total}", end - 1);
            let reply = self.api.http().send(|c| {
                c.put(&session.upload_url)
                    .header(CONTENT_RANGE, &range)
                    .body(bytes[start..end].to_vec())
            })?;
            if reply.status != StatusCode::ACCEPTED || end == total {
                return Ok(reply);
            }
            start = end;
        }
    }

    fn write_failure(&self, reply: &Reply) -> ArchiveError {
        let body = String::from_utf8_lossy(&reply.body);
        if reply.status == StatusCode::INSUFFICIENT_STORAGE || body.contains("quotaLimitReached") {
            ArchiveError::NotWritable("your OneDrive is full".into())
        } else {
            self.api.http().failure("upload", reply)
        }
    }
}

impl ArchiveProvider for OneDriveProvider {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, ArchiveError> {
        check_path(path)?;
        // Graph answers with a redirect to a pre-authorized download URL, which the client
        // follows without the access token.
        let url = format!("{}/content", self.item(path));
        let reply = self.api.send(|c, token| c.get(&url).bearer_auth(token))?;
        match reply.status {
            s if s.is_success() => Ok(Some(reply.body)),
            StatusCode::NOT_FOUND => Ok(None),
            _ => Err(self.api.http().failure("download", &reply)),
        }
    }

    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        check_path(path)?;
        let reply = self.upload(path, bytes, Conflict::Replace)?;
        if reply.ok() {
            Ok(())
        } else {
            Err(self.write_failure(&reply))
        }
    }

    fn create(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        check_path(path)?;
        let reply = self.upload(path, bytes, Conflict::Fail)?;
        if reply.ok() {
            return Ok(true);
        }
        if reply.status == StatusCode::CONFLICT {
            return Ok(false);
        }
        Err(self.write_failure(&reply))
    }

    fn list_dirs(&self, dir: &str) -> Result<Vec<String>, ArchiveError> {
        check_path(dir)?;
        #[derive(Deserialize)]
        struct Page {
            #[serde(default)]
            value: Vec<Value>,
            #[serde(rename = "@odata.nextLink")]
            next_link: Option<String>,
        }
        let first = format!("{}/children", self.item(dir));
        let mut url = first.clone();
        let mut dirs = Vec::new();
        loop {
            let reply = self.api.send(|c, token| {
                let request = c.get(&url).bearer_auth(token);
                // The next link carries the query of the first request.
                if url == first {
                    request.query(&[("$select", "name,folder"), ("$top", "1000")])
                } else {
                    request
                }
            })?;
            if reply.status == StatusCode::NOT_FOUND {
                return Ok(Vec::new());
            }
            if !reply.ok() {
                return Err(self.api.http().failure("folder listing", &reply));
            }
            let page: Page = reply.json()?;
            for item in &page.value {
                if item.get("folder").is_some() {
                    if let Some(name) = item["name"].as_str() {
                        dirs.push(name.to_string());
                    }
                }
            }
            match page.next_link {
                Some(next) => url = next,
                None => break,
            }
        }
        dirs.sort();
        dirs.dedup();
        Ok(dirs)
    }

    fn check_writable(&self) -> Result<(), ArchiveError> {
        let reply = self.upload(WRITE_CHECK, b"", Conflict::Replace)?;
        if !reply.ok() {
            return Err(self.write_failure(&reply));
        }
        let url = self.item(WRITE_CHECK);
        let reply = self
            .api
            .send(|c, token| c.delete(&url).bearer_auth(token))?;
        if reply.ok() || reply.status == StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(self.api.http().failure("delete", &reply))
        }
    }

    fn describe(&self) -> String {
        format!("{SERVICE} ({})", self.account)
    }
}
