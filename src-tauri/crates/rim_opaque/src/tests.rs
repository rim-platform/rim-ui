//! Round trips against an in-process OPAQUE server, the derivations' bytes, and the wraps.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use opaque_ke::{
    CredentialFinalization, CredentialRequest, RegistrationRequest, RegistrationUpload,
    ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand_core::OsRng;

use crate::keys::{random_key, KEY_LEN};
use crate::*;

#[cfg(target_arch = "wasm32")]
wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

const PRINCIPAL: &str = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";

fn context() -> ServerLoginParameters<'static, 'static> {
    ServerLoginParameters {
        context: Some(LOGIN_CONTEXT),
        ..Default::default()
    }
}

/// An OPAQUE server holding one record.
struct Server {
    setup: ServerSetup<RimOpaque>,
    record: Option<ServerRegistration<RimOpaque>>,
}

impl Server {
    fn new() -> Self {
        Self {
            setup: ServerSetup::new(&mut OsRng),
            record: None,
        }
    }

    /// Registers `password` and returns the export key the client got.
    fn register(&mut self, password: &[u8]) -> OpaqueKey {
        let (flow, request) = ClientRegistrationFlow::start(password).unwrap();
        let response = ServerRegistration::<RimOpaque>::start(
            &self.setup,
            RegistrationRequest::deserialize(&request).unwrap(),
            PRINCIPAL.as_bytes(),
        )
        .unwrap()
        .message
        .serialize();
        let (upload, export_key) = flow.finish(password, &response).unwrap();
        self.record = Some(ServerRegistration::finish(
            RegistrationUpload::deserialize(&upload).unwrap(),
        ));
        export_key
    }

    /// Logs in with `password`; on success also returns the server's session key.
    fn login(&self, password: &[u8]) -> Result<(LoginFinish, Vec<u8>)> {
        let (flow, request) = ClientLoginFlow::start(password).unwrap();
        let started = ServerLogin::start(
            &mut OsRng,
            &self.setup,
            self.record.clone(),
            CredentialRequest::deserialize(&request).unwrap(),
            PRINCIPAL.as_bytes(),
            context(),
        )
        .unwrap();
        let finished = flow.finish(password, &started.message.serialize())?;
        let session_key = started
            .state
            .finish(
                CredentialFinalization::deserialize(&finished.finalization).unwrap(),
                context(),
            )
            .unwrap()
            .session_key
            .to_vec();
        Ok((finished, session_key))
    }
}

#[test]
fn a_registered_password_logs_in_with_the_same_export_key() {
    let mut server = Server::new();
    let export_key = server.register(b"hunter2 but longer");
    let (finished, server_session_key) = server.login(b"hunter2 but longer").unwrap();
    assert_eq!(*finished.export_key, *export_key);
    assert_eq!(
        finished.session_key.as_slice(),
        server_session_key.as_slice()
    );

    let (again, _) = server.login(b"hunter2 but longer").unwrap();
    assert_eq!(*again.export_key, *export_key);
    assert_ne!(*again.session_key, *finished.session_key);
}

#[test]
fn a_wrong_password_or_a_missing_record_fails_the_same_way() {
    let mut server = Server::new();
    server.register(b"the right one");
    assert_eq!(
        server.login(b"the wrong one").err(),
        Some(Error::WrongPassword)
    );
    assert_eq!(
        Server::new().login(b"the right one").err(),
        Some(Error::WrongPassword)
    );
}

#[test]
fn a_malformed_response_is_refused() {
    let (flow, _) = ClientLoginFlow::start(b"password").unwrap();
    assert_eq!(
        flow.finish(b"password", &[0u8; 10]).err(),
        Some(Error::Malformed("credential response"))
    );
    let (flow, _) = ClientRegistrationFlow::start(b"password").unwrap();
    assert_eq!(
        flow.finish(b"password", &[0xffu8; 64]).err(),
        Some(Error::Malformed("registration response"))
    );
}

