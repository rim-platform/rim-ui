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
    // the inception names. It is not stored anywhere.
    assert!(draft.recovery_kit.starts_with("RIM recovery kit (v2)\n"));
    assert_eq!(draft.recovery_phrase.len(), 12);
    assert!(draft.recovery_kit.contains(&format!(
        "Recovery phrase: {}\n",
        draft.recovery_phrase.join(" ")
    )));
    let (principal, recovery) = recovery_kit::parse_kit(&draft.recovery_kit, None).unwrap();
    assert_eq!(principal, draft.principal_id);
    assert_eq!(recovery.public_key(), head.recovery_key);
    let record = state.record(&draft.principal_id).unwrap();
    let stored = serde_json::to_string(&record).unwrap();
    assert!(!stored.contains(&recovery.to_text()["ed25519:".len()..]));
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
fn removing_a_drafts_keys_never_touches_confirmed_keys() {
    let state = self::state();
    let draft = state.begin_enrollment("Laptop").unwrap();
    state
        .sign_signup(&draft.draft_id, ENDPOINT, "ada", &challenge())
        .unwrap();
    // An earlier attempt landed and was confirmed while this draft is still held.
    let ada = ServerAccount {
        endpoint: ENDPOINT.into(),
        user_id: "u-ada".into(),
        username: "ada".into(),
    };
    let drafts_before = state.drafts.lock().unwrap().len();
    state
        .keys()
        .put_record(&KeyRecord {
            confirmed: true,
            ..state.record(&draft.principal_id).unwrap()
        })
        .unwrap();
    state.remove_draft_keys(&draft.draft_id).unwrap();
    assert!(state.record(&draft.principal_id).is_ok());
    assert_eq!(state.drafts.lock().unwrap().len(), drafts_before);
    assert!(state
        .settle(&ada, Some(draft.principal_id.as_str()))
        .unwrap()
        .is_some());
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
