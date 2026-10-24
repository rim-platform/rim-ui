use std::sync::Arc;

use super::statement::{context, replay, verify};
use super::store::MemorySecretStore;
use super::*;

const ENDPOINT: &str = "http://localhost:8080/api";

fn state() -> KeyIdentityState {
    KeyIdentityState::new(Arc::new(MemorySecretStore::default()))
}

fn account(user: &str) -> ServerAccount {
    ServerAccount {
        endpoint: ENDPOINT.into(),
        user_id: user.into(),
        username: format!("{user}-name"),
    }
}

fn challenge() -> Challenge {
    Challenge {
        challenge_id: "00000000-0000-0000-0000-000000000009".into(),
        nonce: "bm9uY2U".into(),
    }
}

fn payload_field(statement: &Statement, field: &str) -> serde_json::Value {
    let value: serde_json::Value = serde_json::from_str(&statement.payload).unwrap();
    value[field].clone()
}

/// An enrolled, confirmed account and its key log.
fn enrolled(state: &KeyIdentityState) -> (EnrollmentDraft, EnrollmentStatements) {
    let draft = state.begin_enrollment("Laptop").unwrap();
    let statements = state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    state
        .settle(&account("u1"), Some(draft.principal_id.as_str()))
        .unwrap();
    (draft, statements)
}

#[test]
fn enrollment_signs_a_log_a_certificate_and_a_proof_that_verify() {
    let state = self::state();
    let draft = state.begin_enrollment("  Laptop  ").unwrap();
    let statements = state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();

    let head = replay(&statements.key_log).unwrap();
    assert_eq!(head.principal_id, draft.principal_id);
    assert!(verify(
        &statements.device,
        context::DEVICE,
        &head.identity_key,
        2
    ));
    assert_eq!(payload_field(&statements.device, "name"), "Laptop");
    assert_eq!(payload_field(&statements.device, "keySeq"), 0);
    let device_key = payload_field(&statements.device, "deviceKey");
    assert!(verify(
        &statements.proof,
        context::LOGIN,
        device_key.as_str().unwrap(),
        2
    ));
    assert_eq!(
        payload_field(&statements.proof, "audience"),
        "localhost:8080"
    );
    assert_eq!(
        payload_field(&statements.proof, "deviceId"),
        payload_field(&statements.device, "deviceId")
    );

    // The kit is version 2, its phrase is the grid's 12 words, and its recovery key is the one
    // the inception names. The recovery key itself is not stored.
    assert!(draft.recovery_kit.starts_with("RIM recovery kit (v2)\n"));
    assert_eq!(draft.recovery_phrase.len(), 12);
    assert!(draft.recovery_kit.contains(&format!(
        "Recovery phrase: {}\n",
        draft.recovery_phrase.join(" ")
    )));
    let (principal, secret) = recovery_kit::parse_kit(&draft.recovery_kit, None).unwrap();
    let recovery = secret.key;
    assert_eq!(principal, draft.principal_id);
    assert_eq!(recovery.public_key(), head.recovery_key);
    let record = state.record(&draft.principal_id).unwrap();
    let stored = serde_json::to_string(&record).unwrap();
    assert!(!stored.contains(&recovery.to_text()["ed25519:".len()..]));
    // The backup key is kept; it is not the recovery key.
    assert_eq!(
        record.backup_key.as_deref().map(String::as_str),
        Some(backup::encode_key(&secret.backup_key).as_str())
    );
    assert!(!record.confirmed);
}

#[test]
fn a_retried_enrollment_reuses_the_keys_the_kit_belongs_to() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    let first = state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    let second = state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    assert_eq!(first.key_log, second.key_log);
    assert_eq!(first.device, second.device);
}

#[test]
fn a_confirmed_enrollment_is_listed_and_survives_a_server_that_forgets_it() {
    let state = self::state();
    let (draft, _) = enrolled(&state);
    let accounts = state.accounts(ENDPOINT).unwrap();
    assert_eq!(accounts.len(), 1);
    let local = &accounts[0];
    assert_eq!(local.principal_id, draft.principal_id);
    assert_eq!(local.user_id.as_deref(), Some("u1"));
    assert_eq!(local.username.as_deref(), Some("u1-name"));
    assert!(local.has_identity_key && local.confirmed);
    assert!(state
        .accounts("https://other.example/api")
        .unwrap()
        .is_empty());

    // The draft is finished.
    assert!(matches!(
        state.sign_enrollment(&draft.draft_id, &account("u1"), &challenge()),
        Err(KeyIdentityError::NoDraft)
    ));

    // A server answering `null` never deletes confirmed keys.
    assert_eq!(state.settle(&account("u1"), None).unwrap(), None);
    assert_eq!(state.accounts(ENDPOINT).unwrap().len(), 1);
}

#[test]
fn keys_the_server_never_accepted_are_cleaned_up() {
    // Refused: the enrollment is discarded.
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    state.discard_enrollment(&draft.draft_id).unwrap();
    assert!(state.accounts(ENDPOINT).unwrap().is_empty());
    assert!(matches!(
        state.record(&draft.principal_id),
        Err(KeyIdentityError::NoKeys)
    ));

    // The app quit before the answer, and the server never enrolled it: the next run, which
    // holds no draft, cleans up.
    let store = Arc::new(MemorySecretStore::default());
    let state = KeyIdentityState::new(store.clone());
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    let restarted = KeyIdentityState::new(store);
    assert_eq!(restarted.settle(&account("u1"), None).unwrap(), None);
    assert!(restarted.accounts(ENDPOINT).unwrap().is_empty());

    // Another account's unconfirmed keys are left alone.
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_enrollment(&draft.draft_id, &account("u2"), &challenge())
        .unwrap();
    restarted.settle(&account("u1"), None).unwrap();
    assert_eq!(restarted.accounts(ENDPOINT).unwrap().len(), 1);
}

#[test]
fn a_confirmed_account_signs_login_proofs_for_the_endpoint() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let proof = state
        .sign_login(
            "https://RIM.Example.com/api",
            &draft.principal_id,
            &challenge(),
        )
        .unwrap();
    let device_key = payload_field(&statements.device, "deviceKey");
    assert!(verify(
        &proof,
        context::LOGIN,
        device_key.as_str().unwrap(),
        2
    ));
    assert_eq!(payload_field(&proof, "audience"), "rim.example.com");
    assert_eq!(payload_field(&proof, "nonce"), "bm9uY2U");
    assert!(matches!(
        state.sign_login(ENDPOINT, "rimp1_other", &challenge()),
        Err(KeyIdentityError::NoKeys)
    ));
}

