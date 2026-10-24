//! The account lock against an in-process OPAQUE server, over a secret store in memory.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use opaque_ke::{
    CredentialFinalization, CredentialRequest, RegistrationRequest, RegistrationUpload,
    ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand_core::OsRng;
use rim_opaque::{RimOpaque, TransportLabel, LOGIN_CONTEXT};
use zeroize::Zeroizing;

use super::*;

const PRINCIPAL: &str = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";
const ENTROPY: [u8; 16] = [9; 16];

#[derive(Default)]
struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(name)
            .cloned()
            .map(Zeroizing::new))
    }

    fn write(&self, name: &str, value: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert(name.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<()> {
        self.0.lock().unwrap().remove(name);
        Ok(())
    }
}

impl AccountLock {
    /// An account lock over a secret store in memory, with nothing unlocked: for other
    /// modules' tests.
    pub(crate) fn in_memory() -> Self {
        Self::new(Arc::new(MemoryStore::default()))
    }

    /// Unlocks `principal_id` with `data_key` as an unlock command would: for other modules'
    /// tests.
    pub(crate) fn unlock_for_tests(&self, principal_id: &str, data_key: [u8; 32]) {
        self.hold(principal_id, Zeroizing::new(data_key), false);
    }
}

impl MemoryStore {
    fn has(&self, name: &str) -> bool {
        self.0.lock().unwrap().contains_key(name)
    }

    fn wraps(&self) -> DataKeyWraps {
        serde_json::from_str(&self.0.lock().unwrap()[&wraps_name(PRINCIPAL)]).unwrap()
    }
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn unb64(text: &str) -> Vec<u8> {
    URL_SAFE_NO_PAD.decode(text).unwrap()
}

fn context() -> ServerLoginParameters<'static, 'static> {
    ServerLoginParameters {
        context: Some(LOGIN_CONTEXT),
        ..Default::default()
    }
}

/// The account's home server: the OPAQUE setup, the record and the server share.
struct Server {
    setup: ServerSetup<RimOpaque>,
    record: Option<ServerRegistration<RimOpaque>>,
    share: [u8; 32],
}

impl Server {
    fn new() -> Self {
        Self {
            setup: ServerSetup::new(&mut OsRng),
            record: None,
            share: [7; 32],
        }
    }

    /// Runs a registration through `device` and returns its handle.
    fn register(&mut self, device: &AccountLock, password: &str) -> String {
        let start = device.registration_start(password).unwrap();
        let response = ServerRegistration::<RimOpaque>::start(
            &self.setup,
            RegistrationRequest::deserialize(&unb64(&start.request)).unwrap(),
            PRINCIPAL.as_bytes(),
        )
        .unwrap()
        .message
        .serialize();
        let finish = device
            .registration_finish(&start.handle, &b64(&response))
            .unwrap();
        self.record = Some(ServerRegistration::finish(
            RegistrationUpload::deserialize(&unb64(&finish.upload)).unwrap(),
        ));
        start.handle
    }

    /// Runs a login through `device`; on success returns its handle and the sealed share.
    fn login(&self, device: &AccountLock, password: &str) -> Result<(String, String)> {
        let start = device.login_start(password).unwrap();
        let started = ServerLogin::start(
            &mut OsRng,
            &self.setup,
            self.record.clone(),
            CredentialRequest::deserialize(&unb64(&start.request)).unwrap(),
            PRINCIPAL.as_bytes(),
            context(),
        )
        .unwrap();
        let finish = device.login_finish(&start.handle, &b64(&started.message.serialize()))?;
        let session_key = started
            .state
            .finish(
                CredentialFinalization::deserialize(&unb64(&finish.finalization)).unwrap(),
                context(),
            )
            .unwrap()
            .session_key;
        let session_key: [u8; 64] = session_key.as_slice().try_into().unwrap();
        let transport = rim_opaque::transport_key(&session_key, TransportLabel::ServerShare);
        let sealed = rim_opaque::seal(&transport, &[], &self.share).unwrap();
        Ok((start.handle, b64(&sealed)))
    }

    /// The unlock key a password gives, as the device derives it.
    fn unlock_key(&self, device: &AccountLock, password: &str) -> Key {
        let start = device.login_start(password).unwrap();
        let started = ServerLogin::start(
            &mut OsRng,
            &self.setup,
            self.record.clone(),
            CredentialRequest::deserialize(&unb64(&start.request)).unwrap(),
            PRINCIPAL.as_bytes(),
            context(),
        )
        .unwrap();
        let Stage::LoggingIn { flow, password } = device.take_handle(&start.handle).unwrap().stage
        else {
            panic!("not a login");
        };
        let finished = flow
            .finish(&password, &started.message.serialize())
            .unwrap();
        rim_opaque::derive_unlock_key(&finished.export_key, &self.share, PRINCIPAL)
    }
}

fn device() -> (AccountLock, Arc<MemoryStore>) {
    let store = Arc::new(MemoryStore::default());
    (AccountLock::new(store.clone()), store)
}

fn signup(server: &mut Server, device: &AccountLock, password: &str, keep: bool) -> Unlocked {
    let handle = server.register(device, password);
    device
        .unlock_after_signup(
            &handle,
            PRINCIPAL,
            &b64(&server.share),
            Some(&b64(&ENTROPY)),
            keep,
        )
        .unwrap()
}

#[test]
fn a_signup_then_a_login_open_the_same_data_key() {
    let mut server = Server::new();
    let (device, store) = device();
    let signed_up = signup(&mut server, &device, "first password", false);
    assert!(signed_up.started_empty);
    let data_key = device.data_key(PRINCIPAL).unwrap();
    assert_eq!(
        *signed_up.web_store_key,
        b64(rim_opaque::store_key(&data_key, StoreKeyLabel::WebStores).as_ref())
    );
    assert!(store.wraps().recovery_wrap.is_some());
    assert!(store.wraps().keep_wrap.is_none());

    assert!(device.lock_account(PRINCIPAL));
    assert!(device.data_key(PRINCIPAL).is_none());
    assert!(!device.lock_account(PRINCIPAL));

    let (handle, sealed) = server.login(&device, "first password").unwrap();
    let unlocked = device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
        .unwrap();
    assert!(!unlocked.started_empty);
    assert_eq!(*unlocked.web_store_key, *signed_up.web_store_key);
    assert_eq!(*device.data_key(PRINCIPAL).unwrap(), *data_key);
    assert!(
        store.wraps().recovery_wrap.is_some(),
        "the recovery wrap stays"
    );
}

#[test]
fn a_wrong_password_ends_the_handle() {
    let mut server = Server::new();
    let (device, _) = device();
    signup(&mut server, &device, "right password", false);
    assert!(matches!(
        server.login(&device, "wrong password"),
        Err(AccountLockError::WrongPassword)
    ));
    assert!(super::lock(&device.handles).is_empty());
}

#[test]
fn a_handle_serves_once_in_its_own_stage_and_expires() {
    let mut server = Server::new();
    let (device, _) = device();
    let handle = server.register(&device, "password");
    assert!(matches!(
        device.unlock_after_login(&handle, PRINCIPAL, "AAAA", &[], false, false),
        Err(AccountLockError::NoHandle)
    ));
    assert!(matches!(
        device.unlock_after_signup(&handle, PRINCIPAL, &b64(&server.share), None, false),
        Err(AccountLockError::NoHandle)
    ));

    let handle = server.register(&device, "password");
    device
        .unlock_after_signup(&handle, PRINCIPAL, &b64(&server.share), None, false)
        .unwrap();
    assert!(matches!(
        device.unlock_after_signup(&handle, PRINCIPAL, &b64(&server.share), None, false),
        Err(AccountLockError::NoHandle)
    ));

    let start = device.login_start("password").unwrap();
    let stage = device.take_handle(&start.handle).unwrap().stage;
    device.put_handle(start.handle.clone(), stage, Instant::now());
    assert!(matches!(
        device.login_finish(&start.handle, "AAAA"),
        Err(AccountLockError::NoHandle)
    ));
}

#[test]
fn a_share_sealed_under_another_key_does_not_unlock() {
    let mut server = Server::new();
    let (device, _) = device();
    signup(&mut server, &device, "password", false);
    let (handle, _) = server.login(&device, "password").unwrap();
    let forged = rim_opaque::seal(&[1; 32], &[], &server.share).unwrap();
    assert!(matches!(
        device.unlock_after_login(&handle, PRINCIPAL, &b64(&forged), &[], false, false),
        Err(AccountLockError::Crypto(_))
    ));
}

#[test]
fn a_login_without_wraps_starts_empty() {
    let mut server = Server::new();
    let (other_device, _) = device();
    server.register(&other_device, "password");

    let (device, store) = device();
    let (handle, sealed) = server.login(&device, "password").unwrap();
    let unlocked = device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
        .unwrap();
    assert!(unlocked.started_empty);
    assert!(store.wraps().recovery_wrap.is_none());

    let (handle, sealed) = server.login(&device, "password").unwrap();
    let again = device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
        .unwrap();
    assert!(!again.started_empty);
    assert_eq!(*again.web_store_key, *unlocked.web_store_key);
}

#[test]
fn rewraps_open_a_wrap_from_before_two_password_changes() {
    let mut server = Server::new();
    let (device, store) = device();
    signup(&mut server, &device, "password one", false);
    let data_key = device.data_key(PRINCIPAL).unwrap();
    let key_one = server.unlock_key(&device, "password one");

    // Two password changes made on another device.
    let (other_device, _) = self::device();
    server.register(&other_device, "password two");
    let key_two = server.unlock_key(&other_device, "password two");
    server.register(&other_device, "password three");
    let key_three = server.unlock_key(&other_device, "password three");
    let rewraps = vec![
        b64(&rim_opaque::rewrap_unlock_key(&key_three, &key_two, PRINCIPAL).unwrap()),
        b64(&rim_opaque::rewrap_unlock_key(&key_two, &key_one, PRINCIPAL).unwrap()),
    ];

    let (handle, sealed) = server.login(&device, "password three").unwrap();
    let unlocked = device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &rewraps, false, false)
        .unwrap();
    assert!(!unlocked.started_empty);
    assert_eq!(*device.data_key(PRINCIPAL).unwrap(), *data_key);

    let wrap = unb64(&store.wraps().password_wrap);
    assert_eq!(
        *rim_opaque::unwrap_data_key(&key_three, WrapKind::Password, PRINCIPAL, &wrap).unwrap(),
        *data_key,
        "the wrap is under the current unlock key now"
    );
    let (handle, sealed) = server.login(&device, "password three").unwrap();
    assert!(
        !device
            .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
            .unwrap()
            .started_empty
    );
}

#[test]
fn a_kept_account_opens_without_the_server_until_the_keep_is_forgotten() {
    let mut server = Server::new();
    let (device, store) = device();
    let signed_up = signup(&mut server, &device, "password", true);
    assert!(store.has(&keep_name(PRINCIPAL)));
    device.lock_account(PRINCIPAL);

    let kept = device.unlock_kept(PRINCIPAL).unwrap().unwrap();
    assert_eq!(*kept.web_store_key, *signed_up.web_store_key);
    assert!(!kept.started_empty);

    device.forget_keep(PRINCIPAL).unwrap();
    assert!(!store.has(&keep_name(PRINCIPAL)));
    assert!(store.wraps().keep_wrap.is_none());
    assert!(device.unlock_kept(PRINCIPAL).unwrap().is_none());
    device.forget_keep(PRINCIPAL).unwrap();

    let (handle, sealed) = server.login(&device, "password").unwrap();
    device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], true, false)
        .unwrap();
    assert!(device.unlock_kept(PRINCIPAL).unwrap().is_some());
    let (handle, sealed) = server.login(&device, "password").unwrap();
    device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
        .unwrap();
    assert!(
        device.unlock_kept(PRINCIPAL).unwrap().is_none(),
        "a login without keep ends the keep"
    );
    assert!(!store.has(&keep_name(PRINCIPAL)));
}

