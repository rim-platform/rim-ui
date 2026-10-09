//! Every leaf-verification failure, and messages and Commits whose authenticated data does not
//! match what they carry.

use uuid::Uuid;

use super::raw::{commit_raw, key_package_ref, send_raw};
use super::sequencer::{Refusal, Sequencer};
use super::support::{device_ref, now, sign, tagged_public, Directory, Provider, TestDevice};
use crate::content::application_data;
use crate::device::{install_fixed_key, install_unchecked_statement};
use crate::storage::sealed::Sealed as _;
use crate::{
    franking_commitment, mls_key_payload, verify_leaf, verify_leaves, AddedDevice, ApplicationAad,
    CommitOutcome, CommitSummary, ConversationGroup, DecryptExpectations, Decrypted, DeviceStatus,
    LeafError, MessageContent, OutgoingCommit, SignedStatement, CIPHER_SUITE_ID, MLS_KEY_CONTEXT,
};

fn new_group() -> ConversationGroup {
    ConversationGroup::new(Uuid::now_v7(), 1)
}

/// `owner` creates a group with `others` and every one of them joins.
fn group_of(owner: &TestDevice, others: &[&TestDevice]) -> ConversationGroup {
    let group = new_group();
    let packages: Vec<_> = others.iter().map(|d| d.key_package()).collect();
    let created = owner
        .mls
        .create_group(&owner.store, group, &packages)
        .unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    for other in others {
        other
            .mls
            .join(&other.store, group, created.welcome.as_ref().unwrap())
            .unwrap();
        other.store.commit();
    }
    group
}

#[test]
fn every_leaf_verification_failure_is_reported() {
    let device = |n| TestDevice::new(Provider::Libcrux, n, 1);
    let (owner, reader) = (device(1), device(2));
    let (revoked, unknown, outsider, forged, broken_log) =
        (device(3), device(4), device(5), device(6), device(7));

    // A credential that is not an mls-key statement.
    let garbage = device(8);
    install_unchecked_statement(
        garbage.store.backend(),
        SignedStatement {
            payload: "{}".into(),
            signature: "ed25519:AA".into(),
        },
    )
    .unwrap();
    // A statement for one MLS key on a leaf that signs with another.
    let mismatched = device(9);
    install_fixed_key(mismatched.store.backend(), &mismatched.device, &[90; 32]).unwrap();
    let stated_key = ed25519_dalek::SigningKey::from_bytes(&[91; 32])
        .verifying_key()
        .to_bytes();
    let payload = mls_key_payload(
        &mismatched.device.principal_id,
        &mismatched.device.device_id,
        &stated_key,
        "2026-10-09T00:00:00Z",
    );
    install_unchecked_statement(
        mismatched.store.backend(),
        sign(&mismatched.device_key, MLS_KEY_CONTEXT, payload),
    )
    .unwrap();
    // One device with two leaves: a key package from before it lost its MLS key, and one after.
    let twice = device(10);
    let before_loss = twice.key_package();
    twice.mls.forget_identity(&twice.store).unwrap();
    twice.enroll();
    let after_loss = twice.key_package();

    let mut directory = Directory::with(&[
        &owner,
        &reader,
        &revoked,
        &unknown,
        &outsider,
        &forged,
        &broken_log,
        &garbage,
        &mismatched,
        &twice,
    ]);
    let entry = |d: &TestDevice| (d.device.principal_id.clone(), d.device.device_id);
    directory
        .devices
        .insert(entry(&revoked), DeviceStatus::Revoked);
    directory.devices.remove(&entry(&unknown));
    directory.members.remove(&outsider.device.principal_id);
    // The certificate the app found names another key than the one that signed the statement.
    directory.devices.insert(
        entry(&forged),
        DeviceStatus::Certified {
            device_key: tagged_public(&ed25519_dalek::SigningKey::from_bytes(&[99; 32])),
        },
    );
    directory
        .devices
        .insert(entry(&broken_log), DeviceStatus::KeyLogInvalid);

    // The group is created with all but the garbage device; the Welcome's tree is checked.
    let group = new_group();
    let mut packages: Vec<_> = [
        &reader,
        &revoked,
        &unknown,
        &outsider,
        &forged,
        &broken_log,
        &mismatched,
    ]
    .iter()
    .map(|d| d.key_package())
    .collect();
    packages.extend([before_loss, after_loss]);
    let created = owner
        .mls
        .create_group(&owner.store, group, &packages)
        .unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    let joined = reader
        .mls
        .join(&reader.store, group, created.welcome.as_ref().unwrap())
        .unwrap();
    reader.store.commit();
    assert_eq!(joined.leaves.len(), 10);

    // The crate will not add a key package that names no device; a misbehaving committer does,
    // and the reader still processes the Commit and checks the new leaf.
    let garbage_package = garbage.key_package();
    assert!(owner
        .mls
        .commit(
            &owner.store,
            group,
            std::slice::from_ref(&garbage_package),
            &[]
        )
        .is_err());
    owner.store.rollback();
    let (commit, _) = commit_raw(
        &owner,
        group,
        &[garbage_package],
        &[],
        &CommitSummary::default().to_bytes(),
    );
    let CommitOutcome::Applied(applied) = reader
        .mls
        .process_commit(&reader.store, group, &commit)
        .unwrap()
    else {
        panic!("the Commit was not applied");
    };
    reader.store.commit();
    assert!(!applied.summary_matches);
    assert_eq!(applied.to_verify.len(), 1);
    let all = reader.mls.leaves(&reader.store, group).unwrap();
    assert!(matches!(
        verify_leaf(&applied.to_verify[0], &all, &directory),
        Err(LeafError::BadCredential(_))
    ));

    let problems = verify_leaves(&all, &directory);
    let errors_of = |d: &TestDevice| -> Vec<LeafError> {
        problems
            .iter()
            .filter(|p| p.leaf.device().as_ref() == Some(&d.device))
            .map(|p| p.error.clone())
            .collect()
    };
    assert!(errors_of(&owner).is_empty());
    assert!(errors_of(&reader).is_empty());
    assert_eq!(errors_of(&revoked), vec![LeafError::RevokedDevice]);
    assert_eq!(errors_of(&unknown), vec![LeafError::UnknownDevice]);
    assert_eq!(errors_of(&outsider), vec![LeafError::NotMember]);
    assert_eq!(errors_of(&forged), vec![LeafError::BadStatementSignature]);
    assert_eq!(errors_of(&broken_log), vec![LeafError::KeyLogInvalid]);
    assert_eq!(errors_of(&mismatched), vec![LeafError::KeyMismatch]);
    assert_eq!(
        errors_of(&twice),
        vec![LeafError::DuplicateDevice, LeafError::DuplicateDevice]
    );
    assert_eq!(
        problems
            .iter()
            .filter(|p| matches!(p.error, LeafError::BadCredential(_)))
            .count(),
        1
    );
    assert_eq!(problems.len(), 9);
}

