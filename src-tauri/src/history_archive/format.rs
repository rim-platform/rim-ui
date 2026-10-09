//! The on-drive format, version 1 (`docs/specs/history-archive-v1.md`).
//!
//! ```text
//! <folder>/
//!   rim-archive.json                       manifest: format, version, archive id, wrapped key
//!   accounts/<account tag>/devices/<device id>/
//!     head.rimx                            the device's list of its segments (sealed JSON)
//!     seg-0000000001.rimx                  immutable segments (sealed JSON lines)
//! ```
//!
//! A device writes only inside its own `devices/<device id>/` folder, and never changes a
//! segment once its head lists it, so devices sharing a folder never write the same file.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

use super::crypto::{self, ArchiveKey, KdfCost, NONCE_LEN};
use super::ArchiveError;

/// The manifest's name at the archive's root.
pub(crate) const MANIFEST_PATH: &str = "rim-archive.json";
/// `format` in the manifest.
pub(crate) const FORMAT_NAME: &str = "rim-history-archive";
/// The archive format version this build writes. Readers accept this one and the previous.
pub(crate) const FORMAT_VERSION: u32 = 1;
/// The oldest version this build still reads.
pub(crate) const MIN_READ_VERSION: u32 = 1;

/// First bytes of every sealed file.
const MAGIC: &[u8; 4] = b"RIMX";
/// Version of the sealed-file envelope.
const ENVELOPE_VERSION: u8 = 1;
const HEADER_LEN: usize = MAGIC.len() + 2 + NONCE_LEN;

/// A segment holds at most this much plaintext; an export splits into as many as it needs.
pub(crate) const MAX_SEGMENT_BYTES: usize = 4 * 1024 * 1024;

// ─── Manifest ───────────────────────────────────────────────────────────────

/// `rim-archive.json`: written once, by the device that creates the archive, and never
/// rewritten in version 1. Plain JSON: it holds nothing readable without the passphrase.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Manifest {
    pub format: String,
    pub version: u32,
    pub archive_id: String,
    pub created_at: String,
    /// The archive key, wrapped once per way of unlocking it. Version 1 writes one
    /// `passphrase` wrap; Stage 3 adds an identity-key wrap of the same key.
    pub key_wraps: Vec<KeyWrap>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum KeyWrap {
    #[serde(rename_all = "camelCase")]
    Passphrase {
        kdf: KdfSpec,
        /// Base64 XChaCha20-Poly1305 nonce.
        nonce: String,
        /// Base64 ciphertext of the 32-byte archive key, tag included.
        wrapped: String,
    },
    /// A wrap a newer build added. Skipped.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KdfSpec {
    /// Always `argon2id` in version 1.
    pub algorithm: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    /// Base64, 16 random bytes.
    pub salt: String,
}

impl Manifest {
    /// A new archive with `key` wrapped under `passphrase`.
    pub(crate) fn new(
        archive_id: &str,
        key: &ArchiveKey,
        passphrase: &str,
        cost: KdfCost,
        created_at: String,
    ) -> Result<Self, ArchiveError> {
        let salt = crypto::random_bytes::<16>()?;
        let kek = crypto::passphrase_key(passphrase, &salt, cost)?;
        let (nonce, wrapped) = crypto::seal(&kek, &wrap_aad(archive_id), key.as_bytes())?;
        Ok(Self {
            format: FORMAT_NAME.into(),
            version: FORMAT_VERSION,
            archive_id: archive_id.into(),
            created_at,
            key_wraps: vec![KeyWrap::Passphrase {
                kdf: KdfSpec {
                    algorithm: "argon2id".into(),
                    memory_kib: cost.memory_kib,
                    iterations: cost.iterations,
                    parallelism: cost.parallelism,
                    salt: STANDARD.encode(salt),
                },
                nonce: STANDARD.encode(nonce),
                wrapped: STANDARD.encode(wrapped),
            }],
        })
    }

