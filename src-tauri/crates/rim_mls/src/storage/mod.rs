//! Where group state lives: OpenMLS's storage provider over a labelled key-value store, and the
//! two stores behind it (SQLite inside the caller's transaction, and memory).
//!
//! Every entry is `(label, key, value)`. OpenMLS entries use the label `openmls.v1.<kind>`, a key
//! that is the JSON of OpenMLS's key value, and a JSON value, as OpenMLS's own memory storage
//! writes them. This crate's own records use labels starting with `rim.`.

mod memory;
#[cfg(feature = "sqlite")]
mod sqlite;

use serde::de::DeserializeOwned;
use serde::Serialize;

use openmls_traits::storage::{traits, Key, StorageProvider, CURRENT_VERSION};

pub use memory::{Change, MemoryStore};
#[cfg(feature = "sqlite")]
pub use sqlite::{SqliteStore, SCHEMA};

/// A failure of the store under OpenMLS.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct StorageError(pub(crate) String);

impl From<serde_json::Error> for StorageError {
    fn from(e: serde_json::Error) -> Self {
        Self(format!("serialization: {e}"))
    }
}

impl From<StorageError> for crate::Error {
    fn from(e: StorageError) -> Self {
        crate::Error::Storage(e.0)
    }
}

pub(crate) mod sealed {
    use super::StorageError;

    /// Keys and values under one label.
    pub type Entries = Vec<(Vec<u8>, Vec<u8>)>;

    /// The labelled key-value operations a store offers.
    pub trait Backend {
        fn get(&self, label: &str, key: &[u8]) -> Result<Option<Vec<u8>>, StorageError>;
        fn put(&self, label: &str, key: &[u8], value: &[u8]) -> Result<(), StorageError>;
        fn delete(&self, label: &str, key: &[u8]) -> Result<(), StorageError>;
        /// Every entry under `label`, ordered by key.
        fn list(&self, label: &str) -> Result<Entries, StorageError>;
    }

    pub trait Sealed {
        fn backend(&self) -> &dyn Backend;
    }
}

use sealed::Backend;

/// A place group state can live: [`SqliteStore`] (one SQLite transaction) or [`MemoryStore`].
pub trait Store: sealed::Sealed {}

/// OpenMLS's view of a store.
pub(crate) struct KvStorage<'a> {
    backend: &'a dyn Backend,
}

impl<'a> KvStorage<'a> {
    pub(crate) fn new(store: &'a dyn Backend) -> Self {
        Self { backend: store }
    }

    fn write(&self, label: &str, key: &[u8], value: &impl Serialize) -> Result<(), StorageError> {
        self.backend.put(label, key, &serde_json::to_vec(value)?)
    }

    fn read<V: DeserializeOwned>(
        &self,
        label: &str,
        key: &[u8],
    ) -> Result<Option<V>, StorageError> {
        match self.backend.get(label, key)? {
            Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            None => Ok(None),
        }
    }

    fn read_list<V: DeserializeOwned>(
        &self,
        label: &str,
        key: &[u8],
    ) -> Result<Vec<V>, StorageError> {
        let Some(bytes) = self.backend.get(label, key)? else {
            return Ok(vec![]);
        };
        let items: Vec<Vec<u8>> = serde_json::from_slice(&bytes)?;
        items
            .iter()
            .map(|item| serde_json::from_slice(item).map_err(StorageError::from))
            .collect()
    }

    fn append(&self, label: &str, key: &[u8], value: &impl Serialize) -> Result<(), StorageError> {
        let mut items: Vec<Vec<u8>> = match self.backend.get(label, key)? {
            Some(bytes) => serde_json::from_slice(&bytes)?,
            None => vec![],
        };
        items.push(serde_json::to_vec(value)?);
        self.write(label, key, &items)
    }

    fn remove_item(
        &self,
        label: &str,
        key: &[u8],
        value: &impl Serialize,
    ) -> Result<(), StorageError> {
        let Some(bytes) = self.backend.get(label, key)? else {
            return Ok(());
        };
        let mut items: Vec<Vec<u8>> = serde_json::from_slice(&bytes)?;
        let value = serde_json::to_vec(value)?;
        if let Some(position) = items.iter().position(|item| *item == value) {
            items.remove(position);
        }
        self.write(label, key, &items)
    }

    fn delete(&self, label: &str, key: &[u8]) -> Result<(), StorageError> {
        self.backend.delete(label, key)
    }
}

/// The JSON of a key, as OpenMLS's memory storage spells keys.
fn key<K: Serialize + ?Sized>(key: &K) -> Result<Vec<u8>, StorageError> {
    Ok(serde_json::to_vec(key)?)
}

