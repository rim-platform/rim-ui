//! This device's MLS identity (its signature key and `mls-key` statement) and its key packages.

use openmls::prelude::tls_codec::Serialize as _;
use openmls::prelude::{
    BasicCredential, Capabilities, CredentialType, CredentialWithKey, ExtensionType, KeyPackage,
    Lifetime, MlsMessageOut, ProtocolVersion,
};
use openmls_traits::storage::StorageProvider as _;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::codec::{b64, unb64};
use crate::error::{Error, Result};
use crate::identity::{
    credential_identity, mls_key_payload, DeviceRef, MlsKeyStatement, SignedStatement,
};
use crate::provider::{signature_key_pair, Crypto, MlsSigner, Provider};
use crate::storage::{sealed::Backend, KvStorage, Records};
use crate::CIPHER_SUITE;

const DEVICE_LABEL: &str = "rim.device";
const DEVICE_KEY: &[u8] = b"self";
const KEY_PACKAGE_LABEL: &str = "rim.key_package";

/// One-time key packages a device keeps on the server.
pub const KEY_PACKAGE_TARGET: u32 = 20;
/// Below this many, a device tops up to [`KEY_PACKAGE_TARGET`].
pub const KEY_PACKAGE_LOW_WATER: u32 = 10;
/// A key package's lifetime.
pub const KEY_PACKAGE_LIFETIME_SECS: u64 = 30 * 24 * 60 * 60;
/// How far before now a key package's lifetime starts, for skewed clocks.
const KEY_PACKAGE_BACKDATE_SECS: u64 = 60 * 60;
const DAY_SECS: u64 = 24 * 60 * 60;

/// The device's MLS identity as stored with the group state.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub(crate) struct DeviceRecord {
    principal_id: String,
    device_id: String,
    /// The Ed25519 private key, base64url.
    private_key: String,
    /// The Ed25519 public key, base64url.
    public_key: String,
    #[zeroize(skip)]
    statement: Option<SignedStatement>,
}

/// This device's identity, loaded for an operation.
pub(crate) struct Identity {
    pub(crate) device: DeviceRef,
    pub(crate) private_key: Zeroizing<Vec<u8>>,
    pub(crate) public_key: Vec<u8>,
    pub(crate) statement: SignedStatement,
}

impl Identity {
    pub(crate) fn signer<'a, C: Crypto>(&self, crypto: &'a C) -> MlsSigner<'a, C> {
        MlsSigner::new(crypto, &self.private_key)
    }

    pub(crate) fn credential(&self) -> CredentialWithKey {
        CredentialWithKey {
            credential: BasicCredential::new(credential_identity(&self.statement)).into(),
            signature_key: self.public_key.clone().into(),
        }
    }
}

fn load_record(backend: &dyn Backend) -> Result<Option<DeviceRecord>> {
    Records::new(backend).get(DEVICE_LABEL, DEVICE_KEY)
}

/// The identity with its signed statement; `NoIdentity` until both exist.
pub(crate) fn load_identity(backend: &dyn Backend) -> Result<Identity> {
    let record = load_record(backend)?.ok_or(Error::NoIdentity)?;
    let statement = record.statement.clone().ok_or(Error::NoIdentity)?;
    Ok(Identity {
        device: DeviceRef {
            principal_id: record.principal_id.clone(),
            device_id: crate::codec::parse_uuid(&record.device_id, "stored device id")?,
        },
        private_key: Zeroizing::new(unb64(&record.private_key)?),
        public_key: unb64(&record.public_key)?,
        statement,
    })
}

/// The `mls-key` payload for this device's MLS key, generating the key first if the device has
/// none (or has one for another principal or device id).
pub(crate) fn identity_payload<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    device: &DeviceRef,
    issued_at: &str,
) -> Result<String> {
    let device_id = device.device_id.hyphenated().to_string();
    let record = match load_record(backend)? {
        Some(record)
            if record.principal_id == device.principal_id && record.device_id == device_id =>
        {
            record
        }
        _ => {
            let (private, public) = signature_key_pair(crypto)?;
            let record = DeviceRecord {
                principal_id: device.principal_id.clone(),
                device_id,
                private_key: b64(&private),
                public_key: b64(&public),
                statement: None,
            };
            Records::new(backend).put(DEVICE_LABEL, DEVICE_KEY, &record)?;
            record
        }
    };
    let public: [u8; 32] = unb64(&record.public_key)?
        .try_into()
        .map_err(|_| Error::Storage("the stored MLS key is not 32 bytes".into()))?;
    Ok(mls_key_payload(
        &device.principal_id,
        &device.device_id,
        &public,
        issued_at,
    ))
}

