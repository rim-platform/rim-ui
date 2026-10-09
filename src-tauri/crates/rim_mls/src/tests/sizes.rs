//! Message sizes on the wire, against the server's limits. Run with `--nocapture` to see them.

use uuid::Uuid;

use super::support::{Provider, TestDevice};
use crate::{ConversationGroup, MessageContent, MAX_ENVELOPE_BYTES, MAX_HANDSHAKE_BYTES};

/// The server's cap on a key package.
const MAX_KEY_PACKAGE: usize = 16 * 1024;

#[test]
fn key_packages_welcomes_and_messages_fit_the_limits() {
    let owner = TestDevice::new(Provider::Libcrux, 0, 0);
    let one = owner.key_package().key_package.len();
    eprintln!("key package (0x004F, MLSMessage): {one} bytes");
    assert!(one < MAX_KEY_PACKAGE);

    for devices in [10u8, 100] {
        let others: Vec<TestDevice> = (1..devices)
            .map(|d| TestDevice::new(Provider::Libcrux, d, 1))
            .collect();
        let packages: Vec<_> = others.iter().map(|d| d.key_package()).collect();
        let group = ConversationGroup::new(Uuid::now_v7(), 1);
        let created = owner
            .mls
            .create_group(&owner.store, group, &packages)
            .unwrap();
        owner.mls.commit_accepted(&owner.store, group).unwrap();
        let welcome = created.welcome.as_ref().unwrap().len();
        eprintln!(
            "{devices} devices: Welcome {welcome} bytes, first Commit {} bytes",
            created.commit.len()
        );
        assert!(welcome < MAX_HANDSHAKE_BYTES);

        let update = owner.mls.self_update(&owner.store, group).unwrap();
        owner.mls.commit_accepted(&owner.store, group).unwrap();
        eprintln!(
            "{devices} devices: self-update Commit {} bytes",
            update.commit.len()
        );
        let message = owner
            .mls
            .encrypt(
                &owner.store,
                group,
                &MessageContent::new(Uuid::now_v7(), "hi"),
            )
            .unwrap();
        eprintln!(
            "{devices} devices: a two-character message {} bytes",
            message.envelope.len()
        );
        assert!(message.envelope.len() < MAX_ENVELOPE_BYTES);
    }
}
