//! The engine as the page drives it: JSON in and out, the journal, a state reloaded from its
//! entries. Runs natively and, with `wasm-bindgen-test`, in a browser.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::wire::b64;
use crate::{build_content, may_honor_readd, plan_upload, verify_readd, Engine};

#[cfg(target_arch = "wasm32")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

const CONVERSATION: &str = "0199d1a0-0000-7000-8000-000000000001";

struct Device {
    engine: Engine,
    principal_id: String,
    device_id: String,
    key: SigningKey,
}

impl Device {
    fn new(n: u8) -> Self {
        let device = Self {
            engine: Engine::new("[]").unwrap(),
            principal_id: format!("rimp1_{}", b64(&Sha256::digest([b'p', n]))),
            device_id: format!("00000000-0000-7000-8000-0000000000{n:02x}"),
            key: SigningKey::from_bytes(&[n; 32]),
        };
        let payload = device
            .engine
            .mls_key_payload(
                &device.principal_id,
                &device.device_id,
                "2026-10-09T00:00:00Z",
            )
            .unwrap();
        let signature = device.sign(rim_mls::MLS_KEY_CONTEXT, &payload);
        device
            .engine
            .install_mls_key_statement(&payload, &signature, &device.device_key())
            .unwrap();
        device.engine.keep();
        device
    }

    fn device_key(&self) -> String {
        format!("ed25519:{}", b64(self.key.verifying_key().as_bytes()))
    }

    fn sign(&self, context: &[u8], payload: &str) -> String {
        let mut message = context.to_vec();
        message.extend_from_slice(payload.as_bytes());
        format!("ed25519:{}", b64(&self.key.sign(&message).to_bytes()))
    }

    fn key_package(&self) -> String {
        let now = chrono::Utc::now().timestamp() as f64;
        let packages: Value =
            serde_json::from_str(&self.engine.generate_key_packages(1, false, now).unwrap())
                .unwrap();
        self.engine.keep();
        packages[0]["message"].as_str().unwrap().to_string()
    }

    fn known(&self) -> Value {
        json!({
            "principalId": self.principal_id,
            "deviceId": self.device_id,
            "status": "certified",
            "deviceKey": self.device_key(),
        })
    }
}

