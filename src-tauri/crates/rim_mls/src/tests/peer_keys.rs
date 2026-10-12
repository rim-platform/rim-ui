//! X-Wing public keys of the wrong length from another device: refused before any operation would
//! encrypt to them, never a panic.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use std::sync::atomic::{AtomicUsize, Ordering};

use openmls::prelude::tls_codec::SecretVLBytes;
use openmls_traits::crypto::OpenMlsCrypto;
use openmls_traits::random::OpenMlsRand;
use openmls_traits::types::{
    AeadType, Ciphersuite, CryptoError, ExporterSecret, HashType, HpkeCiphertext, HpkeConfig,
    HpkeKeyPair, KemOutput, SignatureScheme,
};
use uuid::Uuid;

use super::raw::{commit_raw, key_package_ref};
use super::support::{now, Provider, TestDevice};
use crate::device::{generate_key_packages, key_package_lifetime};
use crate::group::claimed_key_package;
use crate::peer_key::{check_key_package, XWING_PUBLIC_KEY_LEN};
use crate::provider::with_crypto;
use crate::storage::sealed::Sealed as _;
use crate::{
    AddedDevice, ClaimedKeyPackage, CommitOutcome, CommitSummary, ConversationGroup, Error,
};

/// The length forged keys are cut to: one byte short of the ML-KEM-768 part, which makes the
/// libcrux X-Wing decoder panic.
const SHORT_KEY_LEN: usize = 1183;

/// The libcrux provider, except that the HPKE key pairs it derives in the calls numbered in
/// `short` (from 0) get a public key cut to [`SHORT_KEY_LEN`]: a device publishing short keys.
struct ShortKeys {
    inner: openmls_libcrux_crypto::CryptoProvider,
    calls: AtomicUsize,
    short: &'static [usize],
}

impl ShortKeys {
    fn new(short: &'static [usize]) -> Self {
        Self {
            inner: openmls_libcrux_crypto::CryptoProvider::new().unwrap(),
            calls: AtomicUsize::new(0),
            short,
        }
    }
}

impl OpenMlsRand for ShortKeys {
    type Error = <openmls_libcrux_crypto::CryptoProvider as OpenMlsRand>::Error;

    fn random_array<const N: usize>(&self) -> Result<[u8; N], Self::Error> {
        self.inner.random_array()
    }

    fn random_vec(&self, len: usize) -> Result<Vec<u8>, Self::Error> {
        self.inner.random_vec(len)
    }
}

impl OpenMlsCrypto for ShortKeys {
    fn supports(&self, ciphersuite: Ciphersuite) -> Result<(), CryptoError> {
        self.inner.supports(ciphersuite)
    }

    fn supported_ciphersuites(&self) -> Vec<Ciphersuite> {
        self.inner.supported_ciphersuites()
    }

    fn hkdf_extract(
        &self,
        hash_type: HashType,
        salt: &[u8],
        ikm: &[u8],
    ) -> Result<SecretVLBytes, CryptoError> {
        self.inner.hkdf_extract(hash_type, salt, ikm)
    }

    fn hmac(
        &self,
        hash_type: HashType,
        key: &[u8],
        message: &[u8],
    ) -> Result<SecretVLBytes, CryptoError> {
        self.inner.hmac(hash_type, key, message)
    }

    fn hkdf_expand(
        &self,
        hash_type: HashType,
        prk: &[u8],
        info: &[u8],
        okm_len: usize,
    ) -> Result<SecretVLBytes, CryptoError> {
        self.inner.hkdf_expand(hash_type, prk, info, okm_len)
    }

    fn hash(&self, hash_type: HashType, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
        self.inner.hash(hash_type, data)
    }

    fn aead_encrypt(
        &self,
        alg: AeadType,
        key: &[u8],
        data: &[u8],
        nonce: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        self.inner.aead_encrypt(alg, key, data, nonce, aad)
    }

    fn aead_decrypt(
        &self,
        alg: AeadType,
        key: &[u8],
        ct_tag: &[u8],
        nonce: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        self.inner.aead_decrypt(alg, key, ct_tag, nonce, aad)
    }

