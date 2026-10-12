//! Length checks on the HPKE public keys of other devices. The libcrux X-Wing decoder panics on a
//! public key shorter than its type, and neither OpenMLS nor the server checks the length, so
//! every key this device could encrypt to is checked before OpenMLS uses it.

use openmls::prelude::tls_codec::{DeserializeBytes as _, Serialize, VLBytes};
use openmls::prelude::{KeyPackage, LeafNode, LeafNodeIndex, MlsGroup, Node, ParentNode};
use openmls::treesync::RatchetTree;

use crate::error::{Error, Result};

/// Bytes of an X-Wing public key: the ML-KEM-768 encapsulation key (1,184) and the X25519 key.
pub(crate) const XWING_PUBLIC_KEY_LEN: usize = 1184 + 32;

fn check(what: impl FnOnce() -> String, len: usize) -> Result<()> {
    if len == XWING_PUBLIC_KEY_LEN {
        Ok(())
    } else {
        Err(Error::InvalidPeerKey { what: what(), len })
    }
}

/// The length of the variable-length byte string `value` encodes first. Leaf encryption keys and
/// parent nodes keep their key private, but their TLS encoding starts with it.
fn leading_bytes_len(value: &impl Serialize) -> Result<usize> {
    let encoded = value.tls_serialize_detached().map_err(Error::mls)?;
    let (bytes, _) = VLBytes::tls_deserialize_bytes(&encoded).map_err(Error::mls)?;
    Ok(bytes.as_slice().len())
}

fn check_leaf(leaf: &LeafNode, what: impl FnOnce() -> String) -> Result<()> {
    check(what, leading_bytes_len(leaf.encryption_key())?)
}

fn check_parent(parent: &ParentNode, what: impl FnOnce() -> String) -> Result<()> {
    check(what, leading_bytes_len(parent)?)
}

/// Check a key package's init key and its leaf's encryption key. `device` names it in the error.
pub(crate) fn check_key_package(key_package: &KeyPackage, device: &str) -> Result<()> {
    check(
        || format!("init key of {device}'s key package"),
        key_package.hpke_init_key().as_slice().len(),
    )?;
    check_leaf(key_package.leaf_node(), || {
        format!("encryption key of {device}'s key package")
    })
}

/// Check every encryption key in a ratchet tree.
pub(crate) fn check_tree(tree: &RatchetTree) -> Result<()> {
    for node in tree.nodes() {
        match node {
            Node::LeafNode(leaf) => check_leaf(leaf, || "leaf encryption key".into())?,
            Node::ParentNode(parent) => check_parent(parent, || "parent node key".into())?,
        }
    }
    Ok(())
}

/// Whether parent node `parent` lies on the direct path of `leaf`: its subtree, the nodes within
/// `2^level - 1` of it in the array representation, holds the leaf.
fn on_direct_path(parent: u32, leaf: LeafNodeIndex) -> bool {
    let node = 2 * parent + 1;
    let level = node.trailing_ones();
    node.abs_diff(2 * leaf.u32()) < 1 << level
}

/// Check the keys a Commit of this device that removes `removed` could encrypt to: every key in
/// the group's tree except this device's own leaf and direct path, which the Commit replaces, and
/// the removed leaves and their direct paths, which it blanks.
pub(crate) fn check_commit_targets(group: &MlsGroup, removed: &[LeafNodeIndex]) -> Result<()> {
    let own = group.own_leaf_index();
    let tree = group.public_group().treesync();
    for (index, leaf) in tree.full_leaves() {
        if index != own && !removed.contains(&index) {
            check_leaf(leaf, || format!("encryption key of leaf {}", index.u32()))?;
        }
    }
    for (index, parent) in tree.full_parents() {
        let replaced = on_direct_path(index.u32(), own)
            || removed
                .iter()
                .any(|leaf| on_direct_path(index.u32(), *leaf));
        if !replaced {
            check_parent(parent, || format!("key of parent node {}", index.u32()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_paths_follow_the_array_representation() {
        // Eight leaves: leaf 5 (node 10) has parents 11 (index 5), 9 (index 4), 7 (index 3).
        let path: Vec<u32> = (0..7)
            .filter(|&p| on_direct_path(p, LeafNodeIndex::new(5)))
            .collect();
        assert_eq!(path, vec![3, 4, 5]);
        // Leaf 0 (node 0): parents 1 (index 0), 3 (index 1), 7 (index 3).
        let path: Vec<u32> = (0..7)
            .filter(|&p| on_direct_path(p, LeafNodeIndex::new(0)))
            .collect();
        assert_eq!(path, vec![0, 1, 3]);
    }
}