#[test]
fn the_derivations_produce_the_agreed_bytes() {
    // Computed independently with Python's `hmac` (RFC 5869 HKDF-SHA256).
    let session_key = [0x11u8; OPAQUE_KEY_LEN];
    let export_key = [0x22u8; OPAQUE_KEY_LEN];
    let share = [0x33u8; KEY_LEN];
    let data_key = [0x44u8; KEY_LEN];
    let entropy = [0x55u8; 16];
    let hex = |k: &[u8]| k.iter().map(|b| format!("{b:02x}")).collect::<String>();

    assert_eq!(
        hex(transport_key(&session_key, TransportLabel::ServerShare).as_ref()),
        TRANSPORT_SERVER_SHARE
    );
    assert_eq!(
        hex(transport_key(&session_key, TransportLabel::KeepKey).as_ref()),
        TRANSPORT_KEEP_KEY
    );
    assert_eq!(
        hex(transport_key(&session_key, TransportLabel::SessionSecret).as_ref()),
        TRANSPORT_SESSION_SECRET
    );
    assert_eq!(
        hex(derive_unlock_key(&export_key, &share, PRINCIPAL).as_ref()),
        UNLOCK_KEY
    );
    assert_eq!(hex(recovery_wrap_key(&entropy).as_ref()), RECOVERY_WRAP_KEY);
    assert_eq!(
        hex(store_key(&data_key, StoreKeyLabel::WebStores).as_ref()),
        STORE_WEB
    );
    assert_eq!(
        hex(store_key(&data_key, StoreKeyLabel::DesktopVault).as_ref()),
        STORE_DESKTOP
    );
    assert_eq!(
        hex(store_key(&data_key, StoreKeyLabel::CacheKey).as_ref()),
        STORE_CACHE
    );
    assert_eq!(
        hex(device_key_wrap_key(&share, PRINCIPAL).as_ref()),
        DEVICE_KEY_WRAP_KEY
    );
}

const TRANSPORT_SERVER_SHARE: &str =
    "ca8fab1028bbcf27ddfa98049a0c497eb71258628aabf13b16874e3ba22959e7";
const TRANSPORT_KEEP_KEY: &str = "ac76a26f4a6c9e919ad2f19f9c903f49d3b602ab97f3bff8144a33ee5a4290e7";
const TRANSPORT_SESSION_SECRET: &str =
    "b38b478c6113fe4749683b9aecaed6136c9ebd32d1e7ba10e805dac26b9bc6b8";
const UNLOCK_KEY: &str = "dab909ad5f58275d96715d167bd23bf9b30a3cd567446f57c49c67b71423fe6e";
const RECOVERY_WRAP_KEY: &str = "7e1bf5365264e430df3d5af3bfd7024f5de77b80ac230bbfdb742decf70bcb3e";
const STORE_WEB: &str = "d07ad1cdb29904ad5a2622f9cc73e3a50dd68665dd37bfaad0a4faec8602c7d4";
const STORE_DESKTOP: &str = "1f47f41e0089a665d54210b245f9a3ac9869389bd29cd72ae7d8cfeb9a5a2909";
const STORE_CACHE: &str = "b91473b9602d84232943862cc27d82623df6bfbcd596930c36ee7bae9eaf26d2";
const DEVICE_KEY_WRAP_KEY: &str =
    "5065f83739e596250f269046b2a99f7979778d012df018c89b7b703b445dcd2c";

#[test]
fn transport_labels_parse_only_the_three_names() {
    for label in [
        TransportLabel::ServerShare,
        TransportLabel::KeepKey,
        TransportLabel::SessionSecret,
    ] {
        assert_eq!(TransportLabel::parse(label.as_str()), Some(label));
    }
    assert_eq!(TransportLabel::parse("Server Share"), None);
}

#[test]
fn a_sealed_value_opens_only_with_its_key_and_aad() {
    let key = random_key().unwrap();
    let sealed = seal(&key, b"aad", b"the share").unwrap();
    assert_eq!(sealed.len(), 12 + 9 + 16);
    assert_eq!(
        open(&key, b"aad", &sealed).unwrap().as_slice(),
        b"the share"
    );
    assert_eq!(
        open(&key, b"other", &sealed).err(),
        Some(Error::Unauthentic)
    );
    assert_eq!(
        open(&random_key().unwrap(), b"aad", &sealed).err(),
        Some(Error::Unauthentic)
    );
    let mut altered = sealed.clone();
    altered[20] ^= 1;
    assert_eq!(open(&key, b"aad", &altered).err(), Some(Error::Unauthentic));
    assert_eq!(
        open(&key, b"aad", &sealed[..27]).err(),
        Some(Error::Malformed("sealed value"))
    );
    assert_ne!(seal(&key, b"aad", b"the share").unwrap(), sealed);
}