    fn signature_key_gen(&self, alg: SignatureScheme) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
        self.inner.signature_key_gen(alg)
    }

    fn verify_signature(
        &self,
        alg: SignatureScheme,
        data: &[u8],
        pk: &[u8],
        signature: &[u8],
    ) -> Result<(), CryptoError> {
        self.inner.verify_signature(alg, data, pk, signature)
    }

    fn sign(&self, alg: SignatureScheme, data: &[u8], key: &[u8]) -> Result<Vec<u8>, CryptoError> {
        self.inner.sign(alg, data, key)
    }

    fn hpke_seal(
        &self,
        config: HpkeConfig,
        pk_r: &[u8],
        info: &[u8],
        aad: &[u8],
        ptxt: &[u8],
    ) -> Result<HpkeCiphertext, CryptoError> {
        self.inner.hpke_seal(config, pk_r, info, aad, ptxt)
    }

    fn hpke_open(
        &self,
        config: HpkeConfig,
        input: &HpkeCiphertext,
        sk_r: &[u8],
        info: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        self.inner.hpke_open(config, input, sk_r, info, aad)
    }

    fn hpke_setup_sender_and_export(
        &self,
        config: HpkeConfig,
        pk_r: &[u8],
        info: &[u8],
        exporter_context: &[u8],
        exporter_length: usize,
    ) -> Result<(KemOutput, ExporterSecret), CryptoError> {
        self.inner.hpke_setup_sender_and_export(
            config,
            pk_r,
            info,
            exporter_context,
            exporter_length,
        )
    }

    fn hpke_setup_receiver_and_export(
        &self,
        config: HpkeConfig,
        enc: &[u8],
        sk_r: &[u8],
        info: &[u8],
        exporter_context: &[u8],
        exporter_length: usize,
    ) -> Result<ExporterSecret, CryptoError> {
        self.inner.hpke_setup_receiver_and_export(
            config,
            enc,
            sk_r,
            info,
            exporter_context,
            exporter_length,
        )
    }

    fn derive_hpke_keypair(
        &self,
        config: HpkeConfig,
        ikm: &[u8],
    ) -> Result<HpkeKeyPair, CryptoError> {
        let mut pair = self.inner.derive_hpke_keypair(config, ikm)?;
        if self
            .short
            .contains(&self.calls.fetch_add(1, Ordering::Relaxed))
        {
            pair.public.truncate(SHORT_KEY_LEN);
        }
        Ok(pair)
    }
}

/// A key package of `dev` whose init key (derivation 0) or leaf encryption key (derivation 1) is
/// short, as `short` says.
fn short_key_package(dev: &TestDevice, short: &'static [usize]) -> ClaimedKeyPackage {
    let generated = generate_key_packages(
        &ShortKeys::new(short),
        dev.store.backend(),
        1,
        false,
        now(),
        key_package_lifetime(now()),
    )
    .unwrap()
    .remove(0);
    dev.store.commit();
    ClaimedKeyPackage {
        device: dev.device.clone(),
        key_package: generated.message,
    }
}

/// The summary a Commit that adds `adds` and removes nothing carries.
fn adds_summary(adds: &[&ClaimedKeyPackage]) -> Vec<u8> {
    CommitSummary {
        adds: adds
            .iter()
            .map(|claimed| AddedDevice {
                device: claimed.device.clone(),
                key_package_ref: key_package_ref(claimed),
            })
            .collect(),
        removes: vec![],
    }
    .to_bytes()
}

/// A group of `owner` and `member`, both at epoch 1.
fn pair(owner: &TestDevice, member: &TestDevice) -> ConversationGroup {
    let group = ConversationGroup::new(Uuid::now_v7(), 1);
    let created = owner
        .mls
        .create_group(&owner.store, group, &[member.key_package()])
        .unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    member
        .mls
        .join(&member.store, group, &created.welcome.unwrap())
        .unwrap();
    member.store.commit();
    group
}

fn assert_short(result: crate::Result<impl std::fmt::Debug>, what: &str) {
    match result {
        Err(Error::InvalidPeerKey { what: named, len }) => {
            assert!(named.contains(what), "{named}");
            assert_eq!(len, SHORT_KEY_LEN);
        }
        other => panic!("expected a short {what}, got {other:?}"),
    }
}

#[test]
fn an_add_of_a_key_package_with_a_short_key_is_refused() {
    let owner = TestDevice::new(Provider::Libcrux, 1, 1);
    let member = TestDevice::new(Provider::Libcrux, 2, 1);
    let forger = TestDevice::new(Provider::Libcrux, 3, 1);
    let group = pair(&owner, &member);

    for (short, what) in [(&[0][..], "init key"), (&[1][..], "encryption key")] {
        let claimed = short_key_package(&forger, short);
        assert_short(
            owner
                .mls
                .commit(&owner.store, group, std::slice::from_ref(&claimed), &[]),
            what,
        );
        owner.store.rollback();
        assert_short(
            owner.mls.create_group(
                &owner.store,
                ConversationGroup::new(Uuid::now_v7(), 1),
                &[claimed],
            ),
            what,
        );
        owner.store.rollback();
    }

    // The group goes on: the same device, with keys of the right length, is added.
    let added = owner
        .mls
        .commit(&owner.store, group, &[forger.key_package()], &[])
        .unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    forger
        .mls
        .join(&forger.store, group, &added.welcome.unwrap())
        .unwrap();
}