/// Keep `statement` once it verifies under `device_key` and states this device's MLS key.
pub(crate) fn install_statement(
    backend: &dyn Backend,
    statement: SignedStatement,
    device_key: &str,
) -> Result<()> {
    let mut record = load_record(backend)?.ok_or(Error::NoIdentity)?;
    let claim = MlsKeyStatement::verify(&statement, device_key)?;
    if claim.principal_id != record.principal_id
        || claim.device_id.hyphenated().to_string() != record.device_id
        || b64(&claim.mls_key) != record.public_key
    {
        return Err(Error::Invalid(
            "the mls-key statement is for another device or key".into(),
        ));
    }
    record.statement = Some(statement);
    Records::new(backend).put(DEVICE_LABEL, DEVICE_KEY, &record)
}

/// Use `seed` as this device's MLS signature key, for fixed test vectors.
#[cfg(test)]
pub(crate) fn install_fixed_key(
    backend: &dyn Backend,
    device: &DeviceRef,
    seed: &[u8; 32],
) -> Result<()> {
    let public = ed25519_dalek::SigningKey::from_bytes(seed).verifying_key();
    Records::new(backend).put(
        DEVICE_LABEL,
        DEVICE_KEY,
        &DeviceRecord {
            principal_id: device.principal_id.clone(),
            device_id: device.device_id.hyphenated().to_string(),
            private_key: b64(seed),
            public_key: b64(public.as_bytes()),
            statement: None,
        },
    )
}

/// Keep `statement` without checking it, to build devices that break the rules.
#[cfg(test)]
pub(crate) fn install_unchecked_statement(
    backend: &dyn Backend,
    statement: SignedStatement,
) -> Result<()> {
    let mut record = load_record(backend)?.ok_or(Error::NoIdentity)?;
    record.statement = Some(statement);
    Records::new(backend).put(DEVICE_LABEL, DEVICE_KEY, &record)
}

/// Forget the MLS identity, so the next payload request generates a new key.
pub(crate) fn forget_identity(backend: &dyn Backend) -> Result<()> {
    Records::new(backend).delete(DEVICE_LABEL, DEVICE_KEY)
}

pub(crate) fn statement(backend: &dyn Backend) -> Result<Option<SignedStatement>> {
    Ok(load_record(backend)?.and_then(|record| record.statement.clone()))
}

/// The capabilities every RIM leaf advertises: suite 0x004F, basic credentials, last-resort
/// key packages.
pub(crate) fn capabilities() -> Capabilities {
    Capabilities::builder()
        .versions(vec![ProtocolVersion::Mls10])
        .ciphersuites(vec![CIPHER_SUITE])
        .credentials(vec![CredentialType::Basic])
        .extensions(vec![ExtensionType::LastResort])
        .build()
}

/// A key package ready to upload.
#[derive(Debug, Clone)]
pub struct GeneratedKeyPackage {
    /// The `MLSMessage` carrying the key package.
    pub message: Vec<u8>,
    /// Its `KeyPackageRef` (32 bytes for this suite).
    pub key_package_ref: Vec<u8>,
    pub last_resort: bool,
    /// Unix seconds.
    pub not_after: u64,
}

/// What this device keeps about a key package it generated, beside OpenMLS's private keys.
#[derive(Serialize, Deserialize)]
struct KeyPackageRecord {
    /// OpenMLS's `KeyPackageRef` as its storage spells it, to delete the private keys by.
    hash_ref: serde_json::Value,
    last_resort: bool,
    created_at: u64,
    not_after: u64,
    replaced_at: Option<u64>,
}

/// The lifetime of key packages generated at `now` (Unix seconds): from an hour before it, for
/// [`KEY_PACKAGE_LIFETIME_SECS`].
pub(crate) fn key_package_lifetime(now: u64) -> (u64, u64) {
    (
        now.saturating_sub(KEY_PACKAGE_BACKDATE_SECS),
        now + KEY_PACKAGE_LIFETIME_SECS,
    )
}