#[test]
fn a_keep_wrap_is_bound_to_its_principal() {
    let mut server = Server::new();
    let (device, store) = device();
    signup(&mut server, &device, "password", true);
    let other = "rimp1_someone_else";
    let records = store.0.lock().unwrap().clone();
    store
        .write(&wraps_name(other), &records[&wraps_name(PRINCIPAL)])
        .unwrap();
    store
        .write(&keep_name(other), &records[&keep_name(PRINCIPAL)])
        .unwrap();
    assert!(device.unlock_kept(other).unwrap().is_none());
}

#[test]
fn the_recovery_phrase_opens_the_recovery_wrap() {
    let mut server = Server::new();
    let (device, _) = device();
    let signed_up = signup(&mut server, &device, "password", false);
    device.lock_account(PRINCIPAL);

    assert!(device
        .unlock_with_recovery(PRINCIPAL, &b64(&[8; 16]))
        .unwrap()
        .is_none());
    assert!(matches!(
        device.unlock_with_recovery(PRINCIPAL, &b64(&[8; 15])),
        Err(AccountLockError::Invalid(_))
    ));
    let recovered = device
        .unlock_with_recovery(PRINCIPAL, &b64(&ENTROPY))
        .unwrap()
        .unwrap();
    assert_eq!(*recovered.web_store_key, *signed_up.web_store_key);

    let (fresh, _) = self::device();
    assert!(fresh
        .unlock_with_recovery(PRINCIPAL, &b64(&ENTROPY))
        .unwrap()
        .is_none());
}

