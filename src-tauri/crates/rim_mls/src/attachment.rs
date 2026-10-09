//! Encrypted attachments: AES-256-GCM under a key and nonce derived from a per-file secret.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::content::{AttachmentEntry, MAX_ATTACHMENT_PLAINTEXT};
use crate::error::{Error, Result};

const KEY_INFO: &[u8] = b"rim.e2ee.attachment.v1 key";
const NONCE_INFO: &[u8] = b"rim.e2ee.attachment.v1 nonce";
const AAD: &[u8] = b"rim.e2ee.attachment.v1";

/// The AES-256 key and the 12-byte nonce a secret derives: HKDF-SHA256 without salt.
pub fn attachment_key_and_nonce(secret: &[u8; 32]) -> (Zeroizing<[u8; 32]>, [u8; 12]) {
    let hkdf = Hkdf::<Sha256>::new(None, secret);
    let mut key = Zeroizing::new([0u8; 32]);
    let mut nonce = [0u8; 12];
    // 32 and 12 bytes are valid HKDF-SHA256 output lengths.
    hkdf.expand(KEY_INFO, key.as_mut())
        .expect("32 bytes is a valid HKDF-SHA256 length");
    hkdf.expand(NONCE_INFO, &mut nonce)
        .expect("12 bytes is a valid HKDF-SHA256 length");
    (key, nonce)
}

/// An encrypted file: the blob to upload and the entry the message carries.
pub struct EncryptedAttachment {
    pub blob: Vec<u8>,
    pub entry: AttachmentEntry,
}

/// Encrypt `plaintext` under a fresh random secret.
pub fn encrypt_attachment(
    plaintext: &[u8],
    name: impl Into<String>,
    mime: impl Into<String>,
) -> Result<EncryptedAttachment> {
    let mut secret = Zeroizing::new([0u8; 32]);
    getrandom::fill(secret.as_mut()).map_err(|e| Error::Crypto(format!("random: {e}")))?;
    encrypt_attachment_with(secret, plaintext, name, mime)
}

/// Encrypt `plaintext` under `secret`. A secret encrypts one file only.
pub fn encrypt_attachment_with(
    secret: Zeroizing<[u8; 32]>,
    plaintext: &[u8],
    name: impl Into<String>,
    mime: impl Into<String>,
) -> Result<EncryptedAttachment> {
    if plaintext.len() as u64 > MAX_ATTACHMENT_PLAINTEXT {
        return Err(Error::Invalid(
            "the attachment is larger than 25 MiB".into(),
        ));
    }
    let (key, nonce) = attachment_key_and_nonce(&secret);
    let blob = Aes256Gcm::new(key.as_ref().into())
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: AAD,
            },
        )
        .map_err(|_| Error::Crypto("attachment encryption failed".into()))?;
    let blob_sha256 = Sha256::digest(&blob).into();
    Ok(EncryptedAttachment {
        blob,
        entry: AttachmentEntry {
            blob_sha256,
            secret,
            name: name.into(),
            mime: mime.into(),
            size: plaintext.len() as u64,
        },
    })
}

/// Decrypt a downloaded blob: its hash must be the entry's, it must decrypt under the entry's
/// secret, and the plaintext must have the entry's size.
pub fn decrypt_attachment(entry: &AttachmentEntry, blob: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    let hash: [u8; 32] = Sha256::digest(blob).into();
    if hash != entry.blob_sha256 {
        return Err(Error::Invalid(
            "the blob is not the one the message names".into(),
        ));
    }
    let (key, nonce) = attachment_key_and_nonce(&entry.secret);
    let plaintext = Zeroizing::new(
        Aes256Gcm::new(key.as_ref().into())
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: blob,
                    aad: AAD,
                },
            )
            .map_err(|_| Error::Decrypt("the attachment does not decrypt".into()))?,
    );
    if plaintext.len() as u64 != entry.size {
        return Err(Error::Invalid("the attachment has the wrong size".into()));
    }
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tampering_with_the_blob_or_entry_is_refused() {
        let encrypted = encrypt_attachment(b"hello", "a.txt", "text/plain").unwrap();
        assert_eq!(
            decrypt_attachment(&encrypted.entry, &encrypted.blob)
                .unwrap()
                .as_slice(),
            b"hello"
        );

        let mut blob = encrypted.blob.clone();
        blob[0] ^= 1;
        assert!(decrypt_attachment(&encrypted.entry, &blob).is_err());

        // A blob whose hash the entry names, but under another secret.
        let mut entry = encrypted.entry.clone();
        entry.secret = Zeroizing::new([1; 32]);
        assert!(decrypt_attachment(&entry, &encrypted.blob).is_err());

        let mut entry = encrypted.entry.clone();
        entry.size += 1;
        assert!(decrypt_attachment(&entry, &encrypted.blob).is_err());
    }
}
