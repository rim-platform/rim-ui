//! Signed statements of key identity (`rim-server/docs/specs/key-identity-v1.md`): building
//! and signing the payloads this device sends, and replaying a key log the server returns.
//!
//! This device writes statement version 2, where every key and signature names its algorithm
//! (`ed25519:<base64url>`), and reads versions 1 and 2. This is the only module that knows
//! what is inside a key or a signature: everywhere else they are opaque strings, so a hybrid
//! (post-quantum) algorithm can be added here alone.
//!
//! A payload is the exact JSON text that was signed; nothing here re-serializes a payload it
//! did not build. Fields are written in the spec's order so the known-answer vectors match
//! byte for byte.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::KeyIdentityError;

/// Context bytes that prefix every signed payload, one per purpose.
pub(crate) mod context {
    pub(crate) const KEY_LOG: &[u8] = b"rim.keylog.v1\0";
    pub(crate) const DEVICE: &[u8] = b"rim.device.v1\0";
    pub(crate) const DEVICE_REVOKE: &[u8] = b"rim.device-revoke.v1\0";
    pub(crate) const PROFILE_CARD: &[u8] = b"rim.profile-card.v1\0";
    pub(crate) const LOGIN: &[u8] = b"rim.login.v1\0";
}

const PRINCIPAL_DOMAIN: &[u8] = b"rim.principal.v1\0";
pub(crate) const PRINCIPAL_PREFIX: &str = "rimp1_";

/// The statement format version this device writes.
pub(crate) const WRITE_VERSION: u8 = 2;

/// A statement as it travels: the signed JSON text and its signature, spelled as the payload's
/// version requires.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Statement {
    pub(crate) payload: String,
    pub(crate) signature: String,
}

/// An Ed25519 secret key seed, wiped on drop. Only this module and the recovery kit see raw
/// seeds; everything else holds a [`SecretKey`].
pub(crate) type Seed = Zeroizing<[u8; 32]>;

/// The one algorithm implemented today.
const ED25519: &str = "ed25519";
/// Tag of an Ed25519 key or signature, in statements and in stored secrets alike.
const ED25519_TAG: &str = "ed25519:";

/// A signing key of this device. Opaque outside this module: callers generate, store, load and
/// sign with it, and read its public key as an opaque string.
#[derive(Clone)]
pub(crate) struct SecretKey {
    seed: Seed,
}

impl SecretKey {
    /// A fresh random key from the OS.
    pub(crate) fn generate() -> Result<Self, KeyIdentityError> {
        let mut seed = Zeroizing::new([0u8; 32]);
        getrandom::fill(seed.as_mut())
            .map_err(|e| KeyIdentityError::Crypto(format!("random generation failed: {e}")))?;
        Ok(Self { seed })
    }

    pub(crate) fn from_seed(seed: Seed) -> Self {
        Self { seed }
    }

    /// The raw seed, for writing a version 1 recovery kit in tests; this device no longer
    /// writes one.
    #[cfg(test)]
    pub(crate) fn seed(&self) -> &[u8; 32] {
        &self.seed
    }

    /// The public key in its canonical, tagged text (`ed25519:<base64url>`), as version 2
    /// statements carry it and servers return it.
    pub(crate) fn public_key(&self) -> String {
        let key = SigningKey::from_bytes(&self.seed).verifying_key();
        format!("{ED25519_TAG}{}", b64(key.as_bytes()))
    }

    /// The key as stored in the keyring: its algorithm tag and its secret.
    pub(crate) fn to_text(&self) -> Zeroizing<String> {
        let encoded = Zeroizing::new(b64(self.seed.as_ref()));
        Zeroizing::new(format!("{ED25519_TAG}{}", encoded.as_str()))
    }

    pub(crate) fn from_text(text: &str) -> Result<Self, KeyIdentityError> {
        let encoded = text.strip_prefix(ED25519_TAG).ok_or_else(|| {
            KeyIdentityError::Invalid("stored key has an unknown algorithm".into())
        })?;
        let bytes = Zeroizing::new(unb64(encoded)?);
        if bytes.len() != 32 {
            return Err(KeyIdentityError::Invalid("stored key is malformed".into()));
        }
        let mut seed = Zeroizing::new([0u8; 32]);
        seed.copy_from_slice(&bytes);
        Ok(Self { seed })
    }