#[test]
fn key_packages_carry_x_wing_keys_of_the_checked_length() {
    let dev = TestDevice::new(Provider::Libcrux, 1, 1);
    let claimed = dev.key_package();
    let key_package = with_crypto!(&dev.mls.backend, |crypto| {
        claimed_key_package(crypto, &claimed).unwrap().0
    });
    assert_eq!(
        key_package.hpke_init_key().as_slice().len(),
        XWING_PUBLIC_KEY_LEN
    );
    check_key_package(&key_package, "test").unwrap();
}

#[test]
fn a_commit_that_adds_a_short_leaf_key_is_not_merged() {
    let owner = TestDevice::new(Provider::Libcrux, 1, 1);
    let member = TestDevice::new(Provider::Libcrux, 2, 1);
    let forger = TestDevice::new(Provider::Libcrux, 3, 1);
    let group = pair(&owner, &member);

    // An Add-only Commit without an update path, past the committer's checks: nothing in it is
    // encrypted to the short leaf key.
    let claimed = short_key_package(&forger, &[1]);
    let (commit, _) = commit_raw(
        &owner,
        group,
        std::slice::from_ref(&claimed),
        &[],
        &adds_summary(&[&claimed]),
    );
    owner.store.commit();
    let outcome = member
        .mls
        .process_commit(&member.store, group, &commit)
        .unwrap();
    match outcome {
        CommitOutcome::CannotProcess {
            epoch,
            reason,
            committer,
        } => {
            assert_eq!(epoch, 1);
            assert!(reason.contains("leaf encryption key"), "{reason}");
            assert_eq!(committer, Some(owner.device.clone()));
        }
        other => panic!("merged: {other:?}"),
    }
}

#[test]
fn a_commit_whose_update_path_has_a_short_leaf_key_is_not_merged() {
    let owner = TestDevice::new(Provider::Libcrux, 1, 1);
    let member = TestDevice::new(Provider::Libcrux, 2, 1);
    let group = pair(&owner, &member);

    // A self-update derives the path's one parent key, then the new leaf key.
    let commit = crate::group::commit(
        &ShortKeys::new(&[1]),
        owner.store.backend(),
        group,
        &[],
        &[],
    )
    .unwrap();
    owner.store.commit();
    let outcome = member
        .mls
        .process_commit(&member.store, group, &commit.commit)
        .unwrap();
    match outcome {
        CommitOutcome::CannotProcess {
            reason, committer, ..
        } => {
            assert!(reason.contains("leaf encryption key"), "{reason}");
            assert_eq!(committer, Some(owner.device.clone()));
        }
        other => panic!("merged: {other:?}"),
    }
}

#[test]
fn a_tree_with_a_short_key_refuses_welcomes_and_commits_except_the_removal() {
    let owner = TestDevice::new(Provider::Libcrux, 1, 1);
    let member = TestDevice::new(Provider::Libcrux, 2, 1);
    let forger = TestDevice::new(Provider::Libcrux, 3, 1);
    let joiner = TestDevice::new(Provider::Libcrux, 4, 1);
    let group = pair(&owner, &member);

    // The owner merged an Add of a short leaf key without checking it.
    let short = short_key_package(&forger, &[1]);
    commit_raw(
        &owner,
        group,
        std::slice::from_ref(&short),
        &[],
        &adds_summary(&[&short]),
    );
    owner.store.commit();

    // A Welcome to that tree is refused.
    let joining = joiner.key_package();
    let (_, welcome) = commit_raw(
        &owner,
        group,
        std::slice::from_ref(&joining),
        &[],
        &adds_summary(&[&joining]),
    );
    owner.store.commit();
    assert_short(
        joiner.mls.join(&joiner.store, group, &welcome.unwrap()),
        "leaf encryption key",
    );
    joiner.store.rollback();

    // A Commit that would encrypt to the short key is refused, before OpenMLS decodes it.
    assert_short(
        owner.mls.self_update(&owner.store, group),
        "encryption key of leaf 2",
    );
    owner.store.rollback();

    // Removing the device blanks its leaf and direct path: that Commit goes through.
    owner
        .mls
        .commit(
            &owner.store,
            group,
            &[],
            std::slice::from_ref(&forger.device),
        )
        .unwrap();
    owner.mls.commit_accepted(&owner.store, group).unwrap();
    owner.store.commit();
    owner.mls.self_update(&owner.store, group).unwrap();
}