fn epoch_key_pairs_key(
    group_id: &impl Key<CURRENT_VERSION>,
    epoch: &impl Key<CURRENT_VERSION>,
    leaf_index: u32,
) -> Result<Vec<u8>, StorageError> {
    let mut out = key(group_id)?;
    out.extend_from_slice(&key(epoch)?);
    out.extend_from_slice(&key(&leaf_index)?);
    Ok(out)
}

mod label {
    pub const KEY_PACKAGE: &str = "openmls.v1.KeyPackage";
    pub const PSK: &str = "openmls.v1.Psk";
    pub const ENCRYPTION_KEY_PAIR: &str = "openmls.v1.EncryptionKeyPair";
    pub const SIGNATURE_KEY_PAIR: &str = "openmls.v1.SignatureKeyPair";
    pub const EPOCH_KEY_PAIRS: &str = "openmls.v1.EpochKeyPairs";
    pub const TREE: &str = "openmls.v1.Tree";
    pub const GROUP_CONTEXT: &str = "openmls.v1.GroupContext";
    pub const INTERIM_TRANSCRIPT_HASH: &str = "openmls.v1.InterimTranscriptHash";
    pub const CONFIRMATION_TAG: &str = "openmls.v1.ConfirmationTag";
    pub const JOIN_CONFIG: &str = "openmls.v1.MlsGroupJoinConfig";
    pub const OWN_LEAF_NODES: &str = "openmls.v1.OwnLeafNodes";
    pub const GROUP_STATE: &str = "openmls.v1.GroupState";
    pub const QUEUED_PROPOSAL: &str = "openmls.v1.QueuedProposal";
    pub const PROPOSAL_QUEUE_REFS: &str = "openmls.v1.ProposalQueueRefs";
    pub const OWN_LEAF_NODE_INDEX: &str = "openmls.v1.OwnLeafNodeIndex";
    pub const EPOCH_SECRETS: &str = "openmls.v1.EpochSecrets";
    pub const RESUMPTION_PSK_STORE: &str = "openmls.v1.ResumptionPsk";
    pub const MESSAGE_SECRETS: &str = "openmls.v1.MessageSecrets";
}

/// Reads and writes of this crate's own records (labels `rim.*`), as JSON values.
pub(crate) struct Records<'a> {
    backend: &'a dyn Backend,
}

impl<'a> Records<'a> {
    pub(crate) fn new(backend: &'a dyn Backend) -> Self {
        Self { backend }
    }

    pub(crate) fn get<V: DeserializeOwned>(
        &self,
        label: &str,
        key: &[u8],
    ) -> crate::Result<Option<V>> {
        match self.backend.get(label, key)? {
            Some(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|e| crate::Error::Storage(format!("{label}: {e}"))),
            None => Ok(None),
        }
    }

    pub(crate) fn put(&self, label: &str, key: &[u8], value: &impl Serialize) -> crate::Result<()> {
        let bytes = serde_json::to_vec(value).map_err(|e| crate::Error::Storage(e.to_string()))?;
        Ok(self.backend.put(label, key, &bytes)?)
    }

    pub(crate) fn delete(&self, label: &str, key: &[u8]) -> crate::Result<()> {
        Ok(self.backend.delete(label, key)?)
    }

    pub(crate) fn list<V: DeserializeOwned>(
        &self,
        label: &str,
    ) -> crate::Result<Vec<(Vec<u8>, V)>> {
        self.backend
            .list(label)?
            .into_iter()
            .map(|(key, bytes)| {
                serde_json::from_slice(&bytes)
                    .map(|value| (key, value))
                    .map_err(|e| crate::Error::Storage(format!("{label}: {e}")))
            })
            .collect()
    }
}