fn parse(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

fn content(body: &str) -> String {
    let id = uuid::Uuid::now_v7().hyphenated().to_string();
    build_content(&json!({ "id": id, "body": body }).to_string()).unwrap()
}

/// Alice's device creates the group with Bob's; Bob joins from the Welcome.
fn pair() -> (Device, Device) {
    let alice = Device::new(1);
    let bob = Device::new(2);
    let claimed = json!([{
        "principalId": bob.principal_id,
        "deviceId": bob.device_id,
        "keyPackage": bob.key_package(),
    }]);
    let commit = parse(
        &alice
            .engine
            .create_group(CONVERSATION, 1, &claimed.to_string())
            .unwrap(),
    );
    assert_eq!(commit["epoch"], 0);
    assert_eq!(commit["cipherSuite"], 0x004F);
    assert_eq!(commit["adds"][0]["principalId"], json!(bob.principal_id));
    let merged = parse(&alice.engine.commit_accepted(CONVERSATION, 1).unwrap());
    assert_eq!(merged["epoch"], 1);
    assert_eq!(merged["membership"]["added"], json!([bob.principal_id]));
    alice.engine.keep();
    let joined = parse(
        &bob.engine
            .join(CONVERSATION, 1, commit["welcome"].as_str().unwrap())
            .unwrap(),
    );
    assert_eq!(joined["epoch"], 1);
    assert_eq!(joined["leaves"], 2);
    bob.engine.keep();
    (alice, bob)
}

fn expected(content: &str, author: &Device) -> String {
    json!({
        "messageId": parse(content)["id"],
        "threadRootId": null,
        "authorPrincipalId": author.principal_id,
        "senderDeviceId": author.device_id,
    })
    .to_string()
}

#[test]
fn a_rolled_back_decrypt_decrypts_again_and_a_kept_one_does_not() {
    let (alice, bob) = pair();
    let text = content("hi");
    let sent = parse(&alice.engine.encrypt(CONVERSATION, 1, &text).unwrap());
    alice.engine.keep();
    let envelope = sent["envelope"].as_str().unwrap();

    let first = parse(
        &bob.engine
            .decrypt(CONVERSATION, 1, envelope, &expected(&text, &alice))
            .unwrap(),
    );
    assert_eq!(first["kind"], "message");
    assert_eq!(first["content"], json!(text));
    assert!(!parse(&bob.engine.changes()).as_array().unwrap().is_empty());
    bob.engine.rollback();
    assert!(parse(&bob.engine.changes()).as_array().unwrap().is_empty());

    let again = parse(
        &bob.engine
            .decrypt(CONVERSATION, 1, envelope, &expected(&text, &alice))
            .unwrap(),
    );
    assert_eq!(again["frankingKey"], first["frankingKey"]);
    bob.engine.keep();
    let third = bob
        .engine
        .decrypt(CONVERSATION, 1, envelope, &expected(&text, &alice));
    assert!(third.is_err());
}

#[test]
fn a_state_reloaded_from_its_entries_reads_on() {
    let (alice, bob) = pair();
    let bob_again = Engine::new(&bob.engine.export()).unwrap();
    let text = content("after a reload");
    let sent = parse(&alice.engine.encrypt(CONVERSATION, 1, &text).unwrap());
    let read = parse(
        &bob_again
            .decrypt(
                CONVERSATION,
                1,
                sent["envelope"].as_str().unwrap(),
                &expected(&text, &alice),
            )
            .unwrap(),
    );
    assert_eq!(read["kind"], "message");
    assert_eq!(read["sender"]["deviceId"], json!(alice.device_id));
}

#[test]
fn own_messages_and_reencryption_keep_content_and_franking() {
    let (alice, bob) = pair();
    let text = content("resend me");
    let sent = parse(&alice.engine.encrypt(CONVERSATION, 1, &text).unwrap());
    let again = parse(
        &alice
            .engine
            .reencrypt(
                CONVERSATION,
                1,
                &text,
                sent["frankingKey"].as_str().unwrap(),
                sent["commitment"].as_str().unwrap(),
            )
            .unwrap(),
    );
    assert_eq!(again["commitment"], sent["commitment"]);
    assert_ne!(again["envelope"], sent["envelope"]);
    let own = parse(
        &alice
            .engine
            .decrypt(
                CONVERSATION,
                1,
                again["envelope"].as_str().unwrap(),
                &expected(&text, &alice),
            )
            .unwrap(),
    );
    assert_eq!(own["kind"], "own");
    let read = parse(
        &bob.engine
            .decrypt(
                CONVERSATION,
                1,
                again["envelope"].as_str().unwrap(),
                &expected(&text, &alice),
            )
            .unwrap(),
    );
    assert_eq!(read["content"], json!(text));
}

#[test]
fn a_message_for_another_row_is_invalid() {
    let (alice, bob) = pair();
    let text = content("moved");
    let sent = parse(&alice.engine.encrypt(CONVERSATION, 1, &text).unwrap());
    let other = json!({
        "messageId": uuid::Uuid::now_v7().hyphenated().to_string(),
        "authorPrincipalId": alice.principal_id,
        "senderDeviceId": alice.device_id,
    });
    let read = parse(
        &bob.engine
            .decrypt(
                CONVERSATION,
                1,
                sent["envelope"].as_str().unwrap(),
                &other.to_string(),
            )
            .unwrap(),
    );
    assert_eq!(read["kind"], "invalid");
}

#[test]
fn leaves_verify_against_the_page_answers() {
    let (alice, bob) = pair();
    let members = json!([alice.principal_id, bob.principal_id]);
    let missing = parse(
        &alice
            .engine
            .verify_leaves(CONVERSATION, 1, &json!({ "members": members }).to_string())
            .unwrap(),
    );
    assert_eq!(missing["missing"].as_array().unwrap().len(), 2);

    let fetched = json!({
        "members": members,
        "fetched": [alice.principal_id, bob.principal_id],
        "devices": [alice.known(), bob.known()],
    });
    let outcome = parse(
        &alice
            .engine
            .verify_leaves(CONVERSATION, 1, &fetched.to_string())
            .unwrap(),
    );
    assert_eq!(outcome["unverified"], json!([]));
    assert_eq!(outcome["verified"].as_array().unwrap().len(), 2);

    let revoked = json!({
        "members": members,
        "fetched": [bob.principal_id],
        "devices": [{ "principalId": bob.principal_id, "deviceId": bob.device_id, "status": "revoked" }],
        "remembered": [{ "principalId": alice.principal_id, "deviceId": alice.device_id, "deviceKey": alice.device_key() }],
    });
    let outcome = parse(
        &alice
            .engine
            .verify_leaves(CONVERSATION, 1, &revoked.to_string())
            .unwrap(),
    );
    assert_eq!(outcome["unverified"][0]["reason"], "revokedDevice");
    assert_eq!(outcome["unverified"][0]["deviceId"], json!(bob.device_id));
}

#[test]
fn a_readd_request_is_signed_over_its_payload() {
    let (_, bob) = pair();
    let payload = bob.engine.prepare_readd(CONVERSATION, 1).unwrap();
    let signature = bob.sign(rim_mls::READD_CONTEXT, &payload);
    let request = parse(&verify_readd(&payload, &signature, &bob.device_key()).unwrap());
    assert_eq!(request["deviceId"], json!(bob.device_id));
    assert_eq!(request["incarnation"], 1);
    assert_eq!(request["lastEpoch"], 1);
    let other = Device::new(3);
    assert!(verify_readd(&payload, &signature, &other.device_key()).is_err());
    assert_eq!(
        bob.engine.group_status(CONVERSATION, 1).unwrap_err().code,
        "E2EE_NO_GROUP"
    );
    assert!(may_honor_readd(None, 100.0));
    assert!(!may_honor_readd(Some(100.0), 100.0 + 3600.0));
}

#[test]
fn content_reads_its_mentions_from_the_body() {
    let mentioned = format!("rimp1_{}", b64(&Sha256::digest([b'p', 9])));
    let text = build_content(
        &json!({
            "id": "0199d1a0-0000-7000-8000-000000000002",
            "body": format!("hi <@{mentioned}> @here"),
        })
        .to_string(),
    )
    .unwrap();
    let content = parse(&text);
    assert_eq!(content["mentions"], json!([mentioned]));
    assert_eq!(content["mentionAll"], true);
    assert!(text.starts_with(r#"{"v":1,"type":"message","id":"#));
    let too_long =
        json!({ "id": "0199d1a0-0000-7000-8000-000000000002", "body": "x".repeat(10_001) });
    assert_eq!(
        build_content(&too_long.to_string()).unwrap_err().code,
        "E2EE_INVALID"
    );
}

#[test]
fn the_upload_plan_tops_up_below_ten() {
    let plan = parse(&plan_upload(r#"{"available":3}"#, 1_800_000_000.0).unwrap());
    assert_eq!(plan["oneTime"], 17);
    assert_eq!(plan["lastResort"], true);
}