#[test]
fn application_messages_whose_authenticated_data_lies_are_invalid() {
    let sender = TestDevice::new(Provider::Libcrux, 1, 1);
    let receiver = TestDevice::new(Provider::Libcrux, 2, 1);
    let group = group_of(&sender, &[&receiver]);
    let mentioned = device_ref(3, 1).principal_id;

    let content = MessageContent::new(Uuid::now_v7(), format!("hi <@{mentioned}>"));
    let bytes = content.to_bytes();
    let franking_key = [5u8; 32];
    let honest = ApplicationAad {
        message_id: content.id,
        franking: franking_commitment(&franking_key, &bytes),
        mentions: content.mentions.clone(),
        mention_all: false,
    };
    let expect = DecryptExpectations {
        message_id: content.id,
        thread_root_id: None,
        author_principal_id: Some(sender.device.principal_id.clone()),
    };
    let data = application_data(&franking_key, &bytes).to_vec();

    let decrypt = |aad: &ApplicationAad, data: &[u8], expect: &DecryptExpectations| {
        let envelope = send_raw(&sender, group, &aad.to_bytes(), data);
        sender.store.commit();
        let result = receiver
            .mls
            .decrypt(&receiver.store, group, &envelope, expect)
            .unwrap();
        receiver.store.commit();
        result
    };

    assert!(matches!(
        decrypt(&honest, &data, &expect),
        Decrypted::Message(_)
    ));
    let rule_breaking = application_data(
        &franking_key,
        &MessageContent {
            mentions: vec![],
            ..content.clone()
        }
        .to_bytes(),
    )
    .to_vec();
    let cases = [
        (
            "the mentions differ",
            ApplicationAad {
                mentions: vec![],
                ..honest.clone()
            },
            data.clone(),
            expect.clone(),
        ),
        (
            "mentionAll differs",
            ApplicationAad {
                mention_all: true,
                ..honest.clone()
            },
            data.clone(),
            expect.clone(),
        ),
        (
            "the authenticated message id differs",
            ApplicationAad {
                message_id: Uuid::now_v7(),
                ..honest.clone()
            },
            data.clone(),
            expect.clone(),
        ),
        (
            "the franking commitment differs",
            ApplicationAad {
                franking: [0; 32],
                ..honest.clone()
            },
            data.clone(),
            expect.clone(),
        ),
        (
            "moved to another row",
            honest.clone(),
            data.clone(),
            DecryptExpectations {
                message_id: Uuid::now_v7(),
                ..expect.clone()
            },
        ),
        (
            "another thread",
            honest.clone(),
            data.clone(),
            DecryptExpectations {
                thread_root_id: Some(Uuid::now_v7()),
                ..expect.clone()
            },
        ),
        (
            "not the row's author",
            honest.clone(),
            data.clone(),
            DecryptExpectations {
                author_principal_id: Some(mentioned.clone()),
                ..expect.clone()
            },
        ),
        (
            "the content breaks a rule",
            honest.clone(),
            rule_breaking,
            expect.clone(),
        ),
        (
            "not RIM application data",
            honest.clone(),
            b"\x02plain".to_vec(),
            expect.clone(),
        ),
    ];
    for (case, aad, data, expect) in cases {
        assert!(
            matches!(decrypt(&aad, &data, &expect), Decrypted::Invalid { .. }),
            "{case}"
        );
    }
}

