//! The archive in Google Drive's `appDataFolder`: a hidden folder only this app's OAuth client
//! can see (scope `drive.appdata`), so RIM never sees the user's other files.
//!
//! Drive has no paths, only file ids, and allows several files with one name. Every archive
//! file is stored flat in `appDataFolder` under its whole archive path as its name
//! (`accounts/<tag>/devices/<id>/head.rimx`); "directories" are the prefixes of those names.
//! When several files carry one name (two devices creating the manifest at once, or a retried
//! upload whose first answer was lost), the oldest one (`createdTime`, then id) is the file.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::json;

use super::super::crypto::random_bytes;
use super::super::provider::{check_path, ArchiveProvider};
use super::super::ArchiveError;
use super::http::{Http, Reply};
use super::oauth::TokenSource;
use super::Authorized;

pub(crate) const SERVICE: &str = "Google Drive";
pub(crate) const SCOPES: &str = "https://www.googleapis.com/auth/drive.appdata";
/// `access_type=offline` asks for a refresh token; `prompt=consent` makes Google send one again
/// when the user connects a second time.
pub(crate) const AUTHORIZE_EXTRA: &[(&str, &str)] =
    &[("access_type", "offline"), ("prompt", "consent")];
const WRITE_CHECK: &str = "rim-write-check";

/// Where the Drive API is.
#[derive(Debug, Clone)]
pub(crate) struct DriveEndpoints {
    /// `https://www.googleapis.com/drive/v3`
    pub api: String,
    /// `https://www.googleapis.com/upload/drive/v3`
    pub upload: String,
    /// `https://oauth2.googleapis.com/revoke`
    pub revoke: String,
}