#[test]
fn login_proofs_and_delegations_for_another_server_use_its_id() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let host = "rims1_OFPDNXTV1splCcKcgz1vWYj6Mg-lbUollHQwXTkYEBw";
    let device_key = payload_field(&statements.device, "deviceKey");
    let device_key = device_key.as_str().unwrap();
    let proof = state
        .sign_login_for_server(host, &draft.principal_id, &challenge())
        .unwrap();
    assert!(verify(&proof, context::LOGIN, device_key, 2));
    assert_eq!(payload_field(&proof, "audience"), host);
    assert!(state
        .sign_login_for_server("https://host.example", &draft.principal_id, &challenge())
        .is_err());
    assert!(state
        .sign_login_for_server("rims1_short", &draft.principal_id, &challenge())
        .is_err());

    let delegation = state
        .sign_delegation(
            &draft.principal_id,
            &statement::DelegationInput {
                relay: "rims1_T5LLFxkrobgyvlf3WVxuvLlfqYSZAssRFgmvCfI2R-c".into(),
                relay_key_hash: "8UGftl4tBoxZjUo1UP_-zwUlobQJPwj5kZ0NC1oaAaM".into(),
                host: host.into(),
                workspace_id: "0199d1a0-0000-7000-8000-000000000002".into(),
                nonce: "cHFyc3R1dnd4eXp7fH1-fw".into(),
                issued_at: "2026-10-09T00:00:00Z".into(),
                expires_at: "2026-10-09T06:00:00Z".into(),
            },
        )
        .unwrap();
    assert!(verify(&delegation, context::DELEGATION, device_key, 2));
    assert_eq!(
        payload_field(&delegation, "principalId"),
        draft.principal_id.as_str()
    );
    assert_eq!(
        payload_field(&delegation, "deviceId"),
        payload_field(&statements.device, "deviceId")
    );
}

#[test]
fn a_rotation_is_pending_until_the_log_moves_past_it() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let log = statements.key_log;
    let old_identity = replay(&log).unwrap().identity_key;

    let entry = state.begin_rotation(&draft.principal_id, &log).unwrap();
    assert_eq!(payload_field(&entry, "signer"), "identity");
    assert!(verify(&entry, context::KEY_LOG, &old_identity, 2));

    // A log that ends before the rotation (a stale copy, or the rotation still in flight)
    // keeps the pending key, and a retry signs the same rotation key again.
    let status = state.sync_log(&draft.principal_id, &log).unwrap();
    assert!(status.holds_identity_key);
    let record = state.record(&draft.principal_id).unwrap();
    assert!(record.pending_identity_seed.is_some());
    assert_eq!(record.pending_identity_seq, Some(1));
    let retry = state.begin_rotation(&draft.principal_id, &log).unwrap();
    assert_eq!(
        payload_field(&retry, "identityKey"),
        payload_field(&entry, "identityKey")
    );

    // Accepted: the log ends at the new key, which is promoted.
    let rotated = [log.clone(), vec![entry]].concat();
    let status = state.sync_log(&draft.principal_id, &rotated).unwrap();
    assert_eq!(status.seq, 1);
    assert!(status.holds_identity_key);
    let new_identity = replay(&rotated).unwrap().identity_key;
    assert_ne!(new_identity, old_identity);
    let card = state
        .sign_profile_card(
            &draft.principal_id,
            &rotated,
            &CardContent {
                version: 2,
                display_name: "Ada".into(),
                relays: vec!["http://localhost:8080".into()],
                certificates: vec![statements.device.clone()],
            },
        )
        .unwrap();
    assert!(verify(&card, context::PROFILE_CARD, &new_identity, 2));
    assert_eq!(payload_field(&card, "keySeq"), 1);
    assert_eq!(
        payload_field(&card, "devices")[0]["deviceKey"],
        payload_field(&statements.device, "deviceKey")
    );

    // The old log no longer matches any key here.
    assert!(matches!(
        state.begin_rotation(&draft.principal_id, &log),
        Err(KeyIdentityError::NoIdentityKey)
    ));
}

#[test]
fn a_rotation_that_lost_its_seq_to_another_is_dropped() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let log = statements.key_log;
    state.begin_rotation(&draft.principal_id, &log).unwrap();

    // Seq 1 went to a recovery with another key: the pending key will never be the head's.
    let other = self::state();
    let recovered = other
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &log, "Other")
        .unwrap();
    let moved = [log, vec![recovered.entry]].concat();
    let status = state.sync_log(&draft.principal_id, &moved).unwrap();
    assert!(!status.holds_identity_key);
    let record = state.record(&draft.principal_id).unwrap();
    assert!(record.pending_identity_seed.is_none());
    assert!(record.pending_identity_seq.is_none());
}

#[test]
fn a_profile_card_lists_only_certified_devices() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let log = statements.key_log;
    let card = |certificates: Vec<Statement>| {
        state.sign_profile_card(
            &draft.principal_id,
            &log,
            &CardContent {
                version: 1,
                display_name: "Ada".into(),
                relays: vec![],
                certificates,
            },
        )
    };
    assert!(card(vec![statements.device.clone()]).is_ok());

    // A device row whose key the identity key never certified.
    let mut swapped = statements.device.clone();
    let real = payload_field(&statements.device, "deviceKey");
    let intruder = statement::SecretKey::generate().unwrap().public_key();
    swapped.payload = swapped.payload.replace(real.as_str().unwrap(), &intruder);
    assert!(matches!(
        card(vec![statements.device.clone(), swapped]),
        Err(KeyIdentityError::Invalid(_))
    ));
}

#[test]
fn revocation_uses_the_device_key_for_itself_and_the_identity_key_for_others() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let log = &statements.key_log;
    let own_device = payload_field(&statements.device, "deviceId");
    let own_key = payload_field(&statements.device, "deviceKey");

    let own = state
        .sign_revocation(&draft.principal_id, log, own_device.as_str().unwrap())
        .unwrap();
    assert_eq!(payload_field(&own, "signer"), "device");
    assert!(verify(
        &own,
        context::DEVICE_REVOKE,
        own_key.as_str().unwrap(),
        2
    ));

    let other = state
        .sign_revocation(
            &draft.principal_id,
            log,
            "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7c",
        )
        .unwrap();
    assert_eq!(payload_field(&other, "signer"), "identity");
    let identity = replay(log).unwrap().identity_key;
    assert!(verify(&other, context::DEVICE_REVOKE, &identity, 2));
}

#[test]
fn a_log_for_another_account_is_refused() {
    let state = self::state();
    let (draft, _) = enrolled(&state);
    let other = state.begin_enrollment("Other").unwrap();
    let other_log = state
        .sign_enrollment(&other.draft_id, &account("u2"), &challenge())
        .unwrap()
        .key_log;
    assert!(matches!(
        state.sync_log(&draft.principal_id, &other_log),
        Err(KeyIdentityError::Invalid(_))
    ));
}

