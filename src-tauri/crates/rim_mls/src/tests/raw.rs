//! A misbehaving device: messages and Commits built straight on OpenMLS, past the crate's checks.

use openmls::prelude::tls_codec::DeserializeBytes as _;
use openmls::prelude::{KeyPackage, KeyPackageIn, MlsMessageBodyIn, MlsMessageIn, ProtocolVersion};
use openmls_traits::OpenMlsProvider as _;

use super::support::TestDevice;
use crate::device::load_identity;
use crate::group::{leaf_index_of, load_group, to_bytes};
use crate::provider::{with_crypto, Provider};
use crate::storage::sealed::Sealed as _;
use crate::storage::KvStorage;
use crate::{ClaimedKeyPackage, ConversationGroup, DeviceRef};

/// The `KeyPackageRef` of a claimed key package.
pub(crate) fn key_package_ref(claimed: &ClaimedKeyPackage) -> Vec<u8> {
    let crypto = openmls_rust_crypto::RustCrypto::default();
    parse_key_package(&crypto, &claimed.key_package)
        .hash_ref(&crypto)
        .unwrap()
        .as_slice()
        .to_vec()
}

/// Any valid key package, whatever device its credential names.
fn parse_key_package(
    crypto: &impl openmls_traits::crypto::OpenMlsCrypto,
    bytes: &[u8],
) -> KeyPackage {
    let MlsMessageBodyIn::KeyPackage(key_package) =
        MlsMessageIn::tls_deserialize_exact_bytes(bytes)
            .unwrap()
            .extract()
    else {
        panic!("not a key package");
    };
    KeyPackageIn::validate(key_package, crypto, ProtocolVersion::Mls10).unwrap()
}

/// An application message of `data` (the full application data) with `aad`. The caller commits
/// the sender's store.
pub(crate) fn send_raw(
    dev: &TestDevice,
    group: ConversationGroup,
    aad: &[u8],
    data: &[u8],
) -> Vec<u8> {
    let envelope = with_crypto!(&dev.mls.backend, |crypto| {
        let provider = Provider::new(crypto, KvStorage::new(dev.store.backend()));
        let identity = load_identity(dev.store.backend()).unwrap();
        let mut mls_group = load_group(&provider, &group).unwrap();
        mls_group.set_aad(aad.to_vec());
        let message = mls_group
            .create_message(&provider, &identity.signer(crypto), data)
            .unwrap();
        to_bytes(&message).unwrap()
    });
    envelope
}

/// A Commit of `adds` and `removes` whose authenticated data is `aad`, merged at once by its
/// sender (the caller commits its store). Returns the Commit and the Welcome.
pub(crate) fn commit_raw(
    dev: &TestDevice,
    group: ConversationGroup,
    adds: &[ClaimedKeyPackage],
    removes: &[DeviceRef],
    aad: &[u8],
) -> (Vec<u8>, Option<Vec<u8>>) {
    commit_raw_with(dev, group, adds, removes, aad, false)
}

/// [`commit_raw`] with, when `extensions` is set, a GroupContextExtensions proposal that
/// restates the group's extensions.
pub(crate) fn commit_raw_with(
    dev: &TestDevice,
    group: ConversationGroup,
    adds: &[ClaimedKeyPackage],
    removes: &[DeviceRef],
    aad: &[u8],
    extensions: bool,
) -> (Vec<u8>, Option<Vec<u8>>) {
    let messages = with_crypto!(&dev.mls.backend, |crypto| {
        let provider = Provider::new(crypto, KvStorage::new(dev.store.backend()));
        let identity = load_identity(dev.store.backend()).unwrap();
        let mut mls_group = load_group(&provider, &group).unwrap();
        let key_packages: Vec<KeyPackage> = adds
            .iter()
            .map(|claimed| parse_key_package(crypto, &claimed.key_package))
            .collect();
        let removed: Vec<_> = removes
            .iter()
            .map(|device| leaf_index_of(&mls_group, device).unwrap())
            .collect();
        mls_group.set_aad(aad.to_vec());
        let signer = identity.signer(crypto);
        let current = mls_group.extensions().clone();
        let mut builder = mls_group
            .commit_builder()
            .propose_adds(key_packages)
            .propose_removals(removed);
        if extensions {
            builder = builder.propose_group_context_extensions(current).unwrap();
        }
        let bundle = builder
            .load_psks(provider.storage())
            .unwrap()
            .build(provider.rand(), provider.crypto(), &signer, |_| true)
            .unwrap()
            .stage_commit(&provider)
            .unwrap();
        let (commit, welcome, _) = bundle.into_messages();
        mls_group.merge_pending_commit(&provider).unwrap();
        (
            to_bytes(&commit).unwrap(),
            welcome.map(|w| to_bytes(&w).unwrap()),
        )
    });
    messages
}
