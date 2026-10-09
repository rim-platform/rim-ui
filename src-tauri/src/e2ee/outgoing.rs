//! Sending: a message (or an edit) is encrypted in the group's current epoch and its plaintext
//! stored under the message id this device chose, in one transaction, before the envelope is
//! sent. The content and franking key stay in `e2ee_outgoing` until the server acknowledges it,
//! so a `STALE_EPOCH` answer sends the same content again in the newer epoch.

use rim_mls::{
    AttachmentEntry, EncryptedMessage, ForwardedFrom, LinkPreview, MessageContent, Mls,
    MlsKeyStatement, SqliteStore,
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::feed::content_payload;
use super::group::{conversation_group, load_state};
use super::{b64, now_ms, parse_uuid, E2eeError, Result};
use crate::message_cache::sync::{write_message, MessageRow};

/// The forwarder's claim about a forwarded message's origin.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForwardedFromInput {
    pub message_id: String,
    pub conversation_id: String,
    pub author_principal_id: String,
    pub sent_at: String,
}

/// A link preview the sender's client fetched.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkPreviewInput {
    pub url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
}

/// A message or an edit to encrypt, as the composer has it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DraftInput {
    /// The message an edit replaces; omitted for a new message.
    #[serde(default)]
    pub edit_of: Option<String>,
    /// Mentions as `<@principalId>` tokens.
    pub body: String,
    /// For a thread reply: the root message and the server's thread id.
    #[serde(default)]
    pub thread_root_id: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub forwarded_from: Option<ForwardedFromInput>,
    /// Blob hashes of attachments encrypted on this device for this message, or of the
    /// forwarded message's attachments.
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub link_previews: Vec<LinkPreviewInput>,
    /// The row's author fields, as the timeline renders them.
    pub author_id: String,
    #[serde(default)]
    pub author: Value,
}

/// An envelope to send with `sendEncryptedMessage` or `editEncryptedMessage`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutgoingView {
    pub message_id: String,
    pub incarnation: u32,
    pub epoch: u64,
    pub envelope: String,
    /// `sendEncryptedMessage`'s `threadRootMessageId`.
    pub thread_root_message_id: Option<String>,
    /// `sendEncryptedMessage`'s `forwardedFromMessageId`.
    pub forwarded_from_message_id: Option<String>,
}

/// This device as its `mls-key` statement names it.
fn this_device(tx: &Transaction<'_>, mls: &Mls) -> Result<MlsKeyStatement> {
    let statement = mls
        .mls_key_statement(&SqliteStore::new(tx))?
        .ok_or(rim_mls::Error::NoIdentity)?;
    Ok(MlsKeyStatement::parse(&statement.payload)?)
}