#[test]
fn recovery_signs_a_rotation_with_the_kit_and_enrolls_a_new_device() {
    // The device that enrolled is gone; a fresh install has only the kit.
    let old = state();
    let (draft, statements) = enrolled(&old);
    let log = statements.key_log;
    let fresh = self::state();

    let recovered = fresh
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &log, "New laptop")
        .unwrap();
    assert_eq!(recovered.principal_id, draft.principal_id);
    assert_eq!(payload_field(&recovered.entry, "signer"), "recovery");
    let rotated = [log.clone(), vec![recovered.entry.clone()]].concat();
    let head = replay(&rotated).unwrap();
    assert_eq!(head.seq, 1);
    assert!(verify(
        &recovered.device,
        context::DEVICE,
        &head.identity_key,
        2
    ));
    assert_eq!(payload_field(&recovered.device, "keySeq"), 1);

    // The new keys are stored, linked to the server, and sign in once the account is known.
    let accounts = fresh.accounts(ENDPOINT).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].user_id, None);
    assert!(fresh
        .sign_login(ENDPOINT, &draft.principal_id, &challenge())
        .is_ok());
    let local = fresh
        .settle(&account("u1"), Some(draft.principal_id.as_str()))
        .unwrap()
        .unwrap();
    assert_eq!(local.user_id.as_deref(), Some("u1"));
    assert_eq!(fresh.accounts(ENDPOINT).unwrap().len(), 1);
    assert!(
        fresh
            .sync_log(&draft.principal_id, &rotated)
            .unwrap()
            .holds_identity_key
    );
    // The kit's backup key came along, the same the enrolling device kept.
    assert_eq!(
        fresh.record(&draft.principal_id).unwrap().backup_key,
        old.record(&draft.principal_id).unwrap().backup_key
    );
    assert!(fresh
        .record(&draft.principal_id)
        .unwrap()
        .backup_key
        .is_some());
    // The person just used the kit: it counts as saved and nothing of it is kept.
    let record = fresh.record(&draft.principal_id).unwrap();
    assert_eq!(record.kit_confirmed, Some(true));
    assert!(record.recovery_entropy.is_none());
    assert!(fresh.recovery_kit(&draft.principal_id).unwrap().is_none());
}

#[test]
fn recovery_takes_a_bare_numbered_phrase_with_the_account_id_typed_separately() {
    let old = state();
    let (draft, statements) = enrolled(&old);
    let numbered: String = draft
        .recovery_phrase
        .iter()
        .enumerate()
        .map(|(i, w)| format!("{}. {}\n", i + 1, w.to_uppercase()))
        .collect();

    let recovered = self::state()
        .begin_recovery(
            ENDPOINT,
            &numbered,
            Some(draft.principal_id.as_str()),
            &statements.key_log,
            "New laptop",
        )
        .unwrap();
    assert_eq!(recovered.principal_id, draft.principal_id);
    let head = replay(&statements.key_log).unwrap();
    assert!(verify(
        &recovered.entry,
        context::KEY_LOG,
        &head.recovery_key,
        2
    ));
}

#[test]
fn a_refused_recovery_puts_back_the_keys_it_replaced() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let log = statements.key_log;
    let original = state.record(&draft.principal_id).unwrap();

    // This device lost the identity key (another device rotated) but keeps its device key.
    let other = self::state();
    let rotated_elsewhere = other
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &log, "Other")
        .unwrap();
    let moved = [log, vec![rotated_elsewhere.entry]].concat();

    let attempt = state
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &moved, "Again")
        .unwrap();
    assert_ne!(
        state.record(&draft.principal_id).unwrap().device_id,
        original.device_id
    );
    state
        .discard_recovery(&draft.principal_id, &attempt.device_id)
        .unwrap();
    let restored = state.record(&draft.principal_id).unwrap();
    assert_eq!(restored.device_id, original.device_id);
    assert!(restored.confirmed);

    // A refused recovery on a fresh install leaves nothing behind.
    let fresh = self::state();
    let attempt = fresh
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &moved, "New")
        .unwrap();
    fresh
        .discard_recovery(&draft.principal_id, &attempt.device_id)
        .unwrap();
    assert!(matches!(
        fresh.record(&draft.principal_id),
        Err(KeyIdentityError::NoKeys)
    ));

    // A recovery the server took is confirmed by the next settle and is not undone.
    let taken = state
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &moved, "Again")
        .unwrap();
    state
        .settle(&account("u1"), Some(draft.principal_id.as_str()))
        .unwrap();
    state
        .discard_recovery(&draft.principal_id, &taken.device_id)
        .unwrap();
    let kept = state.record(&draft.principal_id).unwrap();
    assert_eq!(kept.device_id, taken.device_id);
    assert!(kept.replaced.is_none());
}

#[test]
fn recovery_refuses_a_wrong_kit_an_unknown_account_and_a_device_that_still_has_the_key() {
    let old = state();
    let (draft, statements) = enrolled(&old);
    let log = statements.key_log;
    let fresh = self::state();

    let wrong = recovery_kit::format_kit_v1(
        &draft.principal_id,
        &statement::SecretKey::from_seed(zeroize::Zeroizing::new([5u8; 32])),
    );
    assert!(fresh
        .begin_recovery(ENDPOINT, &wrong, None, &log, "New")
        .is_err());
    assert!(fresh
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &[], "New")
        .is_err());
    assert!(fresh.accounts(ENDPOINT).unwrap().is_empty());

    // The enrolling device still holds the identity key: nothing to recover.
    assert!(old
        .begin_recovery(ENDPOINT, &draft.recovery_kit, None, &log, "Again")
        .is_err());
}

#[test]
fn forget_removes_the_keys() {
    let state = self::state();
    let (draft, _) = enrolled(&state);
    state.forget(&draft.principal_id).unwrap();
    assert!(state.accounts(ENDPOINT).unwrap().is_empty());
}

#[test]
fn audience_is_the_endpoint_authority_lowercased() {
    assert_eq!(
        audience("http://localhost:8080/api").unwrap(),
        "localhost:8080"
    );
    assert_eq!(
        audience("https://RIM.example.com/api").unwrap(),
        "rim.example.com"
    );
    assert_eq!(
        audience("https://user@rim.example.com:8443").unwrap(),
        "rim.example.com:8443"
    );
    assert!(audience("/api").is_err());
    assert!(audience("https:///api").is_err());
}

#[test]
fn device_names_are_trimmed_and_bounded() {
    assert_eq!(device_name("  Work\u{7}  laptop ").unwrap(), "Work  laptop");
    assert_eq!(device_name(&"x".repeat(80)).unwrap().chars().count(), 64);
    assert!(device_name(" \n ").is_err());
    assert!(!default_device_name().is_empty());
}

#[test]
fn a_settle_never_removes_the_keys_of_an_enrollment_still_in_flight() {
    // The server answered "not enrolled" before the enrollment it is about to accept.
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    assert_eq!(state.settle(&account("u1"), None).unwrap(), None);
    assert!(state.record(&draft.principal_id).is_ok());

    // The enrollment lands: the keys are there to confirm.
    let local = state
        .settle(&account("u1"), Some(draft.principal_id.as_str()))
        .unwrap()
        .unwrap();
    assert!(local.confirmed && local.has_identity_key);
}

#[test]
fn a_signup_stores_the_keys_before_the_account_exists_and_settles_with_its_user_id() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    let statements = state
        .sign_signup(&draft.draft_id, ENDPOINT, "  ada  ", &challenge())
        .unwrap();

    let head = replay(&statements.key_log).unwrap();
    assert_eq!(head.principal_id, draft.principal_id);
    // The proof-of-work computed from the draft is over the inception the signup sends.
    assert_eq!(statements.key_log[0].payload, draft.inception_payload);
    assert!(verify(
        &statements.device,
        context::DEVICE,
        &head.identity_key,
        2
    ));
    let device_key = payload_field(&statements.device, "deviceKey");
    assert!(verify(
        &statements.proof,
        context::LOGIN,
        device_key.as_str().unwrap(),
        2
    ));
    assert_eq!(
        payload_field(&statements.proof, "principalId"),
        draft.principal_id.as_str()
    );
    assert_eq!(
        payload_field(&statements.proof, "audience"),
        "localhost:8080"
    );

    // Stored and listed before the server answers, with no user id yet, so an answer that is
    // lost still leaves a key to sign in with.
    let accounts = state.accounts(ENDPOINT).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].user_id, None);
    assert_eq!(accounts[0].username.as_deref(), Some("ada"));
    assert!(accounts[0].has_identity_key && !accounts[0].confirmed);

    // The server answered with the new user id: settling links and confirms the keys and
    // finishes the draft.
    let ada = ServerAccount {
        endpoint: ENDPOINT.into(),
        user_id: "u-ada".into(),
        username: "ada".into(),
    };
    let local = state
        .settle(&ada, Some(draft.principal_id.as_str()))
        .unwrap()
        .unwrap();
    assert!(local.confirmed && local.has_identity_key);
    assert_eq!(local.user_id.as_deref(), Some("u-ada"));
    assert_eq!(state.accounts(ENDPOINT).unwrap().len(), 1);
    assert!(matches!(
        state.sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge()),
        Err(KeyIdentityError::NoDraft)
    ));
}

