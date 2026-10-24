//! `rim_opaque` for the web app, compiled to WebAssembly.
//!
//! [`OpaqueRegistration`] and [`OpaqueLogin`] run one OPAQUE flow each: the constructor takes
//! the password and makes the request, `finish` takes the server's response. The flow keeps its
//! state and the password in the module's memory, and both are wiped when `finish` returns or
//! the object is freed. [`unlock_key`] and [`transport_key`] derive what the flow's keys open.
//!
//! Bytes travel as `Uint8Array`. A failure throws a JS `Error` whose `name` is the code of
//! [`Failure`].

mod error;

#[cfg(test)]
mod tests;

use js_sys::{Object, Reflect, Uint8Array};
use rim_opaque::keys::KEY_LEN;
use rim_opaque::{ClientLoginFlow, ClientRegistrationFlow, Key, OpaqueKey, OPAQUE_KEY_LEN};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

pub use error::Failure;
use error::Result;

/// An object with one `Uint8Array` per field, copied out of the module's memory.
fn bytes_object(fields: &[(&str, &[u8])]) -> Object {
    let object = Object::new();
    for (name, bytes) in fields {
        // Setting a property on a plain object cannot fail.
        let _ = Reflect::set(&object, &JsValue::from_str(name), &Uint8Array::from(*bytes));
    }
    object
}

fn opaque_key(bytes: &[u8], what: &str) -> Result<OpaqueKey> {
    let mut key = Zeroizing::new([0u8; OPAQUE_KEY_LEN]);
    if bytes.len() != OPAQUE_KEY_LEN {
        return Err(Failure::invalid(format!(
            "{what} must be {OPAQUE_KEY_LEN} bytes"
        )));
    }
    key.copy_from_slice(bytes);
    Ok(key)
}

fn key(bytes: &[u8], what: &str) -> Result<Key> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    if bytes.len() != KEY_LEN {
        return Err(Failure::invalid(format!("{what} must be {KEY_LEN} bytes")));
    }
    key.copy_from_slice(bytes);
    Ok(key)
}

/// A password registration: signup, a password change or a reset.
#[wasm_bindgen]
pub struct OpaqueRegistration {
    password: Zeroizing<Vec<u8>>,
    flow: Option<ClientRegistrationFlow>,
    request: Vec<u8>,
}

impl OpaqueRegistration {
    /// The upload and the export key, without the JS object around them.
    pub(crate) fn finish_bytes(&mut self, response: &[u8]) -> Result<(Vec<u8>, OpaqueKey)> {
        let flow = self.flow.take().ok_or_else(Failure::used)?;
        let password = std::mem::take(&mut self.password);
        Ok(flow.finish(&password, response)?)
    }
}

#[wasm_bindgen]
impl OpaqueRegistration {
    /// Starts registering `password`.
    #[wasm_bindgen(constructor)]
    pub fn new(password: &str) -> Result<OpaqueRegistration> {
        let password = Zeroizing::new(password.as_bytes().to_vec());
        let (flow, request) = ClientRegistrationFlow::start(&password)?;
        Ok(Self {
            password,
            flow: Some(flow),
            request,
        })
    }

    /// The `RegistrationRequest` to send.
    pub fn request(&self) -> Vec<u8> {
        self.request.clone()
    }

    /// Finishes with the server's `RegistrationResponse`. Returns the `RegistrationUpload` to
    /// send and the export key. A flow finishes once.
    #[wasm_bindgen(unchecked_return_type = "{ upload: Uint8Array; exportKey: Uint8Array }")]
    pub fn finish(&mut self, response: &[u8]) -> Result<Object> {
        let (upload, export_key) = self.finish_bytes(response)?;
        Ok(bytes_object(&[
            ("upload", &upload),
            ("exportKey", export_key.as_ref()),
        ]))
    }
}

/// A sign-in with the password.
#[wasm_bindgen]
pub struct OpaqueLogin {
    password: Zeroizing<Vec<u8>>,
    flow: Option<ClientLoginFlow>,
    request: Vec<u8>,
}

impl OpaqueLogin {
    /// The finalization and the keys, without the JS object around them.
    pub(crate) fn finish_bytes(&mut self, response: &[u8]) -> Result<rim_opaque::LoginFinish> {
        let flow = self.flow.take().ok_or_else(Failure::used)?;
        let password = std::mem::take(&mut self.password);
        Ok(flow.finish(&password, response)?)
    }
}

#[wasm_bindgen]
impl OpaqueLogin {
    /// Starts a sign-in with `password`.
    #[wasm_bindgen(constructor)]
    pub fn new(password: &str) -> Result<OpaqueLogin> {
        let password = Zeroizing::new(password.as_bytes().to_vec());
        let (flow, request) = ClientLoginFlow::start(&password)?;
        Ok(Self {
            password,
            flow: Some(flow),
            request,
        })
    }

    /// The `CredentialRequest` to send.
    pub fn request(&self) -> Vec<u8> {
        self.request.clone()
    }

    /// Finishes with the server's `CredentialResponse`. Returns the `CredentialFinalization` to
    /// send, the export key and the session key. Throws `OPAQUE_WRONG_PASSWORD` when the
    /// password is wrong or the account has none. A flow finishes once.
    #[wasm_bindgen(
        unchecked_return_type = "{ finalization: Uint8Array; exportKey: Uint8Array; sessionKey: Uint8Array }"
    )]
    pub fn finish(&mut self, response: &[u8]) -> Result<Object> {
        let finished = self.finish_bytes(response)?;
        Ok(bytes_object(&[
            ("finalization", &finished.finalization),
            ("exportKey", finished.export_key.as_ref()),
            ("sessionKey", finished.session_key.as_ref()),
        ]))
    }
}

/// [`unlock_key`] over bytes.
pub(crate) fn unlock_key_bytes(export_key: &[u8], share: &[u8], principal_id: &str) -> Result<Key> {
    let export_key = opaque_key(export_key, "the export key")?;
    let share = key(share, "the server share")?;
    Ok(rim_opaque::derive_unlock_key(
        &export_key,
        &share,
        principal_id,
    ))
}

/// [`transport_key`] over bytes.
pub(crate) fn transport_key_bytes(session_key: &[u8], label: &str) -> Result<Key> {
    let session_key = opaque_key(session_key, "the session key")?;
    let label = rim_opaque::TransportLabel::parse(label)
        .ok_or_else(|| Failure::invalid(format!("unknown transport label {label:?}")))?;
    Ok(rim_opaque::transport_key(&session_key, label))
}

/// The unlock key of `principalId`: 32 bytes from the login's export key (64 bytes) and the
/// server share (32 bytes).
#[wasm_bindgen(js_name = unlockKey)]
pub fn unlock_key(export_key: &[u8], share: &[u8], principal_id: &str) -> Result<Uint8Array> {
    Ok(Uint8Array::from(
        unlock_key_bytes(export_key, share, principal_id)?.as_ref(),
    ))
}

/// The 32-byte key the server sealed `label` under (`"server share"`, `"keep key"` or
/// `"session secret"`), from the login's session key (64 bytes).
#[wasm_bindgen(js_name = transportKey)]
pub fn transport_key(session_key: &[u8], label: &str) -> Result<Uint8Array> {
    Ok(Uint8Array::from(
        transport_key_bytes(session_key, label)?.as_ref(),
    ))
}