    /// Sign `payload` for `context`, with a version 2 (tagged) signature.
    pub(crate) fn sign(&self, context: &[u8], payload: String) -> Statement {
        let key = SigningKey::from_bytes(&self.seed);
        let signature = key.sign(&signed_bytes(context, &payload));
        Statement {
            payload,
            signature: format!("{ED25519_TAG}{}", b64(&signature.to_bytes())),
        }
    }
}

impl PartialEq for SecretKey {
    fn eq(&self, other: &Self) -> bool {
        *self.seed == *other.seed
    }
}

pub(crate) fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn unb64(text: &str) -> Result<Vec<u8>, KeyIdentityError> {
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| KeyIdentityError::Invalid("not unpadded base64url".into()))
}

fn signed_bytes(context: &[u8], payload: &str) -> Vec<u8> {
    let mut message = Vec::with_capacity(context.len() + payload.len());
    message.extend_from_slice(context);
    message.extend_from_slice(payload.as_bytes());
    message
}

/// A key or signature split into its algorithm and bytes. Version 1 spells bare base64url
/// (Ed25519 implied); version 2 spells `<algorithm>:<base64url>`, where the algorithm is 1 to 32
/// characters of `a-z`, `0-9` and `-`. Any other version is refused.
fn split_tagged(text: &str, version: u8) -> Result<(&str, Vec<u8>), KeyIdentityError> {
    let malformed = || KeyIdentityError::Invalid("a key or signature is malformed".into());
    match version {
        1 => Ok((ED25519, unb64(text).map_err(|_| malformed())?)),
        2 => {
            let (algorithm, encoded) = text.split_once(':').ok_or_else(malformed)?;
            let well_formed = (1..=32).contains(&algorithm.len())
                && algorithm
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !well_formed {
                return Err(malformed());
            }
            Ok((algorithm, unb64(encoded).map_err(|_| malformed())?))
        }
        v => Err(KeyIdentityError::Invalid(format!(
            "statement version {v} is not supported"
        ))),
    }
}

/// A key as `version` spells it, in canonical tagged text. The algorithm stays opaque here: an
/// algorithm this device cannot sign or verify with still has a canonical text.
pub(crate) fn canonical_key(text: &str, version: u8) -> Result<String, KeyIdentityError> {
    let (algorithm, bytes) = split_tagged(text, version)?;
    Ok(format!("{algorithm}:{}", b64(&bytes)))
}

/// Whether `statement`, a statement of `version`, is signed by `public_key` (canonical tagged
/// text) for `context`. A signature only verifies under a key of its own algorithm. Strict:
/// weak keys and malleable signatures fail, as on the server.
pub(crate) fn verify(statement: &Statement, context: &[u8], public_key: &str, version: u8) -> bool {
    let (Ok((key_algorithm, key_bytes)), Ok((sig_algorithm, sig_bytes))) = (
        split_tagged(public_key, 2),
        split_tagged(&statement.signature, version),
    ) else {
        return false;
    };
    if key_algorithm != sig_algorithm || key_algorithm != ED25519 {
        return false;
    }
    let (Ok(key_bytes), Ok(sig_bytes)) = (
        <[u8; 32]>::try_from(key_bytes),
        <[u8; 64]>::try_from(sig_bytes),
    ) else {
        return false;
    };
    let Ok(key) = VerifyingKey::from_bytes(&key_bytes) else {
        return false;
    };
    if key.is_weak() {
        return false;
    }
    key.verify_strict(
        &signed_bytes(context, &statement.payload),
        &Signature::from_bytes(&sig_bytes),
    )
    .is_ok()
}

/// A device key another device offers to be certified (device linking): version 2 tagged text,
/// spelled canonically, of an algorithm this device can verify, and not a weak key. Returns it
/// unchanged.
pub(crate) fn usable_device_key(text: &str) -> Result<String, KeyIdentityError> {
    let refused = || {
        KeyIdentityError::Invalid(
            "the new device's key is malformed or of a kind this app cannot check".into(),
        )
    };
    let (algorithm, bytes) = split_tagged(text, WRITE_VERSION).map_err(|_| refused())?;
    if algorithm != ED25519 {
        return Err(refused());
    }
    let bytes = <[u8; 32]>::try_from(bytes).map_err(|_| refused())?;
    let key = VerifyingKey::from_bytes(&bytes).map_err(|_| refused())?;
    if key.is_weak() || format!("{ED25519_TAG}{}", b64(&bytes)) != text {
        return Err(refused());
    }
    Ok(text.to_string())
}