#[test]
fn a_refused_signup_removes_its_keys_and_a_retry_signs_the_same_keys_again() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    let first = state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge())
        .unwrap();

    state.remove_draft_keys(&draft.draft_id).unwrap();
    assert!(state.accounts(ENDPOINT).unwrap().is_empty());
    assert!(matches!(
        state.record(&draft.principal_id),
        Err(KeyIdentityError::NoKeys)
    ));

    // Another username, the same keys: the recovery kit already shown stays theirs.
    let second = state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada2", &challenge())
        .unwrap();
    assert_eq!(first.key_log, second.key_log);
    assert_eq!(first.device, second.device);
    let accounts = state.accounts(ENDPOINT).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].username.as_deref(), Some("ada2"));

    // Discarding drops the draft with its keys.
    state.discard_enrollment(&draft.draft_id).unwrap();
    assert!(state.accounts(ENDPOINT).unwrap().is_empty());
    assert!(matches!(
        state.remove_draft_keys(&draft.draft_id),
        Err(KeyIdentityError::NoDraft)
    ));
}

#[test]
fn signing_a_draft_again_never_downgrades_confirmed_keys() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    // The server confirmed the keys while this draft is still held.
    state
        .keys()
        .put_record(&KeyRecord {
            confirmed: true,
            ..state.record(&draft.principal_id).unwrap()
        })
        .unwrap();

    state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge())
        .unwrap();
    let accounts = state.accounts(ENDPOINT).unwrap();
    assert_eq!(accounts.len(), 1);
    assert!(accounts[0].confirmed);
    assert_eq!(accounts[0].user_id.as_deref(), Some("u1"));

    state.remove_draft_keys(&draft.draft_id).unwrap();
    state.forget_unconfirmed(&draft.principal_id).unwrap();
    assert!(state.record(&draft.principal_id).unwrap().confirmed);
}

#[test]
fn a_signup_the_server_took_after_its_keys_were_removed_gets_them_back() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    let signed = state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge())
        .unwrap();
    state.remove_draft_keys(&draft.draft_id).unwrap();
    assert!(state.accounts(ENDPOINT).unwrap().is_empty());

    state
        .restore_draft_keys(&draft.draft_id, ENDPOINT, " ada ")
        .unwrap();
    let accounts = state.accounts(ENDPOINT).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].username.as_deref(), Some("ada"));
    assert_eq!(
        payload_field(&signed.device, "deviceId"),
        accounts[0].device_id.as_str()
    );
    // The same keys: a login proof from them names the certificate's device.
    let proof = state
        .sign_login(ENDPOINT, &draft.principal_id, &challenge())
        .unwrap();
    let device_key = payload_field(&signed.device, "deviceKey");
    assert!(verify(
        &proof,
        context::LOGIN,
        device_key.as_str().unwrap(),
        2
    ));
}

#[test]
fn unconfirmed_keys_of_a_signup_that_never_reached_the_server_can_be_removed() {
    // The app quit after storing the keys; the next run holds no draft.
    let store = Arc::new(MemorySecretStore::default());
    let state = KeyIdentityState::new(store.clone());
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge())
        .unwrap();
    let restarted = KeyIdentityState::new(store);
    assert_eq!(restarted.accounts(ENDPOINT).unwrap().len(), 1);

    restarted.forget_unconfirmed(&draft.principal_id).unwrap();
    assert!(restarted.accounts(ENDPOINT).unwrap().is_empty());
    assert!(matches!(
        restarted.record(&draft.principal_id),
        Err(KeyIdentityError::NoKeys)
    ));

    // Confirmed keys stay.
    let (enrolled, _) = enrolled(&restarted);
    restarted
        .forget_unconfirmed(&enrolled.principal_id)
        .unwrap();
    assert_eq!(restarted.accounts(ENDPOINT).unwrap().len(), 1);
}

#[test]
fn a_signup_needs_a_username_and_a_server_url() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    assert!(matches!(
        state.sign_signup(&draft.draft_id, ENDPOINT, "   ", &challenge()),
        Err(KeyIdentityError::Invalid(_))
    ));
    assert!(matches!(
        state.sign_signup(&draft.draft_id, "/api", "ada", &challenge()),
        Err(KeyIdentityError::Invalid(_))
    ));
    assert!(state.accounts(ENDPOINT).unwrap().is_empty());
}

// ─── The recovery kit ────────────────────────────────────────────────────────

/// A key-only signup on `store` whose kit the person saves later.
fn signed_up_kit_later(store: &Arc<MemorySecretStore>) -> (KeyIdentityState, EnrollmentDraft) {
    let state = KeyIdentityState::new(store.clone());
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge())
        .unwrap();
    (state, draft)
}

/// The draft's kit entropy as a record would keep it.
fn stored_entropy(draft: &EnrollmentDraft) -> String {
    let entropy = recovery_kit::parse_recovery_phrase(&draft.recovery_phrase.join(" ")).unwrap();
    recovery_kit::encode_entropy(&entropy).to_string()
}

fn assert_kit_of(kit: Option<RecoveryKitText>, draft: &EnrollmentDraft) {
    let kit = kit.expect("the kit is kept");
    assert_eq!(kit.principal_id, draft.principal_id);
    assert_eq!(*kit.recovery_kit, *draft.recovery_kit);
    assert_eq!(*kit.recovery_phrase, *draft.recovery_phrase);
}

/// Whether the stored record of the draft's principal holds anything of the kit's secret.
fn record_holds_kit(state: &KeyIdentityState, draft: &EnrollmentDraft) -> bool {
    let record = state.record(&draft.principal_id).unwrap();
    let stored = serde_json::to_string(&record).unwrap();
    record.recovery_entropy.is_some() || stored.contains(&stored_entropy(draft))
}

