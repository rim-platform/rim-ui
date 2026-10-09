//! What a device refuses from a misbehaving server: a Welcome delivered again, a row that misnames
//! a message's sender, key packages a server behind this device's clock would refuse, keys in a
//! non-canonical encoding.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use uuid::Uuid;

use super::raw::commit_raw;
use super::support::{now, Provider, TestDevice};
use crate::codec::b64;
use crate::identity::parse_tagged_key;
use crate::{
    ClaimedKeyPackage, CommitOutcome, ConversationGroup, DecryptExpectations, Decrypted, Error,
    MessageContent, KEY_PACKAGE_CLOCK_MARGIN_SECS, KEY_PACKAGE_LIFETIME_SECS,
};

fn expect(content: &MessageContent, from: &TestDevice) -> DecryptExpectations {
    DecryptExpectations {
        message_id: content.id,
        thread_root_id: None,
        author_principal_id: from.device.principal_id.clone(),
        sender_device_id: from.device.device_id,
    }
}

#[test]
fn finding_6_a_replayed_welcome_never_rolls_a_group_back() {
    let owner = TestDevice::new(Provider::Libcrux, 1, 1);
    let joiner = TestDevice::new(Provider::Libcrux, 2, 1);
    // A last-resort key package keeps its private key, so its Welcome opens more than once.
    let package = joiner
        .mls
        .generate_key_packages(&joiner.store, 1, true, now())
        .unwrap()
        .remove(0);
    joiner.store.commit();
    let claimed = ClaimedKeyPackage {
        device: joiner.device.clone(),
        key_package: package.message,
    };
    let group = ConversationGroup::new(Uuid::now_v7(), 1);
    let created = owner
        .mls
        .create_group(&owner.store, group, &[claimed])
        .unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    let welcome = created.welcome.unwrap();
    joiner.mls.join(&joiner.store, group, &welcome).unwrap();
    joiner.store.commit();

    // The same Welcome again, at the epoch the device holds.
    assert!(matches!(
        joiner.mls.join(&joiner.store, group, &welcome),
        Err(Error::StaleWelcome {
            held: 1,
            welcome: 1
        })
    ));
    joiner.store.rollback();

    // The group moves on; the old Welcome cannot take it back either.
    let update = owner.mls.self_update(&owner.store, group).unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    joiner
        .mls
        .process_commit(&joiner.store, group, &update.commit)
        .unwrap();
    joiner.store.commit();
    assert!(matches!(
        joiner.mls.join(&joiner.store, group, &welcome),
        Err(Error::StaleWelcome {
            held: 2,
            welcome: 1
        })
    ));
    joiner.store.rollback();
    assert_eq!(
        joiner.mls.group_status(&joiner.store, group).unwrap().epoch,
        2
    );
    let content = MessageContent::new(Uuid::now_v7(), "after the replay");
    let sent = owner.mls.encrypt(&owner.store, group, &content).unwrap();
    owner.store.commit();
    assert!(matches!(
        joiner
            .mls
            .decrypt(
                &joiner.store,
                group,
                &sent.envelope,
                &expect(&content, &owner)
            )
            .unwrap(),
        Decrypted::Message(_)
    ));
    joiner.store.commit();

    // A group that waits for a re-add takes a Welcome: the re-add comes as one.
    let (lie, _) = commit_raw(&owner, group, &[], &[], b"not json");
    assert!(matches!(
        joiner
            .mls
            .process_commit(&joiner.store, group, &lie)
            .unwrap(),
        CommitOutcome::CannotProcess { .. }
    ));
    joiner.store.commit();
    let joined = joiner.mls.join(&joiner.store, group, &welcome).unwrap();
    assert_eq!(joined.epoch, 1);
    assert_eq!(
        joiner
            .mls
            .group_status(&joiner.store, group)
            .unwrap()
            .awaiting_readd,
        None
    );
}

#[test]
fn finding_5_the_row_must_name_the_mls_sender_and_its_device() {
    let sender = TestDevice::new(Provider::Libcrux, 1, 1);
    let other = TestDevice::new(Provider::Libcrux, 1, 2);
    let reader = TestDevice::new(Provider::Libcrux, 2, 1);
    let group = ConversationGroup::new(Uuid::now_v7(), 1);
    let created = sender
        .mls
        .create_group(
            &sender.store,
            group,
            &[reader.key_package(), other.key_package()],
        )
        .unwrap();
    sender.mls.commit_accepted(&sender.store, group).unwrap();
    sender.store.commit();
    reader
        .mls
        .join(&reader.store, group, created.welcome.as_ref().unwrap())
        .unwrap();
    reader.store.commit();

    let content = MessageContent::new(Uuid::now_v7(), "who sent this");
    let sent = sender.mls.encrypt(&sender.store, group, &content).unwrap();
    sender.store.commit();
    let decrypt = |expected: &DecryptExpectations| {
        let result = reader
            .mls
            .decrypt(&reader.store, group, &sent.envelope, expected)
            .unwrap();
        reader.store.rollback();
        result
    };
    // The row names another member as the author, or another device of the right author.
    let wrong_author = DecryptExpectations {
        author_principal_id: reader.device.principal_id.clone(),
        ..expect(&content, &sender)
    };
    let wrong_device = expect(&content, &other);
    for expected in [wrong_author, wrong_device] {
        assert!(matches!(
            decrypt(&expected),
            Decrypted::Invalid { sender: Some(s), .. } if s == sender.device
        ));
    }
    let Decrypted::Message(message) = decrypt(&expect(&content, &sender)) else {
        panic!("the honest row does not decrypt");
    };
    assert_eq!(message.sender, sender.device);
}

#[test]
fn finding_10_key_packages_end_an_hour_short_of_ninety_days() {
    let device = TestDevice::new(Provider::Libcrux, 1, 1);
    let at = now();
    let packages = device
        .mls
        .generate_key_packages(&device.store, 2, false, at)
        .unwrap();
    assert_eq!(KEY_PACKAGE_LIFETIME_SECS, 90 * 24 * 60 * 60);
    assert_eq!(KEY_PACKAGE_CLOCK_MARGIN_SECS, 60 * 60);
    for package in packages {
        assert_eq!(package.not_after, at + KEY_PACKAGE_LIFETIME_SECS - 60 * 60);
    }
    // A server whose clock is up to an hour behind still sees at most 90 days.
    let server_now = at - 59 * 60;
    assert!(
        at + KEY_PACKAGE_LIFETIME_SECS - KEY_PACKAGE_CLOCK_MARGIN_SECS
            <= server_now + KEY_PACKAGE_LIFETIME_SECS
    );
}

#[test]
fn finding_22_keys_in_a_non_canonical_encoding_are_refused() {
    let tagged = |bytes: &[u8]| format!("ed25519:{}", b64(bytes));
    let hex = |text: &str| -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
            .collect()
    };
    // rim-server's vector: y = p + 1, a non-canonical spelling of the identity point.
    let server_vector = hex("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f");
    // y = p + 3: a point of large order spelled non-canonically, with either sign bit.
    let large_order = hex("f0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f");
    let mut signed = large_order.clone();
    signed[31] |= 0x80;
    for bytes in [&server_vector, &large_order, &signed] {
        assert!(parse_tagged_key(&tagged(bytes)).is_err(), "{bytes:02x?}");
    }
    // The same point spelled canonically (y = 3) is a key.
    let mut canonical = [0u8; 32];
    canonical[0] = 3;
    assert!(parse_tagged_key(&tagged(&canonical)).is_ok());
}
