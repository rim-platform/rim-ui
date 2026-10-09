//! Signed statements of key identity v1 (`rim-server/docs/specs/key-identity-v1.md`): building
//! and signing the payloads this device sends, and replaying a key log the server returns.
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

/// A statement as it travels: the signed JSON text and its unpadded base64url signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Statement {
    pub(crate) payload: String,
    pub(crate) signature: String,
}

/// An Ed25519 secret key seed, wiped on drop. Only this module and the v1 recovery kit see
/// raw seeds; everything else holds a [`SecretKey`].
pub(crate) type Seed = Zeroizing<[u8; 32]>;

/// Tag of an Ed25519 key in stored text. Stored keys name their algorithm so a hybrid
/// (post-quantum) signer can be added beside this one without guessing what a stored key is.
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

    pub(crate) fn seed(&self) -> &[u8; 32] {
        &self.seed
    }

    /// The public key as statements carry it (unpadded base64url).
    pub(crate) fn public_key(&self) -> String {
        b64(SigningKey::from_bytes(&self.seed)
            .verifying_key()
            .as_bytes())
    }

    /// The key as stored in the keyring: its algorithm tag and its secret.
    pub(crate) fn to_text(&self) -> Zeroizing<String> {
        Zeroizing::new(format!("{ED25519_TAG}{}", b64(self.seed.as_ref())))
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

    /// Sign `payload` for `context`.
    pub(crate) fn sign(&self, context: &[u8], payload: String) -> Statement {
        let key = SigningKey::from_bytes(&self.seed);
        let mut message = Vec::with_capacity(context.len() + payload.len());
        message.extend_from_slice(context);
        message.extend_from_slice(payload.as_bytes());
        let signature = key.sign(&message);
        Statement {
            payload,
            signature: b64(&signature.to_bytes()),
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

/// Whether `statement` is signed by `public_key` (base64url) for `context`. Strict: weak keys
/// and malleable signatures fail, as on the server.
pub(crate) fn verify(statement: &Statement, context: &[u8], public_key: &str) -> bool {
    let Ok(key_bytes) = <[u8; 32]>::try_from(unb64(public_key).unwrap_or_default()) else {
        return false;
    };
    let Ok(sig_bytes) = <[u8; 64]>::try_from(unb64(&statement.signature).unwrap_or_default())
    else {
        return false;
    };
    let Ok(key) = VerifyingKey::from_bytes(&key_bytes) else {
        return false;
    };
    if key.is_weak() {
        return false;
    }
    let mut message = Vec::with_capacity(context.len() + statement.payload.len());
    message.extend_from_slice(context);
    message.extend_from_slice(statement.payload.as_bytes());
    key.verify_strict(&message, &Signature::from_bytes(&sig_bytes))
        .is_ok()
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
        v: 1,
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
        v: 1,
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
        v: 1,
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
        v: 1,
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
        v: 1,
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
        v: 1,
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
/// never trusted unchecked.
pub(crate) fn replay(log: &[Statement]) -> Result<KeyHead, KeyIdentityError> {
    let (first, rest) = log.split_first().ok_or_else(|| invalid("empty"))?;
    let entry: LogEntry =
        serde_json::from_str(&first.payload).map_err(|e| invalid(format!("entry 0: {e}")))?;
    if entry.v != 1 {
        return Err(invalid(format!(
            "statement version {} is not supported",
            entry.v
        )));
    }
    if entry.kind != "inception" || entry.seq != 0 {
        return Err(invalid("entry 0 is not an inception"));
    }
    if !verify(first, context::KEY_LOG, &entry.identity_key) {
        return Err(invalid("inception signature does not verify"));
    }
    let mut head = KeyHead {
        principal_id: principal_id(&first.payload),
        seq: 0,
        identity_key: entry.identity_key,
        recovery_key: entry.recovery_key,
        hash: payload_hash(&first.payload),
    };
    for statement in rest {
        let entry: LogEntry = serde_json::from_str(&statement.payload)
            .map_err(|e| invalid(format!("entry {}: {e}", head.seq + 1)))?;
        if entry.v != 1 {
            return Err(invalid(format!(
                "statement version {} is not supported",
                entry.v
            )));
        }
        if entry.kind != "rotate" {
            return Err(invalid(format!("entry {} is not a rotation", head.seq + 1)));
        }
        if entry.principal_id.as_deref() != Some(head.principal_id.as_str())
            || entry.seq != head.seq + 1
            || entry.prev.as_deref() != Some(head.hash.as_str())
        {
            return Err(invalid(format!(
                "entry {} does not extend the log",
                head.seq + 1
            )));
        }
        if entry.identity_key == head.identity_key {
            return Err(invalid("a rotation must change the identity key"));
        }
        let signer_key = match entry.signer.as_deref() {
            Some("identity") if entry.recovery_key == head.recovery_key => &head.identity_key,
            Some("identity") => return Err(invalid("only recovery may change the recovery key")),
            Some("recovery") => &head.recovery_key,
            _ => return Err(invalid("unknown rotation signer")),
        };
        if !verify(statement, context::KEY_LOG, signer_key) {
            return Err(invalid(format!(
                "entry {} signature does not verify",
                head.seq + 1
            )));
        }
        head = KeyHead {
            principal_id: head.principal_id,
            seq: entry.seq,
            identity_key: entry.identity_key,
            recovery_key: entry.recovery_key,
            hash: payload_hash(&statement.payload),
        };
    }
    Ok(head)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u8) -> SecretKey {
        SecretKey::from_seed(Zeroizing::new([n; 32]))
    }

    // Known-answer vectors from key-identity-v1.md, Appendix A.
    const IDENTITY: &str = "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w";
    const RECOVERY: &str = "1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg";
    const DEVICE: &str = "IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc";
    const PRINCIPAL: &str = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
    const FIRST_PREV: &str = "o1oFYkMXfjtQJnG6as5GURR0cnzeYNYv5Br-LaeI78I";
    const INCEPTION: &str = r#"{"v":1,"type":"inception","seq":0,"identityKey":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}"#;
    const INCEPTION_SIG: &str =
        "vf3zjxbHUJ8l9Oe6ayFGZZszVH1c_FVgO04F_4PqkfsYu9h8jAgbPKhAIAYHlQxg-7yAO5w1OEMmcAGcXptVDQ";
    const DEVICE_CERT: &str = r#"{"v":1,"type":"device","principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}"#;
    const DEVICE_CERT_SIG: &str =
        "tt6UNl3tRCwupWIYEfnWzqW9qVqDsJju2dA7d2CdNqdIZ0piVeP_Q6Y1lLfA4YN-26tsdaFea-rM_I8Qy9H6Cg";
    const LOGIN_PROOF: &str = r#"{"v":1,"type":"login","challengeId":"00000000-0000-0000-0000-000000000009","nonce":"bm9uY2U","audience":"localhost:8080","principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","deviceId":"00000000-0000-0000-0000-000000000001"}"#;
    const LOGIN_SIG: &str =
        "jB_BFFAn7e-FMh8wCSWhnCcPzMjoe1fTKwlCoGfE0p1OYkhZWjV4J1c_AgeIhKpWOnLYyB0PqstAEYmaCITXBw";
    const DEVICE_ID: &str = "00000000-0000-0000-0000-000000000001";
    const AT: &str = "2026-10-09T00:00:00Z";

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
        assert_eq!(payload_hash(INCEPTION), FIRST_PREV);

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
    fn verify_binds_the_context_and_the_key() {
        let statement = key(1).sign(context::LOGIN, "{}".into());
        assert!(verify(&statement, context::LOGIN, IDENTITY));
        assert!(!verify(&statement, context::DEVICE, IDENTITY));
        assert!(!verify(&statement, context::LOGIN, RECOVERY));
        assert!(!verify(&statement, context::LOGIN, "not a key"));
        let tampered = Statement {
            payload: "{ }".into(),
            ..statement
        };
        assert!(!verify(&tampered, context::LOGIN, IDENTITY));
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
        assert!(log[1]
            .payload
            .contains(r#""prev":"o1oFYkMXfjtQJnG6as5GURR0cnzeYNYv5Br-LaeI78I""#));
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
        let forged = Statement {
            payload: INCEPTION.into(),
            signature: LOGIN_SIG.into(),
        };
        assert!(replay(&[forged]).is_err());
    }

    #[test]
    fn revocation_and_profile_card_verify_with_their_signers() {
        let by_identity = revocation(&key(1), false, PRINCIPAL, DEVICE_ID, AT);
        assert!(by_identity.payload.contains(r#""signer":"identity""#));
        assert!(verify(&by_identity, context::DEVICE_REVOKE, IDENTITY));
        let by_device = revocation(&key(20), true, PRINCIPAL, DEVICE_ID, AT);
        assert!(by_device.payload.contains(r#""signer":"device""#));
        assert!(verify(&by_device, context::DEVICE_REVOKE, DEVICE));

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
        assert!(verify(&card, context::PROFILE_CARD, IDENTITY));
        assert!(card
            .payload
            .starts_with(r#"{"v":1,"type":"profile-card","principalId":"#));
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
