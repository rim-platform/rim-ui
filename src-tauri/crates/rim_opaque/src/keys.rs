//! The keys a password unlocks, and the AES-256-GCM values sealed under them.
//!
//! - Transport key: `HKDF-SHA256(ikm = session key, salt = "rim.opaque.transport.v1",
//!   info = label)`; the server seals what it returns after a login under it.
//! - Unlock key: `HKDF-SHA256(ikm = export key ‖ server share, salt = "rim.unlock.v1",
//!   info = principal id)`; it wraps the device's data key.
//! - Recovery wrap key: `HKDF-SHA256(ikm = the phrase's 16 bytes, salt =
//!   "rim.recovery-phrase.v1", info = "data key wrap")`.
//! - Store keys: `HKDF-SHA256(ikm = data key, salt = "rim.store.v1", info = label)`.
//! - Device key wrap key: `HKDF-SHA256(ikm = server share, salt = "rim.device-key.v1",
//!   info = principal id)`; it wraps the device key's seed, so the device keeps its key when
//!   it starts over with a new data key.
//!
//! Every sealed value is `nonce (12) ‖ ciphertext ‖ tag (16)` under a random nonce. A wrap of
//! the data key authenticates `"rim.dk.v1|<kind>|<principal id>"`, a rewrap of an old unlock
//! key `"rim.uk-rewrap.v1|<principal id>"`, a wrap of the device key's seed
//! `"rim.device-key.v1|<principal id>"`, a transport value nothing.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::{Error, Result, OPAQUE_KEY_LEN};

/// Length of every key this module derives or wraps.
pub const KEY_LEN: usize = 32;
/// Length of the random AES-GCM nonce that starts every sealed value.
pub const NONCE_LEN: usize = 12;
/// Length of the AES-GCM tag that ends every sealed value.
pub const TAG_LEN: usize = 16;
/// Length of a recovery phrase's entropy.
pub const RECOVERY_ENTROPY_LEN: usize = 16;

const TRANSPORT_SALT: &[u8] = b"rim.opaque.transport.v1";
const UNLOCK_SALT: &[u8] = b"rim.unlock.v1";
const RECOVERY_SALT: &[u8] = b"rim.recovery-phrase.v1";
const RECOVERY_WRAP_INFO: &[u8] = b"data key wrap";
const STORE_SALT: &[u8] = b"rim.store.v1";
const DEVICE_KEY_SALT: &[u8] = b"rim.device-key.v1";

/// A 256-bit key, wiped on drop.
pub type Key = Zeroizing<[u8; KEY_LEN]>;

/// What a transport key opens: one key per value the server returns after a login.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportLabel {
    ServerShare,
    KeepKey,
    SessionSecret,
}

impl TransportLabel {
    /// The HKDF `info`: `"server share"`, `"keep key"` or `"session secret"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ServerShare => "server share",
            Self::KeepKey => "keep key",
            Self::SessionSecret => "session secret",
        }
    }

    /// The label whose `info` is `label`, if any.
    pub fn parse(label: &str) -> Option<Self> {
        [Self::ServerShare, Self::KeepKey, Self::SessionSecret]
            .into_iter()
            .find(|known| known.as_str() == label)
    }
}

/// What a store key seals on the device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreKeyLabel {
    /// The IndexedDB records of the web app, and of the desktop webview.
    WebStores,
    /// The desktop's secret vault records of the account.
    DesktopVault,
    /// The desktop's message cache key of the account.
    CacheKey,
}

impl StoreKeyLabel {
    /// The HKDF `info`: `"web stores"`, `"desktop vault"` or `"cache key"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WebStores => "web stores",
            Self::DesktopVault => "desktop vault",
            Self::CacheKey => "cache key",
        }
    }
}

/// Which key a wrap of the data key is sealed under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapKind {
    /// The unlock key.
    Password,
    /// The recovery wrap key.
    Recovery,
    /// The keep key of "Keep me signed in".
    Keep,
}

impl WrapKind {
    /// The kind as the AAD names it: `password`, `recovery` or `keep`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Recovery => "recovery",
            Self::Keep => "keep",
        }
    }
}

fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8]) -> Key {
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    Hkdf::<Sha256>::new(Some(salt), ikm)
        .expand(info, out.as_mut())
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

/// The key the server seals the value `label` under after a login with `session_key`.
pub fn transport_key(session_key: &[u8; OPAQUE_KEY_LEN], label: TransportLabel) -> Key {
    hkdf(TRANSPORT_SALT, session_key, label.as_str().as_bytes())
}

/// The unlock key of `principal_id`, from the login's export key and the server share.
pub fn derive_unlock_key(
    export_key: &[u8; OPAQUE_KEY_LEN],
    share: &[u8; KEY_LEN],
    principal_id: &str,
) -> Key {
    let mut ikm = Zeroizing::new([0u8; OPAQUE_KEY_LEN + KEY_LEN]);
    ikm[..OPAQUE_KEY_LEN].copy_from_slice(export_key);
    ikm[OPAQUE_KEY_LEN..].copy_from_slice(share);
    hkdf(UNLOCK_SALT, ikm.as_ref(), principal_id.as_bytes())
}

/// The key of the recovery wrap, from a recovery phrase's entropy.
pub fn recovery_wrap_key(entropy: &[u8; RECOVERY_ENTROPY_LEN]) -> Key {
    hkdf(RECOVERY_SALT, entropy, RECOVERY_WRAP_INFO)
}

/// The key that seals `label`'s records under the data key.
pub fn store_key(data_key: &[u8; KEY_LEN], label: StoreKeyLabel) -> Key {
    hkdf(STORE_SALT, data_key, label.as_str().as_bytes())
}

/// The key that wraps `principal_id`'s device key seed, from the server share.
pub fn device_key_wrap_key(share: &[u8; KEY_LEN], principal_id: &str) -> Key {
    hkdf(DEVICE_KEY_SALT, share, principal_id.as_bytes())
}

/// 32 fresh random bytes: a new data key or keep key.
///
/// # Errors
///
/// [`Error::Protocol`] when the system has no randomness to give.
pub fn random_key() -> Result<Key> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    OsRng
        .try_fill_bytes(key.as_mut())
        .map_err(|e| Error::Protocol(format!("random generation failed: {e}")))?;
    Ok(key)
}