#[test]
fn after_a_reset_elsewhere_the_recovery_phrase_keeps_the_devices_data() {
    let mut server = Server::new();
    let (device, store) = device();
    signup(&mut server, &device, "old password", false);
    let data_key = device.data_key(PRINCIPAL).unwrap();
    device.lock_account(PRINCIPAL);
    let (other_device, _) = self::device();
    server.register(&other_device, "new password");

    let (handle, sealed) = server.login(&device, "new password").unwrap();
    assert!(matches!(
        device.unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false),
        Err(AccountLockError::NeedsRecovery)
    ));
    assert!(device.data_key(PRINCIPAL).is_none(), "nothing is unlocked");
    assert!(store.wraps().recovery_wrap.is_some(), "nothing is replaced");

    device
        .unlock_with_recovery(PRINCIPAL, &b64(&ENTROPY))
        .unwrap()
        .unwrap();
    let unlocked = device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
        .unwrap();
    assert!(!unlocked.started_empty);
    assert_eq!(*device.data_key(PRINCIPAL).unwrap(), *data_key);
    assert!(
        store.wraps().recovery_wrap.is_some(),
        "the recovery wrap stays"
    );

    device.lock_account(PRINCIPAL);
    let (handle, sealed) = server.login(&device, "new password").unwrap();
    let again = device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
        .unwrap();
    assert!(!again.started_empty, "the new password's wrap opens now");
    assert_eq!(*device.data_key(PRINCIPAL).unwrap(), *data_key);
}

