//! End-to-end encryption of RIM DMs and groups with MLS (RFC 9420).
//!
//! This crate is the only code that names OpenMLS types. Everything it exposes is in RIM's terms:
//! conversations and incarnations ([`ConversationGroup`]), devices ([`DeviceRef`]), message
//! content ([`MessageContent`]), and `MLSMessage` bytes as the server stores them.
//!
//! - Every operation runs on one [`Store`]: a [`SqliteStore`] over a transaction the caller owns
//!   (the app's encrypted cache database), or a [`MemoryStore`]. The crate never commits: the
//!   caller commits after storing what the operation produced, so decrypting a message, storing
//!   its plaintext and advancing the ratchet happen together or not at all.
//! - Groups use suite 0x004F (X25519 + ML-KEM-768 hybrid KEM, AES-128-GCM, SHA-256, Ed25519)
//!   through the libcrux provider.
//! - A device signs MLS messages with its own MLS signature key, which its device key certifies
//!   in an `mls-key` statement; the device key stays with the app.

mod aad;
mod attachment;
mod codec;
mod content;
mod device;
mod error;
mod franking;
mod group;
mod group_id;
mod identity;
mod provider;
mod ranking;
mod readd;
mod storage;

#[cfg(test)]
mod tests;

use openmls::prelude::Ciphersuite;

pub use aad::{
    AddedDevice, ApplicationAad, AuthenticatedData, CommitSummary, MAX_APPLICATION_AAD,
    MAX_COMMIT_AAD,
};
pub use attachment::{
    attachment_key_and_nonce, decrypt_attachment, encrypt_attachment, encrypt_attachment_with,
    EncryptedAttachment,
};
pub use content::{
    mentions_everyone, mentions_in, AttachmentEntry, ForwardedFrom, LinkPreview, MessageContent,
    MAX_ATTACHMENTS, MAX_ATTACHMENT_PLAINTEXT, MAX_BODY_CHARS, MAX_CONTENT_BYTES,
    MAX_LINK_PREVIEWS, MAX_MENTIONS,
};
pub use device::{
    plan_key_package_upload, GeneratedKeyPackage, KeyPackageStatus, UploadPlan,
    KEY_PACKAGE_LIFETIME_SECS, KEY_PACKAGE_LOW_WATER, KEY_PACKAGE_TARGET,
};
pub use error::{Error, Result};
pub use franking::{franking_commitment, franking_receipt, franking_receipt_input, ReceiptFacts};
pub use group::{
    AppliedCommit, ClaimedKeyPackage, CommitOutcome, DecryptExpectations, Decrypted,
    DecryptedMessage, EncryptedMessage, GroupStatus, Joined, OutgoingCommit, MAX_ENVELOPE_BYTES,
    MAX_HANDSHAKE_BYTES, MAX_PAST_EPOCHS,
};
pub use group_id::ConversationGroup;
pub use identity::{
    mls_key_payload, verify_leaf, verify_leaves, DeviceDirectory, DeviceRef, DeviceStatus, Leaf,
    LeafError, LeafIdentity, LeafProblem, MlsKeyStatement, SignedStatement, MLS_KEY_CONTEXT,
};
pub use ranking::{commit_delay, commit_rank, MAX_JITTER};
pub use readd::{may_honor_readd, ReaddRequest, READD_CONTEXT};
pub use storage::{Change, MemoryStore, Store};
#[cfg(feature = "sqlite")]
pub use storage::{SqliteStore, SCHEMA};

use provider::{with_crypto, Backend};

/// The cipher suite of every group: `MLS_128_MLKEM768X25519_AES128GCM_SHA256_Ed25519`.
pub(crate) const CIPHER_SUITE: Ciphersuite =
    Ciphersuite::MLS_128_MLKEM768X25519_AES128GCM_SHA256_Ed25519;

/// The cipher suite's code point, as `submitMlsCommit` and the server's suite lists carry it.
pub const CIPHER_SUITE_ID: u16 = 0x004F;

/// The MLS engine: a crypto backend. Its operations take the store they run on.
pub struct Mls {
    backend: Backend,
}

impl Mls {
    /// The libcrux-backed engine clients use.
    pub fn new() -> Result<Self> {
        let crypto = openmls_libcrux_crypto::CryptoProvider::new()
            .map_err(|e| Error::Crypto(format!("libcrux provider: {e:?}")))?;
        Ok(Self {
            backend: Backend::Libcrux(crypto),
        })
    }