#[test]
fn a_data_key_wrap_is_bound_to_its_kind_and_principal() {
    let key = random_key().unwrap();
    let data_key = random_key().unwrap();
    let wrap = wrap_data_key(&key, WrapKind::Password, PRINCIPAL, &data_key).unwrap();
    assert_eq!(
        *unwrap_data_key(&key, WrapKind::Password, PRINCIPAL, &wrap).unwrap(),
        *data_key
    );
    assert_eq!(
        unwrap_data_key(&key, WrapKind::Keep, PRINCIPAL, &wrap).err(),
        Some(Error::Unauthentic)
    );
    assert_eq!(
        unwrap_data_key(&key, WrapKind::Password, "rimp1_someone_else", &wrap).err(),
        Some(Error::Unauthentic)
    );
    let aad = format!("rim.dk.v1|password|{PRINCIPAL}");
    assert_eq!(
        open(&key, aad.as_bytes(), &wrap).unwrap().as_slice(),
        &data_key[..]
    );
}

#[test]
fn a_device_seed_wrap_opens_only_with_its_share_and_principal() {
    let share = [0x33u8; KEY_LEN];
    let seed = random_key().unwrap();
    let key = device_key_wrap_key(&share, PRINCIPAL);
    let wrap = wrap_device_seed(&key, PRINCIPAL, &seed).unwrap();
    assert_eq!(*unwrap_device_seed(&key, PRINCIPAL, &wrap).unwrap(), *seed);
    let other_share = device_key_wrap_key(&[0x34u8; KEY_LEN], PRINCIPAL);
    assert_eq!(
        unwrap_device_seed(&other_share, PRINCIPAL, &wrap).err(),
        Some(Error::Unauthentic)
    );
    assert_eq!(
        unwrap_device_seed(&key, "rimp1_someone_else", &wrap).err(),
        Some(Error::Unauthentic)
    );
    // The key is bound to the principal as well as the AAD.
    assert_ne!(*device_key_wrap_key(&share, "rimp1_someone_else"), *key);
    let aad = format!("rim.device-key.v1|{PRINCIPAL}");
    assert_eq!(
        open(&key, aad.as_bytes(), &wrap).unwrap().as_slice(),
        &seed[..]
    );
}

#[test]
fn a_rewrap_opens_the_old_unlock_key_and_with_it_the_old_wrap() {
    let mut server = Server::new();
    let share = random_key().unwrap();
    let data_key = random_key().unwrap();

    let old_export = server.register(b"old password");
    let old_unlock = derive_unlock_key(&old_export, &share, PRINCIPAL);
    let wrap = wrap_data_key(&old_unlock, WrapKind::Password, PRINCIPAL, &data_key).unwrap();

    let new_export = server.register(b"new password");
    let new_unlock = derive_unlock_key(&new_export, &share, PRINCIPAL);
    assert_ne!(*new_unlock, *old_unlock);
    let rewrap = rewrap_unlock_key(&new_unlock, &old_unlock, PRINCIPAL).unwrap();

    let (finished, _) = server.login(b"new password").unwrap();
    let unlock = derive_unlock_key(&finished.export_key, &share, PRINCIPAL);
    assert_eq!(
        unwrap_data_key(&unlock, WrapKind::Password, PRINCIPAL, &wrap).err(),
        Some(Error::Unauthentic)
    );
    let recovered = unwrap_rewrap(&unlock, PRINCIPAL, &rewrap).unwrap();
    assert_eq!(
        *unwrap_data_key(&recovered, WrapKind::Password, PRINCIPAL, &wrap).unwrap(),
        *data_key
    );
    assert_eq!(
        unwrap_rewrap(&unlock, "rimp1_someone_else", &rewrap).err(),
        Some(Error::Unauthentic)
    );
    let aad = format!("rim.uk-rewrap.v1|{PRINCIPAL}");
    assert_eq!(
        open(&new_unlock, aad.as_bytes(), &rewrap)
            .unwrap()
            .as_slice(),
        &old_unlock[..]
    );
}

#[test]
fn the_ksf_is_argon2id_with_the_agreed_cost() {
    let input = [7u8; 64];
    let mut expected = [0u8; 64];
    argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(65536, 3, 4, None).unwrap(),
    )
    .hash_password_into(&input, &[0; 16], &mut expected)
    .unwrap();
    let out = opaque_ke::ksf::Ksf::hash(
        &RimKsf::default(),
        generic_array::GenericArray::<u8, generic_array::typenum::U64>::clone_from_slice(&input),
    )
    .unwrap();
    assert_eq!(out.as_slice(), expected);
}
