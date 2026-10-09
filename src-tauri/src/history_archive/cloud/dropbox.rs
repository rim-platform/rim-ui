//! The archive in the Dropbox app folder (`Apps/<app name>/`): a Dropbox app created with
//! "App folder" access can see nothing else in the user's Dropbox.
//!
//! Dropbox has paths, atomic whole-file uploads, and an upload mode that fails when the name
//! is taken, which is everything the archive asks of a provider.

use std::sync::Arc;

use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};

use super::super::provider::{check_path, ArchiveProvider};
use super::super::ArchiveError;
use super::http::{Http, Reply};
use super::oauth::TokenSource;
use super::Authorized;

pub(crate) const SERVICE: &str = "Dropbox";
pub(crate) const SCOPES: &str =
    "files.metadata.read files.content.read files.content.write account_info.read";
/// `token_access_type=offline` asks for a refresh token.
pub(crate) const AUTHORIZE_EXTRA: &[(&str, &str)] = &[("token_access_type", "offline")];
const WRITE_CHECK: &str = "/rim-write-check";

/// Where the Dropbox API is.
#[derive(Debug, Clone)]
pub(crate) struct DropboxEndpoints {
    /// `https://api.dropboxapi.com/2`
    pub api: String,
    /// `https://content.dropboxapi.com/2`
    pub content: String,
}

pub(crate) struct DropboxProvider {
    api: Authorized,
    endpoints: DropboxEndpoints,
    account: String,
}

/// The `error_summary` of a 409, e.g. `path/not_found/..`.
fn error_summary(reply: &Reply) -> String {
    serde_json::from_slice::<Value>(&reply.body)
        .ok()
        .and_then(|v| v["error_summary"].as_str().map(str::to_string))
        .unwrap_or_default()
}

/// The Dropbox path of an archive path (`/` is the app folder).
fn dropbox_path(path: &str) -> String {
    format!("/{path}")
}

impl DropboxProvider {
    pub(crate) fn new(
        tokens: Arc<TokenSource>,
        endpoints: DropboxEndpoints,
        account: String,
    ) -> Self {
        Self {
            api: Authorized::new(tokens),
            endpoints,
            account,
        }
    }

    /// The signed-in user's email address.
    pub(crate) fn account_email(
        tokens: Arc<TokenSource>,
        endpoints: &DropboxEndpoints,
    ) -> Result<String, ArchiveError> {
        let api = Authorized::new(tokens);
        let url = format!("{}/users/get_current_account", endpoints.api);
        let reply = api.send(|c, token| c.post(&url).bearer_auth(token))?;
        if !reply.ok() {
            return Err(api.http().failure("account lookup", &reply));
        }
        let account: Value = reply.json()?;
        Ok(account["email"]
            .as_str()
            .or(account["name"]["display_name"].as_str())
            .unwrap_or("Dropbox account")
            .to_string())
    }

    /// Revoke the grant. Revoking an access token revokes the refresh token it came from.
    pub(crate) fn revoke(
        http: &Http,
        tokens: &TokenSource,
        endpoints: &DropboxEndpoints,
    ) -> Result<(), ArchiveError> {
        let token = tokens.access_token()?;
        let url = format!("{}/auth/token/revoke", endpoints.api);
        let reply = http.send(|c| c.post(&url).bearer_auth(token.as_str()))?;
        if reply.ok() {
            Ok(())
        } else {
            Err(http.failure("revoke", &reply))
        }
    }

    fn rpc(&self, endpoint: &str, arg: &Value) -> Result<Reply, ArchiveError> {
        let url = format!("{}/{endpoint}", self.endpoints.api);
        self.api
            .send(|c, token| c.post(&url).bearer_auth(token).json(arg))
    }