    /// The RustCrypto-backed engine, for cross-provider tests.
    #[cfg(test)]
    pub(crate) fn rust_crypto() -> Self {
        Self {
            backend: Backend::RustCrypto(Box::default()),
        }
    }

    // ─── This device ─────────────────────────────────────────────────────────

    /// The `mls-key` statement payload for this device, for the device key to sign over
    /// [`MLS_KEY_CONTEXT`]. Generates the MLS signature key first if the device has none (or has
    /// one for another device id).
    pub fn mls_key_payload(
        &self,
        store: &impl Store,
        device: &DeviceRef,
        issued_at: &str,
    ) -> Result<String> {
        with_crypto!(&self.backend, |crypto| device::identity_payload(
            crypto,
            store.backend(),
            device,
            issued_at
        ))
    }

    /// Keep the signed `mls-key` statement, once it verifies under `device_key` (tagged text) and
    /// states this device's MLS key.
    pub fn install_mls_key_statement(
        &self,
        store: &impl Store,
        statement: SignedStatement,
        device_key: &str,
    ) -> Result<()> {
        device::install_statement(store.backend(), statement, device_key)
    }

    /// Make sure this device has an MLS key and a signed statement for it. `sign` receives the
    /// context bytes and the payload, and returns what the device key signed.
    pub fn ensure_identity(
        &self,
        store: &impl Store,
        device: &DeviceRef,
        device_key: &str,
        sign: impl FnOnce(&[u8], String) -> SignedStatement,
    ) -> Result<SignedStatement> {
        if let Some(statement) = device::statement(store.backend())? {
            let current = MlsKeyStatement::parse(&statement.payload).is_ok_and(|claim| {
                claim.principal_id == device.principal_id && claim.device_id == device.device_id
            });
            if current {
                return Ok(statement);
            }
        }
        let issued_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let payload = self.mls_key_payload(store, device, &issued_at)?;
        let statement = sign(MLS_KEY_CONTEXT, payload);
        self.install_mls_key_statement(store, statement.clone(), device_key)?;
        Ok(statement)
    }

    /// This device's signed `mls-key` statement, if it has one.
    pub fn mls_key_statement(&self, store: &impl Store) -> Result<Option<SignedStatement>> {
        device::statement(store.backend())
    }

    /// Forget this device's MLS key (lost state): the next payload request generates a new one.
    /// Group state is not touched; delete the groups as well.
    pub fn forget_identity(&self, store: &impl Store) -> Result<()> {
        device::forget_identity(store.backend())
    }

    // ─── Key packages ────────────────────────────────────────────────────────

    /// Generate `count` key packages to upload (last-resort ones when `last_resort`), valid from
    /// an hour before `now` (Unix seconds) for 90 days.
    pub fn generate_key_packages(
        &self,
        store: &impl Store,
        count: usize,
        last_resort: bool,
        now: u64,
    ) -> Result<Vec<GeneratedKeyPackage>> {
        with_crypto!(&self.backend, |crypto| device::generate_key_packages(
            crypto,
            store.backend(),
            count,
            last_resort,
            now,
            device::key_package_lifetime(now)
        ))
    }

    /// Delete private keys of key packages that expired or were replaced more than 7 days before
    /// `now`, and forget packages a Welcome used. Returns how many went.
    pub fn prune_key_packages(&self, store: &impl Store, now: u64) -> Result<usize> {
        device::prune_key_packages(store.backend(), now)
    }

    // ─── Groups ──────────────────────────────────────────────────────────────

    /// Create `group` at epoch 0 and stage its first Commit, adding the claimed devices.
    pub fn create_group(
        &self,
        store: &impl Store,
        group: ConversationGroup,
        adds: &[ClaimedKeyPackage],
    ) -> Result<OutgoingCommit> {
        with_crypto!(&self.backend, |crypto| group::create(
            crypto,
            store.backend(),
            group,
            adds
        ))
    }

    /// Stage one Commit with every pending change: devices to add (with their claimed key
    /// packages) and devices to remove. A re-add removes and adds the same device.
    pub fn commit(
        &self,
        store: &impl Store,
        group: ConversationGroup,
        adds: &[ClaimedKeyPackage],
        removes: &[DeviceRef],
    ) -> Result<OutgoingCommit> {
        with_crypto!(&self.backend, |crypto| group::commit(
            crypto,
            store.backend(),
            group,
            adds,
            removes
        ))
    }

