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
use hkdf::Hkdf;
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
    pub(crate) const PLUGIN_MANIFEST: &[u8] = b"rim.plugin-manifest.v1\0";
    pub(crate) const DEVICE_REQUEST: &[u8] = b"rim.device-request.v1\0";
    pub(crate) const DELEGATION: &[u8] = b"rim.delegation.v1\0";
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

    /// A 32-byte key derived from this key's secret: `HKDF-SHA256(ikm = seed, salt, info)`.
    /// Whoever holds the key can derive it again; nobody else can.
    pub(crate) fn derive_key(&self, salt: &[u8], info: &[u8]) -> Zeroizing<[u8; 32]> {
        let mut out = Zeroizing::new([0u8; 32]);
        Hkdf::<Sha256>::new(Some(salt), self.seed.as_ref())
            .expand(info, out.as_mut())
            .expect("32 bytes is a valid HKDF-SHA256 output length");
        out
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

pub(crate) fn unb64(text: &str) -> Result<Vec<u8>, KeyIdentityError> {
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

/// The Ed25519 public key `bytes` spell, if they are 32 bytes of a point in its canonical
/// encoding that is not of small order: the server's rule, so both sides agree on which strings
/// are keys.
fn ed25519_key(bytes: &[u8]) -> Option<VerifyingKey> {
    let bytes = <[u8; 32]>::try_from(bytes).ok()?;
    let key = VerifyingKey::from_bytes(&bytes).ok()?;
    (!key.is_weak() && key.to_edwards().compress().to_bytes() == bytes).then_some(key)
}

/// A key as `version` spells it, in canonical tagged text. An algorithm this device cannot sign
/// or verify with stays opaque and still has a canonical text; an Ed25519 key must be a usable
/// point in its canonical encoding.
pub(crate) fn canonical_key(text: &str, version: u8) -> Result<String, KeyIdentityError> {
    let (algorithm, bytes) = split_tagged(text, version)?;
    if algorithm == ED25519 && ed25519_key(&bytes).is_none() {
        return Err(KeyIdentityError::Invalid(
            "an Ed25519 key is weak or not in its canonical encoding".into(),
        ));
    }
    Ok(format!("{algorithm}:{}", b64(&bytes)))
}

/// Whether `statement`, a statement of `version`, is signed by `public_key` (canonical tagged
/// text) for `context`. A signature only verifies under a key of its own algorithm. Strict:
/// weak or non-canonically encoded keys and malleable signatures fail, as on the server.
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
    let (Some(key), Ok(sig_bytes)) = (ed25519_key(&key_bytes), <[u8; 64]>::try_from(sig_bytes))
    else {
        return false;
    };
    key.verify_strict(
        &signed_bytes(context, &statement.payload),
        &Signature::from_bytes(&sig_bytes),
    )
    .is_ok()
}

/// A device key offered for certification: canonical version 2 tagged text of an algorithm this
/// device can verify, a point in its canonical encoding, and not a weak key. Returns it
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
    if ed25519_key(&bytes).is_none() || format!("{ED25519_TAG}{}", b64(&bytes)) != text {
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

/// What a device request says: a request to a space hosted elsewhere, for `host`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceRequestInput {
    pub(crate) host: String,
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) seq: u64,
    pub(crate) body_sha256: String,
    pub(crate) issued_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceRequest<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    principal_id: &'a str,
    device_id: &'a str,
    host: &'a str,
    method: &'a str,
    path: &'a str,
    seq: u64,
    body_sha256: &'a str,
    issued_at: &'a str,
}

/// The largest `seq` a device request may carry: below 2^53, so JSON readers keep it exact.
pub(crate) const MAX_REQUEST_SEQ: u64 = (1 << 53) - 1;

