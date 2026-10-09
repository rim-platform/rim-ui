//! Keys of the history archive (`docs/specs/history-archive-v1.md`, "Keys").
//!
//! One random 256-bit archive key per archive. Every file is sealed with XChaCha20-Poly1305
//! under a subkey of it; the user's passphrase only wraps it (Argon2id), and so can a key
//! derived from the identity key (`identity`), without re-encrypting a single file.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::Zeroizing;

use super::ArchiveError;

/// XChaCha20-Poly1305 nonce length: random nonces are safe at this size.
pub(crate) const NONCE_LEN: usize = 24;

/// HKDF `info` of the subkey that seals the archive's files.
const FILE_KEY_INFO: &[u8] = b"rim-history-archive v1 file key";
/// HKDF `info` of the subkey that names the per-account folder.
const NAME_KEY_INFO: &[u8] = b"rim-history-archive v1 name key";

/// The archive key. Zeroed on drop.
#[derive(Clone)]
pub(crate) struct ArchiveKey(Zeroizing<[u8; 32]>);

impl ArchiveKey {
    pub(crate) fn generate() -> Result<Self, ArchiveError> {
        let mut bytes = Zeroizing::new([0u8; 32]);
        getrandom::fill(bytes.as_mut())
            .map_err(|e| ArchiveError::Crypto(format!("random generation failed: {e}")))?;
        Ok(Self(bytes))
    }

    #[cfg(test)]
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    /// The key in `bytes`, copied straight into zeroed-on-drop memory (no stray copy on the
    /// stack). `None` unless `bytes` is 32 bytes long.
    pub(crate) fn from_slice(bytes: &[u8]) -> Option<Self> {
        let mut key = Zeroizing::new([0u8; 32]);
        if bytes.len() != key.len() {
            return None;
        }
        key.copy_from_slice(bytes);
        Some(Self(key))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    fn subkey(&self, info: &[u8]) -> Zeroizing<[u8; 32]> {
        let mut out = Zeroizing::new([0u8; 32]);
        Hkdf::<Sha256>::new(None, self.0.as_ref())
            .expand(info, out.as_mut())
            .expect("32 bytes is a valid HKDF-SHA256 output length");
        out
    }

    /// The key every archive file is sealed with.
    pub(crate) fn file_key(&self) -> Zeroizing<[u8; 32]> {
        self.subkey(FILE_KEY_INFO)
    }

    /// The folder name of an account inside the archive: HMAC-SHA256 of the account label,
    /// 128 bits in hex. The drive sees neither the server nor the user id.
    pub(crate) fn account_tag(&self, account_label: &str) -> String {
        let key = self.subkey(NAME_KEY_INFO);
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key.as_ref())
            .expect("HMAC takes a key of any length");
        mac.update(account_label.as_bytes());
        hex::encode(&mac.finalize().into_bytes()[..16])
    }
}

pub(crate) fn random_bytes<const N: usize>() -> Result<[u8; N], ArchiveError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes)
        .map_err(|e| ArchiveError::Crypto(format!("random generation failed: {e}")))?;
    Ok(bytes)
}