    /// Stage an empty Commit with an update path.
    pub fn self_update(
        &self,
        store: &impl Store,
        group: ConversationGroup,
    ) -> Result<OutgoingCommit> {
        self.commit(store, group, &[], &[])
    }

    /// The server accepted this device's pending Commit: merge it. Returns the new epoch.
    pub fn commit_accepted(&self, store: &impl Store, group: ConversationGroup) -> Result<u64> {
        with_crypto!(&self.backend, |crypto| group::commit_accepted(
            crypto,
            store.backend(),
            group
        ))
    }

    /// The server refused this device's pending Commit (`STALE_EPOCH`): drop it. Then process the
    /// Commits that won and recompute what is still pending.
    pub fn commit_rejected(&self, store: &impl Store, group: ConversationGroup) -> Result<()> {
        with_crypto!(&self.backend, |crypto| group::commit_rejected(
            crypto,
            store.backend(),
            group
        ))
    }

    /// Process the Commit the server holds for the group's current epoch. This device's own
    /// pending Commit is recognized by its bytes and merged (the answer to a submit that got no
    /// reply); any other Commit clears the pending one first.
    pub fn process_commit(
        &self,
        store: &impl Store,
        group: ConversationGroup,
        commit: &[u8],
    ) -> Result<CommitOutcome> {
        with_crypto!(&self.backend, |crypto| group::process_commit(
            crypto,
            store.backend(),
            group,
            commit
        ))
    }

    /// Join `group` from a Welcome.
    pub fn join(
        &self,
        store: &impl Store,
        group: ConversationGroup,
        welcome: &[u8],
    ) -> Result<Joined> {
        with_crypto!(&self.backend, |crypto| group::join(
            crypto,
            store.backend(),
            group,
            welcome
        ))
    }

    /// Encrypt a message for `group` in its current epoch.
    pub fn encrypt(
        &self,
        store: &impl Store,
        group: ConversationGroup,
        content: &MessageContent,
    ) -> Result<EncryptedMessage> {
        with_crypto!(&self.backend, |crypto| group::encrypt(
            crypto,
            store.backend(),
            group,
            content
        ))
    }

    /// Encrypt `previous` again in the group's current epoch with the same content and franking
    /// key: the resend after `STALE_EPOCH`, once the newer Commits are processed.
    pub fn reencrypt(
        &self,
        store: &impl Store,
        previous: &EncryptedMessage,
    ) -> Result<EncryptedMessage> {
        with_crypto!(&self.backend, |crypto| group::reencrypt(
            crypto,
            store.backend(),
            previous
        ))
    }

    /// Decrypt an envelope from the change feed, once, and check it against its row.
    pub fn decrypt(
        &self,
        store: &impl Store,
        group: ConversationGroup,
        envelope: &[u8],
        expected: &DecryptExpectations,
    ) -> Result<Decrypted> {
        with_crypto!(&self.backend, |crypto| group::decrypt(
            crypto,
            store.backend(),
            group,
            envelope,
            expected
        ))
    }

    /// The group's epoch, and whether it waits for a Commit answer or a re-add.
    pub fn group_status(
        &self,
        store: &impl Store,
        group: ConversationGroup,
    ) -> Result<GroupStatus> {
        with_crypto!(&self.backend, |crypto| group::status(
            crypto,
            store.backend(),
            group
        ))
    }

    /// Every leaf of the group, to verify.
    pub fn leaves(&self, store: &impl Store, group: ConversationGroup) -> Result<Vec<Leaf>> {
        with_crypto!(&self.backend, |crypto| group::group_leaves(
            crypto,
            store.backend(),
            group
        ))
    }

    /// Delete the group's state on this device.
    pub fn delete_group(&self, store: &impl Store, group: ConversationGroup) -> Result<()> {
        with_crypto!(&self.backend, |crypto| group::delete(
            crypto,
            store.backend(),
            group
        ))
    }

    /// The re-add request to sign (over [`READD_CONTEXT`]) for a group this device cannot use:
    /// it names the last epoch the device processed, and the group's state is deleted.
    pub fn prepare_readd(
        &self,
        store: &impl Store,
        group: ConversationGroup,
    ) -> Result<ReaddRequest> {
        let identity = device::load_identity(store.backend())?;
        let last_epoch = match self.group_status(store, group) {
            Ok(status) => Some(status.awaiting_readd.unwrap_or(status.epoch)),
            Err(Error::NoGroup) => None,
            Err(e) => return Err(e),
        };
        self.delete_group(store, group)?;
        ReaddRequest::new(identity.device.clone(), group, last_epoch)
    }
}
