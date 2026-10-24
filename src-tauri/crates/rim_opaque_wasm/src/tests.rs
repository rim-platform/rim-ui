//! The flows as the page drives them, against an in-process OPAQUE server. Runs natively and,
//! with `wasm-bindgen-test`, in a browser.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use opaque_ke::{
    CredentialFinalization, CredentialRequest, RegistrationRequest, RegistrationUpload,
    ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand_core::OsRng;
use rim_opaque::{RimOpaque, LOGIN_CONTEXT};

use crate::{transport_key_bytes, unlock_key_bytes, OpaqueLogin, OpaqueRegistration};

#[cfg(target_arch = "wasm32")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

const PRINCIPAL: &str = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";

fn context() -> ServerLoginParameters<'static, 'static> {
    ServerLoginParameters {
        context: Some(LOGIN_CONTEXT),
        ..Default::default()
    }
}

/// Registers `password` and returns the server's setup, its record and the export key.
fn register(
    password: &str,
) -> (
    ServerSetup<RimOpaque>,
    ServerRegistration<RimOpaque>,
    Vec<u8>,
) {
    let setup = ServerSetup::<RimOpaque>::new(&mut OsRng);
    let mut registration = OpaqueRegistration::new(password).unwrap();
    let response = ServerRegistration::<RimOpaque>::start(
        &setup,
        RegistrationRequest::deserialize(&registration.request()).unwrap(),
        PRINCIPAL.as_bytes(),
    )
    .unwrap()
    .message
    .serialize();
    let (upload, export_key) = registration.finish_bytes(&response).unwrap();
    let record = ServerRegistration::finish(RegistrationUpload::deserialize(&upload).unwrap());
    (setup, record, export_key.to_vec())
}

#[test]
fn a_registration_then_a_login_agree_on_the_keys() {
    let (setup, record, export_key) = register("a passphrase of five words");

    let mut login = OpaqueLogin::new("a passphrase of five words").unwrap();
    let started = ServerLogin::start(
        &mut OsRng,
        &setup,
        Some(record),
        CredentialRequest::deserialize(&login.request()).unwrap(),
        PRINCIPAL.as_bytes(),
        context(),
    )
    .unwrap();
    let finished = login.finish_bytes(&started.message.serialize()).unwrap();
    let server_session_key = started
        .state
        .finish(
            CredentialFinalization::deserialize(&finished.finalization).unwrap(),
            context(),
        )
        .unwrap()
        .session_key;

    assert_eq!(finished.export_key.as_slice(), export_key.as_slice());
    assert_eq!(
        finished.session_key.as_slice(),
        server_session_key.as_slice()
    );
    assert_eq!(
        login.finish_bytes(&[]).err().map(|f| f.code),
        Some("OPAQUE_USED")
    );
}

#[test]
fn a_wrong_password_throws_its_code() {
    let (setup, record, _) = register("the right one");
    let mut login = OpaqueLogin::new("the wrong one").unwrap();
    let started = ServerLogin::start(
        &mut OsRng,
        &setup,
        Some(record),
        CredentialRequest::deserialize(&login.request()).unwrap(),
        PRINCIPAL.as_bytes(),
        context(),
    )
    .unwrap();
    assert_eq!(
        login
            .finish_bytes(&started.message.serialize())
            .err()
            .map(|f| f.code),
        Some("OPAQUE_WRONG_PASSWORD")
    );
}

#[test]
fn the_derivations_check_their_inputs() {
    let unlock = unlock_key_bytes(&[1; 64], &[2; 32], PRINCIPAL).unwrap();
    assert_eq!(
        *unlock,
        *rim_opaque::derive_unlock_key(&[1; 64], &[2; 32], PRINCIPAL)
    );
    assert_eq!(
        unlock_key_bytes(&[1; 32], &[2; 32], PRINCIPAL)
            .err()
            .map(|f| f.code),
        Some("OPAQUE_INVALID")
    );
    assert_eq!(
        unlock_key_bytes(&[1; 64], &[2; 16], PRINCIPAL)
            .err()
            .map(|f| f.code),
        Some("OPAQUE_INVALID")
    );

    let transport = transport_key_bytes(&[3; 64], "keep key").unwrap();
    assert_eq!(
        *transport,
        *rim_opaque::transport_key(&[3; 64], rim_opaque::TransportLabel::KeepKey)
    );
    assert_eq!(
        transport_key_bytes(&[3; 64], "keep").err().map(|f| f.code),
        Some("OPAQUE_INVALID")
    );
}

#[cfg(target_arch = "wasm32")]
#[test]
fn finish_returns_the_fields_the_page_reads() {
    use js_sys::{Reflect, Uint8Array};
    use wasm_bindgen::JsCast;

    let setup = ServerSetup::<RimOpaque>::new(&mut OsRng);
    let mut registration = OpaqueRegistration::new("browser password").unwrap();
    let response = ServerRegistration::<RimOpaque>::start(
        &setup,
        RegistrationRequest::deserialize(&registration.request()).unwrap(),
        PRINCIPAL.as_bytes(),
    )
    .unwrap()
    .message
    .serialize();
    let result = registration.finish(&response).unwrap();
    let field = |name: &str| {
        Reflect::get(&result, &name.into())
            .unwrap()
            .dyn_into::<Uint8Array>()
            .unwrap()
            .to_vec()
    };
    assert_eq!(field("exportKey").len(), 64);
    assert!(RegistrationUpload::<RimOpaque>::deserialize(&field("upload")).is_ok());

    let key = crate::transport_key(&[3; 64], "server share").unwrap();
    assert_eq!(key.length(), 32);
}
