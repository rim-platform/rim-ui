//! Decrypting the change feed: the client loop of an encrypted conversation, run inside the
//! cache sync's page transaction.
//!
//! For each encrypted entry, in feed (epoch) order: if its epoch is past the group's, the
//! fetched Commits up to it are applied first; then the entry is decrypted once and its
//! plaintext row written, in the same transaction that advanced the ratchet. When the feed is
//! drained, the remaining Commits are applied. An entry this device cannot read (sent before it
//! joined, in an older incarnation, or too many epochs back) becomes a placeholder; one that
//! decrypts but breaks a rule is stored as "could not be verified", without its content. When a
//! Commit or a Welcome is missing the handler stops the conversation where it is and says why;
//! the webview fetches what is missing and syncs it again.

use std::collections::{BTreeMap, HashMap};

use rim_mls::{
    DecryptExpectations, Decrypted, DecryptedMessage, MessageContent, Mls, SqliteStore,
    MAX_PAST_EPOCHS,
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::group::{
    apply_commit, conversation_group, load_state, save_state, CommitInput, CommitStep,
    ConversationState,
};
use super::{b64, parse_uuid, unb64, E2eeError};
use crate::message_cache::feed::MessageChange;
use crate::message_cache::store::parse_timestamp_us;
use crate::message_cache::sync::{
    stored_payload, write_message, EnvelopeHandler, Handled, MessageRow,
};
use crate::message_cache::CacheError;

/// What the webview fetched for one encrypted conversation before handing a feed page in.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationInput {
    pub conversation_id: String,
    /// The server's current incarnation of the conversation's group, when known.
    #[serde(default)]
    pub server_incarnation: Option<u32>,
    /// Whether this device is one of the server's group devices, when known.
    #[serde(default)]
    pub in_group: Option<bool>,
    /// Commits from the group's local epoch on, any order.
    #[serde(default)]
    pub commits: Vec<CommitInput>,
    /// Thread id to its root message id, for the thread replies of the page.
    #[serde(default)]
    pub thread_roots: HashMap<String, String>,
}

/// Why the handler stopped a conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum StopReason {
    /// An entry is past the group's epoch and the Commit of `epoch` was not handed in.
    #[serde(rename_all = "camelCase")]
    NeedCommits { incarnation: u32, epoch: u64 },
    /// An entry of `incarnation`, which this device holds no state for (a Welcome not
    /// processed yet, or lost state).
    #[serde(rename_all = "camelCase")]
    NoGroupState { incarnation: u32 },
    /// The group stopped at a Commit it cannot process, or waits for a requested re-add.
    #[serde(rename_all = "camelCase")]
    AwaitingReadd {
        incarnation: u32,
        epoch: Option<u64>,
    },
    /// A thread reply whose thread's root message id was not handed in.
    #[serde(rename_all = "camelCase")]
    NeedThreadRoot { thread_id: String },
}

/// A message this sync decrypted, for local keyword notifications.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DecryptedNote {
    pub message_id: String,
    pub author_id: String,
    pub thread_id: Option<String>,
    pub sent_at: String,
    pub body: String,
}

/// What the sync did in one encrypted conversation.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncNote {
    pub conversation_id: String,
    pub stopped: Option<StopReason>,
    /// Leaves wait for verification.
    pub verify: bool,
    /// This device processed its own removal.
    pub removed: bool,
    /// A Commit's summary did not match its proposals.
    pub misbehaved: bool,
    pub decrypted: Vec<DecryptedNote>,
}

/// The `MessageEncryption` of a feed entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptionWire {
    incarnation: u32,
    epoch: u64,
    sender_device_id: String,
    ciphertext: Option<String>,
    franking_receipt: String,
    franking_key_id: i64,
    sent_at_us: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthorWire {
    principal_id: Option<String>,
}