/// Drive answers 403 to some rate limits.
pub(crate) fn is_rate_limited(status: StatusCode, body: &[u8]) -> bool {
    status == StatusCode::FORBIDDEN && {
        let body = String::from_utf8_lossy(body);
        body.contains("rateLimitExceeded") || body.contains("userRateLimitExceeded")
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    name: String,
    created_time: String,
}

impl DriveFile {
    /// Older first; the id breaks ties so every device picks the same file.
    fn order_key(&self) -> (chrono::DateTime<chrono::Utc>, &str) {
        let created = chrono::DateTime::parse_from_rfc3339(&self.created_time)
            .map(|t| t.with_timezone(&chrono::Utc))
            .unwrap_or(chrono::DateTime::<chrono::Utc>::MAX_UTC);
        (created, &self.id)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
    next_page_token: Option<String>,
}

const FILE_FIELDS: &str = "id,name,createdTime";

pub(crate) struct GoogleDriveProvider {
    api: Authorized,
    endpoints: DriveEndpoints,
    account: String,
    /// Archive path to file, from listings and from this provider's own uploads. Only
    /// positive answers are kept: another device may create a file at any time.
    ids: Mutex<HashMap<String, DriveFile>>,
}

impl GoogleDriveProvider {
    pub(crate) fn new(
        tokens: Arc<TokenSource>,
        endpoints: DriveEndpoints,
        account: String,
    ) -> Self {
        Self {
            api: Authorized::new(tokens),
            endpoints,
            account,
            ids: Mutex::new(HashMap::new()),
        }
    }

    /// The signed-in user's email address.
    pub(crate) fn account_email(
        tokens: Arc<TokenSource>,
        endpoints: &DriveEndpoints,
    ) -> Result<String, ArchiveError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct About {
            user: User,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct User {
            email_address: Option<String>,
            display_name: Option<String>,
        }
        let api = Authorized::new(tokens);
        let url = format!("{}/about", endpoints.api);
        let reply = api.send(|c, token| {
            c.get(&url)
                .bearer_auth(token)
                .query(&[("fields", "user(emailAddress,displayName)")])
        })?;
        if !reply.ok() {
            return Err(api.http().failure("account lookup", &reply));
        }
        let about: About = reply.json()?;
        Ok(about
            .user
            .email_address
            .or(about.user.display_name)
            .unwrap_or_else(|| "Google account".into()))
    }

    /// Revoke the grant: its refresh token and every access token from it.
    pub(crate) fn revoke(
        http: &Http,
        tokens: &TokenSource,
        endpoints: &DriveEndpoints,
    ) -> Result<(), ArchiveError> {
        let refresh = tokens.refresh_token();
        let reply = http.send(|c| {
            c.post(&endpoints.revoke)
                .form(&[("token", refresh.as_str())])
        })?;
        if reply.ok() {
            Ok(())
        } else {
            Err(http.failure("revoke", &reply))
        }
    }

    fn cache(&self) -> std::sync::MutexGuard<'_, HashMap<String, DriveFile>> {
        self.ids.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Every file in `appDataFolder` matching `query` (a Drive search expression), all pages.
    fn list(&self, query: &str) -> Result<Vec<DriveFile>, ArchiveError> {
        let url = format!("{}/files", self.endpoints.api);
        let q = format!("'appDataFolder' in parents and trashed = false{query}");
        let fields = format!("nextPageToken,files({FILE_FIELDS})");
        let mut files = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let reply = self.api.send(|c, token| {
                let mut request = c.get(&url).bearer_auth(token).query(&[
                    ("spaces", "appDataFolder"),
                    ("q", q.as_str()),
                    ("fields", fields.as_str()),
                    ("pageSize", "1000"),
                ]);
                if let Some(page) = &page {
                    request = request.query(&[("pageToken", page.as_str())]);
                }
                request
            })?;
            if !reply.ok() {
                return Err(self.api.http().failure("file listing", &reply));
            }
            let list: FileList = reply.json()?;
            files.extend(list.files);
            match list.next_page_token {
                Some(next) if !next.is_empty() => page = Some(next),
                _ => return Ok(files),
            }
        }
    }

    /// The files named `path`, oldest first, asking Drive (not the cache).
    fn find_all(&self, path: &str) -> Result<Vec<DriveFile>, ArchiveError> {
        let escaped = path.replace('\\', "\\\\").replace('\'', "\\'");
        let mut files = self.list(&format!(" and name = '{escaped}'"))?;
        // Drive matches names case-insensitively; archive names are lowercase, but be exact.
        files.retain(|f| f.name == path);
        files.sort_by(|a, b| a.order_key().cmp(&b.order_key()));
        Ok(files)
    }

    /// The file at `path`: from the cache, else asking Drive.
    fn find(&self, path: &str) -> Result<Option<DriveFile>, ArchiveError> {
        if let Some(file) = self.cache().get(path) {
            return Ok(Some(file.clone()));
        }
        let found = self.find_all(path)?.into_iter().next();
        if let Some(file) = &found {
            self.cache().insert(path.to_string(), file.clone());
        }
        Ok(found)
    }

    /// Upload a new file named `path`.
    fn upload_new(&self, path: &str, bytes: &[u8]) -> Result<DriveFile, ArchiveError> {
        let boundary = format!("rim-{}", hex::encode(random_bytes::<16>()?));
        let metadata = json!({ "name": path, "parents": ["appDataFolder"] }).to_string();
        let mut body = Vec::with_capacity(bytes.len() + metadata.len() + 256);
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
                 --{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let url = format!("{}/files", self.endpoints.upload);
        let reply = self.api.send(|c, token| {
            c.post(&url)
                .bearer_auth(token)
                .query(&[("uploadType", "multipart"), ("fields", FILE_FIELDS)])
                .header(
                    reqwest::header::CONTENT_TYPE,
                    format!("multipart/related; boundary={boundary}"),
                )
                .body(body.clone())
        })?;
        if !reply.ok() {
            return Err(self.write_failure(&reply));
        }
        reply.json()
    }

    /// Replace the content of an existing file. `Ok(false)` when the file is gone.
    fn upload_over(&self, id: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        let url = format!("{}/files/{id}", self.endpoints.upload);
        let reply = self.api.send(|c, token| {
            c.patch(&url)
                .bearer_auth(token)
                .query(&[("uploadType", "media"), ("fields", "id")])
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(bytes.to_vec())
        })?;
        match reply.status {
            s if s.is_success() => Ok(true),
            StatusCode::NOT_FOUND => Ok(false),
            _ => Err(self.write_failure(&reply)),
        }
    }

    fn delete(&self, id: &str) -> Result<(), ArchiveError> {
        let url = format!("{}/files/{id}", self.endpoints.api);
        let reply = self
            .api
            .send(|c, token| c.delete(&url).bearer_auth(token))?;
        if reply.ok() || reply.status == StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(self.api.http().failure("delete", &reply))
        }
    }

    fn write_failure(&self, reply: &Reply) -> ArchiveError {
        if reply.status == StatusCode::FORBIDDEN
            && String::from_utf8_lossy(&reply.body).contains("storageQuotaExceeded")
        {
            ArchiveError::NotWritable("your Google Drive storage is full".into())
        } else {
            self.api.http().failure("upload", reply)
        }
    }
}

impl ArchiveProvider for GoogleDriveProvider {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, ArchiveError> {
        check_path(path)?;
        let Some(file) = self.find(path)? else {
            return Ok(None);
        };
        let url = format!("{}/files/{}", self.endpoints.api, file.id);
        let reply = self
            .api
            .send(|c, token| c.get(&url).bearer_auth(token).query(&[("alt", "media")]))?;
        match reply.status {
            s if s.is_success() => Ok(Some(reply.body)),
            StatusCode::NOT_FOUND => {
                self.cache().remove(path);
                Ok(None)
            }
            _ => Err(self.api.http().failure("download", &reply)),
        }
    }

    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        check_path(path)?;
        // A file left by an interrupted export (written, not yet listed in the head) is
        // overwritten in place rather than joined by a second file of the same name.
        if let Some(file) = self.find(path)? {
            if self.upload_over(&file.id, bytes)? {
                return Ok(());
            }
            self.cache().remove(path);
        }
        let file = self.upload_new(path, bytes)?;
        self.cache().insert(path.to_string(), file);
        Ok(())
    }

    /// Drive cannot create a file only if its name is free. Upload, then look: when another
    /// file of that name is older, it is the one, and this upload is withdrawn. Two devices
    /// racing both see both files and agree on the older.
    fn create(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        check_path(path)?;
        if !self.find_all(path)?.is_empty() {
            return Ok(false);
        }
        let mine = self.upload_new(path, bytes)?;
        let first = self.find_all(path)?.into_iter().next();
        match first {
            Some(first) if first.id != mine.id => {
                self.delete(&mine.id)?;
                self.cache().insert(path.to_string(), first);
                Ok(false)
            }
            _ => {
                self.cache().insert(path.to_string(), mine);
                Ok(true)
            }
        }
    }

    fn list_dirs(&self, dir: &str) -> Result<Vec<String>, ArchiveError> {
        check_path(dir)?;
        let prefix = format!("{dir}/");
        let files = self.list("")?;
        let mut dirs = Vec::new();
        let mut cache = self.cache();
        for file in files {
            if let Some((sub, _)) = file
                .name
                .strip_prefix(&prefix)
                .and_then(|rest| rest.split_once('/'))
            {
                if !sub.is_empty() {
                    dirs.push(sub.to_string());
                }
            }
            // Prime the cache with the oldest file of each name for the reads that follow.
            let older = cache
                .get(&file.name)
                .is_some_and(|known| known.order_key() <= file.order_key());
            if !older {
                cache.insert(file.name.clone(), file);
            }
        }
        dirs.sort();
        dirs.dedup();
        Ok(dirs)
    }

    fn check_writable(&self) -> Result<(), ArchiveError> {
        let probe = self.upload_new(WRITE_CHECK, b"")?;
        self.delete(&probe.id)
    }

    fn describe(&self) -> String {
        format!("{SERVICE} ({})", self.account)
    }
}
