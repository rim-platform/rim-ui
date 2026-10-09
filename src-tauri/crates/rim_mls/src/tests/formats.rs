//! RIM's formats against their known-answer vectors, byte for byte: the group id, the `mls-key`
//! statement and credential identity, the attachment construction, content, franking and
//! authenticated data, the receipt, the re-add request; and the recorded key package and
//! PrivateMessage fixtures.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use ed25519_dalek::SigningKey;
use openmls::prelude::tls_codec::DeserializeBytes as _;
use openmls::prelude::{
    BasicCredential, KeyPackageIn, MlsMessageBodyIn, MlsMessageIn, ProtocolVersion,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::support::{sign, tagged_public};
use crate::codec::{b64, unb64};
use crate::device::{generate_key_packages, install_fixed_key};
use crate::group::encrypt_content;
use crate::identity::credential_identity;
use crate::provider::with_crypto;
use crate::storage::sealed::Sealed as _;
use crate::{
    encrypt_attachment_with, franking_commitment, franking_receipt, franking_receipt_input,
    mls_key_payload, AddedDevice, ApplicationAad, AuthenticatedData, Change, ClaimedKeyPackage,
    CommitSummary, ConversationGroup, DecryptExpectations, Decrypted, DeviceRef, MemoryStore,
    MessageContent, Mls, MlsKeyStatement, ReaddRequest, ReceiptFacts, SignedStatement,
    MLS_KEY_CONTEXT, READD_CONTEXT,
};

const PRINCIPAL: &str = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";
const MENTIONED: &str = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
const ISSUED_AT: &str = "2026-10-09T00:00:00Z";
/// 2026-10-09T00:00:00Z.
const T0: u64 = 1_791_504_000;

const MLS_KEY: &str = "ed25519:6S62BU_pvGgqG887dZ9lqzikz72BxNHzNC5Myc3tiws";
const MLS_KEY_PAYLOAD: &str = r#"{"v":2,"type":"mls-key","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001","mlsKey":"ed25519:6S62BU_pvGgqG887dZ9lqzikz72BxNHzNC5Myc3tiws","issuedAt":"2026-10-09T00:00:00Z"}"#;
const MLS_KEY_SIGNATURE: &str = "ed25519:6TN4OHOn3VKI00okNthNJOJkuAg1afEO9h-63L9T6VoQxeYA1acXMqTuLBu5_flkzCjPRssEWpP6LkVCi74EDA";

const CONTENT: &str = r#"{"v":1,"type":"message","id":"0199d1a0-0000-7000-8000-000000000002","rev":0,"threadRootId":null,"body":"hi <@rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo>","mentions":["rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo"],"mentionAll":false,"replyTo":null,"forwardedFrom":null,"attachments":[{"blobSha256":"EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac","secret":"oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8","name":"hello.txt","mime":"text/plain","size":18}],"linkPreviews":[]}"#;
const APPLICATION_AAD: &str = r#"{"v":1,"type":"application","messageId":"0199d1a0-0000-7000-8000-000000000002","franking":"cexIhmsoNkTBNQjdxcjU_McrpRch3NO3SxblpQ1ah00","mentions":["rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo"],"mentionAll":false}"#;
const COMMIT_AAD: &str = r#"{"v":1,"type":"commit","adds":[{"principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","deviceId":"00000000-0000-0000-0000-000000000002","keyPackageRef":"wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t8"}],"removes":[]}"#;
const READD_PAYLOAD: &str = r#"{"v":2,"type":"mls-readd","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001","conversationId":"0199d1a0-0000-7000-8000-000000000001","incarnation":1,"lastEpoch":41,"nonce":"AAECAwQFBgcICQoLDA0ODw","issuedAt":"2026-10-09T00:00:00Z"}"#;
const READD_SIGNATURE: &str = "ed25519:UNry-YBfbQv1nUxStNVtA9jirfxTM5rLE-JA40KZGS9c-tCyl90KEq4W1OxmoxL0msvG62Gc5msFvpCI_h_lCw";

fn seed_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn bytes_from(start: u8) -> [u8; 32] {
    std::array::from_fn(|i| start + i as u8)
}

fn conversation() -> ConversationGroup {
    ConversationGroup::new(
        Uuid::parse_str("0199d1a0-0000-7000-8000-000000000001").unwrap(),
        1,
    )
}

fn message_id() -> Uuid {
    Uuid::parse_str("0199d1a0-0000-7000-8000-000000000002").unwrap()
}

fn vector_device() -> DeviceRef {
    DeviceRef {
        principal_id: PRINCIPAL.into(),
        device_id: Uuid::from_u128(1),
    }
}

fn mentioned_device() -> DeviceRef {
    DeviceRef {
        principal_id: MENTIONED.into(),
        device_id: Uuid::from_u128(2),
    }
}

/// The vector content: a mention of the v1 vector principal and the vector attachment.
fn content() -> MessageContent {
    let attachment = encrypt_attachment_with(
        Zeroizing::new(bytes_from(0xa0)),
        b"hello, attachment\n",
        "hello.txt",
        "text/plain",
    )
    .unwrap();
    MessageContent {
        attachments: vec![attachment.entry],
        ..MessageContent::new(message_id(), format!("hi <@{MENTIONED}>"))
    }
}

#[test]
fn group_id_vector() {
    let id = conversation().group_id();
    assert_eq!(
        hex::encode(id),
        "72696d310199d1a000007000800000000000000100000001"
    );
    assert_eq!(b64(&id), "cmltMQGZ0aAAAHAAgAAAAAAAAAEAAAAB");
    assert_eq!(ConversationGroup::from_group_id(&id), Some(conversation()));
    assert_eq!(ConversationGroup::from_group_id(&id[1..]), None);
    let mut other = id;
    other[0] = b'R';
    assert_eq!(ConversationGroup::from_group_id(&other), None);
}

#[test]
fn mls_key_statement_and_credential_identity_vectors() {
    let mls_key = seed_key(40).verifying_key().to_bytes();
    assert_eq!(format!("ed25519:{}", b64(&mls_key)), MLS_KEY);
    let payload = mls_key_payload(PRINCIPAL, &Uuid::from_u128(1), &mls_key, ISSUED_AT);
    assert_eq!(payload, MLS_KEY_PAYLOAD);
    let statement = sign(&seed_key(20), MLS_KEY_CONTEXT, payload);
    assert_eq!(statement.signature, MLS_KEY_SIGNATURE);

    let identity = credential_identity(&statement);
    assert_eq!(identity.len(), 382);
    assert_eq!(
        hex::encode(Sha256::digest(&identity)),
        "b7334437dc6e0da6588fbfc37540416efc0497c0a75d4eccae1fd92cae969a11"
    );

    let device_key = tagged_public(&seed_key(20));
    let claim = MlsKeyStatement::verify(&statement, &device_key).unwrap();
    assert_eq!(claim.mls_key, mls_key);
    assert_eq!(claim.device_id, Uuid::from_u128(1));
    // Another device key, another purpose, an edited payload.
    assert!(MlsKeyStatement::verify(&statement, &tagged_public(&seed_key(21))).is_err());
    let readd_signed = sign(&seed_key(20), READD_CONTEXT, statement.payload.clone());
    assert!(MlsKeyStatement::verify(&readd_signed, &device_key).is_err());
    let edited = SignedStatement {
        payload: statement.payload.replace("000000000001", "000000000002"),
        ..statement.clone()
    };
    assert!(MlsKeyStatement::verify(&edited, &device_key).is_err());
    // Strict reading: unknown, duplicate and missing fields, and the wrong version.
    for bad in [
        MLS_KEY_PAYLOAD.replacen("{", r#"{"x":1,"#, 1),
        MLS_KEY_PAYLOAD.replacen(r#""v":2"#, r#""v":2,"v":2"#, 1),
        MLS_KEY_PAYLOAD.replacen(r#","issuedAt":"2026-10-09T00:00:00Z""#, "", 1),
        MLS_KEY_PAYLOAD.replacen(r#""v":2"#, r#""v":1"#, 1),
        // Non-zero trailing bits: not the key's canonical spelling.
        MLS_KEY_PAYLOAD.replacen("Myc3tiws", "Myc3tiwt", 1),
        MLS_KEY_PAYLOAD.replacen("ed25519:6S62", "x25519:6S62", 1),
    ] {
        assert!(MlsKeyStatement::parse(&bad).is_err(), "{bad}");
    }
}

#[test]
fn attachment_vector() {
    let secret = bytes_from(0xa0);
    assert_eq!(b64(&secret), "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8");
    let (key, nonce) = crate::attachment_key_and_nonce(&secret);
    assert_eq!(
        hex::encode(*key),
        "b03b51201f06749186a1768c665aaa48570ab7c6f42886d09ab5a97116b15b8f"
    );
    assert_eq!(hex::encode(nonce), "306c91d469a72d1e1b19c711");
    let encrypted = encrypt_attachment_with(
        Zeroizing::new(secret),
        b"hello, attachment\n",
        "hello.txt",
        "text/plain",
    )
    .unwrap();
    assert_eq!(
        hex::encode(&encrypted.blob),
        "096d52fa9b833e37ef33d387fc5ecab34eabb410807b85e90c862a44614c7c9cb163"
    );
    assert_eq!(
        b64(&encrypted.entry.blob_sha256),
        "EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac"
    );
    assert_eq!(
        crate::decrypt_attachment(&encrypted.entry, &encrypted.blob)
            .unwrap()
            .as_slice(),
        b"hello, attachment\n"
    );
}

#[test]
fn content_franking_and_authenticated_data_vectors() {
    let content = content();
    let bytes = content.to_bytes();
    assert_eq!(String::from_utf8(bytes.clone()).unwrap(), CONTENT);
    assert_eq!(bytes.len(), 480);
    assert_eq!(MessageContent::parse(CONTENT.as_bytes()).unwrap(), content);

    let franking_key = bytes_from(0x60);
    assert_eq!(
        b64(&franking_key),
        "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8"
    );
    let commitment = franking_commitment(&franking_key, &bytes);
    assert_eq!(
        hex::encode(commitment),
        "71ec48866b283644c13508ddc5c8d4fcc72ba51721dcd3b74b16e5a50d5a874d"
    );
    assert_eq!(
        b64(&commitment),
        "cexIhmsoNkTBNQjdxcjU_McrpRch3NO3SxblpQ1ah00"
    );
    // A commitment binds the content and the key.
    assert_ne!(franking_commitment(&bytes_from(0x61), &bytes), commitment);
    assert_ne!(franking_commitment(&franking_key, &bytes[1..]), commitment);

    let data = crate::content::application_data(&franking_key, &bytes);
    assert_eq!(data.len(), 513);
    assert_eq!(
        hex::encode(Sha256::digest(data.as_slice())),
        "2034e24c9ef5d4ad3965448fb6beec5852da1a0c87896bb07f14b3c7f63ab776"
    );

    let aad = ApplicationAad {
        message_id: message_id(),
        franking: commitment,
        mentions: content.mentions.clone(),
        mention_all: false,
    };
    assert_eq!(String::from_utf8(aad.to_bytes()).unwrap(), APPLICATION_AAD);
    assert_eq!(APPLICATION_AAD.len(), 220);
    assert_eq!(
        AuthenticatedData::parse(APPLICATION_AAD.as_bytes()).unwrap(),
        AuthenticatedData::Application(aad)
    );

    let summary = CommitSummary {
        adds: vec![AddedDevice {
            device: mentioned_device(),
            key_package_ref: bytes_from(0xc0).to_vec(),
        }],
        removes: vec![],
    };
    assert_eq!(String::from_utf8(summary.to_bytes()).unwrap(), COMMIT_AAD);
    assert_eq!(
        AuthenticatedData::parse(COMMIT_AAD.as_bytes()).unwrap(),
        AuthenticatedData::Commit(summary)
    );
}

#[test]
fn franking_receipt_vector() {
    let facts = ReceiptFacts {
        message_id: message_id(),
        conversation_id: conversation().conversation_id,
        sender_user_id: Uuid::parse_str("0199d1a0-0000-7000-8000-0000000000aa").unwrap(),
        sender_device_id: Uuid::from_u128(1),
        sent_at_us: 1_791_504_000_123_456,
        commitment: franking_commitment(&bytes_from(0x60), CONTENT.as_bytes()),
    };
    let input = franking_receipt_input(&facts);
    assert_eq!(input.len(), 133);
    assert_eq!(
        hex::encode(&input),
        "72696d2e653265652e6672616e6b696e672d726563656970742e7631000199d1a00000700080000000000000020199d1a00000700080000000000000010199d1a00000700080000000000000aa0000000000000000000000000000000100065d5d078a824071ec48866b283644c13508ddc5c8d4fcc72ba51721dcd3b74b16e5a50d5a874d"
    );
    let receipt = franking_receipt(&bytes_from(0x80), &facts);
    assert_eq!(
        hex::encode(receipt),
        "9c25cd6659b97074696a9445ad323e061debaaf5f97af5ed2f2cd46150d3db75"
    );
    assert_eq!(b64(&receipt), "nCXNZlm5cHRpapRFrTI-Bh3rqvX5evXtLyzUYVDT23U");
}

#[test]
fn readd_request_vector() {
    let request = ReaddRequest {
        device: vector_device(),
        group: conversation(),
        last_epoch: Some(41),
        nonce: std::array::from_fn(|i| i as u8),
        issued_at: ISSUED_AT.into(),
    };
    assert_eq!(request.payload(), READD_PAYLOAD);
    let statement = sign(&seed_key(20), READD_CONTEXT, request.payload());
    assert_eq!(statement.signature, READD_SIGNATURE);
    let device_key = tagged_public(&seed_key(20));
    assert_eq!(
        ReaddRequest::verify(&statement, &device_key).unwrap(),
        request
    );

    // Another device's key, the mls-key context, a payload without `lastEpoch`.
    assert!(ReaddRequest::verify(&statement, &tagged_public(&seed_key(21))).is_err());
    let wrong_context = sign(&seed_key(20), MLS_KEY_CONTEXT, request.payload());
    assert!(ReaddRequest::verify(&wrong_context, &device_key).is_err());
    let missing = sign(
        &seed_key(20),
        READD_CONTEXT,
        READD_PAYLOAD.replace(r#""lastEpoch":41,"#, ""),
    );
    assert!(ReaddRequest::verify(&missing, &device_key).is_err());
    let no_state = ReaddRequest {
        last_epoch: None,
        ..request
    };
    assert!(no_state.payload().contains(r#""lastEpoch":null"#));
}

// ─── Recorded fixtures ──────────────────────────────────────────────────────

/// What the fixture file holds: one key package of the vector device, and one PrivateMessage of
/// the vector application data with the receiving device's group state to decrypt it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    key_package: String,
    key_package_ref: String,
    private_message: String,
    receiver_state: Vec<StoredEntry>,
}

#[derive(Serialize, Deserialize)]
struct StoredEntry {
    label: String,
    key: String,
    value: String,
}

const FIXTURES: &str = include_str!("fixtures/recorded.json");
/// The fixture key package's lifetime: 2026-10-08T23:00:00Z to 2036-10-09T00:00:00Z, so it
/// stays valid while the fixture is in use.
const FIXTURE_LIFETIME: (u64, u64) = (T0 - 3600, 2_107_123_200);

/// A device of fixed keys: device key `device_seed`, MLS key `mls_seed`, statement issued at T0.
fn fixed_device(mls: &Mls, device: &DeviceRef, device_seed: u8, mls_seed: u8) -> MemoryStore {
    let store = MemoryStore::new();
    install_fixed_key(store.backend(), device, &[mls_seed; 32]).unwrap();
    let payload = mls.mls_key_payload(&store, device, ISSUED_AT).unwrap();
    let statement = sign(&seed_key(device_seed), MLS_KEY_CONTEXT, payload);
    mls.install_mls_key_statement(&store, statement, &tagged_public(&seed_key(device_seed)))
        .unwrap();
    store.commit();
    store
}

/// Writes `fixtures/recorded.json`. Run once per format change with
/// `cargo test -p rim_mls write_recorded_fixtures -- --ignored`, then format the file.
#[test]
#[ignore]
fn write_recorded_fixtures() {
    let mls = Mls::new().unwrap();
    let sender = fixed_device(&mls, &vector_device(), 20, 40);
    let receiver = fixed_device(&mls, &mentioned_device(), 21, 41);

    let key_package = with_crypto!(&mls.backend, |crypto| generate_key_packages(
        crypto,
        sender.backend(),
        1,
        false,
        T0,
        FIXTURE_LIFETIME
    ))
    .unwrap()
    .remove(0);

    let claimed = mls
        .generate_key_packages(&receiver, 1, false, super::support::now())
        .unwrap()
        .remove(0);
    let group = conversation();
    let created = mls
        .create_group(
            &sender,
            group,
            &[ClaimedKeyPackage {
                device: mentioned_device(),
                key_package: claimed.message,
            }],
        )
        .unwrap();
    mls.commit_accepted(&sender, group).unwrap();
    mls.join(&receiver, group, created.welcome.as_ref().unwrap())
        .unwrap();
    receiver.commit();
    let receiver_state = receiver
        .export()
        .into_iter()
        .map(|change| StoredEntry {
            label: change.label,
            key: b64(&change.key),
            value: b64(&change.value.unwrap()),
        })
        .collect();

    let content = content();
    let sent = with_crypto!(&mls.backend, |crypto| encrypt_content(
        crypto,
        sender.backend(),
        group,
        &content,
        &content.to_bytes(),
        Zeroizing::new(bytes_from(0x60))
    ))
    .unwrap();

    let fixtures = Fixtures {
        key_package: b64(&key_package.message),
        key_package_ref: b64(&key_package.key_package_ref),
        private_message: b64(&sent.envelope),
        receiver_state,
    };
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/tests/fixtures/recorded.json"
    );
    std::fs::write(
        path,
        serde_json::to_string_pretty(&fixtures).unwrap() + "\n",
    )
    .unwrap();
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURES).unwrap()
}

#[test]
fn the_recorded_key_package_is_the_vector_device_s() {
    let fixtures = fixtures();
    let bytes = unb64(&fixtures.key_package).unwrap();
    let MlsMessageBodyIn::KeyPackage(key_package) =
        MlsMessageIn::tls_deserialize_exact_bytes(&bytes)
            .unwrap()
            .extract()
    else {
        panic!("not a key package");
    };
    let crypto = openmls_rust_crypto::RustCrypto::default();
    let key_package = KeyPackageIn::validate(key_package, &crypto, ProtocolVersion::Mls10).unwrap();
    assert_eq!(
        b64(key_package.hash_ref(&crypto).unwrap().as_slice()),
        fixtures.key_package_ref
    );
    assert_eq!(key_package.ciphersuite(), crate::CIPHER_SUITE);
    let leaf = key_package.leaf_node();
    let identity = BasicCredential::try_from(leaf.credential().clone()).unwrap();
    let expected = SignedStatement {
        payload: MLS_KEY_PAYLOAD.into(),
        signature: MLS_KEY_SIGNATURE.into(),
    };
    assert_eq!(
        identity.identity(),
        credential_identity(&expected).as_slice()
    );
    assert_eq!(
        leaf.signature_key().as_slice(),
        seed_key(40).verifying_key().as_bytes()
    );
    let lifetime = key_package.life_time();
    assert_eq!(
        (lifetime.not_before(), lifetime.not_after()),
        FIXTURE_LIFETIME
    );
    assert!(!key_package.last_resort());
}

#[test]
fn the_recorded_private_message_decrypts_to_the_vector_application_data() {
    let fixtures = fixtures();
    let envelope = unb64(&fixtures.private_message).unwrap();
    let MlsMessageBodyIn::PrivateMessage(message) =
        MlsMessageIn::tls_deserialize_exact_bytes(&envelope)
            .unwrap()
            .extract()
    else {
        panic!("not a PrivateMessage");
    };
    assert_eq!(message.aad(), APPLICATION_AAD.as_bytes());
    assert_eq!(message.group_id().as_slice(), conversation().group_id());
    assert_eq!(message.epoch().as_u64(), 1);

    let expected = DecryptExpectations {
        message_id: message_id(),
        thread_root_id: None,
        author_principal_id: Some(PRINCIPAL.into()),
    };
    // State written by this OpenMLS release loads, on either provider, and decrypts once.
    for mls in [Mls::new().unwrap(), Mls::rust_crypto()] {
        let receiver = MemoryStore::import(fixtures.receiver_state.iter().map(|entry| Change {
            label: entry.label.clone(),
            key: unb64(&entry.key).unwrap(),
            value: Some(unb64(&entry.value).unwrap()),
        }));
        let Decrypted::Message(decrypted) = mls
            .decrypt(&receiver, conversation(), &envelope, &expected)
            .unwrap()
        else {
            panic!("the fixture does not decrypt to a valid message");
        };
        assert_eq!(decrypted.content_bytes, CONTENT.as_bytes());
        assert_eq!(decrypted.sender, vector_device());
        let data =
            crate::content::application_data(&decrypted.franking_key, &decrypted.content_bytes);
        assert_eq!(
            hex::encode(Sha256::digest(data.as_slice())),
            "2034e24c9ef5d4ad3965448fb6beec5852da1a0c87896bb07f14b3c7f63ab776"
        );
        assert!(mls
            .decrypt(&receiver, conversation(), &envelope, &expected)
            .is_err());
    }
}