#[test]
fn after_a_reset_elsewhere_starting_empty_replaces_the_wraps() {
    let mut server = Server::new();
    let (device, store) = device();
    signup(&mut server, &device, "old password", false);
    let old_key = device.data_key(PRINCIPAL).unwrap();
    device.lock_account(PRINCIPAL);
    let (other_device, _) = self::device();
    server.register(&other_device, "new password");

    let (handle, sealed) = server.login(&device, "new password").unwrap();
    assert!(matches!(
        device.unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false),
        Err(AccountLockError::NeedsRecovery)
    ));
    let unlocked = device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, true)
        .unwrap();
    assert!(unlocked.started_empty);
    assert_ne!(*device.data_key(PRINCIPAL).unwrap(), *old_key);
    assert!(store.wraps().recovery_wrap.is_none());
    assert!(matches!(
        device.unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, true),
        Err(AccountLockError::NoHandle)
    ));
}

#[test]
fn errors_serialize_as_kind_and_message() {
    assert_eq!(
        serde_json::to_value(AccountLockError::WrongPassword).unwrap(),
        serde_json::json!({ "kind": "WRONG_PASSWORD", "message": "the password is wrong" })
    );
    assert_eq!(
        serde_json::to_value(AccountLockError::NeedsRecovery).unwrap()["kind"],
        "NEEDS_RECOVERY"
    );
}