/// Encrypt `plaintext` under `key` with a fresh random nonce, authenticating `aad` too.
pub(crate) fn seal(
    key: &[u8; 32],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<([u8; NONCE_LEN], Vec<u8>), ArchiveError> {
    let nonce = random_bytes::<NONCE_LEN>()?;
    Ok((nonce, seal_with_nonce(key, &nonce, aad, plaintext)?))
}

/// [`seal`] with a nonce the caller drew (and must never reuse under the same key).
pub(crate) fn seal_with_nonce(
    key: &[u8; 32],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, ArchiveError> {
    XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| ArchiveError::Crypto("encryption failed".into()))
}

/// Decrypt and authenticate. Fails if the key, nonce, `aad` or a single byte is wrong.
pub(crate) fn open(
    key: &[u8; 32],
    nonce: &[u8],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>, ArchiveError> {
    if nonce.len() != NONCE_LEN {
        return Err(ArchiveError::Format("nonce has the wrong length".into()));
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| ArchiveError::Unauthentic)
}

/// Argon2id cost. Stored in the manifest next to the wrapped key so it can be raised later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct KdfCost {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl KdfCost {
    /// What a new archive uses: 64 MiB, 3 passes, 1 lane (above OWASP's Argon2id minimum of
    /// 19 MiB and 2 passes; about half a second on a laptop).
    pub(crate) const DEFAULT: Self = Self {
        memory_kib: 64 * 1024,
        iterations: 3,
        parallelism: 1,
    };

    /// A manifest is input from a shared folder: a cost beyond these bounds is refused
    /// instead of making the app allocate gigabytes or spin for minutes.
    fn check(&self) -> Result<(), ArchiveError> {
        let ok = (8..=1024 * 1024).contains(&self.memory_kib)
            && (1..=16).contains(&self.iterations)
            && (1..=16).contains(&self.parallelism)
            && self.memory_kib >= 8 * self.parallelism;
        if ok {
            Ok(())
        } else {
            Err(ArchiveError::Format(
                "key derivation cost out of bounds".into(),
            ))
        }
    }
}

/// Shortest passphrase a new archive accepts, in characters.
pub(crate) const MIN_PASSPHRASE_CHARS: usize = 12;

/// The key that wraps the archive key: Argon2id over the passphrase.
pub(crate) fn passphrase_key(
    passphrase: &str,
    salt: &[u8],
    cost: KdfCost,
) -> Result<Zeroizing<[u8; 32]>, ArchiveError> {
    cost.check()?;
    let params = Params::new(cost.memory_kib, cost.iterations, cost.parallelism, Some(32))
        .map_err(|e| ArchiveError::Format(format!("key derivation parameters: {e}")))?;
    let mut out = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, out.as_mut())
        .map_err(|e| ArchiveError::Crypto(format!("key derivation failed: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_and_open_round_trip_and_bind_the_aad() {
        let key = [3u8; 32];
        let (nonce, ciphertext) = seal(&key, b"aad", b"hello").unwrap();
        assert_eq!(&*open(&key, &nonce, b"aad", &ciphertext).unwrap(), b"hello");
        assert!(matches!(
            open(&key, &nonce, b"other", &ciphertext),
            Err(ArchiveError::Unauthentic)
        ));
        assert!(matches!(
            open(&[4u8; 32], &nonce, b"aad", &ciphertext),
            Err(ArchiveError::Unauthentic)
        ));
    }

    #[test]
    fn subkeys_differ_from_each_other_and_from_the_key() {
        let key = ArchiveKey::from_bytes([9u8; 32]);
        assert_ne!(*key.file_key(), *key.as_bytes());
        assert_ne!(key.account_tag("a"), key.account_tag("b"));
        assert_eq!(key.account_tag("a").len(), 32);
        let other = ArchiveKey::from_bytes([8u8; 32]);
        assert_ne!(key.account_tag("a"), other.account_tag("a"));
    }

    #[test]
    fn passphrase_key_is_deterministic_and_rejects_absurd_costs() {
        let cost = KdfCost {
            memory_kib: 64,
            iterations: 1,
            parallelism: 1,
        };
        let a = passphrase_key("correct horse", b"saltsaltsaltsalt", cost).unwrap();
        let b = passphrase_key("correct horse", b"saltsaltsaltsalt", cost).unwrap();
        let c = passphrase_key("correct horsf", b"saltsaltsaltsalt", cost).unwrap();
        assert_eq!(*a, *b);
        assert_ne!(*a, *c);
        let huge = KdfCost {
            memory_kib: 4 * 1024 * 1024,
            ..cost
        };
        assert!(passphrase_key("x", b"saltsaltsaltsalt", huge).is_err());
    }
}