/// base64url(SHA-256(bytes)), the `prev` link of a rotation.
pub(crate) fn payload_hash(payload: &str) -> String {
    b64(&Sha256::digest(payload.as_bytes()))
}

/// The principal id an inception payload fixes forever.
pub(crate) fn principal_id(inception_payload: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(PRINCIPAL_DOMAIN);
    hasher.update(inception_payload.as_bytes());
    format!("{PRINCIPAL_PREFIX}{}", b64(&hasher.finalize()))
}

/// The current time as the statements write it (RFC 3339, whole seconds, `Z`). Informational
/// only: servers never trust it.
pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ─── Payloads, fields in the spec's order ────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Inception<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    seq: u32,
    identity_key: &'a str,
    recovery_key: &'a str,
    created_at: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Rotation<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    principal_id: &'a str,
    seq: u32,
    prev: &'a str,
    identity_key: &'a str,
    recovery_key: &'a str,
    signer: &'a str,
    created_at: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceCert<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    principal_id: &'a str,
    device_id: &'a str,
    device_key: &'a str,
    name: &'a str,
    key_seq: u32,
    issued_at: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Revocation<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    principal_id: &'a str,
    device_id: &'a str,
    signer: &'a str,
    issued_at: &'a str,
}

/// A device as a profile card lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardDevice {
    pub(crate) device_id: String,
    pub(crate) device_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileCard<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    principal_id: &'a str,
    version: u32,
    key_seq: u32,
    display_name: &'a str,
    relays: &'a [String],
    devices: &'a [CardDevice],
    issued_at: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Login<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    challenge_id: &'a str,
    nonce: &'a str,
    audience: &'a str,
    principal_id: &'a str,
    device_id: &'a str,
}

fn json<T: Serialize>(value: &T) -> String {
    // Serializing these plain structs cannot fail.
    serde_json::to_string(value).unwrap_or_default()
}

/// The inception entry, signed by its own identity key.
pub(crate) fn inception(identity: &SecretKey, recovery_key: &str, created_at: &str) -> Statement {
    let payload = json(&Inception {
        v: WRITE_VERSION,
        kind: "inception",
        seq: 0,
        identity_key: &identity.public_key(),
        recovery_key,
        created_at,
    });
    identity.sign(context::KEY_LOG, payload)
}

/// Who signs a rotation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RotationSigner {
    Identity,
    Recovery,
}

/// A rotation extending `head` to `new_identity_key`, keeping the recovery key. Signed by the
/// current identity key or by the recovery key, as `signer` says.
pub(crate) fn rotation(
    head: &KeyHead,
    signer: RotationSigner,
    signing_seed: &SecretKey,
    new_identity_key: &str,
    created_at: &str,
) -> Statement {
    let payload = json(&Rotation {
        v: WRITE_VERSION,
        kind: "rotate",
        principal_id: &head.principal_id,
        seq: head.seq + 1,
        prev: &head.hash,
        identity_key: new_identity_key,
        recovery_key: &head.recovery_key,
        signer: match signer {
            RotationSigner::Identity => "identity",
            RotationSigner::Recovery => "recovery",
        },
        created_at,
    });
    signing_seed.sign(context::KEY_LOG, payload)
}

/// A device certificate, signed by the identity key at `key_seq`.
pub(crate) struct DeviceCertInput<'a> {
    pub(crate) principal_id: &'a str,
    pub(crate) device_id: &'a str,
    pub(crate) device_key: &'a str,
    pub(crate) name: &'a str,
    pub(crate) key_seq: u32,
    pub(crate) issued_at: &'a str,
}

pub(crate) fn device_cert(identity: &SecretKey, input: &DeviceCertInput<'_>) -> Statement {
    let payload = json(&DeviceCert {
        v: WRITE_VERSION,
        kind: "device",
        principal_id: input.principal_id,
        device_id: input.device_id,
        device_key: input.device_key,
        name: input.name,
        key_seq: input.key_seq,
        issued_at: input.issued_at,
    });
    identity.sign(context::DEVICE, payload)
}

/// A device revocation. `by_device` means the revoked device signs its own retirement.
pub(crate) fn revocation(
    seed: &SecretKey,
    by_device: bool,
    principal_id: &str,
    device_id: &str,
    issued_at: &str,
) -> Statement {
    let payload = json(&Revocation {
        v: WRITE_VERSION,
        kind: "device-revoke",
        principal_id,
        device_id,
        signer: if by_device { "device" } else { "identity" },
        issued_at,
    });
    seed.sign(context::DEVICE_REVOKE, payload)
}