#[test]
fn a_kit_saved_later_is_kept_with_the_keys_and_read_back_after_a_restart() {
    let store = Arc::new(MemorySecretStore::default());
    let (state, draft) = signed_up_kit_later(&store);
    assert_kit_of(state.recovery_kit(&draft.principal_id).unwrap(), &draft);

    let record = state.record(&draft.principal_id).unwrap();
    assert_eq!(record.kit_confirmed, Some(false));
    assert_eq!(
        record.recovery_entropy.as_deref().map(String::as_str),
        Some(stored_entropy(&draft).as_str())
    );

    // A later run holds no draft and reads the kit from the record.
    let restarted = KeyIdentityState::new(store.clone());
    assert_kit_of(restarted.recovery_kit(&draft.principal_id).unwrap(), &draft);

    // The server confirming the keys finishes the draft but keeps the unsaved kit.
    let ada = ServerAccount {
        endpoint: ENDPOINT.into(),
        user_id: "u-ada".into(),
        username: "ada".into(),
    };
    state
        .settle(&ada, Some(draft.principal_id.as_str()))
        .unwrap();
    assert_kit_of(state.recovery_kit(&draft.principal_id).unwrap(), &draft);
    assert!(state.recovery_kit("rimp1_other").unwrap().is_none());
}

#[test]
fn confirming_the_kit_deletes_its_secret_from_the_draft_and_the_record() {
    let store = Arc::new(MemorySecretStore::default());
    let (state, draft) = signed_up_kit_later(&store);
    state.confirm_recovery_kit(&draft.principal_id).unwrap();

    assert!(state.recovery_kit(&draft.principal_id).unwrap().is_none());
    assert!(!record_holds_kit(&state, &draft));
    assert_eq!(
        state.record(&draft.principal_id).unwrap().kit_confirmed,
        Some(true)
    );
    let restarted = KeyIdentityState::new(store);
    assert!(restarted
        .recovery_kit(&draft.principal_id)
        .unwrap()
        .is_none());

    // The draft let go of it too: a retried signup stores the keys without it.
    state.remove_draft_keys(&draft.draft_id).unwrap();
    state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge())
        .unwrap();
    assert!(!record_holds_kit(&state, &draft));
    assert_eq!(
        state.record(&draft.principal_id).unwrap().kit_confirmed,
        Some(true)
    );
    // Confirming again changes nothing.
    state.confirm_recovery_kit(&draft.principal_id).unwrap();
    assert!(state.recovery_kit(&draft.principal_id).unwrap().is_none());
}

#[test]
fn a_kit_confirmed_before_the_keys_are_stored_is_never_written() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    assert_kit_of(state.recovery_kit(&draft.principal_id).unwrap(), &draft);

    state.confirm_recovery_kit(&draft.principal_id).unwrap();
    assert!(state.recovery_kit(&draft.principal_id).unwrap().is_none());
    state
        .sign_enrollment(&draft.draft_id, &account("u1"), &challenge())
        .unwrap();
    assert!(!record_holds_kit(&state, &draft));
    assert_eq!(
        state.record(&draft.principal_id).unwrap().kit_confirmed,
        Some(true)
    );
}

#[test]
fn a_discarded_enrollment_takes_its_kit_with_it() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    state.discard_enrollment(&draft.draft_id).unwrap();
    assert!(state.recovery_kit(&draft.principal_id).unwrap().is_none());

    let store = Arc::new(MemorySecretStore::default());
    let (state, draft) = signed_up_kit_later(&store);
    state.discard_enrollment(&draft.draft_id).unwrap();
    assert!(state.recovery_kit(&draft.principal_id).unwrap().is_none());
    assert!(matches!(
        state.record(&draft.principal_id),
        Err(KeyIdentityError::NoKeys)
    ));
}

// ─── Device linking ──────────────────────────────────────────────────────────

use device_link::{KnownDevice, LinkCode, LiveLink, Offer, Sealed};

const LINK_ID: &str = "AAECAwQFBgcICQoLDA0ODw";

/// An enrolled old device with a started link, and its code.
struct OldDevice {
    store: Arc<MemorySecretStore>,
    state: KeyIdentityState,
    principal_id: String,
    key_log: Vec<Statement>,
    devices: Vec<KnownDevice>,
    code: String,
}

fn old_device() -> OldDevice {
    let store = Arc::new(MemorySecretStore::default());
    let state = KeyIdentityState::new(store.clone());
    let (draft, statements) = enrolled(&state);
    // Signed in: the account is unlocked, so its pending links can be sealed.
    state
        .account_lock()
        .unlock_for_tests(&draft.principal_id, [3; 32]);
    state.seal_at_rest(&draft.principal_id).unwrap();
    let started = state
        .begin_link(&draft.principal_id, ENDPOINT, LINK_ID)
        .unwrap();
    assert!(started
        .code
        .starts_with("rim-link:1:AAECAwQFBgcICQoLDA0ODw:"));
    let devices = vec![KnownDevice {
        device_id: payload_field(&statements.device, "deviceId")
            .as_str()
            .unwrap()
            .into(),
        public_key: payload_field(&statements.device, "deviceKey")
            .as_str()
            .unwrap()
            .into(),
    }];
    OldDevice {
        store,
        state,
        principal_id: draft.principal_id,
        key_log: statements.key_log,
        devices,
        code: started.code.to_string(),
    }
}

impl OldDevice {
    fn review(&self, offer: &Sealed) -> Result<device_link::OfferReview> {
        self.state
            .review_offer(LINK_ID, &self.key_log, &self.devices, offer)
    }

    /// Seal an offer as anyone holding the code could.
    fn seal_offer(&self, offer: &Offer) -> Sealed {
        let code = LinkCode::parse(&self.code).unwrap();
        device_link::seal(&code, device_link::Direction::Offer, &offer.to_bytes()).unwrap()
    }
}

fn fresh_offer() -> Offer {
    Offer::new(
        &uuid::Uuid::now_v7().to_string(),
        &SecretKey::generate().unwrap().public_key(),
        "Phone",
    )
}

fn nothing_stored(store: &MemorySecretStore) -> bool {
    let lock = AccountLock::in_memory();
    let keys = store::Keys::new(store, &lock);
    keys.links().unwrap().is_empty() && keys.pending_links().unwrap().is_empty()
}

#[test]
fn a_device_links_end_to_end_and_signs_in_with_its_own_key() {
    let old = old_device();
    let new_store = Arc::new(MemorySecretStore::default());
    let new = KeyIdentityState::new(new_store.clone());

    let sent = new.offer_link(ENDPOINT, &old.code, "Phone").unwrap();
    assert_eq!(sent.link_id, LINK_ID);
    assert!(nothing_stored(&new_store));

    let review = old.review(&sent.offer).unwrap();
    assert_eq!(review.fingerprint, sent.fingerprint);
    assert_eq!(review.name, "Phone");
    assert_eq!(review.platform, "desktop");

    // The person renamed it before confirming.
    let answer = old
        .state
        .confirm_link(LINK_ID, &old.key_log, "  Work phone ")
        .unwrap();
    assert_eq!(answer.device_id, review.device_id);
    assert_eq!(payload_field(&answer.certificate, "name"), "Work phone");
    assert_eq!(payload_field(&answer.certificate, "keySeq"), 0);
    let head = replay(&old.key_log).unwrap();
    assert!(statement::certified_device(&answer.certificate, &head).is_ok());
    // A retry sends the same bytes.
    assert_eq!(
        old.state
            .confirm_link(LINK_ID, &old.key_log, "Other")
            .unwrap(),
        answer
    );
    // The pending record is in the keyring before `addDeviceKey`.
    let pending = old.state.keys().pending_links().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].device_id, answer.device_id);
    assert_eq!(pending[0].certificate, answer.certificate);

    let opened = new.open_link_answer(LINK_ID, &answer.answer).unwrap();
    assert_eq!(opened.principal_id, old.principal_id);
    assert!(nothing_stored(&new_store));

    let linked = new.accept_link(LINK_ID, &old.key_log).unwrap();
    assert_eq!(linked.principal_id, old.principal_id);
    assert_eq!(linked.device_id, answer.device_id);
    assert_eq!(linked.device_name, "Work phone");
    let accounts = new.accounts(ENDPOINT).unwrap();
    assert_eq!(accounts.len(), 1);
    let account = &accounts[0];
    assert!(!account.has_identity_key && !account.confirmed);
    assert_eq!(account.user_id, None);
    // A linked device never saw the kit, so its record says nothing about it.
    let record = new.record(&old.principal_id).unwrap();
    assert!(record.recovery_entropy.is_none() && record.kit_confirmed.is_none());
    assert!(new.recovery_kit(&old.principal_id).unwrap().is_none());

    let proof = new
        .sign_login(ENDPOINT, &old.principal_id, &challenge())
        .unwrap();
    assert!(verify(&proof, context::LOGIN, &answer.device_key, 2));
    assert_eq!(payload_field(&proof, "deviceId"), answer.device_id.as_str());
    // The link is over on the new device.
    assert!(matches!(
        new.accept_link(LINK_ID, &old.key_log),
        Err(KeyIdentityError::NoLink)
    ));

    old.state.end_link(LINK_ID).unwrap();
    assert!(old.state.keys().pending_links().unwrap().is_empty());
}