/// Seals `plaintext` under `key` with a random nonce, authenticating `aad` too, as
/// `nonce ‖ ciphertext ‖ tag`.
///
/// # Errors
///
/// [`Error::Protocol`] when the system has no randomness to give.
pub fn seal(key: &[u8; KEY_LEN], aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng
        .try_fill_bytes(&mut nonce)
        .map_err(|e| Error::Protocol(format!("random generation failed: {e}")))?;
    let sealed = Aes256Gcm::new(key.into())
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| Error::Protocol("encryption failed".into()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens a value [`seal`] made.
///
/// # Errors
///
/// [`Error::Malformed`] when `sealed` is shorter than a nonce and a tag;
/// [`Error::Unauthentic`] when the key, `aad` or a byte is wrong.
pub fn open(key: &[u8; KEY_LEN], aad: &[u8], sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if sealed.len() < NONCE_LEN + TAG_LEN {
        return Err(Error::Malformed("sealed value"));
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
    Aes256Gcm::new(key.into())
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| Error::Unauthentic)
}

fn data_key_aad(kind: WrapKind, principal_id: &str) -> Vec<u8> {
    format!("rim.dk.v1|{}|{principal_id}", kind.as_str()).into_bytes()
}

fn rewrap_aad(principal_id: &str) -> Vec<u8> {
    format!("rim.uk-rewrap.v1|{principal_id}").into_bytes()
}

fn device_key_aad(principal_id: &str) -> Vec<u8> {
    format!("rim.device-key.v1|{principal_id}").into_bytes()
}

fn key_from(bytes: &[u8], what: &'static str) -> Result<Key> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    if bytes.len() != KEY_LEN {
        return Err(Error::Malformed(what));
    }
    key.copy_from_slice(bytes);
    Ok(key)
}

/// The wrap of `data_key` under `key`, bound to `kind` and `principal_id`.
///
/// # Errors
///
/// As [`seal`].
pub fn wrap_data_key(
    key: &[u8; KEY_LEN],
    kind: WrapKind,
    principal_id: &str,
    data_key: &[u8; KEY_LEN],
) -> Result<Vec<u8>> {
    seal(key, &data_key_aad(kind, principal_id), data_key)
}

/// The data key a wrap of `kind` for `principal_id` holds.
///
/// # Errors
///
/// As [`open`]; [`Error::Malformed`] when what opened is not 32 bytes.
pub fn unwrap_data_key(
    key: &[u8; KEY_LEN],
    kind: WrapKind,
    principal_id: &str,
    wrap: &[u8],
) -> Result<Key> {
    let opened = open(key, &data_key_aad(kind, principal_id), wrap)?;
    key_from(&opened, "data key")
}

/// The rewrap a password change leaves at the server: the old unlock key sealed under the new
/// one, so a device whose data key is still wrapped under the old key can open it.
///
/// # Errors
///
/// As [`seal`].
pub fn rewrap_unlock_key(
    new_unlock_key: &[u8; KEY_LEN],
    old_unlock_key: &[u8; KEY_LEN],
    principal_id: &str,
) -> Result<Vec<u8>> {
    seal(new_unlock_key, &rewrap_aad(principal_id), old_unlock_key)
}

/// The old unlock key a rewrap holds.
///
/// # Errors
///
/// As [`open`]; [`Error::Malformed`] when what opened is not 32 bytes.
pub fn unwrap_rewrap(
    new_unlock_key: &[u8; KEY_LEN],
    principal_id: &str,
    rewrap: &[u8],
) -> Result<Key> {
    let opened = open(new_unlock_key, &rewrap_aad(principal_id), rewrap)?;
    key_from(&opened, "unlock key")
}

/// The wrap of `principal_id`'s device key seed under `key`, from [`device_key_wrap_key`].
///
/// # Errors
///
/// As [`seal`].
pub fn wrap_device_seed(
    key: &[u8; KEY_LEN],
    principal_id: &str,
    seed: &[u8; KEY_LEN],
) -> Result<Vec<u8>> {
    seal(key, &device_key_aad(principal_id), seed)
}

/// The device key seed a wrap for `principal_id` holds.
///
/// # Errors
///
/// As [`open`]; [`Error::Malformed`] when what opened is not 32 bytes.
pub fn unwrap_device_seed(key: &[u8; KEY_LEN], principal_id: &str, wrap: &[u8]) -> Result<Key> {
    let opened = open(key, &device_key_aad(principal_id), wrap)?;
    key_from(&opened, "device key seed")
}
