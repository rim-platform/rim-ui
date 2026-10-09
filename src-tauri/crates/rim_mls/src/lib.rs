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

mod codec;
mod device;
mod error;
mod group_id;
mod identity;
mod provider;
mod storage;

use openmls::prelude::Ciphersuite;

pub use device::{
    plan_key_package_upload, GeneratedKeyPackage, KeyPackageStatus, UploadPlan,
    KEY_PACKAGE_LIFETIME_SECS, KEY_PACKAGE_LOW_WATER, KEY_PACKAGE_TARGET,
};
pub use error::{Error, Result};
pub use group_id::ConversationGroup;
pub use identity::{
    mls_key_payload, verify_leaf, verify_leaves, DeviceDirectory, DeviceRef, DeviceStatus, Leaf,
    LeafError, LeafIdentity, LeafProblem, MlsKeyStatement, SignedStatement, MLS_KEY_CONTEXT,
};
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
    /// an hour before `now` (Unix seconds) for 30 days.
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
}
