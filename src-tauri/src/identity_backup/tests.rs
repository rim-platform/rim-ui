//! The identity key backup end to end: key stores in memory, archives in a real folder shared
//! by two "devices".

use std::path::Path;
use std::sync::Arc;

use zeroize::Zeroizing;

use super::*;
use crate::account_lock::AccountLock;
use crate::history_archive::tests::Device;
use crate::key_identity::recovery_kit;
use crate::key_identity::statement::{self, SecretKey};
use crate::key_identity::store::{KeyRecord, Keys, MemorySecretStore};
use crate::key_identity::{Challenge, ServerAccount};
use crate::message_cache::tests::account;

const ENDPOINT: &str = "http://localhost:8080/api";

/// One computer: its keys and its archive settings.
struct Computer {
    keys: KeyIdentityState,
    store: Arc<MemorySecretStore>,
    archive: Device,
}

impl Computer {
    fn new() -> Self {
        let store = Arc::new(MemorySecretStore::default());
        Self {
            keys: KeyIdentityState::new(store.clone()),
            store,
            archive: Device::new("alice"),
        }
    }

    fn sync(&self, principal: &str, log: &[Statement]) -> IdentityBackupStatus {
        sync(
            &self.keys,
            &self.archive.archive,
            &account("alice"),
            principal,
            log,
        )
        .unwrap()
    }

    fn take_over(&self, principal: &str, log: &[Statement], secret: &str) -> Result<LogStatus> {
        take_over(
            &self.keys,
            &self.archive.archive,
            &account("alice"),
            principal,
            log,
            secret,
        )
    }

    /// Keys for `principal` with no identity key, as device linking leaves them.
    fn link(&self, principal: &str) {
        Keys::new(self.store.as_ref(), &AccountLock::in_memory())
            .put_record(&record(principal, None))
            .unwrap();
    }
}

fn record(principal: &str, identity: Option<&SecretKey>) -> KeyRecord {
    KeyRecord {
        v: 1,
        principal_id: principal.into(),
        device_id: uuid::Uuid::now_v7().to_string(),
        device_name: "Desktop".into(),
        device_seed: SecretKey::generate().unwrap().to_text(),
        identity_seed: identity.map(SecretKey::to_text),
        pending_identity_seed: None,
        pending_identity_seq: None,
        backup_key: None,
        recovery_entropy: None,
        kit_confirmed: None,
        confirmed: true,
        replaced: None,
        sealed: None,
        device_wrap: None,
    }
}

/// Enroll on `computer`; returns the principal, the key log and the recovery phrase.
fn enroll(computer: &Computer) -> (String, Vec<Statement>, String) {
    let draft = computer.keys.begin_enrollment("Laptop").unwrap();
    let server = ServerAccount {
        endpoint: ENDPOINT.into(),
        user_id: "alice".into(),
        username: "alice".into(),
    };
    let challenge = Challenge {
        challenge_id: "00000000-0000-0000-0000-000000000009".into(),
        nonce: "bm9uY2U".into(),
    };
    let statements = computer
        .keys
        .sign_enrollment(&draft.draft_id, &server, &challenge)
        .unwrap();
    computer
        .keys
        .settle(&server, Some(draft.principal_id.as_str()))
        .unwrap();
    (
        draft.principal_id.clone(),
        statements.key_log,
        draft.recovery_phrase.join(" "),
    )
}

/// Rotate the identity key on `computer` and return the log the server would answer with.
fn rotate(computer: &Computer, principal: &str, log: &[Statement]) -> Vec<Statement> {
    let entry = computer.keys.begin_rotation(principal, log).unwrap();
    let mut rotated = log.to_vec();
    rotated.push(entry);
    computer.keys.sync_log(principal, &rotated).unwrap();
    rotated
}

fn backup_files(folder: &Path) -> usize {
    let accounts = folder.join("accounts");
    let Ok(tags) = std::fs::read_dir(accounts) else {
        return 0;
    };
    tags.flatten()
        .flat_map(|tag| std::fs::read_dir(tag.path().join("devices")).unwrap())
        .flatten()
        .filter(|device| device.path().join("identity-backup.rimx").exists())
        .count()
}

#[test]
fn a_linked_device_takes_over_the_identity_key_from_the_backup() {
    let folder = tempfile::tempdir().unwrap();
    let a = Computer::new();
    let (principal, log, phrase) = enroll(&a);
    a.archive.connect(folder.path());
    let status = a.sync(&principal, &log);
    assert_eq!(
        status,
        IdentityBackupStatus {
            archive: ArchiveState::Ready,
            holds_identity_key: true,
            has_backup_key: true,
            backed_up: true,
            wrapped: true,
        }
    );
    assert_eq!(backup_files(folder.path()), 1);

    let b = Computer::new();
    b.link(&principal);
    b.archive.connect(folder.path());
    let before = b.sync(&principal, &log);
    assert!(!before.holds_identity_key);
    assert!(!before.wrapped);

    let taken = b.take_over(&principal, &log, &phrase).unwrap();
    assert!(taken.holds_identity_key);
    assert!(
        b.keys
            .sync_log(&principal, &log)
            .unwrap()
            .holds_identity_key
    );
    // B backed the key up itself right away; A keeps its copy.
    assert_eq!(backup_files(folder.path()), 2);
    assert!(
        a.keys
            .sync_log(&principal, &log)
            .unwrap()
            .holds_identity_key
    );
    assert!(b.sync(&principal, &log).backed_up);
}

