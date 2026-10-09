//! `rim_mls` for the web app, compiled to WebAssembly.
//!
//! An [`Engine`] holds one account's MLS state in a journaled [`MemoryStore`]. Operations take
//! and return bytes as unpadded base64url and structures as JSON text; a failure throws a JS
//! `Error` whose `name` is the code of [`Failure`].
//!
//! The page persists the state: after an operation it reads [`Engine::changes`], writes them to
//! IndexedDB, and then calls [`Engine::keep`]; if the write fails it calls [`Engine::rollback`],
//! which undoes the operation in memory as well. Nothing an operation returned is used before
//! its write landed.

mod directory;
mod error;
mod wire;

#[cfg(test)]
mod tests;

use rim_mls::{
    plan_key_package_upload, verify_leaves, AttachmentEntry, Change, ConversationGroup,
    DecryptExpectations, Decrypted, DeviceRef, EncryptedMessage, ForwardedFrom, KeyPackageStatus,
    LinkPreview, MemoryStore, MessageContent, Mls, ReaddRequest, SignedStatement,
};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

use directory::{Directory, DirectoryInput, VerifyOutcome};
pub use error::Failure;
use error::Result;
use wire::{b64, json, parse_json, parse_uuid, unb64, unb64_32};

/// The cipher suite every group uses (0x004F), as `submitMlsCommit` names it.
#[wasm_bindgen(js_name = cipherSuite)]
pub fn cipher_suite() -> u16 {
    rim_mls::CIPHER_SUITE_ID
}

/// One account's MLS engine and its state.
#[wasm_bindgen]
pub struct Engine {
    mls: Mls,
    store: MemoryStore,
}

fn group(conversation_id: &str, incarnation: u32) -> Result<ConversationGroup> {
    Ok(ConversationGroup::new(
        parse_uuid(conversation_id)?,
        incarnation,
    ))
}

fn device_ref(principal_id: &str, device_id: &str) -> Result<DeviceRef> {
    Ok(DeviceRef {
        principal_id: principal_id.to_string(),
        device_id: parse_uuid(device_id)?,
    })
}