    /// Parse and check the format and version.
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, ArchiveError> {
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|e| ArchiveError::Format(format!("manifest: {e}")))?;
        if manifest.format != FORMAT_NAME {
            return Err(ArchiveError::Format("not a RIM history archive".into()));
        }
        if manifest.version > FORMAT_VERSION {
            return Err(ArchiveError::Format(format!(
                "archive version {} is newer than this app reads ({FORMAT_VERSION}); update RIM",
                manifest.version
            )));
        }
        if manifest.version < MIN_READ_VERSION {
            return Err(ArchiveError::Format(format!(
                "archive version {} is too old for this app",
                manifest.version
            )));
        }
        check_id(&manifest.archive_id)?;
        Ok(manifest)
    }

    /// The archive key, if `passphrase` opens one of the wraps.
    pub(crate) fn unwrap_key(&self, passphrase: &str) -> Result<ArchiveKey, ArchiveError> {
        let mut saw_wrap = false;
        for wrap in &self.key_wraps {
            let KeyWrap::Passphrase {
                kdf,
                nonce,
                wrapped,
            } = wrap
            else {
                continue;
            };
            if kdf.algorithm != "argon2id" {
                continue;
            }
            saw_wrap = true;
            let salt = b64(&kdf.salt)?;
            let cost = KdfCost {
                memory_kib: kdf.memory_kib,
                iterations: kdf.iterations,
                parallelism: kdf.parallelism,
            };
            let kek = crypto::passphrase_key(passphrase, &salt, cost)?;
            match crypto::open(
                &kek,
                &b64(nonce)?,
                &wrap_aad(&self.archive_id),
                &b64(wrapped)?,
            ) {
                Ok(bytes) => {
                    return ArchiveKey::from_slice(&bytes).ok_or_else(|| {
                        ArchiveError::Format("wrapped key has the wrong length".into())
                    });
                }
                Err(ArchiveError::Unauthentic) => continue,
                Err(e) => return Err(e),
            }
        }
        if saw_wrap {
            Err(ArchiveError::WrongPassphrase)
        } else {
            Err(ArchiveError::Format(
                "the archive has no passphrase this app can use".into(),
            ))
        }
    }
}

fn wrap_aad(archive_id: &str) -> Vec<u8> {
    format!("rim-history-archive v1 key wrap\0{archive_id}").into_bytes()
}

fn b64(value: &str) -> Result<Vec<u8>, ArchiveError> {
    STANDARD
        .decode(value)
        .map_err(|_| ArchiveError::Format("invalid base64 in the manifest".into()))
}

// ─── Sealed files ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileKind {
    Segment = 1,
    Head = 2,
}

/// Where a sealed file belongs. It is part of the authenticated data, so a file copied or
/// renamed to another place (another device's folder, another sequence number) fails to open.
pub(crate) struct FilePlace<'a> {
    pub archive_id: &'a str,
    pub account_tag: &'a str,
    pub device_id: &'a str,
    pub name: &'a str,
}

fn header(kind: FileKind, nonce: &[u8]) -> Vec<u8> {
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.push(ENVELOPE_VERSION);
    header.push(kind as u8);
    header.extend_from_slice(nonce);
    header
}

fn file_aad(header: &[u8], place: &FilePlace<'_>) -> Vec<u8> {
    let mut aad = header.to_vec();
    for part in [
        place.archive_id,
        place.account_tag,
        place.device_id,
        place.name,
    ] {
        aad.push(0);
        aad.extend_from_slice(part.as_bytes());
    }
    aad
}

/// `RIMX | envelope version | kind | nonce | ciphertext`, the first 30 bytes authenticated.
pub(crate) fn seal_file(
    key: &ArchiveKey,
    kind: FileKind,
    place: &FilePlace<'_>,
    plaintext: &[u8],
) -> Result<Vec<u8>, ArchiveError> {
    let nonce = crypto::random_bytes::<NONCE_LEN>()?;
    let header = header(kind, &nonce);
    let aad = file_aad(&header, place);
    let ciphertext = crypto::seal_with_nonce(&key.file_key(), &nonce, &aad, plaintext)?;
    let mut out = header;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub(crate) fn open_file(
    key: &ArchiveKey,
    kind: FileKind,
    place: &FilePlace<'_>,
    bytes: &[u8],
) -> Result<zeroize::Zeroizing<Vec<u8>>, ArchiveError> {
    if bytes.len() < HEADER_LEN || &bytes[..MAGIC.len()] != MAGIC {
        return Err(ArchiveError::Format("not a sealed archive file".into()));
    }
    if bytes[4] != ENVELOPE_VERSION {
        return Err(ArchiveError::Format(format!(
            "sealed file version {} is not supported",
            bytes[4]
        )));
    }
    if bytes[5] != kind as u8 {
        return Err(ArchiveError::Format("sealed file of the wrong kind".into()));
    }
    let (header, ciphertext) = bytes.split_at(HEADER_LEN);
    let aad = file_aad(header, place);
    crypto::open(&key.file_key(), &header[6..], &aad, ciphertext)
}

// ─── Paths ──────────────────────────────────────────────────────────────────

pub(crate) fn devices_dir(account_tag: &str) -> String {
    format!("accounts/{account_tag}/devices")
}

pub(crate) const HEAD_NAME: &str = "head.rimx";

pub(crate) fn segment_name(seq: u64) -> String {
    format!("seg-{seq:010}.rimx")
}

pub(crate) fn file_path(account_tag: &str, device_id: &str, name: &str) -> String {
    format!("{}/{device_id}/{name}", devices_dir(account_tag))
}

/// Archive and device ids: lowercase hex and dashes, 8 to 64 characters. Anything else found
/// in a shared folder (a sync client's "conflicted copy" folder, say) is not a device.
pub(crate) fn check_id(id: &str) -> Result<(), ArchiveError> {
    let ok = (8..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(ArchiveError::Format(format!("not an archive id: {id:?}")))
    }
}

// ─── Device head ────────────────────────────────────────────────────────────

/// `head.rimx`: the segments a device has written, in order. Only that device rewrites it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceHead {
    pub v: u32,
    pub archive_id: String,
    pub device_id: String,
    pub updated_at_ms: i64,
    pub segments: Vec<SegmentEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SegmentEntry {
    pub seq: u64,
    /// SHA-256 of the sealed file, hex.
    pub sha256: String,
    pub events: u32,
    pub created_at_ms: i64,
}

impl DeviceHead {
    pub(crate) fn next_seq(&self) -> u64 {
        self.segments.last().map_or(1, |s| s.seq + 1)
    }
}

// ─── Events ─────────────────────────────────────────────────────────────────

/// A message as the cache holds it, at one version. Edits and deletes are later versions of
/// the same message; a delete is a tombstone with no text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivedMessage {
    pub workspace_id: String,
    pub conversation_id: String,
    pub id: String,
    pub thread_id: Option<String>,
    pub author_id: String,
    /// The server's change-feed version; the higher one wins.
    pub version: i64,
    pub sent_at_us: i64,
    pub edited_at: Option<String>,
    pub deleted: bool,
    pub text: Option<String>,
    /// The rest of the message as the UI renders it (the timeline's message JSON, no text).
    pub payload: serde_json::Value,
    /// The author's signature. Always null before Stage 3 (identity keys): such messages are
    /// unsigned, which readers accept and do not treat as a failed verification.
    #[serde(default)]
    pub sig: Option<String>,
}