/// A device request signed by the device key: what the host checks before it runs a request
/// the relay forwarded. Refuses fields that could not belong to such a request.
pub(crate) fn device_request(
    device: &SecretKey,
    principal_id: &str,
    device_id: &str,
    input: &DeviceRequestInput,
) -> Result<Statement, KeyIdentityError> {
    let refused = |why: &str| KeyIdentityError::Invalid(format!("device request: {why}"));
    if !input.host.starts_with("rims1_") {
        return Err(refused("not a server id"));
    }
    if input.method != "GET" && input.method != "POST" {
        return Err(refused("only GET and POST are forwarded"));
    }
    if !input.path.starts_with('/') {
        return Err(refused("the path must start with /"));
    }
    if input.seq > MAX_REQUEST_SEQ {
        return Err(refused("seq is out of range"));
    }
    if unb64(&input.body_sha256).map(|b| b.len()).ok() != Some(32) {
        return Err(refused("the body hash is malformed"));
    }
    let payload = json(&DeviceRequest {
        v: WRITE_VERSION,
        kind: "device-request",
        principal_id,
        device_id,
        host: &input.host,
        method: &input.method,
        path: &input.path,
        seq: input.seq,
        body_sha256: &input.body_sha256,
        issued_at: &input.issued_at,
    });
    Ok(device.sign(context::DEVICE_REQUEST, payload))
}

/// What a delegation says besides the device: relay `relay` may receive workspace
/// `workspace_id`'s events from `host` and forward this device's requests there until
/// `expires_at`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DelegationInput {
    pub(crate) relay: String,
    pub(crate) relay_key_hash: String,
    pub(crate) host: String,
    pub(crate) workspace_id: String,
    pub(crate) nonce: String,
    pub(crate) issued_at: String,
    pub(crate) expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Delegation<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    principal_id: &'a str,
    device_id: &'a str,
    relay: &'a str,
    relay_key_hash: &'a str,
    host: &'a str,
    workspace_id: &'a str,
    scope: &'a str,
    nonce: &'a str,
    issued_at: &'a str,
    expires_at: &'a str,
}

/// The longest a delegation may run, from `issuedAt` to `expiresAt`.
pub(crate) const MAX_DELEGATION_SECONDS: i64 = 24 * 60 * 60;

/// A whole-second UTC time as statements write it (`2026-10-09T00:00:00Z`).
fn statement_time(text: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let parsed = chrono::DateTime::parse_from_rfc3339(text).ok()?;
    let utc = parsed.with_timezone(&chrono::Utc);
    (utc.to_rfc3339_opts(chrono::SecondsFormat::Secs, true) == text).then_some(utc)
}

fn uuid_text(text: &str) -> bool {
    uuid::Uuid::parse_str(text).is_ok_and(|u| u.hyphenated().to_string() == text)
}

/// A delegation signed by the device key, for one workspace on one host through one relay, at
/// most 24 hours. Refuses fields a host would refuse.
pub(crate) fn delegation(
    device: &SecretKey,
    principal_id: &str,
    device_id: &str,
    input: &DelegationInput,
) -> Result<Statement, KeyIdentityError> {
    let refused = |why: &str| KeyIdentityError::Invalid(format!("delegation: {why}"));
    if !input.relay.starts_with("rims1_") || !input.host.starts_with("rims1_") {
        return Err(refused("relay and host must be server ids"));
    }
    if unb64(&input.relay_key_hash).map(|b| b.len()).ok() != Some(32) {
        return Err(refused("the relay key hash is malformed"));
    }
    if !uuid_text(&input.workspace_id) {
        return Err(refused("the workspace id is malformed"));
    }
    if unb64(&input.nonce).map(|b| b.len()).ok() != Some(16) {
        return Err(refused("the nonce must be 16 bytes"));
    }
    let (Some(issued), Some(expires)) = (
        statement_time(&input.issued_at),
        statement_time(&input.expires_at),
    ) else {
        return Err(refused("times must be whole-second UTC"));
    };
    let lifetime = (expires - issued).num_seconds();
    if lifetime <= 0 || lifetime > MAX_DELEGATION_SECONDS {
        return Err(refused(
            "a delegation runs for at most 24 hours after it is issued",
        ));
    }
    let payload = json(&Delegation {
        v: WRITE_VERSION,
        kind: "delegation",
        principal_id,
        device_id,
        relay: &input.relay,
        relay_key_hash: &input.relay_key_hash,
        host: &input.host,
        workspace_id: &input.workspace_id,
        scope: "workspace",
        nonce: &input.nonce,
        issued_at: &input.issued_at,
        expires_at: &input.expires_at,
    });
    Ok(device.sign(context::DELEGATION, payload))
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
    /// Who signed the entry at every seq, oldest first; `None` for the inception.
    pub(crate) signers: Vec<Option<RotationSigner>>,
    /// base64url(SHA-256(payload)) of the entry at every seq, oldest first.
    pub(crate) hashes: Vec<String>,
}