#[test]
fn the_old_device_refuses_and_reports_bad_offers() {
    let old = old_device();
    let head = replay(&old.key_log).unwrap();
    let refused = |offer: &Offer| old.review(&old.seal_offer(offer)).unwrap_err().to_string();

    // Sealed without the secret: the same link id under another secret.
    let mut parts: Vec<String> = old.code.splitn(5, ':').map(String::from).collect();
    parts[3] = statement::b64(&[7u8; 32]);
    let stranger = LinkCode::parse(&parts.join(":")).unwrap();
    let bogus = device_link::seal(
        &stranger,
        device_link::Direction::Offer,
        &fresh_offer().to_bytes(),
    )
    .unwrap();
    assert!(old
        .review(&bogus)
        .unwrap_err()
        .to_string()
        .contains("someone other than your new device"));
    // A sealed plaintext that breaks the rules reads the same.
    let code = LinkCode::parse(&old.code).unwrap();
    let not_json = device_link::seal(&code, device_link::Direction::Offer, b"{\"v\":1}").unwrap();
    assert!(old
        .review(&not_json)
        .unwrap_err()
        .to_string()
        .contains("someone other than your new device"));

    let with = |f: &dyn Fn(&mut Offer)| {
        let mut offer = fresh_offer();
        f(&mut offer);
        offer
    };
    for key in [head.identity_key.clone(), head.recovery_key.clone()] {
        let err = refused(&with(&|o| o.device_key = key.clone()));
        assert!(err.contains("one of this account's own keys"), "{err}");
    }
    let used_key = old.devices[0].public_key.clone();
    assert!(refused(&with(&|o| o.device_key = used_key.clone())).contains("already used"));
    let used_id = old.devices[0].device_id.clone();
    assert!(refused(&with(&|o| o.device_id = used_id.clone())).contains("already used"));
    assert!(refused(&with(&|o| o.device_key = "ed25519:AAAA".into())).contains("malformed"));
    assert!(refused(&with(&|o| o.device_key = "mldsa44:AAAA".into())).contains("malformed"));
    assert!(refused(&with(&|o| o.device_id = "not-a-uuid".into())).contains("device id"));
    assert!(refused(&with(&|o| o.name = "\u{7}".into())).contains("name"));

    // A revoked device's key and id stay taken: `devices` lists it.
    let revoked = fresh_offer();
    let mut devices = old.devices.clone();
    devices.push(KnownDevice {
        device_id: revoked.device_id.clone(),
        public_key: revoked.device_key.clone(),
    });
    assert!(old
        .state
        .review_offer(LINK_ID, &old.key_log, &devices, &old.seal_offer(&revoked))
        .is_err());

    // Nothing to confirm after a refusal.
    assert!(old.state.confirm_link(LINK_ID, &old.key_log, "x").is_err());
    assert!(old.state.keys().pending_links().unwrap().is_empty());
}

#[test]
fn only_a_device_holding_the_identity_key_reviews_offers() {
    let old = old_device();
    let stranger = KeyIdentityState::new(Arc::new(MemorySecretStore::default()));
    assert!(matches!(
        stranger.begin_link(&old.principal_id, ENDPOINT, LINK_ID),
        Err(KeyIdentityError::NoKeys)
    ));

    // A linked device holds only its own device key.
    let linked = KeyIdentityState::new(Arc::new(MemorySecretStore::default()));
    let sent = linked.offer_link(ENDPOINT, &old.code, "Phone").unwrap();
    old.review(&sent.offer).unwrap();
    let answer = old
        .state
        .confirm_link(LINK_ID, &old.key_log, "Phone")
        .unwrap();
    linked.open_link_answer(LINK_ID, &answer.answer).unwrap();
    linked.accept_link(LINK_ID, &old.key_log).unwrap();

    const SECOND: &str = "EBESExQVFhcYGRobHB0eHw";
    let started = linked
        .begin_link(&old.principal_id, ENDPOINT, SECOND)
        .unwrap();
    let code = LinkCode::parse(&started.code).unwrap();
    let offer = device_link::seal(
        &code,
        device_link::Direction::Offer,
        &fresh_offer().to_bytes(),
    )
    .unwrap();
    assert!(matches!(
        linked.review_offer(SECOND, &old.key_log, &old.devices, &offer),
        Err(KeyIdentityError::NoIdentityKey)
    ));
}

#[test]
fn a_confirmed_link_resumes_after_a_restart_with_the_same_certificate() {
    let old = old_device();
    let new = KeyIdentityState::new(Arc::new(MemorySecretStore::default()));
    let sent = new.offer_link(ENDPOINT, &old.code, "Phone").unwrap();
    old.review(&sent.offer).unwrap();
    let answer = old
        .state
        .confirm_link(LINK_ID, &old.key_log, "Phone")
        .unwrap();
    // This run carries the link on itself.
    assert!(old.state.pending_links(ENDPOINT).unwrap().is_empty());

    let restarted = KeyIdentityState::new(old.store.clone());
    // Sealed under the account's data key: nothing to resume until the account is unlocked.
    assert!(restarted.pending_links(ENDPOINT).unwrap().is_empty());
    restarted
        .account_lock()
        .unlock_for_tests(&old.principal_id, [3; 32]);
    assert!(restarted
        .pending_links("https://other.example/api")
        .unwrap()
        .is_empty());
    let pending = restarted.pending_links(ENDPOINT).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].link_id, LINK_ID);
    assert_eq!(pending[0].principal_id, old.principal_id);
    assert_eq!(pending[0].device_id, answer.device_id);
    assert_eq!(pending[0].device_key, answer.device_key);

    let resumed = restarted.resume_link(LINK_ID).unwrap();
    assert_eq!(resumed, answer);
    assert_eq!(restarted.resume_link(LINK_ID).unwrap(), resumed);
    assert!(restarted.pending_links(ENDPOINT).unwrap().is_empty());
    new.open_link_answer(LINK_ID, &resumed.answer).unwrap();
    new.accept_link(LINK_ID, &old.key_log).unwrap();

    restarted.end_link(LINK_ID).unwrap();
    assert!(KeyIdentityState::new(old.store.clone())
        .pending_links(ENDPOINT)
        .unwrap()
        .is_empty());
    assert!(matches!(
        restarted.resume_link(LINK_ID),
        Err(KeyIdentityError::NoLink)
    ));
}