#[test]
fn records_seal_under_the_data_key_and_open_only_while_unlocked() {
    let (device, _) = device();
    let name = format!("key-identity-v1:{PRINCIPAL}");
    assert!(matches!(
        device.seal_record(PRINCIPAL, StoreKeyLabel::DesktopVault, &name, b"secret"),
        Err(AccountLockError::Locked)
    ));

    device.unlock_for_tests(PRINCIPAL, [4; 32]);
    let sealed = device
        .seal_record(PRINCIPAL, StoreKeyLabel::DesktopVault, &name, b"secret")
        .unwrap();
    assert!(!sealed.contains("secret"));
    let opened = device
        .open_record(PRINCIPAL, StoreKeyLabel::DesktopVault, &name, &sealed)
        .unwrap();
    assert_eq!(opened.as_slice(), b"secret");
    // Bound to the record's name and to the label.
    assert!(device
        .open_record(PRINCIPAL, StoreKeyLabel::DesktopVault, "other", &sealed)
        .is_err());
    assert!(device
        .open_record(PRINCIPAL, StoreKeyLabel::CacheKey, &name, &sealed)
        .is_err());
    // Another data key does not open it.
    device.unlock_for_tests(PRINCIPAL, [5; 32]);
    assert!(matches!(
        device.open_record(PRINCIPAL, StoreKeyLabel::DesktopVault, &name, &sealed),
        Err(AccountLockError::Crypto(_))
    ));

    assert!(device.lock_account(PRINCIPAL));
    assert!(!device.is_unlocked(PRINCIPAL));
    assert!(matches!(
        device.open_record(PRINCIPAL, StoreKeyLabel::DesktopVault, &name, &sealed),
        Err(AccountLockError::Locked)
    ));
    assert_eq!(
        serde_json::to_value(AccountLockError::Locked).unwrap()["kind"],
        "LOCKED"
    );
}

mod device_key {
    use super::*;
    use crate::account_lock::commands::seal_after_unlock;
    use crate::key_identity::statement::SecretKey;
    use crate::key_identity::store::{
        KeyRecord, Keys, MemorySecretStore, SecretStore as KeySecretStore,
    };
    use crate::key_identity::{Challenge, KeyIdentityError, KeyIdentityState};

    const ENDPOINT: &str = "http://localhost:8080/api";

    fn challenge() -> Challenge {
        Challenge {
            challenge_id: "00000000-0000-0000-0000-000000000009".into(),
            nonce: "bm9uY2U".into(),
        }
    }

    /// The key identity of [`PRINCIPAL`] on `device`, written before its first unlock, and its
    /// device key.
    fn key_identity(device: &AccountLock) -> (KeyIdentityState, Arc<MemorySecretStore>, SecretKey) {
        let store = Arc::new(MemorySecretStore::default());
        let seed = SecretKey::generate().unwrap();
        Keys::new(store.as_ref(), device)
            .put_record(&KeyRecord {
                v: 1,
                principal_id: PRINCIPAL.into(),
                device_id: uuid::Uuid::now_v7().to_string(),
                device_name: "Laptop".into(),
                device_seed: seed.to_text(),
                identity_seed: Some(SecretKey::generate().unwrap().to_text()),
                pending_identity_seed: None,
                pending_identity_seq: None,
                backup_key: None,
                recovery_entropy: None,
                kit_confirmed: Some(true),
                confirmed: true,
                replaced: None,
                sealed: None,
                device_wrap: None,
            })
            .unwrap();
        (
            KeyIdentityState::with_lock(store.clone(), device.clone()),
            store,
            seed,
        )
    }