pub(crate) struct ProfileCardInput<'a> {
    pub(crate) principal_id: &'a str,
    pub(crate) version: u32,
    pub(crate) key_seq: u32,
    pub(crate) display_name: &'a str,
    pub(crate) relays: &'a [String],
    pub(crate) devices: &'a [CardDevice],
    pub(crate) issued_at: &'a str,
}

pub(crate) fn profile_card(identity: &SecretKey, input: &ProfileCardInput<'_>) -> Statement {
    let payload = json(&ProfileCard {
        v: WRITE_VERSION,
        kind: "profile-card",
        principal_id: input.principal_id,
        version: input.version,
        key_seq: input.key_seq,
        display_name: input.display_name,
        relays: input.relays,
        devices: input.devices,
        issued_at: input.issued_at,
    });
    identity.sign(context::PROFILE_CARD, payload)
}

pub(crate) struct LoginInput<'a> {
    pub(crate) challenge_id: &'a str,
    pub(crate) nonce: &'a str,
    pub(crate) audience: &'a str,
    pub(crate) principal_id: &'a str,
    pub(crate) device_id: &'a str,
}

pub(crate) fn login(device: &SecretKey, input: &LoginInput<'_>) -> Statement {
    let payload = json(&Login {
        v: WRITE_VERSION,
        kind: "login",
        challenge_id: input.challenge_id,
        nonce: input.nonce,
        audience: input.audience,
        principal_id: input.principal_id,
        device_id: input.device_id,
    });
    device.sign(context::LOGIN, payload)
}

// ─── Replaying a key log ─────────────────────────────────────────────────────

/// Where a verified key log ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyHead {
    pub(crate) principal_id: String,
    pub(crate) seq: u32,
    pub(crate) identity_key: String,
    pub(crate) recovery_key: String,
    /// `prev` for the next rotation: base64url(SHA-256(head payload)).
    pub(crate) hash: String,
    /// The identity key at every seq, oldest first, to check device certificates against.
    pub(crate) identity_keys: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    seq: u32,
    principal_id: Option<String>,
    prev: Option<String>,
    identity_key: String,
    recovery_key: String,
    signer: Option<String>,
}

fn invalid(message: impl Into<String>) -> KeyIdentityError {
    KeyIdentityError::Invalid(format!("key log: {}", message.into()))
}

/// Verify a key log from its inception, as the server does, and return its head. The client
/// signs rotations and certificates against this head, so a log the server answers with is
/// never trusted unchecked. Entries may be version 1 or 2, and a log never goes back from 2 to 1;
/// the head's keys are in canonical tagged text whichever version spelled them.
pub(crate) fn replay(log: &[Statement]) -> Result<KeyHead, KeyIdentityError> {
    let (first, rest) = log.split_first().ok_or_else(|| invalid("empty"))?;
    let entry: LogEntry =
        serde_json::from_str(&first.payload).map_err(|e| invalid(format!("entry 0: {e}")))?;
    let identity_key = canonical_key(&entry.identity_key, entry.v).map_err(log_error)?;
    let recovery_key = canonical_key(&entry.recovery_key, entry.v).map_err(log_error)?;
    if entry.kind != "inception" || entry.seq != 0 {
        return Err(invalid("entry 0 is not an inception"));
    }
    if !verify(first, context::KEY_LOG, &identity_key, entry.v) {
        return Err(invalid("inception signature does not verify"));
    }
    let mut version = entry.v;
    let mut head = KeyHead {
        principal_id: principal_id(&first.payload),
        seq: 0,
        identity_keys: vec![identity_key.clone()],
        identity_key,
        recovery_key,
        hash: payload_hash(&first.payload),
    };
    for statement in rest {
        let at = head.seq + 1;
        let entry: LogEntry = serde_json::from_str(&statement.payload)
            .map_err(|e| invalid(format!("entry {at}: {e}")))?;
        let identity_key = canonical_key(&entry.identity_key, entry.v).map_err(log_error)?;
        let recovery_key = canonical_key(&entry.recovery_key, entry.v).map_err(log_error)?;
        if entry.v < version {
            return Err(invalid(format!(
                "entry {at} goes back to statement version {}",
                entry.v
            )));
        }
        if entry.kind != "rotate" {
            return Err(invalid(format!("entry {at} is not a rotation")));
        }
        if entry.principal_id.as_deref() != Some(head.principal_id.as_str())
            || entry.seq != at
            || entry.prev.as_deref() != Some(head.hash.as_str())
        {
            return Err(invalid(format!("entry {at} does not extend the log")));
        }
        if identity_key == head.identity_key {
            return Err(invalid("a rotation must change the identity key"));
        }
        let signer_key = match entry.signer.as_deref() {
            Some("identity") if recovery_key == head.recovery_key => &head.identity_key,
            Some("identity") => return Err(invalid("only recovery may change the recovery key")),
            Some("recovery") => &head.recovery_key,
            _ => return Err(invalid("unknown rotation signer")),
        };
        if !verify(statement, context::KEY_LOG, signer_key, entry.v) {
            return Err(invalid(format!("entry {at} signature does not verify")));
        }
        version = entry.v;
        let mut identity_keys = head.identity_keys;
        identity_keys.push(identity_key.clone());
        head = KeyHead {
            principal_id: head.principal_id,
            seq: entry.seq,
            identity_key,
            recovery_key,
            hash: payload_hash(&statement.payload),
            identity_keys,
        };
    }
    Ok(head)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    principal_id: String,
    device_id: String,
    device_key: String,
    name: String,
    key_seq: u32,
}