/// Generate `count` key packages valid over `lifetime` (`not_before`, `not_after`, Unix
/// seconds). A new last-resort package marks the previous one replaced at `now`.
pub(crate) fn generate_key_packages<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    count: usize,
    last_resort: bool,
    now: u64,
    (not_before, not_after): (u64, u64),
) -> Result<Vec<GeneratedKeyPackage>> {
    let identity = load_identity(backend)?;
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let signer = identity.signer(crypto);
    let records = Records::new(backend);
    if last_resort {
        for (key, mut record) in records.list::<KeyPackageRecord>(KEY_PACKAGE_LABEL)? {
            if record.last_resort && record.replaced_at.is_none() {
                record.replaced_at = Some(now);
                records.put(KEY_PACKAGE_LABEL, &key, &record)?;
            }
        }
    }
    let mut generated = Vec::with_capacity(count);
    for _ in 0..count {
        let mut builder = KeyPackage::builder()
            .key_package_lifetime(Lifetime::init(not_before, not_after))
            .leaf_node_capabilities(capabilities());
        if last_resort {
            builder = builder.mark_as_last_resort();
        }
        let bundle = builder
            .build(CIPHER_SUITE, &provider, &signer, identity.credential())
            .map_err(Error::mls)?;
        let key_package = bundle.key_package().clone();
        let hash_ref = key_package.hash_ref(crypto).map_err(Error::mls)?;
        let key_package_ref = hash_ref.as_slice().to_vec();
        records.put(
            KEY_PACKAGE_LABEL,
            &key_package_ref,
            &KeyPackageRecord {
                hash_ref: serde_json::to_value(&hash_ref)
                    .map_err(|e| Error::Storage(e.to_string()))?,
                last_resort,
                created_at: now,
                not_after,
                replaced_at: None,
            },
        )?;
        let message = MlsMessageOut::from(key_package)
            .tls_serialize_detached()
            .map_err(Error::mls)?;
        generated.push(GeneratedKeyPackage {
            message,
            key_package_ref,
            last_resort,
            not_after,
        });
    }
    Ok(generated)
}

/// The server's account of this device's key packages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KeyPackageStatus {
    /// Unclaimed one-time packages on the server.
    pub available: u32,
    /// When the current last-resort package expires (Unix seconds); `None` without one.
    pub last_resort_not_after: Option<u64>,
    /// How often the current last-resort package was handed out, when known.
    pub last_resort_claims: Option<u32>,
}

/// What to upload now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadPlan {
    pub one_time: usize,
    pub last_resort: bool,
}

/// Top up to 20 one-time packages when fewer than 10 remain; a new last-resort package when the
/// current one expires within 7 days or was claimed more than 5 times.
pub fn plan_key_package_upload(status: &KeyPackageStatus, now: u64) -> UploadPlan {
    let one_time = if status.available < KEY_PACKAGE_LOW_WATER {
        (KEY_PACKAGE_TARGET - status.available) as usize
    } else {
        0
    };
    let last_resort = status
        .last_resort_not_after
        .is_none_or(|not_after| not_after <= now + 7 * DAY_SECS)
        || status.last_resort_claims.is_some_and(|claims| claims > 5);
    UploadPlan {
        one_time,
        last_resort,
    }
}

/// Delete the private keys of key packages that expired, or were replaced, more than 7 days
/// before `now`, and forget packages a Welcome already used. Returns how many were deleted.
pub(crate) fn prune_key_packages(backend: &dyn Backend, now: u64) -> Result<usize> {
    let records = Records::new(backend);
    let storage = KvStorage::new(backend);
    let mut pruned = 0;
    for (key, record) in records.list::<KeyPackageRecord>(KEY_PACKAGE_LABEL)? {
        let hash_ref: openmls::prelude::KeyPackageRef =
            serde_json::from_value(record.hash_ref.clone())
                .map_err(|e| Error::Storage(format!("{KEY_PACKAGE_LABEL}: {e}")))?;
        let used = storage
            .key_package::<_, openmls::prelude::KeyPackageBundle>(&hash_ref)?
            .is_none();
        let stale = |at: u64| at + 7 * DAY_SECS < now;
        if used || stale(record.not_after) || record.replaced_at.is_some_and(stale) {
            storage.delete_key_package(&hash_ref)?;
            records.delete(KEY_PACKAGE_LABEL, &key)?;
            pruned += 1;
        }
    }
    Ok(pruned)
}