#[test]
fn commits_whose_summary_lies_are_flagged() {
    let device = |n| TestDevice::new(Provider::Libcrux, n, 1);
    let (owner, reader, extra, other) = (device(1), device(2), device(3), device(4));
    let group = group_of(&owner, &[&reader, &extra]);
    let process = |commit: &[u8]| {
        owner.store.commit();
        let outcome = reader
            .mls
            .process_commit(&reader.store, group, commit)
            .unwrap();
        reader.store.commit();
        match outcome {
            CommitOutcome::Applied(applied) => applied,
            other => panic!("{other:?}"),
        }
    };

    // Claims to add a device while removing one.
    let lie = CommitSummary {
        adds: vec![AddedDevice {
            device: other.device.clone(),
            key_package_ref: vec![1; 32],
        }],
        removes: vec![],
    };
    let (commit, _) = commit_raw(
        &owner,
        group,
        &[],
        std::slice::from_ref(&extra.device),
        &lie.to_bytes(),
    );
    let applied = process(&commit);
    assert!(!applied.summary_matches);
    assert_eq!(applied.removed, vec![extra.device.clone()]);

    // Claims nothing while adding a device: flagged, and the new leaf still verifies.
    let (commit, _) = commit_raw(
        &owner,
        group,
        &[other.key_package()],
        &[],
        &CommitSummary::default().to_bytes(),
    );
    let applied = process(&commit);
    assert!(!applied.summary_matches);
    assert_eq!(applied.added, vec![other.device.clone()]);
    let all = reader.mls.leaves(&reader.store, group).unwrap();
    let directory = Directory::with(&[&owner, &reader, &other]);
    assert!(applied
        .to_verify
        .iter()
        .all(|leaf| verify_leaf(leaf, &all, &directory).is_ok()));

    // Authenticated data that is no summary at all.
    let (commit, _) = commit_raw(&owner, group, &[], &[], b"not json");
    assert!(!process(&commit).summary_matches);

    // The honest Commit of the same change matches.
    let outgoing = owner.mls.self_update(&owner.store, group).unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    assert!(process(&outgoing.commit).summary_matches);
}

#[test]
fn the_server_refuses_a_summary_it_cannot_match() {
    let device = |n| TestDevice::new(Provider::Libcrux, n, 1);
    let (owner, reader, newcomer) = (device(1), device(2), device(3));
    let mut server = Sequencer::new();
    for d in [&owner, &reader, &newcomer] {
        server.members.insert(d.device.principal_id.clone());
        let packages = d
            .mls
            .generate_key_packages(&d.store, 2, false, now())
            .unwrap();
        d.store.commit();
        server.upload(&d.device, packages);
    }
    server.members.remove(&newcomer.device.principal_id);
    let claimed = server
        .claim(&owner.device, std::slice::from_ref(&reader.device))
        .unwrap();
    let group = ConversationGroup::new(server.conversation, 1);
    let created = owner
        .mls
        .create_group(&owner.store, group, &claimed)
        .unwrap();
    server.submit_commit(&owner.device, &created).unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    server.members.insert(newcomer.device.principal_id.clone());

    let submit = |summary: &CommitSummary, server: &mut Sequencer| {
        let (commit, welcome) = commit_raw(&owner, group, &[], &[], &summary.to_bytes());
        // The sender's state moved on; put it back for the next attempt.
        owner.store.rollback();
        server.submit_commit(
            &owner.device,
            &OutgoingCommit {
                group,
                epoch: 1,
                cipher_suite: CIPHER_SUITE_ID,
                commit,
                welcome: welcome.or(Some(vec![])),
                summary: summary.clone(),
            },
        )
    };
    // A pending add with a key package nobody claimed.
    let unclaimed = CommitSummary {
        adds: vec![AddedDevice {
            device: newcomer.device.clone(),
            key_package_ref: vec![7; 32],
        }],
        removes: vec![],
    };
    assert!(matches!(
        submit(&unclaimed, &mut server),
        Err(Refusal::Validation(_))
    ));
    // A package claimed by another device.
    let theirs = server
        .claim(&reader.device, std::slice::from_ref(&newcomer.device))
        .unwrap();
    let theirs_ref = key_package_ref(&theirs[0]);
    let foreign = CommitSummary {
        adds: vec![AddedDevice {
            device: newcomer.device.clone(),
            key_package_ref: theirs_ref,
        }],
        removes: vec![],
    };
    assert!(matches!(
        submit(&foreign, &mut server),
        Err(Refusal::Validation(_))
    ));
    // Removing a device that is still wanted, or the committer itself.
    for removes in [vec![reader.device.clone()], vec![owner.device.clone()]] {
        let summary = CommitSummary {
            adds: vec![],
            removes,
        };
        assert!(matches!(
            submit(&summary, &mut server),
            Err(Refusal::Validation(_))
        ));
    }
    assert_eq!(server.group.as_ref().unwrap().epoch, 1);
}