/// What a device certificate says, read before it is verified: which account's log to verify
/// it against, and whether it names the device it was asked for. Never trusted on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CertificateClaim {
    pub(crate) principal_id: String,
    pub(crate) device_id: String,
    /// Canonical tagged text.
    pub(crate) device_key: String,
    pub(crate) name: String,
}

pub(crate) fn certificate_claim(
    certificate: &Statement,
) -> Result<CertificateClaim, KeyIdentityError> {
    let refused = || KeyIdentityError::Invalid("not a device certificate".into());
    let entry: CertEntry = serde_json::from_str(&certificate.payload).map_err(|_| refused())?;
    if entry.kind != "device" {
        return Err(refused());
    }
    Ok(CertificateClaim {
        device_key: canonical_key(&entry.device_key, entry.v).map_err(|_| refused())?,
        principal_id: entry.principal_id,
        device_id: entry.device_id,
        name: entry.name,
    })
}

/// The device a certificate vouches for, once the certificate verifies against the log: it
/// names this log's principal and is signed by the identity key at its `keySeq`. A profile
/// card lists only devices that pass, so a server cannot slip a key of its own into the card
/// the identity key signs.
pub(crate) fn certified_device(
    certificate: &Statement,
    head: &KeyHead,
) -> Result<CardDevice, KeyIdentityError> {
    let refused = || KeyIdentityError::Invalid("a device certificate does not verify".into());
    let entry: CertEntry = serde_json::from_str(&certificate.payload).map_err(|_| refused())?;
    if entry.kind != "device" || entry.principal_id != head.principal_id {
        return Err(refused());
    }
    let signer = head
        .identity_keys
        .get(entry.key_seq as usize)
        .ok_or_else(refused)?;
    if !verify(certificate, context::DEVICE, signer, entry.v) {
        return Err(refused());
    }
    Ok(CardDevice {
        device_key: canonical_key(&entry.device_key, entry.v)?,
        device_id: entry.device_id,
    })
}