    fn stored(store: &MemorySecretStore) -> serde_json::Value {
        let raw = store
            .read(&format!("key-identity-v1:{PRINCIPAL}"))
            .unwrap()
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn device_wrap(store: &MemorySecretStore) -> String {
        stored(store)["deviceWrap"].as_str().unwrap().to_string()
    }

    #[test]
    fn after_a_reset_elsewhere_starting_empty_keeps_the_device_key() {
        let mut server = Server::new();
        let (device, _) = device();
        let (keys, store, seed) = key_identity(&device);

        let signed_up = signup(&mut server, &device, "old password", false);
        assert_eq!(*signed_up.share.clone().unwrap(), server.share);
        assert!(serde_json::to_value(&signed_up)
            .unwrap()
            .get("share")
            .is_none());
        seal_after_unlock(&keys, PRINCIPAL, signed_up.share.as_ref());
        let after_signup = stored(&store);
        assert!(after_signup.get("deviceSeed").is_none());
        assert!(after_signup.get("sealed").is_some());
        let first_wrap = device_wrap(&store);

        // Each login's unlock wraps the device key again under the share.
        device.lock_account(PRINCIPAL);
        let (handle, sealed) = server.login(&device, "old password").unwrap();
        let unlocked = device
            .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
            .unwrap();
        seal_after_unlock(&keys, PRINCIPAL, unlocked.share.as_ref());
        let refreshed = device_wrap(&store);
        assert_ne!(refreshed, first_wrap);
        let wrap_key = rim_opaque::device_key_wrap_key(&server.share, PRINCIPAL);
        let opened = rim_opaque::unwrap_device_seed(&wrap_key, PRINCIPAL, &unb64(&refreshed));
        assert_eq!(&*opened.unwrap(), seed.seed());

        // A reset on another device: the password wrap no longer opens, and this device starts
        // empty. The device key comes back from its wrap; the identity key is gone.
        device.lock_account(PRINCIPAL);
        let (other_device, _) = super::device();
        server.register(&other_device, "new password");
        let (handle, sealed) = server.login(&device, "new password").unwrap();
        assert!(matches!(
            device.unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false),
            Err(AccountLockError::NeedsRecovery)
        ));
        let unlocked = device
            .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, true)
            .unwrap();
        assert!(unlocked.started_empty);
        seal_after_unlock(&keys, PRINCIPAL, unlocked.share.as_ref());

        assert_eq!(keys.device(PRINCIPAL).unwrap().1, seed.public_key());
        keys.sign_login(ENDPOINT, PRINCIPAL, &challenge()).unwrap();
        let record = Keys::new(store.as_ref(), &device)
            .record(PRINCIPAL)
            .unwrap()
            .unwrap();
        assert!(record.identity_seed.is_none());
        assert!(stored(&store).get("deviceSeed").is_none(), "sealed again");
    }

    #[test]
    fn a_device_key_whose_wrap_does_not_open_is_lost() {
        let mut server = Server::new();
        let (device, _) = device();
        let (keys, store, _) = key_identity(&device);
        let signed_up = signup(&mut server, &device, "password", false);
        seal_after_unlock(&keys, PRINCIPAL, signed_up.share.as_ref());

        // A new data key, and another share: the wrap does not open.
        device.unlock_for_tests(PRINCIPAL, [9; 32]);
        seal_after_unlock(&keys, PRINCIPAL, Some(&Zeroizing::new([8; 32])));
        assert!(matches!(
            keys.sign_login(ENDPOINT, PRINCIPAL, &challenge()),
            Err(KeyIdentityError::NoKeys)
        ));
        // The dead keys are dropped, the wrap is kept.
        assert!(stored(&store).get("sealed").is_none());
        assert!(stored(&store).get("deviceWrap").is_some());
    }
}