impl KeyHead {
    /// Whether a recovery rotation follows the entry at `seq`: what that entry's identity key
    /// signed is void from then on.
    pub(crate) fn recovered_after(&self, seq: u32) -> bool {
        self.signers
            .iter()
            .skip(seq as usize + 1)
            .any(|signer| *signer == Some(RotationSigner::Recovery))
    }
}

/// An inception entry. Unknown fields are refused, as on the server; serde refuses duplicates.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InceptionEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    seq: u32,
    identity_key: String,
    recovery_key: String,
    #[allow(dead_code)]
    created_at: chrono::DateTime<chrono::Utc>,
}

/// A rotation entry, as strictly as [`InceptionEntry`].
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RotationEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    principal_id: String,
    seq: u32,
    prev: String,
    identity_key: String,
    recovery_key: String,
    signer: String,
    #[allow(dead_code)]
    created_at: chrono::DateTime<chrono::Utc>,
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
    let entry: InceptionEntry =
        serde_json::from_str(&first.payload).map_err(|e| invalid(format!("entry 0: {e}")))?;
    let identity_key = canonical_key(&entry.identity_key, entry.v).map_err(log_error)?;
    let recovery_key = canonical_key(&entry.recovery_key, entry.v).map_err(log_error)?;
    if entry.kind != "inception" || entry.seq != 0 {
        return Err(invalid("entry 0 is not an inception"));
    }
    if identity_key == recovery_key {
        return Err(invalid("the identity and recovery keys must differ"));
    }
    if !verify(first, context::KEY_LOG, &identity_key, entry.v) {
        return Err(invalid("inception signature does not verify"));
    }
    let mut version = entry.v;
    let mut head = KeyHead {
        principal_id: principal_id(&first.payload),
        seq: 0,
        identity_keys: vec![identity_key.clone()],
        signers: vec![None],
        hashes: vec![payload_hash(&first.payload)],
        identity_key,
        recovery_key,
        hash: payload_hash(&first.payload),
    };
    for statement in rest {
        let at = head.seq + 1;
        let entry: RotationEntry = serde_json::from_str(&statement.payload)
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
        if entry.principal_id != head.principal_id || entry.seq != at || entry.prev != head.hash {
            return Err(invalid(format!("entry {at} does not extend the log")));
        }
        if identity_key == head.identity_key {
            return Err(invalid("a rotation must change the identity key"));
        }
        if identity_key == recovery_key {
            return Err(invalid("the identity and recovery keys must differ"));
        }
        let (signer, signer_key) = match entry.signer.as_str() {
            "identity" if recovery_key == head.recovery_key => {
                (RotationSigner::Identity, &head.identity_key)
            }
            "identity" => return Err(invalid("only recovery may change the recovery key")),
            "recovery" => (RotationSigner::Recovery, &head.recovery_key),
            _ => return Err(invalid("unknown rotation signer")),
        };
        if !verify(statement, context::KEY_LOG, signer_key, entry.v) {
            return Err(invalid(format!("entry {at} signature does not verify")));
        }
        version = entry.v;
        let mut identity_keys = head.identity_keys;
        identity_keys.push(identity_key.clone());
        let mut signers = head.signers;
        signers.push(Some(signer));
        let hash = payload_hash(&statement.payload);
        let mut hashes = head.hashes;
        hashes.push(hash.clone());
        head = KeyHead {
            principal_id: head.principal_id,
            seq: entry.seq,
            identity_key,
            recovery_key,
            hash,
            identity_keys,
            signers,
            hashes,
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

/// Read what a device certificate claims, without verifying it.
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
/// names this log's principal, is signed by the identity key at its `keySeq`, and no recovery
/// rotation follows that `keySeq` (a recovery voids what the lost key signed). A profile card
/// lists only devices that pass, so a server cannot slip a key of its own into the card the
/// identity key signs.
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
    if head.recovered_after(entry.key_seq) {
        return Err(KeyIdentityError::Invalid(
            "a device certificate predates a recovery".into(),
        ));
    }
    if !verify(certificate, context::DEVICE, signer, entry.v) {
        return Err(refused());
    }
    Ok(CardDevice {
        device_key: canonical_key(&entry.device_key, entry.v)?,
        device_id: entry.device_id,
    })
}

/// A device revocation as signed.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevocationEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    principal_id: String,
    device_id: String,
    signer: String,
    #[allow(dead_code)]
    issued_at: chrono::DateTime<chrono::Utc>,
}

