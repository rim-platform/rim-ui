//! The client side of a RIM account password.
//!
//! The password is checked with OPAQUE (RFC 9807): the server keeps a registration record that
//! verifies the password without revealing it, and every sign-in yields two keys on the
//! device, the export key (only the device knows it) and the session key (shared with the
//! server). [`RimOpaque`] is the suite, byte for byte the one the server runs.
//!
//! [`ClientRegistrationFlow`] registers a password and [`ClientLoginFlow`] signs in with one;
//! both carry their OPAQUE state between the request and the server's answer. The [`keys`]
//! module derives what the two keys unlock: the transport key that opens what the server
//! returns, the unlock key that opens the device's data key, and the AES-256-GCM wraps of that
//! data key.
//!
//! Every secret this crate returns is wiped on drop.

pub mod keys;

use opaque_ke::errors::{InternalError, ProtocolError};
use opaque_ke::{
    ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialResponse, RegistrationResponse,
};
use rand_core::{CryptoRng, OsRng, RngCore};
use zeroize::{Zeroize, Zeroizing};

pub use keys::{
    derive_unlock_key, open, random_key, recovery_wrap_key, rewrap_unlock_key, seal, store_key,
    transport_key, unwrap_data_key, unwrap_rewrap, wrap_data_key, Key, StoreKeyLabel,
    TransportLabel, WrapKind, KEY_LEN,
};

/// The context both sides bind every login to.
pub const LOGIN_CONTEXT: &[u8] = b"rim-opaque-v1";

/// Length of the export key and of the session key: one SHA-512 output.
pub const OPAQUE_KEY_LEN: usize = 64;

/// The export key or the session key of one OPAQUE run, wiped on drop.
pub type OpaqueKey = Zeroizing<[u8; OPAQUE_KEY_LEN]>;