/// The fields of a feed message the handler reads.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryWire {
    id: String,
    conversation_id: String,
    thread_id: Option<String>,
    author_id: String,
    author: Option<AuthorWire>,
    is_deleted: bool,
    sent_at: String,
    encryption: Option<EncryptionWire>,
}

/// The [`EnvelopeHandler`] of an account with end-to-end encryption.
pub(crate) struct Decryptor<'a> {
    mls: &'a Mls,
    inputs: HashMap<String, ConversationInput>,
    states: HashMap<String, ConversationState>,
    notes: BTreeMap<String, SyncNote>,
}

impl<'a> Decryptor<'a> {
    pub(crate) fn new(mls: &'a Mls, inputs: Vec<ConversationInput>) -> Self {
        Self {
            mls,
            inputs: inputs
                .into_iter()
                .map(|input| (input.conversation_id.clone(), input))
                .collect(),
            states: HashMap::new(),
            notes: BTreeMap::new(),
        }
    }

    /// What happened in each encrypted conversation of the page.
    pub(crate) fn into_notes(self) -> Vec<SyncNote> {
        self.notes.into_values().collect()
    }

    fn note(&mut self, conversation_id: &str) -> &mut SyncNote {
        self.notes
            .entry(conversation_id.to_string())
            .or_insert_with(|| SyncNote {
                conversation_id: conversation_id.to_string(),
                ..SyncNote::default()
            })
    }

    fn state(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
    ) -> Result<ConversationState, CacheError> {
        if let Some(state) = self.states.get(conversation_id) {
            return Ok(state.clone());
        }
        let state = load_state(tx, workspace_id, conversation_id)?;
        self.states
            .insert(conversation_id.to_string(), state.clone());
        Ok(state)
    }

    fn keep_state(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
        state: ConversationState,
    ) -> Result<(), CacheError> {
        if self.states.get(conversation_id) != Some(&state) {
            save_state(tx, workspace_id, conversation_id, &state)?;
        }
        let note = self.note(conversation_id);
        note.verify = state.verify_pending;
        note.removed = state.removed;
        note.misbehaved = state.misbehaved.is_some();
        self.states.insert(conversation_id.to_string(), state);
        Ok(())
    }

    fn stop(&mut self, conversation_id: &str, reason: StopReason) -> Handled {
        self.note(conversation_id).stopped = Some(reason);
        Handled::Stop
    }

