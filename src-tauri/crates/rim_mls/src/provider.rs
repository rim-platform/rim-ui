//! The OpenMLS provider: a crypto backend composed with RIM's storage, and the signer that
//! signs with this device's MLS signature key.

use openmls_traits::crypto::OpenMlsCrypto;
use openmls_traits::random::OpenMlsRand;
use openmls_traits::signatures::{Signer, SignerError};
use openmls_traits::types::SignatureScheme;
use openmls_traits::OpenMlsProvider;
use zeroize::Zeroizing;

use crate::error::{Error, Result};
use crate::storage::KvStorage;

/// The crypto backend an [`crate::Mls`] runs on. Clients use libcrux; the RustCrypto provider is
/// the named fallback and the second implementation the cross-provider tests compare against.
pub(crate) enum Backend {
    Libcrux(openmls_libcrux_crypto::CryptoProvider),
    #[cfg(test)]
    RustCrypto(Box<openmls_rust_crypto::RustCrypto>),
}

/// Runs `$body` with `$crypto` bound to the backend's crypto provider, whichever it is.
macro_rules! with_crypto {
    ($backend:expr, |$crypto:ident| $body:expr) => {
        match $backend {
            $crate::provider::Backend::Libcrux($crypto) => $body,
            #[cfg(test)]
            $crate::provider::Backend::RustCrypto(boxed) => {
                let $crypto = &**boxed;
                $body
            }
        }
    };
}
pub(crate) use with_crypto;

/// A crypto provider that is also its own source of randomness, as both OpenMLS providers are.
pub(crate) trait Crypto: OpenMlsCrypto + OpenMlsRand {}
impl<T: OpenMlsCrypto + OpenMlsRand> Crypto for T {}

/// One operation's OpenMLS provider: the backend's crypto and a storage view of the caller's
/// store, both borrowed for the operation.
pub(crate) struct Provider<'a, C> {
    crypto: &'a C,
    storage: KvStorage<'a>,
}

impl<'a, C: Crypto> Provider<'a, C> {
    pub(crate) fn new(crypto: &'a C, storage: KvStorage<'a>) -> Self {
        Self { crypto, storage }
    }
}

impl<'a, C: Crypto> OpenMlsProvider for Provider<'a, C> {
    type CryptoProvider = C;
    type RandProvider = C;
    type StorageProvider = KvStorage<'a>;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        self.crypto
    }

    fn rand(&self) -> &Self::RandProvider {
        self.crypto
    }
}

/// This device's MLS signature key (Ed25519, the suite's signature scheme), signing through the
/// backend's crypto provider.
pub(crate) struct MlsSigner<'a, C> {
    crypto: &'a C,
    private: Zeroizing<Vec<u8>>,
}

impl<'a, C: Crypto> MlsSigner<'a, C> {
    pub(crate) fn new(crypto: &'a C, private: &[u8]) -> Self {
        Self {
            crypto,
            private: Zeroizing::new(private.to_vec()),
        }
    }
}

impl<C: Crypto> Signer for MlsSigner<'_, C> {
    fn sign(&self, payload: &[u8]) -> std::result::Result<Vec<u8>, SignerError> {
        self.crypto
            .sign(SignatureScheme::ED25519, payload, &self.private)
            .map_err(SignerError::CryptoError)
    }

    fn signature_scheme(&self) -> SignatureScheme {
        SignatureScheme::ED25519
    }
}

/// A fresh Ed25519 key pair from the backend: (private seed, public key).
pub(crate) fn signature_key_pair<C: Crypto>(crypto: &C) -> Result<(Zeroizing<Vec<u8>>, Vec<u8>)> {
    let (private, public) = crypto
        .signature_key_gen(SignatureScheme::ED25519)
        .map_err(|e| Error::Crypto(format!("signature key generation: {e:?}")))?;
    Ok((Zeroizing::new(private), public))
}
