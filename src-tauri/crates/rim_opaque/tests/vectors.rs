//! The shared OPAQUE test vector, `vectors/opaque-v1.json`: one registration and one login of
//! the RIM suite, every message drawn from one seeded RNG. The server replays the same file, so
//! both sides prove they speak the same suite byte for byte.
//!
//! The randomness is one `ChaCha20Rng::from_seed([7; 32])` (`rand_chacha` 0.3), drawn by these
//! calls in this order:
//! 1. `ServerSetup::new`
//! 2. `ClientRegistration::start(password)`
//! 3. `ServerRegistration::start(setup, request, credential id)`
//! 4. `ClientRegistration::finish(password, response, default parameters)`
//! 5. `ServerRegistration::finish(upload)`: the password file
//! 6. `ClientLogin::start(password)`
//! 7. `ServerLogin::start(setup, password file, request, credential id, context)`
//! 8. `ClientLogin::finish(password, response, context)`
//! 9. `ServerLogin::finish(finalization, context)`
//!
//! The context is `rim-opaque-v1`. Byte values are unpadded base64url, the seed is hex. The file
//! is `serde_json::to_string_pretty` of [`Vector`] plus a newline;
//! `cargo test -p rim_opaque --test vectors -- --ignored` rewrites it.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use opaque_ke::{
    CredentialFinalization, CredentialRequest, RegistrationRequest, RegistrationUpload,
    ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use rim_opaque::{ClientLoginFlow, ClientRegistrationFlow, RimOpaque, LOGIN_CONTEXT};
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

const FILE: &str = include_str!("vectors/opaque-v1.json");

const SEED: [u8; 32] = [7; 32];
const PASSWORD: &str = "correct horse battery staple";
const CREDENTIAL_ID: &str = "rimp1_vectortest";

/// The vector file.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    /// The suite's name, which is also the login context.
    suite: String,
    /// The 32-byte `ChaCha20Rng` seed, hex.
    seed: String,
    /// The password, as UTF-8.
    password: String,
    /// The credential identifier, as UTF-8.
    credential_id: String,
    server_setup: String,
    registration_request: String,
    registration_response: String,
    registration_upload: String,
    registration_export_key: String,
    password_file: String,
    credential_request: String,
    credential_response: String,
    credential_finalization: String,
    login_export_key: String,
    client_session_key: String,
    server_session_key: String,
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn unb64(text: &str) -> Vec<u8> {
    URL_SAFE_NO_PAD.decode(text).unwrap()
}

/// Runs the registration and the login from the seed, the client through this crate.
fn generate(seed: [u8; 32], password: &str, credential_id: &str) -> Vector {
    let mut rng = ChaCha20Rng::from_seed(seed);
    let pw = password.as_bytes();
    let id = credential_id.as_bytes();
    let parameters = || ServerLoginParameters {
        context: Some(LOGIN_CONTEXT),
        identifiers: Default::default(),
    };

    let setup = ServerSetup::<RimOpaque>::new(&mut rng);

    let (registration, registration_request) =
        ClientRegistrationFlow::start_with_rng(&mut rng, pw).unwrap();
    let registration_response = ServerRegistration::<RimOpaque>::start(
        &setup,
        RegistrationRequest::deserialize(&registration_request).unwrap(),
        id,
    )
    .unwrap()
    .message
    .serialize()
    .to_vec();
    let (registration_upload, registration_export_key) = registration
        .finish_with_rng(&mut rng, pw, &registration_response)
        .unwrap();
    let password_file = ServerRegistration::<RimOpaque>::finish(
        RegistrationUpload::deserialize(&registration_upload).unwrap(),
    );

    let (login, credential_request) = ClientLoginFlow::start_with_rng(&mut rng, pw).unwrap();
    let server = ServerLogin::start(
        &mut rng,
        &setup,
        Some(password_file.clone()),
        CredentialRequest::deserialize(&credential_request).unwrap(),
        id,
        parameters(),
    )
    .unwrap();
    let credential_response = server.message.serialize().to_vec();
    let finished = login
        .finish_with_rng(&mut rng, pw, &credential_response)
        .unwrap();
    let server_session_key = server
        .state
        .finish(
            CredentialFinalization::deserialize(&finished.finalization).unwrap(),
            parameters(),
        )
        .unwrap()
        .session_key;

    Vector {
        suite: String::from_utf8(LOGIN_CONTEXT.to_vec()).unwrap(),
        seed: seed.iter().map(|b| format!("{b:02x}")).collect(),
        password: password.into(),
        credential_id: credential_id.into(),
        server_setup: b64(&setup.serialize()),
        registration_request: b64(&registration_request),
        registration_response: b64(&registration_response),
        registration_upload: b64(&registration_upload),
        registration_export_key: b64(registration_export_key.as_ref()),
        password_file: b64(&password_file.serialize()),
        credential_request: b64(&credential_request),
        credential_response: b64(&credential_response),
        credential_finalization: b64(&finished.finalization),
        login_export_key: b64(finished.export_key.as_ref()),
        client_session_key: b64(finished.session_key.as_ref()),
        server_session_key: b64(&server_session_key),
    }
}

fn file_text(vector: &Vector) -> String {
    format!("{}\n", serde_json::to_string_pretty(vector).unwrap())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
#[ignore = "rewrites the vector file"]
fn generate_the_vector() {
    std::fs::write(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors/opaque-v1.json"),
        file_text(&generate(SEED, PASSWORD, CREDENTIAL_ID)),
    )
    .unwrap();
}

#[test]
fn the_vector_replays() {
    let stored: Vector = serde_json::from_str(FILE).unwrap();
    assert_eq!(stored.seed, "07".repeat(32));
    let replayed = generate(SEED, &stored.password, &stored.credential_id);
    assert_eq!(replayed, stored);
    assert_eq!(
        file_text(&replayed),
        FILE,
        "the file is byte for byte the generator's"
    );
    assert_eq!(replayed.registration_export_key, replayed.login_export_key);
    assert_eq!(replayed.client_session_key, replayed.server_session_key);
}

#[test]
fn the_client_alone_reproduces_its_messages_and_keys() {
    let stored: Vector = serde_json::from_str(FILE).unwrap();
    let pw = stored.password.as_bytes();

    // The client's draws from the same stream, skipping the server's.
    let mut rng = ChaCha20Rng::from_seed(SEED);
    let _ = ServerSetup::<RimOpaque>::new(&mut rng);
    let (registration, request) = ClientRegistrationFlow::start_with_rng(&mut rng, pw).unwrap();
    assert_eq!(b64(&request), stored.registration_request);
    let (upload, export_key) = registration
        .finish_with_rng(&mut rng, pw, &unb64(&stored.registration_response))
        .unwrap();
    assert_eq!(b64(&upload), stored.registration_upload);
    assert_eq!(b64(export_key.as_ref()), stored.registration_export_key);

    let (login, request) = ClientLoginFlow::start_with_rng(&mut rng, pw).unwrap();
    assert_eq!(b64(&request), stored.credential_request);
    let finished = login
        .finish(pw, &unb64(&stored.credential_response))
        .unwrap();
    assert_eq!(b64(&finished.finalization), stored.credential_finalization);
    assert_eq!(b64(finished.export_key.as_ref()), stored.login_export_key);
    assert_eq!(
        b64(finished.session_key.as_ref()),
        stored.client_session_key
    );
}