    /// Decrypt (or place) one encrypted, live entry.
    #[allow(clippy::too_many_arguments)]
    fn entry(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
        change: &MessageChange,
        entry: &EntryWire,
        encryption: &EncryptionWire,
        version: i64,
        state: &mut ConversationState,
        input: &ConversationInput,
    ) -> Result<Handled, CacheError> {
        let row = RowFacts {
            workspace_id,
            conversation_id,
            change,
            entry,
            encryption,
            version,
        };
        let incarnation = encryption.incarnation;

        if incarnation < state.incarnation || (incarnation == state.incarnation && state.removed) {
            return row.placeholder(tx);
        }
        let group = conversation_group(conversation_id, incarnation).map_err(CacheError::from)?;
        let store = SqliteStore::new(tx);
        let status = if incarnation == state.incarnation {
            match self.mls.group_status(&store, group) {
                Ok(status) => Some(status),
                Err(rim_mls::Error::NoGroup) => None,
                Err(e) => return Err(E2eeError::from(e).into()),
            }
        } else {
            None
        };
        let Some(status) = status else {
            if state.readd_requested_at.is_some() {
                return Ok(self.stop(
                    conversation_id,
                    StopReason::AwaitingReadd {
                        incarnation,
                        epoch: None,
                    },
                ));
            }
            let absent = input.in_group == Some(false)
                || input.server_incarnation.is_some_and(|s| s > incarnation);
            if absent {
                return row.placeholder(tx);
            }
            return Ok(self.stop(conversation_id, StopReason::NoGroupState { incarnation }));
        };
        if let Some(epoch) = status.awaiting_readd {
            return Ok(self.stop(
                conversation_id,
                StopReason::AwaitingReadd {
                    incarnation,
                    epoch: Some(epoch),
                },
            ));
        }
        if encryption.epoch < state.join_epoch {
            return row.placeholder(tx);
        }

        let mut epoch = status.epoch;
        while encryption.epoch > epoch {
            let Some(commit) = input
                .commits
                .iter()
                .find(|c| c.incarnation == incarnation && c.epoch == epoch)
            else {
                return Ok(self.stop(
                    conversation_id,
                    StopReason::NeedCommits { incarnation, epoch },
                ));
            };
            match apply_commit(tx, self.mls, state, conversation_id, commit)? {
                CommitStep::Applied => epoch += 1,
                CommitStep::CannotProcess => {
                    return Ok(self.stop(
                        conversation_id,
                        StopReason::AwaitingReadd {
                            incarnation,
                            epoch: Some(epoch),
                        },
                    ))
                }
                CommitStep::Skipped | CommitStep::Gap => {
                    return Ok(self.stop(
                        conversation_id,
                        StopReason::NeedCommits { incarnation, epoch },
                    ))
                }
            }
            if state.removed {
                return row.placeholder(tx);
            }
        }
        if epoch - encryption.epoch > MAX_PAST_EPOCHS {
            return row.placeholder(tx);
        }

        let thread_root_id = match &entry.thread_id {
            None => None,
            Some(thread_id) => match input.thread_roots.get(thread_id) {
                Some(root) => Some(parse_uuid(root).map_err(CacheError::from)?),
                None => {
                    return Ok(self.stop(
                        conversation_id,
                        StopReason::NeedThreadRoot {
                            thread_id: thread_id.clone(),
                        },
                    ))
                }
            },
        };
        let Some(ciphertext) = &encryption.ciphertext else {
            log::warn!("[e2ee] an encrypted entry without a ciphertext");
            return Ok(Handled::Done);
        };
        let Ok(envelope) = unb64(ciphertext) else {
            log::warn!("[e2ee] an encrypted entry whose ciphertext is not base64url");
            return Ok(Handled::Done);
        };
        let expected = DecryptExpectations {
            message_id: parse_uuid(&entry.id).map_err(CacheError::from)?,
            thread_root_id,
            author_principal_id: entry.author.as_ref().and_then(|a| a.principal_id.clone()),
        };
        match self.mls.decrypt(&store, group, &envelope, &expected) {
            Ok(Decrypted::Message(message)) => {
                if row.decrypted(tx, &message)? {
                    self.note(conversation_id).decrypted.push(DecryptedNote {
                        message_id: entry.id.clone(),
                        author_id: entry.author_id.clone(),
                        thread_id: entry.thread_id.clone(),
                        sent_at: entry.sent_at.clone(),
                        body: message.content.body.clone(),
                    });
                }
                Ok(Handled::Done)
            }
            Ok(Decrypted::Invalid { reason, .. }) => {
                log::warn!("[e2ee] a message could not be verified: {reason}");
                row.invalid(tx, &reason)
            }
            Ok(Decrypted::Own) => row.own(tx, &envelope),
            Err(rim_mls::Error::EpochMismatch { .. }) => row.placeholder(tx),
            Err(rim_mls::Error::AwaitingReadd(epoch)) => Ok(self.stop(
                conversation_id,
                StopReason::AwaitingReadd {
                    incarnation,
                    epoch: Some(epoch),
                },
            )),
            Err(e @ rim_mls::Error::Storage(_)) => Err(E2eeError::from(e).into()),
            Err(e) => {
                // A replay (the key is used up), or bytes that are not a message of this group.
                log::warn!("[e2ee] ignoring an entry that does not decrypt: {e}");
                Ok(Handled::Done)
            }
        }
    }
}