/// The key-stretching function: Argon2id with 64 MiB, 3 passes and 4 lanes, and the all-zero
/// salt OPAQUE prescribes (the OPRF output it stretches is already unique per account).
pub struct RimKsf(argon2::Argon2<'static>);

impl Default for RimKsf {
    fn default() -> Self {
        Self(argon2::Argon2::new(
            argon2::Algorithm::Argon2id,
            argon2::Version::V0x13,
            argon2::Params::new(65536, 3, 4, None).expect("valid"),
        ))
    }
}

impl opaque_ke::ksf::Ksf for RimKsf {
    fn hash<L: generic_array::ArrayLength<u8>>(
        &self,
        input: generic_array::GenericArray<u8, L>,
    ) -> std::result::Result<generic_array::GenericArray<u8, L>, opaque_ke::errors::InternalError>
    {
        let mut out = generic_array::GenericArray::default();
        self.0
            .hash_password_into(&input, &[0; argon2::RECOMMENDED_SALT_LEN], &mut out)
            .map_err(|_| opaque_ke::errors::InternalError::KsfError)?;
        Ok(out)
    }
}

/// The OPAQUE suite of RIM accounts: OPRF over ristretto255, 3DH over ristretto255 with
/// SHA-512, and [`RimKsf`].
pub struct RimOpaque;

impl opaque_ke::CipherSuite for RimOpaque {
    type OprfCs = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf = RimKsf;
}

/// Why a step failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// The login did not verify: the password is wrong, or the server holds no password for
    /// the account. OPAQUE does not tell the two apart.
    #[error("the password is wrong")]
    WrongPassword,
    /// A message or a value is not in the expected form.
    #[error("malformed {0}")]
    Malformed(&'static str),
    /// A sealed value did not open: the key, the AAD or a byte of it is wrong.
    #[error("the sealed value did not open")]
    Unauthentic,
    /// The protocol failed for another reason: a server that reflected the blinded password,
    /// or an internal error.
    #[error("OPAQUE failed: {0}")]
    Protocol(String),
}

/// The crate's result type.
pub type Result<T> = std::result::Result<T, Error>;

fn protocol_error(what: &'static str, e: ProtocolError) -> Error {
    match e {
        ProtocolError::InvalidLoginError => Error::WrongPassword,
        ProtocolError::SerializationError | ProtocolError::SizeError { .. } => {
            Error::Malformed(what)
        }
        ProtocolError::ReflectedValueError => {
            Error::Protocol("the server reflected the blinded password".into())
        }
        ProtocolError::LibraryError(InternalError::KsfError) => {
            Error::Protocol("the key-stretching function failed".into())
        }
        ProtocolError::LibraryError(e) => Error::Protocol(format!("{e:?}")),
        ProtocolError::Custom(never) => match never {},
    }
}

fn copy_key(bytes: &[u8]) -> OpaqueKey {
    let mut key = Zeroizing::new([0u8; OPAQUE_KEY_LEN]);
    key.copy_from_slice(bytes);
    key
}

/// A password registration between its request and the server's response.
pub struct ClientRegistrationFlow {
    state: ClientRegistration<RimOpaque>,
}

impl ClientRegistrationFlow {
    /// Starts registering `password` and returns the flow and the `RegistrationRequest` to
    /// send.
    ///
    /// # Errors
    ///
    /// [`Error::Protocol`] when the password cannot be blinded.
    pub fn start(password: &[u8]) -> Result<(Self, Vec<u8>)> {
        Self::start_with_rng(&mut OsRng, password)
    }

    /// [`ClientRegistrationFlow::start`] with the caller's randomness, for known-answer tests.
    ///
    /// # Errors
    ///
    /// As [`ClientRegistrationFlow::start`].
    pub fn start_with_rng<R: RngCore + CryptoRng>(
        rng: &mut R,
        password: &[u8],
    ) -> Result<(Self, Vec<u8>)> {
        let started = ClientRegistration::<RimOpaque>::start(rng, password)
            .map_err(|e| protocol_error("password", e))?;
        Ok((
            Self {
                state: started.state,
            },
            started.message.serialize().to_vec(),
        ))
    }

    /// Finishes with the server's `RegistrationResponse` and returns the
    /// `RegistrationUpload` to send and the export key.
    ///
    /// # Errors
    ///
    /// [`Error::Malformed`] when `response` is not a `RegistrationResponse`;
    /// [`Error::Protocol`] when the server reflected the request or Argon2id failed.
    pub fn finish(self, password: &[u8], response: &[u8]) -> Result<(Vec<u8>, OpaqueKey)> {
        self.finish_with_rng(&mut OsRng, password, response)
    }

    /// [`ClientRegistrationFlow::finish`] with the caller's randomness, for known-answer tests.
    ///
    /// # Errors
    ///
    /// As [`ClientRegistrationFlow::finish`].
    pub fn finish_with_rng<R: RngCore + CryptoRng>(
        self,
        rng: &mut R,
        password: &[u8],
        response: &[u8],
    ) -> Result<(Vec<u8>, OpaqueKey)> {
        let response = RegistrationResponse::<RimOpaque>::deserialize(response)
            .map_err(|_| Error::Malformed("registration response"))?;
        let mut finished = self
            .state
            .finish(
                rng,
                password,
                response,
                ClientRegistrationFinishParameters::default(),
            )
            .map_err(|e| protocol_error("registration response", e))?;
        let export_key = copy_key(&finished.export_key);
        finished.export_key.as_mut_slice().zeroize();
        Ok((finished.message.serialize().to_vec(), export_key))
    }
}

/// What a successful login gives: the `CredentialFinalization` to send, the export key and
/// the session key.
pub struct LoginFinish {
    pub finalization: Vec<u8>,
    pub export_key: OpaqueKey,
    pub session_key: OpaqueKey,
}

/// A login between its request and the server's response.
pub struct ClientLoginFlow {
    state: ClientLogin<RimOpaque>,
}

impl ClientLoginFlow {
    /// Starts a login with `password` and returns the flow and the `CredentialRequest` to send.
    ///
    /// # Errors
    ///
    /// [`Error::Protocol`] when the password cannot be blinded.
    pub fn start(password: &[u8]) -> Result<(Self, Vec<u8>)> {
        Self::start_with_rng(&mut OsRng, password)
    }

    /// [`ClientLoginFlow::start`] with the caller's randomness, for known-answer tests.
    ///
    /// # Errors
    ///
    /// As [`ClientLoginFlow::start`].
    pub fn start_with_rng<R: RngCore + CryptoRng>(
        rng: &mut R,
        password: &[u8],
    ) -> Result<(Self, Vec<u8>)> {
        let started = ClientLogin::<RimOpaque>::start(rng, password)
            .map_err(|e| protocol_error("password", e))?;
        Ok((
            Self {
                state: started.state,
            },
            started.message.serialize().to_vec(),
        ))
    }

    /// Finishes with the server's `CredentialResponse`, bound to [`LOGIN_CONTEXT`].
    ///
    /// # Errors
    ///
    /// [`Error::WrongPassword`] when the login does not verify; [`Error::Malformed`] when
    /// `response` is not a `CredentialResponse`; [`Error::Protocol`] when the server reflected
    /// the request or Argon2id failed.
    pub fn finish(self, password: &[u8], response: &[u8]) -> Result<LoginFinish> {
        self.finish_with_rng(&mut OsRng, password, response)
    }

    /// [`ClientLoginFlow::finish`] with the caller's randomness, for known-answer tests.
    ///
    /// # Errors
    ///
    /// As [`ClientLoginFlow::finish`].
    pub fn finish_with_rng<R: RngCore + CryptoRng>(
        self,
        rng: &mut R,
        password: &[u8],
        response: &[u8],
    ) -> Result<LoginFinish> {
        let response = CredentialResponse::<RimOpaque>::deserialize(response)
            .map_err(|_| Error::Malformed("credential response"))?;
        let mut finished = self
            .state
            .finish(
                rng,
                password,
                response,
                ClientLoginFinishParameters::new(Some(LOGIN_CONTEXT), Default::default(), None),
            )
            .map_err(|e| protocol_error("credential response", e))?;
        let export_key = copy_key(&finished.export_key);
        let session_key = copy_key(&finished.session_key);
        finished.export_key.as_mut_slice().zeroize();
        finished.session_key.as_mut_slice().zeroize();
        Ok(LoginFinish {
            finalization: finished.message.serialize().to_vec(),
            export_key,
            session_key,
        })
    }
}

#[cfg(test)]
mod tests;