/// The old device certifies `offer` instead of the new device's own, as it would after the
/// person confirmed an offer someone else posted.
fn answer_for(old: &OldDevice, offer: &Offer) -> Sealed {
    old.review(&old.seal_offer(offer)).unwrap();
    old.state
        .confirm_link(LINK_ID, &old.key_log, "Phone")
        .unwrap()
        .answer
}

#[test]
fn the_new_device_refuses_a_certificate_for_another_key_or_device_id() {
    for change in [
        (|o: &mut Offer| o.device_key = SecretKey::generate().unwrap().public_key())
            as fn(&mut Offer),
        |o: &mut Offer| o.device_id = uuid::Uuid::now_v7().to_string(),
    ] {
        let old = old_device();
        let new_store = Arc::new(MemorySecretStore::default());
        let new = KeyIdentityState::new(new_store.clone());
        new.offer_link(ENDPOINT, &old.code, "Phone").unwrap();
        let LiveLink::New(link) = new.live_links().unwrap()[LINK_ID].clone() else {
            panic!("not a new-device link");
        };
        let mut other = link.offer().clone();
        change(&mut other);
        let answer = answer_for(&old, &other);

        let err = new
            .open_link_answer(LINK_ID, &answer)
            .unwrap_err()
            .to_string();
        assert!(err.contains("did not verify"), "{err}");
        assert!(nothing_stored(&new_store));
        assert!(matches!(
            new.accept_link(LINK_ID, &old.key_log),
            Err(KeyIdentityError::NoLink)
        ));
    }
}

#[test]
fn the_new_device_refuses_a_certificate_the_served_log_does_not_verify() {
    let old = old_device();
    let new_store = Arc::new(MemorySecretStore::default());
    let new = KeyIdentityState::new(new_store.clone());
    new.offer_link(ENDPOINT, &old.code, "Phone").unwrap();
    let LiveLink::New(link) = new.live_links().unwrap()[LINK_ID].clone() else {
        panic!("not a new-device link");
    };
    let offer = link.offer().clone();

    // A certificate naming this device, signed by a key that is not the account's.
    let forged = statement::device_cert(
        &SecretKey::generate().unwrap(),
        &statement::DeviceCertInput {
            principal_id: &old.principal_id,
            device_id: &offer.device_id,
            device_key: &offer.device_key,
            name: "Phone",
            key_seq: 0,
            issued_at: "2026-10-09T00:00:00Z",
        },
    );
    let code = LinkCode::parse(&old.code).unwrap();
    let sealed = device_link::seal(
        &code,
        device_link::Direction::Answer,
        &device_link::Answer::new(&forged).to_bytes(),
    )
    .unwrap();
    new.open_link_answer(LINK_ID, &sealed).unwrap();
    let err = new
        .accept_link(LINK_ID, &old.key_log)
        .unwrap_err()
        .to_string();
    assert!(err.contains("did not verify"), "{err}");
    assert!(nothing_stored(&new_store));

    // A genuine certificate checked against another account's log.
    let new = KeyIdentityState::new(new_store.clone());
    new.offer_link(ENDPOINT, &old.code, "Phone").unwrap();
    let LiveLink::New(link) = new.live_links().unwrap()[LINK_ID].clone() else {
        panic!("not a new-device link");
    };
    let answer = answer_for(&old, link.offer());
    new.open_link_answer(LINK_ID, &answer).unwrap();
    let elsewhere = old_device();
    assert!(new.accept_link(LINK_ID, &elsewhere.key_log).is_err());
    assert!(nothing_stored(&new_store));
}

#[test]
fn a_new_device_never_links_over_keys_it_holds_or_for_another_server() {
    let old = old_device();
    let new = KeyIdentityState::new(Arc::new(MemorySecretStore::default()));
    let err = new
        .offer_link("https://other.example/api", &old.code, "Phone")
        .unwrap_err()
        .to_string();
    assert!(err.contains("another server"), "{err}");
    let err = new
        .offer_link(ENDPOINT, "rim-link:2:x:y:http://h", "Phone")
        .unwrap_err()
        .to_string();
    assert!(err.contains("newer app"), "{err}");

    // A computer that already holds this account's keys keeps them.
    let same_computer = KeyIdentityState::new(old.store.clone());
    let sent = same_computer
        .offer_link(&format!("{ENDPOINT}/"), &old.code, "Phone")
        .unwrap();
    old.review(&sent.offer).unwrap();
    let answer = old
        .state
        .confirm_link(LINK_ID, &old.key_log, "Phone")
        .unwrap();
    same_computer
        .open_link_answer(LINK_ID, &answer.answer)
        .unwrap();
    let err = same_computer
        .accept_link(LINK_ID, &old.key_log)
        .unwrap_err()
        .to_string();
    assert!(err.contains("already holds keys"), "{err}");
    assert!(old
        .state
        .record(&old.principal_id)
        .unwrap()
        .identity_seed
        .is_some());
}

#[test]
fn a_plugin_manifest_is_signed_at_the_head_and_verifies() {
    use super::plugin_manifest::{
        verify_plugin_manifest, KeyHistory, PluginManifestInput, PluginSource, Validity,
    };
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let log = statements.key_log;
    let input = PluginManifestInput {
        publisher_name: "Ada".into(),
        manifest: r#"{"manifest_version":1,"plugin_id":"dev.example.pods","display_name":"Pods","version":"0.3.0","runtime_kind":"DesktopLocalProcess","entrypoint":"main.mjs"}"#.into(),
        source: PluginSource::Git {
            url: "https://github.com/acme/pods".into(),
            commit: "1a2b3c4d".repeat(5),
            tree_sha256: "ab".repeat(32),
        },
    };
    let signed = state
        .sign_plugin_manifest(&draft.principal_id, &log, &input)
        .unwrap();
    assert_eq!(payload_field(&signed, "keySeq"), 0);
    assert_eq!(payload_field(&signed, "pluginId"), "dev.example.pods");
    let verified = verify_plugin_manifest(&KeyHistory::replay(&log).unwrap(), &signed).unwrap();
    assert_eq!(verified.validity, Validity::Valid);

    // A web plugin cannot come from git, so nothing is signed for it.
    let web = PluginManifestInput {
        manifest: input
            .manifest
            .replace("DesktopLocalProcess", "WebSandboxed"),
        ..input.clone()
    };
    assert!(state
        .sign_plugin_manifest(&draft.principal_id, &log, &web)
        .is_err());

    // A device without the identity key cannot sign.
    let other = self::state();
    assert!(other
        .sign_plugin_manifest(&draft.principal_id, &log, &input)
        .is_err());
}