impl EnvelopeHandler for Decryptor<'_> {
    fn change(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
        change: &MessageChange,
    ) -> Result<Handled, CacheError> {
        let Ok(entry) = serde_json::from_value::<EntryWire>(change.message.clone()) else {
            return Ok(Handled::Plaintext);
        };
        let Some(encryption) = entry.encryption.clone() else {
            return Ok(Handled::Plaintext);
        };
        if entry.conversation_id != conversation_id {
            return Ok(Handled::Plaintext);
        }
        let Ok(version) = change.version.parse::<i64>() else {
            return Ok(Handled::Plaintext);
        };
        if let Some((cached, e2ee_state)) = cached_version(tx, &entry.id)? {
            if cached >= version && e2ee_state.as_deref() != Some("outgoing") {
                return Ok(Handled::Done);
            }
        }
        if entry.is_deleted {
            tx.execute(
                "DELETE FROM e2ee_outgoing WHERE message_id = ?1",
                params![entry.id],
            )?;
            return Ok(Handled::Plaintext);
        }

        let mut state = self.state(tx, workspace_id, conversation_id)?;
        // Taken out for the call, so the Commits are not copied per entry.
        let input = self.inputs.remove(conversation_id).unwrap_or_default();
        let handled = self.entry(
            tx,
            workspace_id,
            conversation_id,
            change,
            &entry,
            &encryption,
            version,
            &mut state,
            &input,
        );
        self.inputs.insert(conversation_id.to_string(), input);
        let handled = handled?;
        self.keep_state(tx, workspace_id, conversation_id, state)?;
        Ok(handled)
    }

    fn finish(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
        drained: bool,
    ) -> Result<(), CacheError> {
        let Some(input) = self.inputs.remove(conversation_id) else {
            return Ok(());
        };
        let mut state = self.state(tx, workspace_id, conversation_id)?;
        let result = self.drain_commits(tx, conversation_id, &input, &mut state, drained);
        self.inputs.insert(conversation_id.to_string(), input);
        result?;
        self.keep_state(tx, workspace_id, conversation_id, state)
    }

    fn dropped(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
    ) -> Result<(), CacheError> {
        super::group::forget(tx, self.mls, workspace_id, conversation_id)?;
        self.states.remove(conversation_id);
        Ok(())
    }
}

impl Decryptor<'_> {
    /// Apply the Commits left once the feed is drained.
    fn drain_commits(
        &mut self,
        tx: &Transaction<'_>,
        conversation_id: &str,
        input: &ConversationInput,
        state: &mut ConversationState,
        drained: bool,
    ) -> Result<(), CacheError> {
        if drained {
            let mut commits: Vec<&CommitInput> = input
                .commits
                .iter()
                .filter(|c| c.incarnation == state.incarnation)
                .collect();
            commits.sort_by_key(|c| c.epoch);
            for commit in commits {
                match apply_commit(tx, self.mls, state, conversation_id, commit)? {
                    CommitStep::Applied | CommitStep::Skipped => {}
                    CommitStep::Gap => break,
                    CommitStep::CannotProcess => {
                        self.note(conversation_id).stopped = Some(StopReason::AwaitingReadd {
                            incarnation: state.incarnation,
                            epoch: Some(commit.epoch),
                        });
                        break;
                    }
                }
            }
        }
        Ok(())
    }
}