/// The content of a cached encrypted message this device can read.
pub(crate) fn cached_content(
    tx: &Transaction<'_>,
    message_id: &str,
) -> Result<Option<(Option<String>, Value, MessageContent)>> {
    let row: Option<(Option<String>, String)> = tx
        .query_row(
            "SELECT text, payload FROM message
             WHERE id = ?1 AND e2ee_state IN ('decrypted', 'outgoing')",
            params![message_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((text, payload)) = row else {
        return Ok(None);
    };
    let payload: Value = serde_json::from_str(&payload)?;
    let content = payload
        .pointer("/e2ee/content")
        .and_then(Value::as_str)
        .map(|c| MessageContent::parse(c.as_bytes()))
        .transpose()?;
    Ok(content.map(|content| (text, payload, content)))
}

fn link_previews(inputs: &[LinkPreviewInput]) -> Vec<LinkPreview> {
    inputs
        .iter()
        .map(|p| LinkPreview {
            url: p.url.clone(),
            title: p.title.clone(),
            description: p.description.clone(),
            site_name: p.site_name.clone(),
        })
        .collect()
}

/// Encrypt a draft and store its plaintext; the caller commits, then sends.
/// `attachment` resolves a blob hash to the entry encrypted for it.
pub(crate) fn encrypt(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
    draft: &DraftInput,
    attachment: &mut dyn FnMut(&str) -> Option<AttachmentEntry>,
) -> Result<OutgoingView> {
    let state = load_state(tx, workspace_id, conversation_id)?;
    if state.incarnation == 0 || state.removed {
        return Err(rim_mls::Error::NoGroup.into());
    }
    if !state.unverified.is_empty() {
        return Err(E2eeError::Blocked(
            "a device RIM cannot verify is in this conversation".into(),
        ));
    }
    let group = conversation_group(conversation_id, state.incarnation)?;
    let me = this_device(tx, mls)?;

    let (content, previous) = match &draft.edit_of {
        Some(id) => {
            let (text, payload, original) = cached_content(tx, id)?.ok_or_else(|| {
                E2eeError::Invalid("only a message this device can read can be edited".into())
            })?;
            let mut content = MessageContent::new(original.id, draft.body.clone());
            content.rev = original.rev + 1;
            content.thread_root_id = original.thread_root_id;
            content.reply_to = original.reply_to;
            content.forwarded_from = original.forwarded_from;
            content.attachments = original.attachments;
            content.link_previews = link_previews(&draft.link_previews);
            (content, Some(json!({ "text": text, "payload": payload })))
        }
        None => {
            let mut content = MessageContent::new(Uuid::now_v7(), draft.body.clone());
            content.thread_root_id = draft
                .thread_root_id
                .as_deref()
                .map(parse_uuid)
                .transpose()?;
            content.reply_to = draft.reply_to.as_deref().map(parse_uuid).transpose()?;
            content.forwarded_from = draft
                .forwarded_from
                .as_ref()
                .map(|f| -> Result<ForwardedFrom> {
                    Ok(ForwardedFrom {
                        message_id: parse_uuid(&f.message_id)?,
                        conversation_id: parse_uuid(&f.conversation_id)?,
                        author_principal_id: f.author_principal_id.clone(),
                        sent_at: f.sent_at.clone(),
                    })
                })
                .transpose()?;
            content.attachments = draft
                .attachments
                .iter()
                .map(|hash| {
                    attachment(hash).ok_or_else(|| {
                        E2eeError::Invalid("an attachment was not encrypted on this device".into())
                    })
                })
                .collect::<Result<_>>()?;
            content.link_previews = link_previews(&draft.link_previews);
            (content, None)
        }
    };

    let encrypted = mls.encrypt(&SqliteStore::new(tx), group, &content)?;
    let message_id = content.id.hyphenated().to_string();
    let e2ee = e2ee_facts(&encrypted, &me, &content);
    match &previous {
        Some(_) => {
            let (_, payload, _) = cached_content(tx, &message_id)?
                .ok_or_else(|| E2eeError::Invalid("the edited message is gone".into()))?;
            let payload = content_payload(payload, &json!({}), &content, e2ee);
            tx.execute(
                "UPDATE message SET text = ?2, payload = ?3 WHERE id = ?1",
                params![message_id, content.body, payload.to_string()],
            )?;
        }
        None => {
            let sent_at = chrono::Utc::now();
            let base = json!({
                "id": message_id,
                "serverId": workspace_id,
                "conversationId": conversation_id,
                "threadId": draft.thread_id,
                "rootThreadId": null,
                "authorId": draft.author_id,
                "author": draft.author,
                "isPinned": false,
                "isDeleted": false,
                "mentionedUserIds": [],
                "forwardedFromMessageId": draft.forwarded_from.as_ref().map(|f| &f.message_id),
                "forwardedFrom": null,
                "sentAt": sent_at.to_rfc3339_opts(chrono::SecondsFormat::Micros, true),
                "reactions": [],
            });
            let payload = content_payload(base, &json!({}), &content, e2ee);
            write_message(
                tx,
                &MessageRow {
                    id: message_id.clone(),
                    workspace_id: workspace_id.to_string(),
                    conversation_id: conversation_id.to_string(),
                    thread_id: draft.thread_id.clone(),
                    author_id: draft.author_id.clone(),
                    version: 0,
                    sent_at_us: sent_at.timestamp_micros(),
                    edited_at: None,
                    is_deleted: false,
                    text: Some(content.body.clone()),
                    payload: payload.to_string(),
                    e2ee_state: Some("outgoing".into()),
                },
            )?;
        }
    }
    tx.execute(
        "INSERT INTO e2ee_outgoing
             (message_id, workspace_id, conversation_id, kind, incarnation, epoch, envelope,
              content, franking_key, commitment, previous, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT (message_id) DO UPDATE SET
             kind = excluded.kind, incarnation = excluded.incarnation, epoch = excluded.epoch,
             envelope = excluded.envelope, content = excluded.content,
             franking_key = excluded.franking_key, commitment = excluded.commitment,
             previous = coalesce(e2ee_outgoing.previous, excluded.previous),
             created_at = excluded.created_at",
        params![
            message_id,
            workspace_id,
            conversation_id,
            if previous.is_some() { "edit" } else { "send" },
            state.incarnation,
            encrypted.epoch as i64,
            encrypted.envelope,
            encrypted.content,
            encrypted.franking_key.as_slice(),
            encrypted.commitment.as_slice(),
            previous.map(|p| p.to_string()),
            now_ms(),
        ],
    )?;
    Ok(OutgoingView {
        message_id,
        incarnation: state.incarnation,
        epoch: encrypted.epoch,
        envelope: b64(&encrypted.envelope),
        thread_root_message_id: content.thread_root_id.map(|id| id.hyphenated().to_string()),
        forwarded_from_message_id: draft.forwarded_from.as_ref().map(|f| f.message_id.clone()),
    })
}

/// The `e2ee` facts of a row this device sent.
fn e2ee_facts(
    encrypted: &EncryptedMessage,
    me: &MlsKeyStatement,
    content: &MessageContent,
) -> Map<String, Value> {
    let mut e2ee = Map::new();
    e2ee.insert("status".into(), json!("decrypted"));
    e2ee.insert("incarnation".into(), json!(encrypted.group.incarnation));
    e2ee.insert("epoch".into(), json!(encrypted.epoch));
    e2ee.insert(
        "senderDeviceId".into(),
        json!(me.device_id.hyphenated().to_string()),
    );
    e2ee.insert("senderPrincipalId".into(), json!(me.principal_id));
    e2ee.insert(
        "frankingKey".into(),
        json!(b64(encrypted.franking_key.as_ref())),
    );
    e2ee.insert("rev".into(), json!(content.rev));
    e2ee.insert(
        "content".into(),
        json!(String::from_utf8_lossy(&encrypted.content)),
    );
    e2ee
}

struct OutgoingRecord {
    workspace_id: String,
    conversation_id: String,
    kind: String,
    content: Vec<u8>,
    franking_key: Vec<u8>,
    commitment: Vec<u8>,
    previous: Option<String>,
}

fn load_record(tx: &Transaction<'_>, message_id: &str) -> Result<Option<OutgoingRecord>> {
    Ok(tx
        .query_row(
            "SELECT workspace_id, conversation_id, kind, content, franking_key, commitment,
                    previous
             FROM e2ee_outgoing WHERE message_id = ?1",
            params![message_id],
            |row| {
                Ok(OutgoingRecord {
                    workspace_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    kind: row.get(2)?,
                    content: row.get(3)?,
                    franking_key: row.get(4)?,
                    commitment: row.get(5)?,
                    previous: row.get(6)?,
                })
            },
        )
        .optional()?)
}

/// Encrypt a message waiting for acknowledgement again, with the same content and franking
/// key, in the group's current epoch (after `STALE_EPOCH`, once the newer Commits are in).
pub(crate) fn reencrypt(tx: &Transaction<'_>, mls: &Mls, message_id: &str) -> Result<OutgoingView> {
    let record = load_record(tx, message_id)?
        .ok_or_else(|| E2eeError::Invalid("no message of this id waits to be sent".into()))?;
    let state = load_state(tx, &record.workspace_id, &record.conversation_id)?;
    if state.incarnation == 0 || state.removed {
        return Err(rim_mls::Error::NoGroup.into());
    }
    if !state.unverified.is_empty() {
        return Err(E2eeError::Blocked(
            "a device RIM cannot verify is in this conversation".into(),
        ));
    }
    let group = conversation_group(&record.conversation_id, state.incarnation)?;
    let franking_key: [u8; 32] = record
        .franking_key
        .as_slice()
        .try_into()
        .map_err(|_| E2eeError::Invalid("a stored franking key is not 32 bytes".into()))?;
    let commitment: [u8; 32] = record
        .commitment
        .as_slice()
        .try_into()
        .map_err(|_| E2eeError::Invalid("a stored commitment is not 32 bytes".into()))?;
    let previous = EncryptedMessage {
        group,
        message_id: parse_uuid(message_id)?,
        epoch: 0,
        envelope: vec![],
        content: record.content.clone(),
        franking_key: Zeroizing::new(franking_key),
        commitment,
    };
    let encrypted = mls.reencrypt(&SqliteStore::new(tx), &previous)?;
    tx.execute(
        "UPDATE e2ee_outgoing SET incarnation = ?2, epoch = ?3, envelope = ?4 WHERE message_id = ?1",
        params![message_id, state.incarnation, encrypted.epoch as i64, encrypted.envelope],
    )?;
    let content = MessageContent::parse(&record.content)?;
    tx.execute(
        "UPDATE message
         SET payload = json_set(payload, '$.e2ee.incarnation', ?2, '$.e2ee.epoch', ?3)
         WHERE id = ?1",
        params![message_id, state.incarnation, encrypted.epoch as i64],
    )?;
    Ok(OutgoingView {
        message_id: message_id.to_string(),
        incarnation: state.incarnation,
        epoch: encrypted.epoch,
        envelope: b64(&encrypted.envelope),
        thread_root_message_id: content.thread_root_id.map(|id| id.hyphenated().to_string()),
        forwarded_from_message_id: content
            .forwarded_from
            .map(|f| f.message_id.hyphenated().to_string()),
    })
}

/// What settling a sent message left behind.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettledView {
    /// The body of a refused new message, to put back in the composer.
    pub unsent_body: Option<String>,
}

/// The server answered a message or an edit. `accepted` carries the message it returned; a
/// refusal removes a new message's row, or puts an edited row back as it was.
pub(crate) fn settle(
    tx: &Transaction<'_>,
    message_id: &str,
    accepted: Option<&Value>,
) -> Result<SettledView> {
    let Some(record) = load_record(tx, message_id)? else {
        return Ok(SettledView::default());
    };
    tx.execute(
        "DELETE FROM e2ee_outgoing WHERE message_id = ?1",
        params![message_id],
    )?;
    match (accepted, record.kind.as_str()) {
        (Some(message), "send") => {
            let sent_at = message.get("sentAt").and_then(Value::as_str);
            let sent_at_us = sent_at.and_then(|s| {
                chrono::DateTime::parse_from_rfc3339(s)
                    .ok()
                    .map(|t| t.timestamp_micros())
            });
            let receipt = message
                .pointer("/encryption/frankingReceipt")
                .and_then(Value::as_str);
            let key_id = message
                .pointer("/encryption/frankingKeyId")
                .and_then(Value::as_i64);
            let receipt_us = message
                .pointer("/encryption/sentAtUs")
                .and_then(Value::as_str);
            tx.execute(
                "UPDATE message SET
                     e2ee_state = CASE WHEN e2ee_state = 'outgoing' THEN 'decrypted' ELSE e2ee_state END,
                     sent_at_us = coalesce(?2, sent_at_us),
                     payload = json_set(payload,
                         '$.sentAt', coalesce(?3, json_extract(payload, '$.sentAt')),
                         '$.e2ee.receipt', ?4,
                         '$.e2ee.receiptKeyId', ?5,
                         '$.e2ee.sentAtUs', ?6)
                 WHERE id = ?1",
                params![message_id, sent_at_us, sent_at, receipt, key_id, receipt_us],
            )?;
            Ok(SettledView::default())
        }
        (Some(_), _) => Ok(SettledView::default()),
        (None, "send") => {
            let body: Option<String> = tx
                .query_row(
                    "SELECT text FROM message WHERE id = ?1 AND e2ee_state = 'outgoing'",
                    params![message_id],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            tx.execute(
                "DELETE FROM message WHERE id = ?1 AND e2ee_state = 'outgoing'",
                params![message_id],
            )?;
            Ok(SettledView { unsent_body: body })
        }
        (None, _) => {
            if let Some(previous) = record.previous {
                let previous: Value = serde_json::from_str(&previous)?;
                tx.execute(
                    "UPDATE message SET text = ?2, payload = ?3 WHERE id = ?1",
                    params![
                        message_id,
                        previous.get("text").and_then(Value::as_str),
                        previous.get("payload").map(Value::to_string),
                    ],
                )?;
            }
            Ok(SettledView::default())
        }
    }
}