/// Whether `revocation` is a signed revocation of `device_id` of the log's principal: by an
/// identity key of the log (the key current when it was signed), or by the revoked device's
/// own key `device_key` (canonical tagged text).
pub(crate) fn verified_revocation(
    revocation: &Statement,
    head: &KeyHead,
    device_id: &str,
    device_key: &str,
) -> bool {
    let Ok(entry) = serde_json::from_str::<RevocationEntry>(&revocation.payload) else {
        return false;
    };
    let same_device = match (
        uuid::Uuid::parse_str(&entry.device_id),
        uuid::Uuid::parse_str(device_id),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if entry.kind != "device-revoke" || entry.principal_id != head.principal_id || !same_device {
        return false;
    }
    match entry.signer.as_str() {
        "identity" => head
            .identity_keys
            .iter()
            .any(|key| verify(revocation, context::DEVICE_REVOKE, key, entry.v)),
        "device" => verify(revocation, context::DEVICE_REVOKE, device_key, entry.v),
        _ => false,
    }
}

/// A profile card as signed. Unknown fields are refused.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CardEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    principal_id: String,
    version: u32,
    key_seq: u32,
    display_name: String,
    relays: Vec<String>,
    devices: Vec<CardDevice>,
    #[allow(dead_code)]
    issued_at: chrono::DateTime<chrono::Utc>,
}

/// What a verified profile card says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedCard {
    pub(crate) version: u32,
    pub(crate) display_name: String,
    pub(crate) relays: Vec<String>,
}

