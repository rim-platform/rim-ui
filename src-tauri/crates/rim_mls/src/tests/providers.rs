//! Both providers run suite 0x004F, frame the authenticated data into every message, and read
//! each other's groups.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use openmls::prelude::tls_codec::DeserializeBytes as _;
use openmls::prelude::{MlsMessageBodyIn, MlsMessageIn};
use uuid::Uuid;

use super::support::{Provider, TestDevice};
use crate::{
    AuthenticatedData, CommitOutcome, ConversationGroup, DecryptExpectations, Decrypted,
    MessageContent, CIPHER_SUITE_ID,
};

fn group() -> ConversationGroup {
    ConversationGroup::new(Uuid::now_v7(), 1)
}

/// The cleartext authenticated data of a PrivateMessage, as the server reads it.
fn header_aad(message: &[u8]) -> Vec<u8> {
    match MlsMessageIn::tls_deserialize_exact_bytes(message)
        .unwrap()
        .extract()
    {
        MlsMessageBodyIn::PrivateMessage(message) => message.aad().to_vec(),
        _ => panic!("not a PrivateMessage"),
    }
}

fn expect(content: &MessageContent) -> DecryptExpectations {
    DecryptExpectations {
        message_id: content.id,
        thread_root_id: content.thread_root_id,
        author_principal_id: None,
    }
}

/// `a` creates a group with `b`, and they exchange a message each way.
fn create_join_and_talk(a: &TestDevice, b: &TestDevice) {
    let group = group();
    let outgoing = a
        .mls
        .create_group(&a.store, group, &[b.key_package()])
        .unwrap();
    assert_eq!(outgoing.cipher_suite, CIPHER_SUITE_ID);
    assert_eq!(outgoing.epoch, 0);
    assert_eq!(a.mls.commit_accepted(&a.store, group).unwrap(), 1);
    let joined = b
        .mls
        .join(&b.store, group, outgoing.welcome.as_ref().unwrap())
        .unwrap();
    assert_eq!(joined.epoch, 1);
    assert_eq!(joined.leaves.len(), 2);
    assert_eq!(joined.welcomer.as_ref(), Some(&a.device));

    for (from, to) in [(a, b), (b, a)] {
        let content = MessageContent::new(Uuid::now_v7(), "hello over X-Wing");
        let sent = from.mls.encrypt(&from.store, group, &content).unwrap();
        match to
            .mls
            .decrypt(&to.store, group, &sent.envelope, &expect(&content))
            .unwrap()
        {
            Decrypted::Message(message) => {
                assert_eq!(message.content, content);
                assert_eq!(message.sender, from.device);
                assert_eq!(*message.franking_key, *sent.franking_key);
            }
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn both_providers_create_join_and_decrypt_a_0x004f_group() {
    for provider in [Provider::Libcrux, Provider::RustCrypto] {
        let a = TestDevice::new(provider, 1, 1);
        let b = TestDevice::new(provider, 2, 1);
        create_join_and_talk(&a, &b);
    }
}

#[test]
fn a_group_of_one_provider_is_joined_and_read_with_the_other() {
    for (first, second) in [
        (Provider::Libcrux, Provider::RustCrypto),
        (Provider::RustCrypto, Provider::Libcrux),
    ] {
        let a = TestDevice::new(first, 1, 1);
        let b = TestDevice::new(second, 2, 1);
        create_join_and_talk(&a, &b);

        // A third device on the first provider, added by the second; its Commit is processed by
        // the first and every message reads on every device.
        let c = TestDevice::new(first, 3, 1);
        let group = group();
        let created = a
            .mls
            .create_group(&a.store, group, &[b.key_package()])
            .unwrap();
        a.mls.commit_accepted(&a.store, group).unwrap();
        b.mls
            .join(&b.store, group, created.welcome.as_ref().unwrap())
            .unwrap();
        let added = b
            .mls
            .commit(&b.store, group, &[c.key_package()], &[])
            .unwrap();
        b.mls.commit_accepted(&b.store, group).unwrap();
        match a
            .mls
            .process_commit(&a.store, group, &added.commit)
            .unwrap()
        {
            CommitOutcome::Applied(applied) => {
                assert!(applied.summary_matches);
                assert_eq!(applied.added, vec![c.device.clone()]);
            }
            other => panic!("{other:?}"),
        }
        c.mls
            .join(&c.store, group, added.welcome.as_ref().unwrap())
            .unwrap();
        for from in [&a, &b, &c] {
            let content = MessageContent::new(Uuid::now_v7(), "across providers");
            let sent = from.mls.encrypt(&from.store, group, &content).unwrap();
            for to in [&a, &b, &c] {
                let result = to
                    .mls
                    .decrypt(&to.store, group, &sent.envelope, &expect(&content))
                    .unwrap();
                if std::ptr::eq(from, to) {
                    assert!(matches!(result, Decrypted::Own));
                } else {
                    assert!(matches!(result, Decrypted::Message(m) if m.content == content));
                }
            }
        }
    }
}

#[test]
fn authenticated_data_is_framed_into_commits_and_application_messages() {
    for provider in [Provider::Libcrux, Provider::RustCrypto] {
        let a = TestDevice::new(provider, 1, 1);
        let b = TestDevice::new(provider, 2, 1);
        let c = TestDevice::new(provider, 3, 1);
        let group = group();

        let created = a
            .mls
            .create_group(&a.store, group, &[b.key_package()])
            .unwrap();
        assert_eq!(header_aad(&created.commit), created.summary.to_bytes());
        a.mls.commit_accepted(&a.store, group).unwrap();
        b.mls
            .join(&b.store, group, created.welcome.as_ref().unwrap())
            .unwrap();

        let added = a
            .mls
            .commit(&a.store, group, &[c.key_package()], &[])
            .unwrap();
        let aad = header_aad(&added.commit);
        assert_eq!(aad, added.summary.to_bytes());
        assert!(matches!(
            AuthenticatedData::parse(&aad).unwrap(),
            AuthenticatedData::Commit(summary) if summary.adds.len() == 1
        ));

        // The authenticated data is authenticated: a server that edits it breaks the Commit.
        let mut tampered = added.commit.clone();
        let at = tampered
            .windows(b"\"adds\"".len())
            .position(|w| w == b"\"adds\"")
            .unwrap();
        tampered[at + 1] = b'A';
        b.store.commit();
        assert!(matches!(
            b.mls.process_commit(&b.store, group, &tampered).unwrap(),
            CommitOutcome::CannotProcess { .. }
        ));
        b.store.rollback();

        a.mls.commit_accepted(&a.store, group).unwrap();
        assert!(matches!(
            b.mls.process_commit(&b.store, group, &added.commit).unwrap(),
            CommitOutcome::Applied(applied) if applied.summary_matches
        ));

        let content = MessageContent::new(Uuid::now_v7(), "aad");
        let sent = a.mls.encrypt(&a.store, group, &content).unwrap();
        let aad = header_aad(&sent.envelope);
        match AuthenticatedData::parse(&aad).unwrap() {
            AuthenticatedData::Application(aad) => {
                assert_eq!(aad.message_id, content.id);
                assert_eq!(aad.franking, sent.commitment);
            }
            other => panic!("{other:?}"),
        }
    }
}