#[wasm_bindgen]
impl Engine {
    /// An engine over stored entries: the JSON array [`Engine::export`] (or the persisted
    /// changes) gives, `[{label, key, value}]` with base64url key and value.
    #[wasm_bindgen(constructor)]
    pub fn new(entries: &str) -> Result<Engine> {
        let entries: Vec<wire::EntryWire> = parse_json(entries, "entries")?;
        let changes = entries
            .into_iter()
            .map(|e| {
                Ok(Change {
                    label: e.label,
                    key: unb64(&e.key)?,
                    value: e.value.as_deref().map(unb64).transpose()?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            mls: Mls::new()?,
            store: MemoryStore::import(changes),
        })
    }

    // ─── The journal ─────────────────────────────────────────────────────────

    /// The entries changed since the last [`Engine::keep`], to persist: `[{label, key, value}]`,
    /// `value` null for a deleted entry.
    pub fn changes(&self) -> String {
        json(&wire::changes(&self.store.pending()))
    }

    /// The changes were persisted: start a new journal.
    pub fn keep(&self) {
        self.store.commit();
    }

    /// The changes could not be persisted: undo them.
    pub fn rollback(&self) {
        self.store.rollback();
    }

    /// Every kept entry, as [`Engine::new`] reads them.
    pub fn export(&self) -> String {
        json(&wire::changes(&self.store.export()))
    }

    // ─── This device ─────────────────────────────────────────────────────────

    /// The `mls-key` payload for the device key to sign; makes the MLS key if there is none.
    #[wasm_bindgen(js_name = mlsKeyPayload)]
    pub fn mls_key_payload(
        &self,
        principal_id: &str,
        device_id: &str,
        issued_at: &str,
    ) -> Result<String> {
        let device = device_ref(principal_id, device_id)?;
        Ok(self.mls.mls_key_payload(&self.store, &device, issued_at)?)
    }

    /// Keep the signed `mls-key` statement once it verifies under `device_key`.
    #[wasm_bindgen(js_name = installMlsKeyStatement)]
    pub fn install_mls_key_statement(
        &self,
        payload: &str,
        signature: &str,
        device_key: &str,
    ) -> Result<()> {
        let statement = SignedStatement {
            payload: payload.to_string(),
            signature: signature.to_string(),
        };
        Ok(self
            .mls
            .install_mls_key_statement(&self.store, statement, device_key)?)
    }

    /// This device's `mls-key` statement as `{payload, signature}` JSON, if it has one.
    #[wasm_bindgen(js_name = mlsKeyStatement)]
    pub fn mls_key_statement(&self) -> Result<Option<String>> {
        Ok(self.mls.mls_key_statement(&self.store)?.map(|s| json(&s)))
    }

    /// Forget the MLS key; the next payload makes a new one.
    #[wasm_bindgen(js_name = forgetIdentity)]
    pub fn forget_identity(&self) -> Result<()> {
        Ok(self.mls.forget_identity(&self.store)?)
    }

    // ─── Key packages ────────────────────────────────────────────────────────

    /// `count` new key packages (`[{message, keyPackageRef, lastResort, notAfter}]`), valid
    /// from an hour before `now` (Unix seconds) for 90 days.
    #[wasm_bindgen(js_name = generateKeyPackages)]
    pub fn generate_key_packages(&self, count: u32, last_resort: bool, now: f64) -> Result<String> {
        let packages =
            self.mls
                .generate_key_packages(&self.store, count as usize, last_resort, now as u64)?;
        Ok(json(
            &packages
                .iter()
                .map(|p| wire::KeyPackageWire {
                    message: b64(&p.message),
                    key_package_ref: b64(&p.key_package_ref),
                    last_resort: p.last_resort,
                    not_after: p.not_after,
                })
                .collect::<Vec<_>>(),
        ))
    }

    /// Delete the keys of expired and replaced key packages; returns how many went.
    #[wasm_bindgen(js_name = pruneKeyPackages)]
    pub fn prune_key_packages(&self, now: f64) -> Result<u32> {
        Ok(self.mls.prune_key_packages(&self.store, now as u64)? as u32)
    }

    // ─── Groups ──────────────────────────────────────────────────────────────

    /// Create `incarnation` of the conversation's group and stage its first Commit, adding the
    /// claimed devices (`[{principalId, deviceId, keyPackage}]`).
    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(
        &self,
        conversation_id: &str,
        incarnation: u32,
        claimed: &str,
    ) -> Result<String> {
        let commit = self.mls.create_group(
            &self.store,
            group(conversation_id, incarnation)?,
            &wire::claimed(claimed)?,
        )?;
        Ok(json(&wire::outgoing_commit(&commit)))
    }

    /// Stage one Commit of the claimed adds and the removes (`[{principalId, deviceId}]`).
    #[wasm_bindgen(js_name = stageCommit)]
    pub fn stage_commit(
        &self,
        conversation_id: &str,
        incarnation: u32,
        claimed: &str,
        removes: &str,
    ) -> Result<String> {
        let removes: Vec<wire::DeviceWire> = parse_json(removes, "removes")?;
        let removes = removes
            .iter()
            .map(|d| device_ref(&d.principal_id, &d.device_id))
            .collect::<Result<Vec<_>>>()?;
        let commit = self.mls.commit(
            &self.store,
            group(conversation_id, incarnation)?,
            &wire::claimed(claimed)?,
            &removes,
        )?;
        Ok(json(&wire::outgoing_commit(&commit)))
    }

    /// The server accepted the pending Commit: merge it. Returns the new epoch.
    #[wasm_bindgen(js_name = commitAccepted)]
    pub fn commit_accepted(&self, conversation_id: &str, incarnation: u32) -> Result<f64> {
        let epoch = self
            .mls
            .commit_accepted(&self.store, group(conversation_id, incarnation)?)?;
        Ok(epoch as f64)
    }

    /// The server refused the pending Commit: drop it.
    #[wasm_bindgen(js_name = commitRejected)]
    pub fn commit_rejected(&self, conversation_id: &str, incarnation: u32) -> Result<()> {
        Ok(self
            .mls
            .commit_rejected(&self.store, group(conversation_id, incarnation)?)?)
    }

    /// Process the Commit for the group's current epoch.
    #[wasm_bindgen(js_name = processCommit)]
    pub fn process_commit(
        &self,
        conversation_id: &str,
        incarnation: u32,
        commit: &str,
    ) -> Result<String> {
        let outcome = self.mls.process_commit(
            &self.store,
            group(conversation_id, incarnation)?,
            &unb64(commit)?,
        )?;
        Ok(json(&wire::commit_outcome(&outcome)))
    }

    /// Join `incarnation` of the conversation's group from a Welcome.
    pub fn join(&self, conversation_id: &str, incarnation: u32, welcome: &str) -> Result<String> {
        let joined = self.mls.join(
            &self.store,
            group(conversation_id, incarnation)?,
            &unb64(welcome)?,
        )?;
        Ok(json(&wire::JoinedWire {
            epoch: joined.epoch,
            welcomer: joined.welcomer.as_ref().map(wire::DeviceWire::from_ref),
            leaves: joined.leaves.len() as u32,
        }))
    }

    /// Encrypt content (its exact JSON text) in the group's current epoch.
    pub fn encrypt(
        &self,
        conversation_id: &str,
        incarnation: u32,
        content: &str,
    ) -> Result<String> {
        let content = MessageContent::parse(content.as_bytes())?;
        let encrypted =
            self.mls
                .encrypt(&self.store, group(conversation_id, incarnation)?, &content)?;
        Ok(json(&wire::encrypted(&encrypted)))
    }

    /// Encrypt an earlier message again in the current epoch, with the same content, franking
    /// key and commitment (the resend after `STALE_EPOCH`).
    pub fn reencrypt(
        &self,
        conversation_id: &str,
        incarnation: u32,
        content: &str,
        franking_key: &str,
        commitment: &str,
    ) -> Result<String> {
        let parsed = MessageContent::parse(content.as_bytes())?;
        let previous = EncryptedMessage {
            group: group(conversation_id, incarnation)?,
            message_id: parsed.id,
            epoch: 0,
            envelope: vec![],
            content: content.as_bytes().to_vec(),
            franking_key: Zeroizing::new(unb64_32(franking_key)?),
            commitment: unb64_32(commitment)?,
        };
        let encrypted = self.mls.reencrypt(&self.store, &previous)?;
        Ok(json(&wire::encrypted(&encrypted)))
    }

    /// Decrypt an envelope once and check it against its row (`{messageId, threadRootId,
    /// authorPrincipalId}`).
    pub fn decrypt(
        &self,
        conversation_id: &str,
        incarnation: u32,
        envelope: &str,
        expected: &str,
    ) -> Result<String> {
        let expected: wire::ExpectedWire = parse_json(expected, "expectations")?;
        let expected = DecryptExpectations {
            message_id: parse_uuid(&expected.message_id)?,
            thread_root_id: expected
                .thread_root_id
                .as_deref()
                .map(parse_uuid)
                .transpose()?,
            author_principal_id: expected.author_principal_id,
        };
        let decrypted = self.mls.decrypt(
            &self.store,
            group(conversation_id, incarnation)?,
            &unb64(envelope)?,
            &expected,
        )?;
        Ok(json(&match decrypted {
            Decrypted::Message(message) => wire::DecryptedWire::Message {
                sender: wire::DeviceWire::from_ref(&message.sender),
                epoch: message.epoch,
                content: String::from_utf8_lossy(&message.content_bytes).into_owned(),
                franking_key: b64(message.franking_key.as_ref()),
                commitment: b64(&message.commitment),
            },
            Decrypted::Invalid { sender, reason } => wire::DecryptedWire::Invalid {
                sender: sender.as_ref().map(wire::DeviceWire::from_ref),
                reason,
            },
            Decrypted::Own => wire::DecryptedWire::Own,
        }))
    }

    /// The group's epoch and whether it waits for a Commit answer or a re-add.
    #[wasm_bindgen(js_name = groupStatus)]
    pub fn group_status(&self, conversation_id: &str, incarnation: u32) -> Result<String> {
        let status = self
            .mls
            .group_status(&self.store, group(conversation_id, incarnation)?)?;
        Ok(json(&wire::StatusWire {
            epoch: status.epoch,
            commit_pending: status.commit_pending,
            awaiting_readd: status.awaiting_readd,
        }))
    }

    /// Check every leaf of the group against what the page found out about each device.
    #[wasm_bindgen(js_name = verifyLeaves)]
    pub fn verify_leaves(
        &self,
        conversation_id: &str,
        incarnation: u32,
        directory: &str,
    ) -> Result<String> {
        let input: DirectoryInput = parse_json(directory, "directory")?;
        let leaves = self
            .mls
            .leaves(&self.store, group(conversation_id, incarnation)?)?;
        let directory = Directory::new(&input);
        let problems = verify_leaves(&leaves, &directory);
        Ok(json(&VerifyOutcome::new(&directory, &leaves, &problems)))
    }

    /// Delete the group's state on this device.
    #[wasm_bindgen(js_name = deleteGroup)]
    pub fn delete_group(&self, conversation_id: &str, incarnation: u32) -> Result<()> {
        Ok(self
            .mls
            .delete_group(&self.store, group(conversation_id, incarnation)?)?)
    }

    /// The re-add request payload for the device key to sign; the group's state goes.
    #[wasm_bindgen(js_name = prepareReadd)]
    pub fn prepare_readd(&self, conversation_id: &str, incarnation: u32) -> Result<String> {
        let request = self
            .mls
            .prepare_readd(&self.store, group(conversation_id, incarnation)?)?;
        Ok(request.payload())
    }
}

// ─── Without state ───────────────────────────────────────────────────────────

/// The content JSON text of a message: `{id, rev, threadRootId, body, replyTo, forwardedFrom,
/// attachments, linkPreviews}`, with the mentions read from the body. Refuses content that
/// breaks a rule.
#[wasm_bindgen(js_name = buildContent)]
pub fn build_content(draft: &str) -> Result<String> {
    let draft: wire::DraftWire = parse_json(draft, "draft")?;
    let mut content = MessageContent::new(parse_uuid(&draft.id)?, draft.body);
    content.rev = draft.rev;
    content.thread_root_id = draft
        .thread_root_id
        .as_deref()
        .map(parse_uuid)
        .transpose()?;
    content.reply_to = draft.reply_to.as_deref().map(parse_uuid).transpose()?;
    content.forwarded_from = draft
        .forwarded_from
        .map(|f| -> Result<ForwardedFrom> {
            Ok(ForwardedFrom {
                message_id: parse_uuid(&f.message_id)?,
                conversation_id: parse_uuid(&f.conversation_id)?,
                author_principal_id: f.author_principal_id,
                sent_at: f.sent_at,
            })
        })
        .transpose()?;
    content.attachments = draft
        .attachments
        .into_iter()
        .map(|a| -> Result<AttachmentEntry> {
            Ok(AttachmentEntry {
                blob_sha256: unb64_32(&a.blob_sha256)?,
                secret: Zeroizing::new(unb64_32(&a.secret)?),
                name: a.name,
                mime: a.mime,
                size: a.size,
            })
        })
        .collect::<Result<_>>()?;
    content.link_previews = draft
        .link_previews
        .into_iter()
        .map(|p| LinkPreview {
            url: p.url,
            title: p.title,
            description: p.description,
            site_name: p.site_name,
        })
        .collect();
    content.check()?;
    Ok(String::from_utf8_lossy(&content.to_bytes()).into_owned())
}

/// What to upload given the server's key package status (`{available, lastResortNotAfter,
/// lastResortClaims}`, the time in Unix seconds): `{oneTime, lastResort}`.
#[wasm_bindgen(js_name = planKeyPackageUpload)]
pub fn plan_upload(status: &str, now: f64) -> Result<String> {
    let status: wire::StatusInput = parse_json(status, "key package status")?;
    let plan = plan_key_package_upload(
        &KeyPackageStatus {
            available: status.available,
            last_resort_not_after: status.last_resort_not_after,
            last_resort_claims: status.last_resort_claims,
        },
        now as u64,
    );
    Ok(json(&wire::PlanWire {
        one_time: plan.one_time as u32,
        last_resort: plan.last_resort,
    }))
}

/// Read a re-add request and check that `device_key` signed it: `{principalId, deviceId,
/// conversationId, incarnation, lastEpoch}`.
#[wasm_bindgen(js_name = verifyReadd)]
pub fn verify_readd(payload: &str, signature: &str, device_key: &str) -> Result<String> {
    let request = ReaddRequest::verify(
        &SignedStatement {
            payload: payload.to_string(),
            signature: signature.to_string(),
        },
        device_key,
    )?;
    Ok(json(&wire::ReaddWire {
        principal_id: request.device.principal_id,
        device_id: request.device.device_id.hyphenated().to_string(),
        conversation_id: request.group.conversation_id.hyphenated().to_string(),
        incarnation: request.group.incarnation,
        last_epoch: request.last_epoch,
    }))
}

/// Whether a committer may act on a device's re-add request now (Unix seconds).
#[wasm_bindgen(js_name = mayHonorReadd)]
pub fn may_honor_readd(last_honored_at: Option<f64>, now: f64) -> bool {
    rim_mls::may_honor_readd(last_honored_at.map(|at| at as i64), now as i64)
}