#[test]
fn a_device_request_names_this_device_and_verifies_under_its_key() {
    let state = self::state();
    let (draft, statements) = enrolled(&state);
    let request = statement::DeviceRequestInput {
        host: "rims1_OFPDNXTV1splCcKcgz1vWYj6Mg-lbUollHQwXTkYEBw".into(),
        method: "POST".into(),
        path: "/api".into(),
        seq: 1_791_504_000_000_000,
        body_sha256: "a2PtmXdQU8dMqDduw8cQymbwEmFEilShfZfDDArTcwU".into(),
        issued_at: "2026-10-09T00:00:00Z".into(),
    };
    let signed = state
        .sign_device_request(&draft.principal_id, &request)
        .unwrap();
    assert_eq!(payload_field(&signed, "type"), "device-request");
    assert_eq!(payload_field(&signed, "principalId"), draft.principal_id);
    assert_eq!(
        payload_field(&signed, "deviceId"),
        payload_field(&statements.device, "deviceId")
    );
    let device_key = payload_field(&statements.device, "deviceKey");
    assert!(verify(
        &signed,
        context::DEVICE_REQUEST,
        device_key.as_str().unwrap(),
        2
    ));
    assert!(matches!(
        state.sign_device_request("rimp1_someone-else", &request),
        Err(KeyIdentityError::NoKeys)
    ));
}

/// The stored JSON of `principal_id`'s record.
fn stored_record(store: &MemorySecretStore, principal_id: &str) -> serde_json::Value {
    let raw = store
        .read(&format!("key-identity-v1:{principal_id}"))
        .unwrap()
        .unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn an_unlock_seals_the_keys_and_a_locked_account_answers_locked() {
    let store = Arc::new(MemorySecretStore::default());
    let state = KeyIdentityState::new(store.clone());
    // A signup writes its keys before the account's first unlock: under the vault key only, and
    // usable as before.
    let (draft, statements) = enrolled(&state);
    let principal = draft.principal_id.as_str();
    let stored = stored_record(&store, principal);
    assert!(stored.get("deviceSeed").is_some() && stored.get("sealed").is_none());
    state.sign_login(ENDPOINT, principal, &challenge()).unwrap();

    state.account_lock().unlock_for_tests(principal, [3; 32]);
    state.seal_at_rest(principal).unwrap();
    let stored = stored_record(&store, principal);
    let raw = serde_json::to_string(&stored).unwrap();
    let opened = state.record(principal).unwrap();
    let identity_seed = opened.identity_seed.clone().unwrap();
    assert!(!raw.contains(identity_seed.as_str()));
    assert!(!raw.contains(opened.device_seed.as_str()));
    for field in ["deviceSeed", "identitySeed", "backupKey", "recoveryEntropy"] {
        assert!(stored.get(field).is_none(), "{field} left in the clear");
    }
    for field in [
        "principalId",
        "deviceId",
        "deviceName",
        "confirmed",
        "sealed",
    ] {
        assert!(stored.get(field).is_some(), "{field} missing");
    }
    assert!(state.recovery_kit(principal).unwrap().is_some());

    // After a restart the account is locked: it is listed, and every key refuses.
    let restarted = KeyIdentityState::new(store.clone());
    let listed = restarted.accounts(ENDPOINT).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].device_id, opened.device_id);
    assert!(!listed[0].has_identity_key);
    assert!(matches!(
        restarted.sign_login(ENDPOINT, principal, &challenge()),
        Err(KeyIdentityError::Locked)
    ));
    assert!(matches!(
        restarted.device(principal),
        Err(KeyIdentityError::Locked)
    ));
    assert!(matches!(
        restarted.recovery_kit(principal),
        Err(KeyIdentityError::Locked)
    ));
    assert!(matches!(
        restarted.confirm_recovery_kit(principal),
        Err(KeyIdentityError::Locked)
    ));
    assert!(matches!(
        restarted.sync_log(principal, &statements.key_log),
        Err(KeyIdentityError::Locked)
    ));
    assert!(matches!(
        restarted.begin_rotation(principal, &statements.key_log),
        Err(KeyIdentityError::Locked)
    ));
    assert_eq!(
        serde_json::to_value(KeyIdentityError::Locked).unwrap()["kind"],
        "LOCKED"
    );
    // Settling while locked keeps the sealed keys as they were.
    restarted
        .settle(&account("u1"), Some(principal))
        .unwrap()
        .unwrap();
    assert_eq!(stored_record(&store, principal)["sealed"], stored["sealed"]);

    // Unlocked with the same data key, everything opens again.
    restarted
        .account_lock()
        .unlock_for_tests(principal, [3; 32]);
    let proof = restarted
        .sign_login(ENDPOINT, principal, &challenge())
        .unwrap();
    assert_eq!(payload_field(&proof, "principalId"), principal);
    assert_eq!(
        restarted
            .record(principal)
            .unwrap()
            .identity_seed
            .unwrap()
            .as_str(),
        identity_seed.as_str()
    );
    assert!(
        restarted
            .sync_log(principal, &statements.key_log)
            .unwrap()
            .holds_identity_key
    );
    restarted.confirm_recovery_kit(principal).unwrap();
    // Written while unlocked: sealed at once.
    let stored = stored_record(&store, principal);
    assert!(stored.get("sealed").is_some() && stored.get("deviceSeed").is_none());
    assert_eq!(stored["kitConfirmed"], true);
}

#[test]
fn keys_sealed_under_an_earlier_data_key_are_gone() {
    let store = Arc::new(MemorySecretStore::default());
    let state = KeyIdentityState::new(store.clone());
    let (draft, _) = enrolled(&state);
    let principal = draft.principal_id.as_str();
    state.account_lock().unlock_for_tests(principal, [3; 32]);
    state.seal_at_rest(principal).unwrap();

    // The account started empty here: a new data key.
    let restarted = KeyIdentityState::new(store.clone());
    restarted
        .account_lock()
        .unlock_for_tests(principal, [4; 32]);
    let record = restarted.record(principal).unwrap();
    assert!(record.device_seed.is_empty() && record.identity_seed.is_none());
    assert!(record.confirmed);
    assert!(matches!(
        restarted.sign_login(ENDPOINT, principal, &challenge()),
        Err(KeyIdentityError::NoKeys)
    ));
}

#[test]
fn pending_links_are_sealed_and_written_only_while_unlocked() {
    let old = old_device();
    let new = KeyIdentityState::new(Arc::new(MemorySecretStore::default()));
    let sent = new.offer_link(ENDPOINT, &old.code, "Phone").unwrap();
    old.review(&sent.offer).unwrap();

    old.state.account_lock().lock_account(&old.principal_id);
    assert!(matches!(
        old.state.confirm_link(LINK_ID, &old.key_log, "Phone"),
        Err(KeyIdentityError::Locked)
    ));
    old.state
        .account_lock()
        .unlock_for_tests(&old.principal_id, [3; 32]);
    let answer = old
        .state
        .confirm_link(LINK_ID, &old.key_log, "Phone")
        .unwrap();
    let raw = old
        .store
        .read(&format!("device-link-v1:{LINK_ID}"))
        .unwrap()
        .unwrap();
    let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(stored["principalId"], old.principal_id.as_str());
    assert!(stored.get("secret").is_none() && stored.get("answer").is_none());
    assert!(!raw.contains(&answer.device_id));
}
