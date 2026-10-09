//! Encrypted attachments over raw IPC: the webview hands file bytes in and gets bytes back,
//! without base64 or JSON around up to 25 MiB.
//!
//! - Encrypting keeps the file's entry (with its secret) here, by blob hash, until the message
//!   that carries it is encrypted: the secret never reaches the webview.
//! - Decrypting reads the entry from the cached message's content, checks the blob's hash,
//!   decrypts and checks the size.
//! - A moderator decrypts a reported message's attachment with the entry from the report's
//!   verified content, which the webview hands in with the blob.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rim_mls::{decrypt_attachment, encrypt_attachment, AttachmentEntry, MessageContent};
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportedArgs {
    blob_sha256: String,
}

/// Decrypt the blob of a reported message's attachment. The body is the verified content's
/// length (big-endian u32), the content, then the blob. Answers the file's bytes.
#[tauri::command]
pub async fn e2ee_reported_attachment_decrypt(
    request: Request<'_>,
) -> std::result::Result<Response, E2eeError> {
    let args: ReportedArgs = args(&request)?;
    let body = bytes(&request)?.to_vec();
    let plaintext = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>> {
        let (entry, blob) = reported_attachment(&body, &args.blob_sha256)?;
        Ok(decrypt_attachment(&entry, blob)?.to_vec())
    })
    .await
    .map_err(|e| E2eeError::Invalid(format!("attachment task failed: {e}")))??;
    Ok(Response::new(plaintext))
}

/// Split a reported attachment's request body into the content's entry for `blob_sha256` and
/// the blob.
pub(crate) fn reported_attachment<'b>(
    body: &'b [u8],
    blob_sha256: &str,
) -> Result<(AttachmentEntry, &'b [u8])> {
    let malformed = || E2eeError::Invalid("malformed reported attachment request".into());
    let (len, rest) = body.split_first_chunk::<4>().ok_or_else(malformed)?;
    let len = u32::from_be_bytes(*len) as usize;
    if rest.len() < len {
        return Err(malformed());
    }
    let (content, blob) = rest.split_at(len);
    let entry = MessageContent::parse(content)?
        .attachments
        .into_iter()
        .find(|a| b64(&a.blob_sha256) == blob_sha256)
        .ok_or_else(|| E2eeError::Invalid("the message has no such attachment".into()))?;
    Ok((entry, blob))
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

#[cfg(test)]
mod tests {
    use super::*;

    const CONTENT: &str = r#"{"v":1,"type":"message","id":"0199d1a0-0000-7000-8000-000000000002","rev":0,"threadRootId":null,"body":"hi <@rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo>","mentions":["rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo"],"mentionAll":false,"replyTo":null,"forwardedFrom":null,"attachments":[{"blobSha256":"EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac","secret":"oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8","name":"hello.txt","mime":"text/plain","size":18}],"linkPreviews":[]}"#;
    const BLOB: &str = "096d52fa9b833e37ef33d387fc5ecab34eabb410807b85e90c862a44614c7c9cb163";
    const HASH: &str = "EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac";

    fn body(content: &[u8], blob: &[u8]) -> Vec<u8> {
        let mut out = (content.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(content);
        out.extend_from_slice(blob);
        out
    }

    fn blob() -> Vec<u8> {
        (0..BLOB.len() / 2)
            .map(|i| u8::from_str_radix(&BLOB[i * 2..i * 2 + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn a_reported_attachment_decrypts_with_the_content_entry() {
        let request = body(CONTENT.as_bytes(), &blob());
        let (entry, blob) = reported_attachment(&request, HASH).unwrap();
        assert_eq!(entry.name, "hello.txt");
        assert_eq!(entry.size, 18);
        assert_eq!(
            decrypt_attachment(&entry, blob).unwrap().as_slice(),
            b"hello, attachment\n"
        );
    }

    #[test]
    fn a_reported_attachment_is_refused_when_anything_differs() {
        let mut tampered = blob();
        tampered[0] ^= 1;
        let request = body(CONTENT.as_bytes(), &tampered);
        let (entry, blob) = reported_attachment(&request, HASH).unwrap();
        assert!(decrypt_attachment(&entry, blob).is_err());

        let request = body(CONTENT.as_bytes(), &self::blob());
        assert!(reported_attachment(&request, "AAAA").is_err());
        assert!(reported_attachment(&request[..10], HASH).is_err());
        assert!(reported_attachment(&[0, 0], HASH).is_err());
        let other = CONTENT.replace("hello.txt", "hello.txt\"");
        assert!(reported_attachment(&body(other.as_bytes(), &self::blob()), HASH).is_err());
    }
}