#[test]
fn a_password_change_rewraps_the_old_unlock_key_and_this_devices_data_key() {
    let mut server = Server::new();
    let (device, store) = device();
    signup(&mut server, &device, "old password", false);
    let data_key = device.data_key(PRINCIPAL).unwrap();
    let old_key = server.unlock_key(&device, "old password");

    let (login, sealed) = server.login(&device, "old password").unwrap();
    let registration = server.register(&device, "new password");
    let rewrap = device
        .password_rewrap(&login, &sealed, &registration, PRINCIPAL)
        .unwrap()
        .rewrap;
    let new_key = server.unlock_key(&device, "new password");
    assert_eq!(
        *rim_opaque::unwrap_rewrap(&new_key, PRINCIPAL, &unb64(&rewrap)).unwrap(),
        *old_key
    );
    let password_wrap = || unb64(&store.wraps().password_wrap);
    assert!(
        rim_opaque::unwrap_data_key(&old_key, WrapKind::Password, PRINCIPAL, &password_wrap())
            .is_ok(),
        "nothing changes here before the server takes the change"
    );

    device.password_commit(&registration, PRINCIPAL).unwrap();
    assert_eq!(
        *rim_opaque::unwrap_data_key(&new_key, WrapKind::Password, PRINCIPAL, &password_wrap())
            .unwrap(),
        *data_key
    );
    assert!(
        store.wraps().recovery_wrap.is_some(),
        "the recovery wrap stays"
    );
    assert!(matches!(
        device.password_commit(&registration, PRINCIPAL),
        Err(AccountLockError::NoHandle)
    ));

    let (login, sealed) = server.login(&device, "new password").unwrap();
    let registration = server.register(&device, "newer password");
    device
        .password_rewrap(&login, &sealed, &registration, PRINCIPAL)
        .unwrap();
    assert!(matches!(
        device.password_commit(&registration, "rimp1_other"),
        Err(AccountLockError::NoHandle)
    ));
}

#[test]
fn a_signup_elsewhere_keeps_the_unlocked_data_key_and_its_recovery_wrap() {
    let mut server = Server::new();
    let (device, store) = device();
    signup(&mut server, &device, "password", false);
    let data_key = device.data_key(PRINCIPAL).unwrap();
    let recovery_wrap = store.wraps().recovery_wrap;

    let mut elsewhere = Server::new();
    elsewhere.share = [8; 32];
    let handle = elsewhere.register(&device, "password");
    let unlocked = device
        .unlock_after_signup(&handle, PRINCIPAL, &b64(&elsewhere.share), None, true)
        .unwrap();
    assert!(!unlocked.started_empty);
    assert_eq!(*device.data_key(PRINCIPAL).unwrap(), *data_key);
    assert_eq!(store.wraps().recovery_wrap, recovery_wrap);
    assert!(store.wraps().keep_wrap.is_some());

    device.lock_account(PRINCIPAL);
    let (handle, sealed) = elsewhere.login(&device, "password").unwrap();
    device
        .unlock_after_login(&handle, PRINCIPAL, &sealed, &[], false, false)
        .unwrap();
    assert_eq!(*device.data_key(PRINCIPAL).unwrap(), *data_key);
}

#[test]
fn the_recovery_phrase_wraps_the_unlocked_data_key() {
    let mut server = Server::new();
    let (device, store) = device();
    let handle = server.register(&device, "password");
    device
        .unlock_after_signup(&handle, PRINCIPAL, &b64(&server.share), None, false)
        .unwrap();
    assert!(store.wraps().recovery_wrap.is_none());
    let data_key = device.data_key(PRINCIPAL).unwrap();

    device.add_recovery_wrap(PRINCIPAL, &b64(&ENTROPY)).unwrap();
    device.lock_account(PRINCIPAL);
    assert!(matches!(
        device.add_recovery_wrap(PRINCIPAL, &b64(&ENTROPY)),
        Err(AccountLockError::Locked)
    ));
    device
        .unlock_with_recovery(PRINCIPAL, &b64(&ENTROPY))
        .unwrap()
        .unwrap();
    assert_eq!(*device.data_key(PRINCIPAL).unwrap(), *data_key);
}

#[test]
fn a_password_wrap_is_there_once_the_account_unlocked_with_its_password() {
    let mut server = Server::new();
    let (device, _) = device();
    assert!(!device.has_password_wrap(PRINCIPAL).unwrap());
    signup(&mut server, &device, "password", false);
    assert!(device.has_password_wrap(PRINCIPAL).unwrap());
    assert!(!device.has_password_wrap("rimp1_other").unwrap());
}
