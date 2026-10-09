//! Encrypted attachments over raw IPC: the webview hands file bytes in and gets bytes back,
//! without base64 or JSON around up to 25 MiB.
//!
//! - Encrypting keeps the file's entry (with its secret) here, by blob hash, until the message
//!   that carries it is encrypted: the secret never reaches the webview.
//! - Decrypting reads the entry from the cached message's content, checks the blob's hash,
//!   decrypts and checks the size.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rim_mls::{decrypt_attachment, encrypt_attachment, AttachmentEntry};
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

use super::outgoing::cached_content;
use super::{b64, unb64, E2eeError, Result};
use crate::message_cache::{AccountId, MessageCacheState};

/// The header carrying a request's arguments: base64url of their JSON.
const ARGS_HEADER: &str = "x-rim-args";

/// How long an encrypted file's entry waits for its message.
const PENDING_TTL: Duration = Duration::from_secs(60 * 60);

/// Entries of files encrypted on this device and not yet sent, by blob hash.
#[derive(Default)]
pub(crate) struct PendingAttachments(Mutex<HashMap<String, (AttachmentEntry, Instant)>>);

impl PendingAttachments {
    pub(crate) fn put(&self, entry: AttachmentEntry) -> String {
        let hash = b64(&entry.blob_sha256);
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.retain(|_, (_, at)| at.elapsed() < PENDING_TTL);
        pending.insert(hash.clone(), (entry, Instant::now()));
        hash
    }

    pub(crate) fn get(&self, hash: &str) -> Option<AttachmentEntry> {
        let pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.get(hash).map(|(entry, _)| entry.clone())
    }

    pub(crate) fn forget(&self, hashes: &[String]) {
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        for hash in hashes {
            pending.remove(hash);
        }
    }
}

fn args<T: for<'de> Deserialize<'de>>(request: &Request<'_>) -> Result<T> {
    let header = request
        .headers()
        .get(ARGS_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| E2eeError::Invalid(format!("missing {ARGS_HEADER}")))?;
    Ok(serde_json::from_slice(&unb64(header)?)?)
}

fn bytes<'r>(request: &'r Request<'_>) -> Result<&'r [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(E2eeError::Invalid("expected raw bytes".into())),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptArgs {
    name: String,
    mime: String,
}

/// Encrypt a file. Answers its blob's SHA-256 (32 bytes) followed by the blob to upload.
#[tauri::command]
pub async fn e2ee_attachment_encrypt(
    request: Request<'_>,
    pending: State<'_, PendingAttachments>,
) -> std::result::Result<Response, E2eeError> {
    let args: EncryptArgs = args(&request)?;
    let plaintext = bytes(&request)?.to_vec();
    let encrypted = tauri::async_runtime::spawn_blocking(move || {
        encrypt_attachment(&plaintext, args.name, args.mime)
    })
    .await
    .map_err(|e| E2eeError::Invalid(format!("attachment task failed: {e}")))??;
    pending.put(encrypted.entry.clone());
    let mut out = Vec::with_capacity(32 + encrypted.blob.len());
    out.extend_from_slice(&encrypted.entry.blob_sha256);
    out.extend_from_slice(&encrypted.blob);
    Ok(Response::new(out))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecryptArgs {
    account: AccountId,
    message_id: String,
    blob_sha256: String,
}

/// Decrypt a downloaded blob of a cached message's attachment. Answers the file's bytes.
#[tauri::command]
pub async fn e2ee_attachment_decrypt(
    request: Request<'_>,
    cache: State<'_, MessageCacheState>,
) -> std::result::Result<Response, E2eeError> {
    let args: DecryptArgs = args(&request)?;
    let blob = bytes(&request)?.to_vec();
    let store = cache.store(&args.account)?;
    let plaintext = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>> {
        let entry = {
            let mut store = store.lock().unwrap_or_else(|e| e.into_inner());
            let tx = store.conn.transaction()?;
            attachment_entry(&tx, &args.message_id, &args.blob_sha256)?
        };
        Ok(decrypt_attachment(&entry, &blob)?.to_vec())
    })
    .await
    .map_err(|e| E2eeError::Invalid(format!("attachment task failed: {e}")))??;
    Ok(Response::new(plaintext))
}

/// The entry of a cached message's attachment, by blob hash.
pub(crate) fn attachment_entry(
    tx: &rusqlite::Transaction<'_>,
    message_id: &str,
    blob_sha256: &str,
) -> Result<AttachmentEntry> {
    let (_, _, content) = cached_content(tx, message_id)?
        .ok_or_else(|| E2eeError::Invalid("the message is not readable on this device".into()))?;
    content
        .attachments
        .into_iter()
        .find(|a| b64(&a.blob_sha256) == blob_sha256)
        .ok_or_else(|| E2eeError::Invalid("the message has no such attachment".into()))
}