fn log_error(error: KeyIdentityError) -> KeyIdentityError {
    match error {
        KeyIdentityError::Invalid(message) => invalid(message),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u8) -> SecretKey {
        SecretKey::from_seed(Zeroizing::new([n; 32]))
    }

    fn statement(payload: &str, signature: &str) -> Statement {
        Statement {
            payload: payload.into(),
            signature: signature.into(),
        }
    }

    // Known-answer vectors from key-identity-v1.md, appendix B (version 2).
    const IDENTITY: &str = "ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w";
    const RECOVERY: &str = "ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg";
    const DEVICE: &str = "ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc";
    const PRINCIPAL: &str = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";
    const INCEPTION: &str = r#"{"v":2,"type":"inception","seq":0,"identityKey":"ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}"#;
    const INCEPTION_SIG: &str = "ed25519:kGvSf1hR28cdKP2Smwmy2BHEdP7wmKwy0At-DtrUs8mYhfzF0jjHTjpeX4DAzXv5HuCVwFEYWM1DjN-6wkU2Ag";
    const DEVICE_CERT: &str = r#"{"v":2,"type":"device","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}"#;
    const DEVICE_CERT_SIG: &str = "ed25519:0HjRzn6gQ2q-vCHSkdOPK2ykGGBUpW2fYdDuEdTzf6OxsWzjXeNNpRSVgzPxOEfbYzZ9o9DWqp4NxcTEDhOaDA";
    const LOGIN_PROOF: &str = r#"{"v":2,"type":"login","challengeId":"00000000-0000-0000-0000-000000000009","nonce":"bm9uY2U","audience":"localhost:8080","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001"}"#;
    const LOGIN_SIG: &str = "ed25519:3FSH7M9uz0sP42GA0gKPso6JmGSx32Y1WZ-oKBW0VcVWANGEEjkDjaEtDpHNIjdEgC5fFA2jbfzSmuzhW7k1Dg";
    const DEVICE_ID: &str = "00000000-0000-0000-0000-000000000001";
    const AT: &str = "2026-10-09T00:00:00Z";

    // Appendix A (version 1): written by older clients, still read.
    const V1_PRINCIPAL: &str = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
    const V1_PREV: &str = "o1oFYkMXfjtQJnG6as5GURR0cnzeYNYv5Br-LaeI78I";
    const V1_INCEPTION: &str = r#"{"v":1,"type":"inception","seq":0,"identityKey":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}"#;
    const V1_INCEPTION_SIG: &str =
        "vf3zjxbHUJ8l9Oe6ayFGZZszVH1c_FVgO04F_4PqkfsYu9h8jAgbPKhAIAYHlQxg-7yAO5w1OEMmcAGcXptVDQ";
    const V1_DEVICE_CERT: &str = r#"{"v":1,"type":"device","principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}"#;
    const V1_DEVICE_CERT_SIG: &str =
        "tt6UNl3tRCwupWIYEfnWzqW9qVqDsJju2dA7d2CdNqdIZ0piVeP_Q6Y1lLfA4YN-26tsdaFea-rM_I8Qy9H6Cg";
    // Appendix B's mixed log: the version 1 inception, then a version 2 identity rotation.
    const MIXED_ROTATION: &str = r#"{"v":2,"type":"rotate","principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","seq":1,"prev":"o1oFYkMXfjtQJnG6as5GURR0cnzeYNYv5Br-LaeI78I","identityKey":"ed25519:gTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","signer":"identity","createdAt":"2026-10-09T00:00:00Z"}"#;
    const MIXED_ROTATION_SIG: &str = "ed25519:D2moo9U9OjVL9zed4lM0A5cHoGQOVEtUfgKfAmOn0P18x74NEbh4FL4f3PbulQzoVuGAGOEJUZq3R2ZNpeUdCg";

    #[test]
    fn known_answer_vectors_match_the_spec() {
        let (identity, recovery, device) = (key(1), key(101), key(20));
        assert_eq!(identity.public_key(), IDENTITY);
        assert_eq!(recovery.public_key(), RECOVERY);
        assert_eq!(device.public_key(), DEVICE);

        let inception = inception(&identity, RECOVERY, AT);
        assert_eq!(inception.payload, INCEPTION);
        assert_eq!(inception.signature, INCEPTION_SIG);
        assert_eq!(principal_id(INCEPTION), PRINCIPAL);

        let cert = device_cert(
            &identity,
            &DeviceCertInput {
                principal_id: PRINCIPAL,
                device_id: DEVICE_ID,
                device_key: DEVICE,
                name: "Laptop",
                key_seq: 0,
                issued_at: AT,
            },
        );
        assert_eq!(cert.payload, DEVICE_CERT);
        assert_eq!(cert.signature, DEVICE_CERT_SIG);

        let proof = login(
            &device,
            &LoginInput {
                challenge_id: "00000000-0000-0000-0000-000000000009",
                nonce: "bm9uY2U",
                audience: "localhost:8080",
                principal_id: PRINCIPAL,
                device_id: DEVICE_ID,
            },
        );
        assert_eq!(proof.payload, LOGIN_PROOF);
        assert_eq!(proof.signature, LOGIN_SIG);
    }

    #[test]
    fn a_version_1_log_is_read_and_extended_in_version_2() {
        let v1 = statement(V1_INCEPTION, V1_INCEPTION_SIG);
        let head = replay(std::slice::from_ref(&v1)).unwrap();
        assert_eq!(head.principal_id, V1_PRINCIPAL);
        assert_eq!(head.hash, V1_PREV);
        // The head's keys are canonical whichever version spelled them.
        assert_eq!(head.identity_key, IDENTITY);
        assert_eq!(head.recovery_key, RECOVERY);

        // This device's rotation of it matches the spec's mixed log byte for byte.
        let rotation = rotation(
            &head,
            RotationSigner::Identity,
            &key(1),
            &key(2).public_key(),
            AT,
        );
        assert_eq!(rotation.payload, MIXED_ROTATION);
        assert_eq!(rotation.signature, MIXED_ROTATION_SIG);
        let head = replay(&[v1, rotation]).unwrap();
        assert_eq!(head.principal_id, V1_PRINCIPAL);
        assert_eq!(head.identity_key, key(2).public_key());
        assert_eq!(
            head.identity_keys,
            vec![IDENTITY.to_string(), key(2).public_key()]
        );
    }

    #[test]
    fn a_log_never_goes_back_to_version_1() {
        let first = inception(&key(1), RECOVERY, AT);
        let head = replay(std::slice::from_ref(&first)).unwrap();
        let payload = format!(
            r#"{{"v":1,"type":"rotate","principalId":"{}","seq":1,"prev":"{}","identityKey":"{}","recoveryKey":"{}","signer":"identity","createdAt":"{AT}"}}"#,
            head.principal_id,
            head.hash,
            key(2).public_key().trim_start_matches(ED25519_TAG),
            RECOVERY.trim_start_matches(ED25519_TAG),
        );
        let mut v1_rotation = key(1).sign(context::KEY_LOG, payload);
        v1_rotation.signature = v1_rotation.signature.replace(ED25519_TAG, "");
        let err = replay(&[first, v1_rotation]).unwrap_err().to_string();
        assert!(err.contains("goes back to statement version 1"), "{err}");
    }

    #[test]
    fn replay_refuses_unknown_versions_and_wrong_spellings() {
        let v3 = key(1).sign(context::KEY_LOG, INCEPTION.replace(r#""v":2"#, r#""v":3"#));
        let err = replay(&[v3]).unwrap_err().to_string();
        assert!(
            err.contains("statement version 3 is not supported"),
            "{err}"
        );
        // A version 2 key without its tag, and a version 1 signature with one.
        let untagged = INCEPTION.replace(IDENTITY, IDENTITY.trim_start_matches(ED25519_TAG));
        assert!(replay(&[key(1).sign(context::KEY_LOG, untagged)]).is_err());
        assert!(replay(&[statement(
            V1_INCEPTION,
            &format!("{ED25519_TAG}{V1_INCEPTION_SIG}")
        )])
        .is_err());
    }

    #[test]
    fn verify_binds_the_context_the_key_and_the_algorithm() {
        let statement = key(1).sign(context::LOGIN, "{}".into());
        assert!(verify(&statement, context::LOGIN, IDENTITY, 2));
        assert!(!verify(&statement, context::DEVICE, IDENTITY, 2));
        assert!(!verify(&statement, context::LOGIN, RECOVERY, 2));
        assert!(!verify(&statement, context::LOGIN, "not a key", 2));
        // The same signature under another algorithm's name is not a signature of the key.
        let renamed = Statement {
            signature: statement.signature.replace("ed25519:", "ed25519-mldsa44:"),
            ..statement.clone()
        };
        assert!(!verify(&renamed, context::LOGIN, IDENTITY, 2));
        let tampered = Statement {
            payload: "{ }".into(),
            ..statement
        };
        assert!(!verify(&tampered, context::LOGIN, IDENTITY, 2));
    }

    fn rotated(signer: RotationSigner, seed: &SecretKey, next: &SecretKey) -> Vec<Statement> {
        let first = inception(&key(1), RECOVERY, AT);
        let head = replay(std::slice::from_ref(&first)).unwrap();
        let second = rotation(&head, signer, seed, &next.public_key(), AT);
        vec![first, second]
    }

    #[test]
    fn replay_follows_identity_and_recovery_rotations() {
        let log = rotated(RotationSigner::Identity, &key(1), &key(2));
        let head = replay(&log).unwrap();
        assert_eq!(head.principal_id, PRINCIPAL);
        assert_eq!(head.seq, 1);
        assert_eq!(head.identity_key, key(2).public_key());
        assert_eq!(head.recovery_key, RECOVERY);
        assert_eq!(head.hash, payload_hash(&log[1].payload));

        let log = rotated(RotationSigner::Recovery, &key(101), &key(3));
        let head = replay(&log).unwrap();
        assert_eq!(head.identity_key, key(3).public_key());
    }

    #[test]
    fn replay_refuses_a_rotation_by_the_wrong_key_or_off_the_head() {
        // Signed by a key that is neither the identity key nor the recovery key.
        let log = rotated(RotationSigner::Identity, &key(9), &key(2));
        assert!(replay(&log).is_err());
        let log = rotated(RotationSigner::Recovery, &key(1), &key(2));
        assert!(replay(&log).is_err());

        // A rotation that does not name the head it extends.
        let first = inception(&key(1), RECOVERY, AT);
        let mut head = replay(std::slice::from_ref(&first)).unwrap();
        head.hash = b64(&[0u8; 32]);
        let second = rotation(
            &head,
            RotationSigner::Identity,
            &key(1),
            &key(2).public_key(),
            AT,
        );
        assert!(replay(&[first, second]).is_err());

        assert!(replay(&[]).is_err());
        assert!(replay(&[statement(INCEPTION, LOGIN_SIG)]).is_err());
    }

    #[test]
    fn certificates_vouch_for_devices_only_when_they_verify() {
        let head = replay(&[statement(INCEPTION, INCEPTION_SIG)]).unwrap();
        let device = certified_device(&statement(DEVICE_CERT, DEVICE_CERT_SIG), &head).unwrap();
        assert_eq!(device.device_id, DEVICE_ID);
        assert_eq!(device.device_key, DEVICE);

        // A version 1 certificate under a version 1 log: the key comes out tagged.
        let v1_head = replay(&[statement(V1_INCEPTION, V1_INCEPTION_SIG)]).unwrap();
        let v1_device =
            certified_device(&statement(V1_DEVICE_CERT, V1_DEVICE_CERT_SIG), &v1_head).unwrap();
        assert_eq!(v1_device.device_key, DEVICE);

        // A key the server slipped in, a certificate of another account, a seq past the head.
        let swapped = DEVICE_CERT.replace(DEVICE, &key(66).public_key());
        assert!(certified_device(&statement(&swapped, DEVICE_CERT_SIG), &head).is_err());
        assert!(certified_device(&statement(V1_DEVICE_CERT, V1_DEVICE_CERT_SIG), &head).is_err());
        let forged = key(66).sign(context::DEVICE, swapped);
        assert!(certified_device(&forged, &head).is_err());
        let ahead = key(1).sign(
            context::DEVICE,
            DEVICE_CERT.replace(r#""keySeq":0"#, r#""keySeq":1"#),
        );
        assert!(certified_device(&ahead, &head).is_err());
    }

    #[test]
    fn revocation_and_profile_card_verify_with_their_signers() {
        let by_identity = revocation(&key(1), false, PRINCIPAL, DEVICE_ID, AT);
        assert!(by_identity.payload.contains(r#""signer":"identity""#));
        assert!(verify(&by_identity, context::DEVICE_REVOKE, IDENTITY, 2));
        let by_device = revocation(&key(20), true, PRINCIPAL, DEVICE_ID, AT);
        assert!(by_device.payload.contains(r#""signer":"device""#));
        assert!(verify(&by_device, context::DEVICE_REVOKE, DEVICE, 2));

        let card = profile_card(
            &key(1),
            &ProfileCardInput {
                principal_id: PRINCIPAL,
                version: 1,
                key_seq: 0,
                display_name: "Ada",
                relays: &["https://relay.rim.chat".to_string()],
                devices: &[CardDevice {
                    device_id: DEVICE_ID.into(),
                    device_key: DEVICE.into(),
                }],
                issued_at: AT,
            },
        );
        assert!(verify(&card, context::PROFILE_CARD, IDENTITY, 2));
        assert!(card
            .payload
            .starts_with(r#"{"v":2,"type":"profile-card","principalId":"#));
    }

    #[test]
    fn keys_round_trip_through_their_tagged_text() {
        let key = SecretKey::generate().unwrap();
        let text = key.to_text();
        assert!(text.starts_with("ed25519:"));
        assert!(SecretKey::from_text(&text).unwrap() == key);
        assert!(SecretKey::from_text("ed25519:AAAA").is_err());
        assert!(SecretKey::from_text(&text.replace("ed25519:", "mldsa:")).is_err());
    }
}