fn cached_version(
    tx: &Transaction<'_>,
    id: &str,
) -> Result<Option<(i64, Option<String>)>, CacheError> {
    Ok(tx
        .query_row(
            "SELECT version, e2ee_state FROM message WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

/// One encrypted entry, and how its rows are written.
struct RowFacts<'r> {
    workspace_id: &'r str,
    conversation_id: &'r str,
    change: &'r MessageChange,
    entry: &'r EntryWire,
    encryption: &'r EncryptionWire,
    version: i64,
}

impl RowFacts<'_> {
    fn write(
        &self,
        tx: &Transaction<'_>,
        text: Option<String>,
        payload: Value,
        e2ee_state: &str,
    ) -> Result<bool, CacheError> {
        let Ok(sent_at_us) = parse_timestamp_us(&self.entry.sent_at) else {
            log::warn!("[e2ee] skipping an entry with an unreadable sentAt");
            return Ok(false);
        };
        write_message(
            tx,
            &MessageRow {
                id: self.entry.id.clone(),
                workspace_id: self.workspace_id.to_string(),
                conversation_id: self.conversation_id.to_string(),
                thread_id: self.entry.thread_id.clone(),
                author_id: self.entry.author_id.clone(),
                version: self.version,
                sent_at_us,
                edited_at: self.change.edited_at.clone(),
                is_deleted: false,
                text,
                payload: payload.to_string(),
                e2ee_state: Some(e2ee_state.to_string()),
            },
        )
    }

    /// The server's fields of the entry, without content.
    fn base_payload(&self) -> Value {
        let mut payload: Value =
            serde_json::from_str(&stored_payload(self.change.message.clone(), false))
                .unwrap_or_else(|_| json!({}));
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("attachments".into(), json!([]));
            obj.insert("linkPreviews".into(), json!([]));
            obj.insert("hasAttachments".into(), json!(false));
        }
        payload
    }

    fn envelope_facts(&self, status: &str) -> Map<String, Value> {
        let mut e2ee = Map::new();
        e2ee.insert("status".into(), json!(status));
        e2ee.insert("incarnation".into(), json!(self.encryption.incarnation));
        e2ee.insert("epoch".into(), json!(self.encryption.epoch));
        e2ee.insert(
            "senderDeviceId".into(),
            json!(self.encryption.sender_device_id),
        );
        e2ee.insert("receipt".into(), json!(self.encryption.franking_receipt));
        e2ee.insert(
            "receiptKeyId".into(),
            json!(self.encryption.franking_key_id),
        );
        e2ee.insert("sentAtUs".into(), json!(self.encryption.sent_at_us));
        e2ee
    }

    fn placeholder(&self, tx: &Transaction<'_>) -> Result<Handled, CacheError> {
        let mut payload = self.base_payload();
        payload["e2ee"] = Value::Object(self.envelope_facts("undecryptable"));
        self.write(tx, None, payload, "placeholder")?;
        Ok(Handled::Done)
    }

    fn invalid(&self, tx: &Transaction<'_>, reason: &str) -> Result<Handled, CacheError> {
        let mut payload = self.base_payload();
        let mut e2ee = self.envelope_facts("invalid");
        e2ee.insert("reason".into(), json!(reason));
        payload["e2ee"] = Value::Object(e2ee);
        self.write(tx, None, payload, "invalid")?;
        Ok(Handled::Done)
    }

    /// Store a decrypted message. Returns whether it was written (a lower revision than the
    /// cached one is not).
    fn decrypted(
        &self,
        tx: &Transaction<'_>,
        message: &DecryptedMessage,
    ) -> Result<bool, CacheError> {
        if cached_rev(tx, &self.entry.id)?.is_some_and(|rev| rev > message.content.rev) {
            return Ok(false);
        }
        let content_text = String::from_utf8_lossy(&message.content_bytes).into_owned();
        let mut e2ee = self.envelope_facts("decrypted");
        e2ee.insert(
            "senderPrincipalId".into(),
            json!(message.sender.principal_id),
        );
        e2ee.insert(
            "frankingKey".into(),
            json!(b64(message.franking_key.as_ref())),
        );
        e2ee.insert("rev".into(), json!(message.content.rev));
        e2ee.insert("content".into(), json!(content_text));
        let payload = content_payload(
            self.base_payload(),
            &self.change.message,
            &message.content,
            e2ee,
        );
        self.write(tx, Some(message.content.body.clone()), payload, "decrypted")
    }

    /// One of this device's own messages came back: it keeps the plaintext stored when sending
    /// and takes the server's fields.
    fn own(&self, tx: &Transaction<'_>, envelope: &[u8]) -> Result<Handled, CacheError> {
        let cached: Option<(Option<String>, String)> = tx
            .query_row(
                "SELECT text, payload FROM message WHERE id = ?1 AND conversation_id = ?2
                   AND e2ee_state IN ('outgoing', 'decrypted')",
                params![self.entry.id, self.conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((text, cached_payload)) = cached else {
            return self.placeholder(tx);
        };
        let cached_payload: Value = serde_json::from_str(&cached_payload)?;
        let Some(stored) = cached_payload.get("e2ee").and_then(Value::as_object) else {
            return self.placeholder(tx);
        };
        let Some(content) = stored
            .get("content")
            .and_then(Value::as_str)
            .and_then(|c| MessageContent::parse(c.as_bytes()).ok())
        else {
            return self.placeholder(tx);
        };
        let mut e2ee = stored.clone();
        for (key, value) in self.envelope_facts("decrypted") {
            e2ee.insert(key, value);
        }
        let payload = content_payload(self.base_payload(), &self.change.message, &content, e2ee);
        self.write(tx, text, payload, "decrypted")?;
        tx.execute(
            "DELETE FROM e2ee_outgoing WHERE message_id = ?1 AND envelope = ?2",
            params![self.entry.id, envelope],
        )?;
        Ok(Handled::Done)
    }
}

fn cached_rev(tx: &Transaction<'_>, id: &str) -> Result<Option<u32>, CacheError> {
    let payload: Option<String> = tx
        .query_row(
            "SELECT payload FROM message WHERE id = ?1 AND e2ee_state = 'decrypted'",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(payload
        .and_then(|p| serde_json::from_str::<Value>(&p).ok())
        .and_then(|p| p.pointer("/e2ee/rev").and_then(Value::as_u64))
        .map(|rev| rev as u32))
}

/// A row's payload with what the content says: attachments (matched to the server's uploads by
/// their blob hash), the sender's link previews, the reply target, and the `e2ee` facts.
pub(crate) fn content_payload(
    mut payload: Value,
    server_message: &Value,
    content: &MessageContent,
    e2ee: Map<String, Value>,
) -> Value {
    let uploads: Vec<&Value> = server_message
        .get("attachments")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    let attachments: Vec<Value> = content
        .attachments
        .iter()
        .map(|entry| {
            let hash = b64(&entry.blob_sha256);
            let upload = uploads
                .iter()
                .find(|u| u.get("blobSha256").and_then(Value::as_str) == Some(hash.as_str()));
            json!({
                "id": upload
                    .and_then(|u| u.get("id"))
                    .cloned()
                    .unwrap_or_else(|| json!(format!("pending:{hash}"))),
                "filename": entry.name,
                "contentType": entry.mime,
                "sizeBytes": entry.size,
                "status": upload
                    .and_then(|u| u.get("status"))
                    .cloned()
                    .unwrap_or_else(|| json!("PENDING_UPLOAD")),
                "blobSha256": hash,
            })
        })
        .collect();
    let id = content.id.hyphenated().to_string();
    let previews: Vec<Value> = content
        .link_previews
        .iter()
        .enumerate()
        .map(|(i, p)| {
            json!({
                "id": format!("{id}:{i}"),
                "url": p.url.clone().unwrap_or_default(),
                "title": p.title,
                "description": p.description,
                "imageUrl": null,
                "siteName": p.site_name,
            })
        })
        .collect();
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("hasAttachments".into(), json!(!attachments.is_empty()));
        obj.insert("attachments".into(), Value::Array(attachments));
        obj.insert("linkPreviews".into(), Value::Array(previews));
        obj.insert(
            "parentMessageId".into(),
            json!(content.reply_to.map(|r| r.hyphenated().to_string())),
        );
        obj.insert("e2ee".into(), Value::Object(e2ee));
    }
    payload
}