/// Where the device's sync of a conversation stood when the segment was written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchivedConversation {
    pub workspace_id: String,
    pub conversation_id: String,
    /// The change-feed cursor every message up to which is in this device's segments.
    pub cursor: Option<String>,
    /// The device held the conversation's whole history at `cursor`.
    pub complete: bool,
    pub last_viewed_at: i64,
    /// When the device last saw the server answer `RESET` (Unix ms), if ever.
    pub reset_at: Option<i64>,
    /// The highest message version the device held.
    pub max_version: i64,
}

/// The first line of every segment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SegmentHeader {
    pub v: u32,
    pub archive_id: String,
    pub device_id: String,
    pub seq: u64,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Event {
    Message(ArchivedMessage),
    Conversation(ArchivedConversation),
}

#[derive(Serialize)]
struct Tagged<'a, T> {
    t: &'a str,
    #[serde(flatten)]
    body: &'a T,
}

pub(crate) fn event_line(event: &Event) -> Result<String, ArchiveError> {
    let line = match event {
        Event::Message(m) => serde_json::to_string(&Tagged { t: "msg", body: m }),
        Event::Conversation(c) => serde_json::to_string(&Tagged { t: "conv", body: c }),
    };
    line.map_err(|e| ArchiveError::Format(e.to_string()))
}

pub(crate) fn header_line(header: &SegmentHeader) -> Result<String, ArchiveError> {
    serde_json::to_string(&Tagged {
        t: "segment",
        body: header,
    })
    .map_err(|e| ArchiveError::Format(e.to_string()))
}

/// A decrypted segment: its header and the events this build understands. Lines of a type it
/// does not know are skipped, which is what lets version 1 add event types.
pub(crate) fn parse_segment(plaintext: &[u8]) -> Result<(SegmentHeader, Vec<Event>), ArchiveError> {
    let text = std::str::from_utf8(plaintext)
        .map_err(|_| ArchiveError::Format("segment is not UTF-8".into()))?;
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let first: serde_json::Value = serde_json::from_str(lines.next().unwrap_or("{}"))
        .map_err(|e| ArchiveError::Format(format!("segment header: {e}")))?;
    if first.get("t").and_then(|t| t.as_str()) != Some("segment") {
        return Err(ArchiveError::Format("segment has no header line".into()));
    }
    let header: SegmentHeader = serde_json::from_value(first)
        .map_err(|e| ArchiveError::Format(format!("segment header: {e}")))?;

    let mut events = Vec::new();
    for line in lines {
        let value: serde_json::Value = serde_json::from_str(line)
            .map_err(|e| ArchiveError::Format(format!("segment line: {e}")))?;
        let event = match value.get("t").and_then(|t| t.as_str()) {
            Some("msg") => Event::Message(
                serde_json::from_value(value)
                    .map_err(|e| ArchiveError::Format(format!("message event: {e}")))?,
            ),
            Some("conv") => Event::Conversation(
                serde_json::from_value(value)
                    .map_err(|e| ArchiveError::Format(format!("conversation event: {e}")))?,
            ),
            _ => continue,
        };
        events.push(event);
    }
    Ok((header, events))
}