    fn upload(&self, path: &str, bytes: &[u8], mode: &str) -> Result<Reply, ArchiveError> {
        let url = format!("{}/files/upload", self.endpoints.content);
        let arg = json!({
            "path": path,
            "mode": mode,
            "autorename": false,
            "mute": true,
            // With "add", fail even when the file there has the same content.
            "strict_conflict": true,
        })
        .to_string();
        self.api.send(|c, token| {
            c.post(&url)
                .bearer_auth(token)
                .header("Dropbox-API-Arg", &arg)
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(bytes.to_vec())
        })
    }

    fn write_failure(&self, reply: &Reply) -> ArchiveError {
        if reply.status == StatusCode::CONFLICT
            && error_summary(reply).contains("insufficient_space")
        {
            ArchiveError::NotWritable("your Dropbox is full".into())
        } else {
            self.api.http().failure("upload", reply)
        }
    }
}

impl ArchiveProvider for DropboxProvider {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, ArchiveError> {
        check_path(path)?;
        let url = format!("{}/files/download", self.endpoints.content);
        let arg = json!({ "path": dropbox_path(path) }).to_string();
        let reply = self.api.send(|c, token| {
            c.post(&url)
                .bearer_auth(token)
                .header("Dropbox-API-Arg", &arg)
        })?;
        if reply.ok() {
            return Ok(Some(reply.body));
        }
        if reply.status == StatusCode::CONFLICT
            && error_summary(&reply).starts_with("path/not_found")
        {
            return Ok(None);
        }
        Err(self.api.http().failure("download", &reply))
    }

    /// An upload in "overwrite" mode replaces the file whole, so a file left by an interrupted
    /// export is simply written again.
    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        check_path(path)?;
        let reply = self.upload(&dropbox_path(path), bytes, "overwrite")?;
        if reply.ok() {
            Ok(())
        } else {
            Err(self.write_failure(&reply))
        }
    }

    fn create(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        check_path(path)?;
        let reply = self.upload(&dropbox_path(path), bytes, "add")?;
        if reply.ok() {
            return Ok(true);
        }
        if reply.status == StatusCode::CONFLICT && error_summary(&reply).contains("conflict") {
            return Ok(false);
        }
        Err(self.write_failure(&reply))
    }

    fn list_dirs(&self, dir: &str) -> Result<Vec<String>, ArchiveError> {
        check_path(dir)?;
        #[derive(Deserialize)]
        struct Listing {
            entries: Vec<Value>,
            cursor: String,
            has_more: bool,
        }
        let mut reply = self.rpc(
            "files/list_folder",
            &json!({ "path": dropbox_path(dir), "recursive": false }),
        )?;
        let mut dirs = Vec::new();
        loop {
            if !reply.ok() {
                if reply.status == StatusCode::CONFLICT
                    && error_summary(&reply).starts_with("path/not_found")
                {
                    return Ok(Vec::new());
                }
                return Err(self.api.http().failure("folder listing", &reply));
            }
            let listing: Listing = reply.json()?;
            for entry in &listing.entries {
                if entry[".tag"] == "folder" {
                    if let Some(name) = entry["name"].as_str() {
                        dirs.push(name.to_string());
                    }
                }
            }
            if !listing.has_more {
                break;
            }
            reply = self.rpc(
                "files/list_folder/continue",
                &json!({ "cursor": listing.cursor }),
            )?;
        }
        dirs.sort();
        Ok(dirs)
    }

    fn check_writable(&self) -> Result<(), ArchiveError> {
        let reply = self.upload(WRITE_CHECK, b"", "overwrite")?;
        if !reply.ok() {
            return Err(self.write_failure(&reply));
        }
        let reply = self.rpc("files/delete_v2", &json!({ "path": WRITE_CHECK }))?;
        if reply.ok() || reply.status == StatusCode::CONFLICT {
            Ok(())
        } else {
            Err(self.api.http().failure("delete", &reply))
        }
    }

    fn describe(&self) -> String {
        format!("{SERVICE} ({})", self.account)
    }
}
