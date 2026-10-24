//! The shared OPAQUE test vector, `vectors/opaque-v1.json`: one registration and one login of
//! the RIM suite, every message drawn from one seeded RNG. The server runs the same replay over
//! the same file, so both sides prove they speak the same suite byte for byte.
//!
//! The randomness is `ChaCha20Rng::from_seed(seed)` (`rand_chacha` 0.3), one stream drawn by
//! these calls in this order:
//! 1. `ServerSetup::<RimOpaque>::new`
//! 2. `ClientRegistration::start(password)`
//! 3. `ServerRegistration::start(setup, request, credential identifier)` (draws nothing)
//! 4. `ClientRegistration::finish(password, response, default parameters)`
//! 5. `ClientLogin::start(password)`
//! 6. `ServerLogin::start(setup, record, request, credential identifier, context)`
//! 7. `ClientLogin::finish(password, response, context)`
//! 8. `ServerLogin::finish(finalization, context)` (draws nothing)
//!
//! Bytes are lowercase hex. The file is `serde_json::to_string_pretty` of [`Vector`] plus a
//! newline. `RIM_WRITE_OPAQUE_VECTORS=1 cargo test -p rim_opaque --test vectors` rewrites it.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use opaque_ke::{
    RegistrationRequest, RegistrationUpload, ServerLogin, ServerLoginParameters,
    ServerRegistration, ServerSetup,
};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use rim_opaque::{ClientLoginFlow, ClientRegistrationFlow, RimOpaque, LOGIN_CONTEXT};
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

const FILE: &str = include_str!("vectors/opaque-v1.json");

const SEED: [u8; 32] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
];
const PASSWORD: &str = "correct horse battery staple";
const CREDENTIAL_IDENTIFIER: &str = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";

/// The vector file.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Vector {
    /// The suite, in words.
    suite: String,
    /// The login context, as UTF-8.
    context: String,
    /// The 32-byte `ChaCha20Rng` seed.
    seed: String,
    /// The password, as UTF-8.
    password: String,
    /// The credential identifier (the principal id), as UTF-8.
    credential_identifier: String,
    server_setup: String,
    registration_request: String,
    registration_response: String,
    registration_upload: String,
    credential_request: String,
    credential_response: String,
    credential_finalization: String,
    /// The export key, the same from the registration and the login.
    export_key: String,
    /// The session key, the same on both sides.
    session_key: String,
}

/// Runs the registration and the login from the seed, the client through this crate.
fn generate(seed: [u8; 32], password: &str, credential_identifier: &str) -> Vector {
    let mut rng = ChaCha20Rng::from_seed(seed);
    let password_bytes = password.as_bytes();
    let id = credential_identifier.as_bytes();
    let context = ServerLoginParameters {
        context: Some(LOGIN_CONTEXT),
        ..Default::default()
    };

    let setup = ServerSetup::<RimOpaque>::new(&mut rng);

    let (registration, registration_request) =
        ClientRegistrationFlow::start_with_rng(&mut rng, password_bytes).unwrap();
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
        .finish_with_rng(&mut rng, password_bytes, &registration_response)
        .unwrap();
    let record = ServerRegistration::<RimOpaque>::finish(
        RegistrationUpload::deserialize(&registration_upload).unwrap(),
    );

    let (login, credential_request) =
        ClientLoginFlow::start_with_rng(&mut rng, password_bytes).unwrap();
    let server = ServerLogin::start(
        &mut rng,
        &setup,
        Some(record),
        opaque_ke::CredentialRequest::deserialize(&credential_request).unwrap(),
        id,
        context.clone(),
    )
    .unwrap();
    let credential_response = server.message.serialize().to_vec();
    let finished = login
        .finish_with_rng(&mut rng, password_bytes, &credential_response)
        .unwrap();
    let server_session_key = server
        .state
        .finish(
            opaque_ke::CredentialFinalization::deserialize(&finished.finalization).unwrap(),
            context,
        )
        .unwrap()
        .session_key;

    assert_eq!(*registration_export_key, *finished.export_key);
    assert_eq!(
        finished.session_key.as_slice(),
        server_session_key.as_slice()
    );

    Vector {
        suite: "OPRF ristretto255-SHA512; 3DH ristretto255 with SHA-512; KSF Argon2id v19 \
                m=65536 t=3 p=4 with a zero salt"
            .into(),
        context: String::from_utf8(LOGIN_CONTEXT.to_vec()).unwrap(),
        seed: hex::encode(seed),
        password: password.into(),
        credential_identifier: credential_identifier.into(),
        server_setup: hex::encode(setup.serialize()),
        registration_request: hex::encode(registration_request),
        registration_response: hex::encode(registration_response),
        registration_upload: hex::encode(registration_upload),
        credential_request: hex::encode(credential_request),
        credential_response: hex::encode(credential_response),
        credential_finalization: hex::encode(&finished.finalization),
        export_key: hex::encode(finished.export_key.as_slice()),
        session_key: hex::encode(finished.session_key.as_slice()),
    }
}

fn file_text(vector: &Vector) -> String {
    format!("{}\n", serde_json::to_string_pretty(vector).unwrap())
}

#[cfg(not(target_arch = "wasm32"))]
fn write_requested() -> bool {
    std::env::var_os("RIM_WRITE_OPAQUE_VECTORS").is_some_and(|v| v == "1")
}

#[cfg(target_arch = "wasm32")]
fn write_requested() -> bool {
    false
}

#[test]
fn the_vector_replays() {
    if write_requested() {
        let generated = generate(SEED, PASSWORD, CREDENTIAL_IDENTIFIER);
        #[cfg(not(target_arch = "wasm32"))]
        std::fs::write(
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors/opaque-v1.json"),
            file_text(&generated),
        )
        .unwrap();
        return;
    }
    let stored: Vector = serde_json::from_str(FILE).unwrap();
    let seed: [u8; 32] = hex::decode(&stored.seed).unwrap().try_into().unwrap();
    let replayed = generate(seed, &stored.password, &stored.credential_identifier);
    assert_eq!(replayed, stored);
    assert_eq!(
        file_text(&replayed),
        FILE,
        "the file is byte for byte the generator's"
    );
}

#[test]
fn the_client_alone_reproduces_the_login() {
    let stored: Vector = serde_json::from_str(FILE).unwrap();
    let response = hex::decode(&stored.credential_response).unwrap();

    // The client's draws, without the server's: the same stream, skipping what the server took.
    let seed: [u8; 32] = hex::decode(&stored.seed).unwrap().try_into().unwrap();
    let mut rng = ChaCha20Rng::from_seed(seed);
    let _ = ServerSetup::<RimOpaque>::new(&mut rng);
    let (registration, _) =
        ClientRegistrationFlow::start_with_rng(&mut rng, stored.password.as_bytes()).unwrap();
    let registration_response = hex::decode(&stored.registration_response).unwrap();
    let (upload, _) = registration
        .finish_with_rng(&mut rng, stored.password.as_bytes(), &registration_response)
        .unwrap();
    assert_eq!(hex::encode(upload), stored.registration_upload);

    let (login, request) =
        ClientLoginFlow::start_with_rng(&mut rng, stored.password.as_bytes()).unwrap();
    assert_eq!(hex::encode(request), stored.credential_request);
    let finished = login.finish(stored.password.as_bytes(), &response).unwrap();
    assert_eq!(
        hex::encode(finished.export_key.as_slice()),
        stored.export_key
    );
    assert_eq!(
        hex::encode(finished.session_key.as_slice()),
        stored.session_key
    );
}