#[test]
fn a_takeover_needs_a_backup_of_the_current_key_and_the_right_phrase() {
    let folder = tempfile::tempdir().unwrap();
    let a = Computer::new();
    let (principal, log, phrase) = enroll(&a);
    let b = Computer::new();
    b.link(&principal);

    // No archive on B yet.
    assert!(matches!(
        b.take_over(&principal, &log, &phrase),
        Err(IdentityBackupError::Archive(ArchiveError::NotConfigured))
    ));
    a.archive.connect(folder.path());
    b.archive.connect(folder.path());
    // An archive without a backup.
    assert!(matches!(
        b.take_over(&principal, &log, &phrase),
        Err(IdentityBackupError::NotFound)
    ));
    a.sync(&principal, &log);

    // Another phrase is refused before the archive is read.
    let other = recovery_kit::phrase_words(&[7u8; 16]).unwrap().join(" ");
    assert!(matches!(
        b.take_over(&principal, &log, &other),
        Err(IdentityBackupError::Keys(KeyIdentityError::Invalid(_)))
    ));

    // A rotates; until it backs up again, the backup holds a key the log no longer names.
    let rotated = rotate(&a, &principal, &log);
    assert!(matches!(
        b.take_over(&principal, &rotated, &phrase),
        Err(IdentityBackupError::Stale)
    ));
    assert!(
        !b.keys
            .sync_log(&principal, &rotated)
            .unwrap()
            .holds_identity_key
    );
    assert!(a.sync(&principal, &rotated).backed_up);
    assert!(
        b.take_over(&principal, &rotated, &phrase)
            .unwrap()
            .holds_identity_key
    );
}

#[test]
fn a_rotation_rewrites_the_wrap_and_the_old_key_no_longer_unlocks() {
    let folder = tempfile::tempdir().unwrap();
    let a = Computer::new();
    let (principal, log, _) = enroll(&a);
    a.archive.connect(folder.path());
    a.sync(&principal, &log);
    let old_wrap = a.keys.archive_wrap_keys(&principal).unwrap();
    let alice = account("alice");
    assert!(a
        .archive
        .archive
        .can_unlock_with_identity(&alice, &old_wrap)
        .unwrap());

    let rotated = rotate(&a, &principal, &log);
    assert!(a.sync(&principal, &rotated).wrapped);
    assert!(!a
        .archive
        .archive
        .can_unlock_with_identity(&alice, &old_wrap)
        .unwrap());
    assert!(can_unlock(&a.keys, &a.archive.archive, &alice, &principal).unwrap());

    // The keyring lost the archive key: the identity key brings it back.
    let archive_id = a
        .archive
        .archive
        .status(&alice)
        .unwrap()
        .archive_id
        .unwrap();
    a.archive.forget_key(&archive_id);
    let status = unlock(&a.keys, &a.archive.archive, &alice, &principal).unwrap();
    assert!(status.unlocked);
    a.archive.export();
}

#[test]
fn a_device_without_the_identity_key_has_nothing_to_unlock_with() {
    let folder = tempfile::tempdir().unwrap();
    let a = Computer::new();
    let (principal, log, _) = enroll(&a);
    a.archive.connect(folder.path());
    a.sync(&principal, &log);

    let b = Computer::new();
    b.link(&principal);
    b.archive.connect(folder.path());
    let alice = account("alice");
    assert!(!can_unlock(&b.keys, &b.archive.archive, &alice, &principal).unwrap());
    assert!(matches!(
        unlock(&b.keys, &b.archive.archive, &alice, &principal),
        Err(IdentityBackupError::Archive(ArchiveError::NoIdentityWrap))
    ));
    // A device with no keys for the account at all.
    let c = Computer::new();
    c.archive.connect(folder.path());
    assert!(!can_unlock(&c.keys, &c.archive.archive, &alice, &principal).unwrap());
}

#[test]
fn an_account_with_a_v1_kit_turns_the_backup_on_with_its_rk1_key() {
    let folder = tempfile::tempdir().unwrap();
    let a = Computer::new();
    let identity = SecretKey::generate().unwrap();
    let recovery = SecretKey::from_seed(Zeroizing::new([42u8; 32]));
    let inception = statement::inception(&identity, &recovery.public_key(), &statement::now());
    let principal = statement::principal_id(&inception.payload);
    let log = vec![inception];
    Keys::new(a.store.as_ref(), &AccountLock::in_memory())
        .put_record(&record(&principal, Some(&identity)))
        .unwrap();
    a.archive.connect(folder.path());

    let status = a.sync(&principal, &log);
    assert!(status.holds_identity_key);
    assert!(!status.has_backup_key);
    assert!(!status.backed_up);
    assert!(status.wrapped);

    let rk1 = recovery_kit::format_recovery_key(recovery.seed());
    let enabled = enable(
        &a.keys,
        &a.archive.archive,
        &account("alice"),
        &principal,
        &log,
        &rk1,
    )
    .unwrap();
    assert!(enabled.backed_up);

    let b = Computer::new();
    b.link(&principal);
    b.archive.connect(folder.path());
    assert!(
        b.take_over(&principal, &log, &rk1)
            .unwrap()
            .holds_identity_key
    );
}

#[test]
fn errors_keep_the_kinds_the_webview_narrows() {
    let kind = |e: IdentityBackupError| serde_json::to_value(e).unwrap()["kind"].clone();
    assert_eq!(kind(IdentityBackupError::Stale), "IDENTITY_BACKUP_STALE");
    assert_eq!(
        kind(IdentityBackupError::NotFound),
        "IDENTITY_BACKUP_NOT_FOUND"
    );
    assert_eq!(
        kind(IdentityBackupError::Archive(ArchiveError::Locked)),
        "ARCHIVE_LOCKED"
    );
    assert_eq!(
        kind(IdentityBackupError::Keys(KeyIdentityError::NoKeys)),
        "NO_KEYS"
    );
}