impl StorageProvider<CURRENT_VERSION> for KvStorage<'_> {
    type Error = StorageError;

    fn write_mls_join_config<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MlsGroupJoinConfig: traits::MlsGroupJoinConfig<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        config: &MlsGroupJoinConfig,
    ) -> Result<(), Self::Error> {
        self.write(label::JOIN_CONFIG, &key(group_id)?, config)
    }

    fn append_own_leaf_node<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNode: traits::LeafNode<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        leaf_node: &LeafNode,
    ) -> Result<(), Self::Error> {
        self.append(label::OWN_LEAF_NODES, &key(group_id)?, leaf_node)
    }

    fn queue_proposal<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
        QueuedProposal: traits::QueuedProposal<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        proposal_ref: &ProposalRef,
        proposal: &QueuedProposal,
    ) -> Result<(), Self::Error> {
        self.write(
            label::QUEUED_PROPOSAL,
            &key(&(group_id, proposal_ref))?,
            proposal,
        )?;
        self.append(label::PROPOSAL_QUEUE_REFS, &key(group_id)?, proposal_ref)
    }

    fn write_tree<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        TreeSync: traits::TreeSync<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        tree: &TreeSync,
    ) -> Result<(), Self::Error> {
        self.write(label::TREE, &key(group_id)?, tree)
    }

    fn write_interim_transcript_hash<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        InterimTranscriptHash: traits::InterimTranscriptHash<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        interim_transcript_hash: &InterimTranscriptHash,
    ) -> Result<(), Self::Error> {
        self.write(
            label::INTERIM_TRANSCRIPT_HASH,
            &key(group_id)?,
            interim_transcript_hash,
        )
    }

    fn write_context<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupContext: traits::GroupContext<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        group_context: &GroupContext,
    ) -> Result<(), Self::Error> {
        self.write(label::GROUP_CONTEXT, &key(group_id)?, group_context)
    }

    fn write_confirmation_tag<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ConfirmationTag: traits::ConfirmationTag<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        confirmation_tag: &ConfirmationTag,
    ) -> Result<(), Self::Error> {
        self.write(label::CONFIRMATION_TAG, &key(group_id)?, confirmation_tag)
    }

    fn write_group_state<
        GroupState: traits::GroupState<CURRENT_VERSION>,
        GroupId: traits::GroupId<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        group_state: &GroupState,
    ) -> Result<(), Self::Error> {
        self.write(label::GROUP_STATE, &key(group_id)?, group_state)
    }

    fn write_message_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MessageSecrets: traits::MessageSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        message_secrets: &MessageSecrets,
    ) -> Result<(), Self::Error> {
        self.write(label::MESSAGE_SECRETS, &key(group_id)?, message_secrets)
    }

    fn write_resumption_psk_store<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ResumptionPskStore: traits::ResumptionPskStore<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        resumption_psk_store: &ResumptionPskStore,
    ) -> Result<(), Self::Error> {
        self.write(
            label::RESUMPTION_PSK_STORE,
            &key(group_id)?,
            resumption_psk_store,
        )
    }

    fn write_own_leaf_index<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNodeIndex: traits::LeafNodeIndex<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        own_leaf_index: &LeafNodeIndex,
    ) -> Result<(), Self::Error> {
        self.write(label::OWN_LEAF_NODE_INDEX, &key(group_id)?, own_leaf_index)
    }

    fn write_group_epoch_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupEpochSecrets: traits::GroupEpochSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        group_epoch_secrets: &GroupEpochSecrets,
    ) -> Result<(), Self::Error> {
        self.write(label::EPOCH_SECRETS, &key(group_id)?, group_epoch_secrets)
    }

    fn write_signature_key_pair<
        SignaturePublicKey: traits::SignaturePublicKey<CURRENT_VERSION>,
        SignatureKeyPair: traits::SignatureKeyPair<CURRENT_VERSION>,
    >(
        &self,
        public_key: &SignaturePublicKey,
        signature_key_pair: &SignatureKeyPair,
    ) -> Result<(), Self::Error> {
        self.write(
            label::SIGNATURE_KEY_PAIR,
            &key(public_key)?,
            signature_key_pair,
        )
    }

    fn write_encryption_key_pair<
        EncryptionKey: traits::EncryptionKey<CURRENT_VERSION>,
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
    >(
        &self,
        public_key: &EncryptionKey,
        key_pair: &HpkeKeyPair,
    ) -> Result<(), Self::Error> {
        self.write(label::ENCRYPTION_KEY_PAIR, &key(public_key)?, key_pair)
    }

    fn write_encryption_epoch_key_pairs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        EpochKey: traits::EpochKey<CURRENT_VERSION>,
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        epoch: &EpochKey,
        leaf_index: u32,
        key_pairs: &[HpkeKeyPair],
    ) -> Result<(), Self::Error> {
        self.write(
            label::EPOCH_KEY_PAIRS,
            &epoch_key_pairs_key(group_id, epoch, leaf_index)?,
            &key_pairs,
        )
    }

    fn write_key_package<
        HashReference: traits::HashReference<CURRENT_VERSION>,
        KeyPackage: traits::KeyPackage<CURRENT_VERSION>,
    >(
        &self,
        hash_ref: &HashReference,
        key_package: &KeyPackage,
    ) -> Result<(), Self::Error> {
        self.write(label::KEY_PACKAGE, &key(hash_ref)?, key_package)
    }

    fn write_psk<
        PskId: traits::PskId<CURRENT_VERSION>,
        PskBundle: traits::PskBundle<CURRENT_VERSION>,
    >(
        &self,
        psk_id: &PskId,
        psk: &PskBundle,
    ) -> Result<(), Self::Error> {
        self.write(label::PSK, &key(psk_id)?, psk)
    }

    fn mls_group_join_config<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MlsGroupJoinConfig: traits::MlsGroupJoinConfig<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<MlsGroupJoinConfig>, Self::Error> {
        self.read(label::JOIN_CONFIG, &key(group_id)?)
    }

    fn own_leaf_nodes<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNode: traits::LeafNode<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Vec<LeafNode>, Self::Error> {
        self.read_list(label::OWN_LEAF_NODES, &key(group_id)?)
    }

    fn queued_proposal_refs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Vec<ProposalRef>, Self::Error> {
        self.read_list(label::PROPOSAL_QUEUE_REFS, &key(group_id)?)
    }

    fn queued_proposals<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
        QueuedProposal: traits::QueuedProposal<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Vec<(ProposalRef, QueuedProposal)>, Self::Error> {
        let refs: Vec<ProposalRef> = self.read_list(label::PROPOSAL_QUEUE_REFS, &key(group_id)?)?;
        refs.into_iter()
            .map(|proposal_ref| {
                let proposal = self
                    .read(label::QUEUED_PROPOSAL, &key(&(group_id, &proposal_ref))?)?
                    .ok_or_else(|| StorageError("a queued proposal is missing".into()))?;
                Ok((proposal_ref, proposal))
            })
            .collect()
    }

    fn tree<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        TreeSync: traits::TreeSync<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<TreeSync>, Self::Error> {
        self.read(label::TREE, &key(group_id)?)
    }

    fn group_context<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupContext: traits::GroupContext<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<GroupContext>, Self::Error> {
        self.read(label::GROUP_CONTEXT, &key(group_id)?)
    }

    fn interim_transcript_hash<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        InterimTranscriptHash: traits::InterimTranscriptHash<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<InterimTranscriptHash>, Self::Error> {
        self.read(label::INTERIM_TRANSCRIPT_HASH, &key(group_id)?)
    }

    fn confirmation_tag<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ConfirmationTag: traits::ConfirmationTag<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<ConfirmationTag>, Self::Error> {
        self.read(label::CONFIRMATION_TAG, &key(group_id)?)
    }

    fn group_state<
        GroupState: traits::GroupState<CURRENT_VERSION>,
        GroupId: traits::GroupId<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<GroupState>, Self::Error> {
        self.read(label::GROUP_STATE, &key(group_id)?)
    }

    fn message_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        MessageSecrets: traits::MessageSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<MessageSecrets>, Self::Error> {
        self.read(label::MESSAGE_SECRETS, &key(group_id)?)
    }

    fn resumption_psk_store<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ResumptionPskStore: traits::ResumptionPskStore<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<ResumptionPskStore>, Self::Error> {
        self.read(label::RESUMPTION_PSK_STORE, &key(group_id)?)
    }

    fn own_leaf_index<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        LeafNodeIndex: traits::LeafNodeIndex<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<LeafNodeIndex>, Self::Error> {
        self.read(label::OWN_LEAF_NODE_INDEX, &key(group_id)?)
    }

    fn group_epoch_secrets<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        GroupEpochSecrets: traits::GroupEpochSecrets<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<Option<GroupEpochSecrets>, Self::Error> {
        self.read(label::EPOCH_SECRETS, &key(group_id)?)
    }

    fn signature_key_pair<
        SignaturePublicKey: traits::SignaturePublicKey<CURRENT_VERSION>,
        SignatureKeyPair: traits::SignatureKeyPair<CURRENT_VERSION>,
    >(
        &self,
        public_key: &SignaturePublicKey,
    ) -> Result<Option<SignatureKeyPair>, Self::Error> {
        self.read(label::SIGNATURE_KEY_PAIR, &key(public_key)?)
    }

    fn encryption_key_pair<
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
        EncryptionKey: traits::EncryptionKey<CURRENT_VERSION>,
    >(
        &self,
        public_key: &EncryptionKey,
    ) -> Result<Option<HpkeKeyPair>, Self::Error> {
        self.read(label::ENCRYPTION_KEY_PAIR, &key(public_key)?)
    }

    fn encryption_epoch_key_pairs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        EpochKey: traits::EpochKey<CURRENT_VERSION>,
        HpkeKeyPair: traits::HpkeKeyPair<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        epoch: &EpochKey,
        leaf_index: u32,
    ) -> Result<Vec<HpkeKeyPair>, Self::Error> {
        Ok(self
            .read(
                label::EPOCH_KEY_PAIRS,
                &epoch_key_pairs_key(group_id, epoch, leaf_index)?,
            )?
            .unwrap_or_default())
    }

    fn key_package<
        KeyPackageRef: traits::HashReference<CURRENT_VERSION>,
        KeyPackage: traits::KeyPackage<CURRENT_VERSION>,
    >(
        &self,
        hash_ref: &KeyPackageRef,
    ) -> Result<Option<KeyPackage>, Self::Error> {
        self.read(label::KEY_PACKAGE, &key(hash_ref)?)
    }

    fn psk<PskBundle: traits::PskBundle<CURRENT_VERSION>, PskId: traits::PskId<CURRENT_VERSION>>(
        &self,
        psk_id: &PskId,
    ) -> Result<Option<PskBundle>, Self::Error> {
        self.read(label::PSK, &key(psk_id)?)
    }

    fn remove_proposal<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        proposal_ref: &ProposalRef,
    ) -> Result<(), Self::Error> {
        self.remove_item(label::PROPOSAL_QUEUE_REFS, &key(group_id)?, proposal_ref)?;
        self.delete(label::QUEUED_PROPOSAL, &key(&(group_id, proposal_ref))?)
    }

    fn delete_own_leaf_nodes<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::OWN_LEAF_NODES, &key(group_id)?)
    }

    fn delete_group_config<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::JOIN_CONFIG, &key(group_id)?)
    }

    fn delete_tree<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::TREE, &key(group_id)?)
    }

    fn delete_confirmation_tag<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::CONFIRMATION_TAG, &key(group_id)?)
    }

    fn delete_group_state<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::GROUP_STATE, &key(group_id)?)
    }

    fn delete_context<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::GROUP_CONTEXT, &key(group_id)?)
    }

    fn delete_interim_transcript_hash<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::INTERIM_TRANSCRIPT_HASH, &key(group_id)?)
    }

    fn delete_message_secrets<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::MESSAGE_SECRETS, &key(group_id)?)
    }

    fn delete_all_resumption_psk_secrets<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::RESUMPTION_PSK_STORE, &key(group_id)?)
    }

    fn delete_own_leaf_index<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::OWN_LEAF_NODE_INDEX, &key(group_id)?)
    }

    fn delete_group_epoch_secrets<GroupId: traits::GroupId<CURRENT_VERSION>>(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        self.delete(label::EPOCH_SECRETS, &key(group_id)?)
    }

    fn clear_proposal_queue<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        ProposalRef: traits::ProposalRef<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
    ) -> Result<(), Self::Error> {
        let refs: Vec<ProposalRef> = self.read_list(label::PROPOSAL_QUEUE_REFS, &key(group_id)?)?;
        for proposal_ref in refs {
            self.delete(label::QUEUED_PROPOSAL, &key(&(group_id, &proposal_ref))?)?;
        }
        self.delete(label::PROPOSAL_QUEUE_REFS, &key(group_id)?)
    }

    fn delete_signature_key_pair<
        SignaturePublicKey: traits::SignaturePublicKey<CURRENT_VERSION>,
    >(
        &self,
        public_key: &SignaturePublicKey,
    ) -> Result<(), Self::Error> {
        self.delete(label::SIGNATURE_KEY_PAIR, &key(public_key)?)
    }

    fn delete_encryption_key_pair<EncryptionKey: traits::EncryptionKey<CURRENT_VERSION>>(
        &self,
        public_key: &EncryptionKey,
    ) -> Result<(), Self::Error> {
        self.delete(label::ENCRYPTION_KEY_PAIR, &key(public_key)?)
    }

    fn delete_encryption_epoch_key_pairs<
        GroupId: traits::GroupId<CURRENT_VERSION>,
        EpochKey: traits::EpochKey<CURRENT_VERSION>,
    >(
        &self,
        group_id: &GroupId,
        epoch: &EpochKey,
        leaf_index: u32,
    ) -> Result<(), Self::Error> {
        self.delete(
            label::EPOCH_KEY_PAIRS,
            &epoch_key_pairs_key(group_id, epoch, leaf_index)?,
        )
    }

    fn delete_key_package<KeyPackageRef: traits::HashReference<CURRENT_VERSION>>(
        &self,
        hash_ref: &KeyPackageRef,
    ) -> Result<(), Self::Error> {
        self.delete(label::KEY_PACKAGE, &key(hash_ref)?)
    }

    fn delete_psk<PskKey: traits::PskId<CURRENT_VERSION>>(
        &self,
        psk_id: &PskKey,
    ) -> Result<(), Self::Error> {
        self.delete(label::PSK, &key(psk_id)?)
    }
}