/// The profile card of the log's principal, once it verifies: signed by the identity key at its
/// `keySeq` with no recovery after it, 1 to 80 characters of name, at most 8 unique `http(s)`
/// relays of at most 256 bytes and 32 unique devices.
pub(crate) fn verified_card(
    card: &Statement,
    head: &KeyHead,
) -> Result<VerifiedCard, KeyIdentityError> {
    let refused = |why: &str| KeyIdentityError::Invalid(format!("profile card: {why}"));
    let entry: CardEntry =
        serde_json::from_str(&card.payload).map_err(|_| refused("not a profile card"))?;
    if !(1..=2).contains(&entry.v) || entry.kind != "profile-card" || entry.version == 0 {
        return Err(refused("not a profile card"));
    }
    if entry.version > i32::MAX as u32 {
        return Err(refused("not a profile card"));
    }
    if entry.principal_id != head.principal_id {
        return Err(refused("names another account"));
    }
    let signer = head
        .identity_keys
        .get(entry.key_seq as usize)
        .ok_or_else(|| refused("signed by a lost key"))?;
    if head.recovered_after(entry.key_seq) {
        return Err(refused("signed by a lost key"));
    }
    if !verify(card, context::PROFILE_CARD, signer, entry.v) {
        return Err(refused("signature does not verify"));
    }
    let display_name = entry.display_name.trim().to_string();
    if display_name.is_empty() || display_name.chars().count() > 80 {
        return Err(refused("name is not allowed"));
    }
    let relay_ok = |r: &String| {
        r.len() <= 256
            && (r.starts_with("https://") || r.starts_with("http://"))
            && !r.chars().any(char::is_whitespace)
    };
    let unique_relays: std::collections::HashSet<_> = entry.relays.iter().collect();
    if entry.relays.len() > 8
        || !entry.relays.iter().all(relay_ok)
        || unique_relays.len() != entry.relays.len()
    {
        return Err(refused("relays are not allowed"));
    }
    let unique_devices: std::collections::HashSet<_> = entry
        .devices
        .iter()
        .map(|d| d.device_id.to_lowercase())
        .collect();
    if entry.devices.len() > 32 || unique_devices.len() != entry.devices.len() {
        return Err(refused("devices are not allowed"));
    }
    Ok(VerifiedCard {
        version: entry.version,
        display_name,
        relays: entry.relays,
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
    fn finding_3_a_certificate_before_a_recovery_is_refused() {
        let cert_at = |seq: u32, signer: &SecretKey| {
            signer.sign(
                context::DEVICE,
                DEVICE_CERT.replace(r#""keySeq":0"#, &format!(r#""keySeq":{seq}"#)),
            )
        };
        let first = inception(&key(1), RECOVERY, AT);
        let head = replay(std::slice::from_ref(&first)).unwrap();

        // An identity rotation keeps what the earlier key certified.
        let identity_rotation = rotation(
            &head,
            RotationSigner::Identity,
            &key(1),
            &key(2).public_key(),
            AT,
        );
        let rotated = replay(&[first.clone(), identity_rotation.clone()]).unwrap();
        assert!(!rotated.recovered_after(0));
        assert!(certified_device(&cert_at(0, &key(1)), &rotated).is_ok());

        // A recovery voids it: the certificate at keySeq 0, and the one at keySeq 1, both precede
        // the recovery at seq 2; only one signed by the recovered key at seq 2 stands.
        let recovery = rotation(
            &rotated,
            RotationSigner::Recovery,
            &key(101),
            &key(3).public_key(),
            AT,
        );
        let recovered = replay(&[first, identity_rotation, recovery]).unwrap();
        assert!(recovered.recovered_after(0) && recovered.recovered_after(1));
        assert!(!recovered.recovered_after(2));
        for (seq, signer) in [(0, key(1)), (1, key(2))] {
            let err = certified_device(&cert_at(seq, &signer), &recovered).unwrap_err();
            assert!(err.to_string().contains("predates a recovery"), "{err}");
        }
        assert!(certified_device(&cert_at(2, &key(3)), &recovered).is_ok());
    }

    #[test]
    fn finding_11_the_head_lists_every_entry_hash() {
        let log = rotated(RotationSigner::Identity, &key(1), &key(2));
        let head = replay(&log).unwrap();
        assert_eq!(
            head.hashes,
            vec![payload_hash(&log[0].payload), payload_hash(&log[1].payload)]
        );
        assert_eq!(head.hashes.last(), Some(&head.hash));
    }

    /// rim-server's non-canonical vector (y = p + 1, the identity point spelled out of range),
    /// and y = p + 3, a point of large order spelled the same way.
    const NON_CANONICAL: [&str; 2] = [
        "7v_______________________________________38",
        "8P_______________________________________38",
    ];

    #[test]
    fn finding_22_keys_in_a_non_canonical_encoding_are_refused() {
        for body in NON_CANONICAL {
            let tagged = format!("{ED25519_TAG}{body}");
            assert!(usable_device_key(&tagged).is_err(), "{body}");
            assert!(canonical_key(&tagged, 2).is_err(), "{body}");
            assert!(canonical_key(body, 1).is_err(), "{body}");
            let signed = key(1).sign(context::LOGIN, "{}".into());
            assert!(!verify(&signed, context::LOGIN, &tagged, 2), "{body}");
        }
        // y = 3 spelled canonically is a key.
        let mut canonical = [0u8; 32];
        canonical[0] = 3;
        assert!(canonical_key(&format!("{ED25519_TAG}{}", b64(&canonical)), 2).is_ok());
    }

    #[test]
    fn finding_22_a_log_whose_identity_and_recovery_keys_match_is_refused() {
        let same = inception(&key(1), &key(1).public_key(), AT);
        let err = replay(&[same]).unwrap_err().to_string();
        assert!(err.contains("must differ"), "{err}");

        let first = inception(&key(1), RECOVERY, AT);
        let head = replay(std::slice::from_ref(&first)).unwrap();
        let onto_recovery = rotation(&head, RotationSigner::Identity, &key(1), RECOVERY, AT);
        let err = replay(&[first, onto_recovery]).unwrap_err().to_string();
        assert!(err.contains("must differ"), "{err}");
    }

    #[test]
    fn finding_22_a_log_entry_with_an_unknown_field_is_refused() {
        // rim-server's test inserts `"x":1` first.
        let extra = key(1).sign(context::KEY_LOG, INCEPTION.replacen('{', r#"{"x":1,"#, 1));
        let err = replay(&[extra]).unwrap_err().to_string();
        assert!(err.contains("unknown field"), "{err}");

        let first = inception(&key(1), RECOVERY, AT);
        let head = replay(std::slice::from_ref(&first)).unwrap();
        let second = rotation(
            &head,
            RotationSigner::Identity,
            &key(1),
            &key(2).public_key(),
            AT,
        );
        let padded = key(1).sign(
            context::KEY_LOG,
            second.payload.replacen('{', r#"{"note":"hi","#, 1),
        );
        assert!(replay(&[first.clone(), padded]).is_err());
        // An inception never names a principal or a previous entry.
        let prefixed = key(1).sign(
            context::KEY_LOG,
            INCEPTION.replacen('{', r#"{"prev":"AA","#, 1),
        );
        assert!(replay(&[prefixed]).is_err());
        // Duplicate fields are refused too.
        let twice = key(1).sign(
            context::KEY_LOG,
            INCEPTION.replacen(
                '{',
                &format!(r#"{{"identityKey":"{}","#, key(9).public_key()),
                1,
            ),
        );
        assert!(replay(&[twice]).is_err());
    }

    #[test]
    fn finding_2_a_revocation_counts_only_when_its_signature_verifies() {
        let head = replay(&[statement(INCEPTION, INCEPTION_SIG)]).unwrap();
        let by_identity = revocation(&key(1), false, PRINCIPAL, DEVICE_ID, AT);
        assert!(verified_revocation(&by_identity, &head, DEVICE_ID, DEVICE));
        let by_device = revocation(&key(20), true, PRINCIPAL, DEVICE_ID, AT);
        assert!(verified_revocation(&by_device, &head, DEVICE_ID, DEVICE));

        // Signed by a key that is neither, naming another device or principal, or not a
        // revocation at all.
        let forged = revocation(&key(66), false, PRINCIPAL, DEVICE_ID, AT);
        assert!(!verified_revocation(&forged, &head, DEVICE_ID, DEVICE));
        let device_claims_identity = revocation(&key(20), false, PRINCIPAL, DEVICE_ID, AT);
        assert!(!verified_revocation(
            &device_claims_identity,
            &head,
            DEVICE_ID,
            DEVICE
        ));
        let other = "00000000-0000-0000-0000-000000000002";
        assert!(!verified_revocation(&by_identity, &head, other, DEVICE));
        let elsewhere = revocation(&key(1), false, V1_PRINCIPAL, DEVICE_ID, AT);
        assert!(!verified_revocation(&elsewhere, &head, DEVICE_ID, DEVICE));
        let not_one = statement(DEVICE_CERT, DEVICE_CERT_SIG);
        assert!(!verified_revocation(&not_one, &head, DEVICE_ID, DEVICE));

        // An identity key since rotated away still signed it when it was current.
        let first = inception(&key(1), RECOVERY, AT);
        let second = rotation(
            &replay(std::slice::from_ref(&first)).unwrap(),
            RotationSigner::Identity,
            &key(1),
            &key(2).public_key(),
            AT,
        );
        let rotated = replay(&[first, second]).unwrap();
        assert!(verified_revocation(
            &by_identity,
            &rotated,
            DEVICE_ID,
            DEVICE
        ));
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
