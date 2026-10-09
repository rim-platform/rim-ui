//! Group state in memory: for tests, and for the web build, which writes the changed entries
//! through to IndexedDB.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

use super::sealed::{Backend, Entries, Sealed};
use super::{StorageError, Store};

type EntryKey = (String, Vec<u8>);

/// An entry an operation changed: its new value, or `None` when it was deleted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub label: String,
    pub key: Vec<u8>,
    pub value: Option<Vec<u8>>,
}

/// A store in memory. Writes apply at once and are journaled: [`MemoryStore::commit`] hands out
/// what changed since the last commit (to persist it), [`MemoryStore::rollback`] undoes it, so an
/// operation that fails, or whose result is dropped, can be taken back like a transaction.
#[derive(Debug, Default)]
pub struct MemoryStore {
    inner: Mutex<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    entries: BTreeMap<EntryKey, Vec<u8>>,
    /// The value each changed entry had at the last commit.
    journal: BTreeMap<EntryKey, Option<Vec<u8>>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Keep everything written since the last commit, and return those entries.
    pub fn commit(&self) -> Vec<Change> {
        let changes = self.pending();
        self.lock().journal.clear();
        changes
    }

    /// The entries written since the last commit, without committing them: what to persist
    /// before calling [`MemoryStore::commit`] (or [`MemoryStore::rollback`] if that fails).
    pub fn pending(&self) -> Vec<Change> {
        let inner = self.lock();
        inner
            .journal
            .keys()
            .map(|(label, key)| Change {
                label: label.clone(),
                key: key.clone(),
                value: inner.entries.get(&(label.clone(), key.clone())).cloned(),
            })
            .collect()
    }

    /// Undo everything written since the last commit.
    pub fn rollback(&self) {
        let mut inner = self.lock();
        let journal = std::mem::take(&mut inner.journal);
        for (entry, original) in journal {
            match original {
                Some(value) => inner.entries.insert(entry, value),
                None => inner.entries.remove(&entry),
            };
        }
    }

    /// Every committed entry, to persist the whole store or copy it into another.
    pub fn export(&self) -> Vec<Change> {
        let inner = self.lock();
        let mut entries = inner.entries.clone();
        for (entry, original) in &inner.journal {
            match original {
                Some(value) => entries.insert(entry.clone(), value.clone()),
                None => entries.remove(entry),
            };
        }
        entries
            .into_iter()
            .map(|((label, key), value)| Change {
                label,
                key,
                value: Some(value),
            })
            .collect()
    }

    /// A store holding `entries` (as [`MemoryStore::export`] returns them), all committed.
    pub fn import(entries: impl IntoIterator<Item = Change>) -> Self {
        let store = Self::new();
        {
            let mut inner = store.lock();
            for change in entries {
                if let Some(value) = change.value {
                    inner.entries.insert((change.label, change.key), value);
                }
            }
        }
        store
    }

    fn record(inner: &mut Inner, entry: &EntryKey) {
        if !inner.journal.contains_key(entry) {
            let original = inner.entries.get(entry).cloned();
            inner.journal.insert(entry.clone(), original);
        }
    }
}

impl Backend for MemoryStore {
    fn get(&self, label: &str, key: &[u8]) -> Result<Option<Vec<u8>>, StorageError> {
        Ok(self
            .lock()
            .entries
            .get(&(label.to_string(), key.to_vec()))
            .cloned())
    }

    fn put(&self, label: &str, key: &[u8], value: &[u8]) -> Result<(), StorageError> {
        let mut inner = self.lock();
        let entry = (label.to_string(), key.to_vec());
        Self::record(&mut inner, &entry);
        inner.entries.insert(entry, value.to_vec());
        Ok(())
    }

    fn delete(&self, label: &str, key: &[u8]) -> Result<(), StorageError> {
        let mut inner = self.lock();
        let entry = (label.to_string(), key.to_vec());
        if inner.entries.contains_key(&entry) {
            Self::record(&mut inner, &entry);
            inner.entries.remove(&entry);
        }
        Ok(())
    }

    fn list(&self, label: &str) -> Result<Entries, StorageError> {
        Ok(self
            .lock()
            .entries
            .iter()
            .filter(|((entry_label, _), _)| entry_label == label)
            .map(|((_, key), value)| (key.clone(), value.clone()))
            .collect())
    }
}

impl Sealed for MemoryStore {
    fn backend(&self) -> &dyn Backend {
        self
    }
}

impl Store for MemoryStore {}

#[cfg(test)]
mod tests {
    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    use super::*;

    #[test]
    fn rollback_restores_and_commit_reports_changes() {
        let store = MemoryStore::new();
        store.put("a", b"1", b"one").unwrap();
        store.put("a", b"2", b"two").unwrap();
        let changes = store.commit();
        assert_eq!(changes.len(), 2);

        store.put("a", b"1", b"uno").unwrap();
        store.delete("a", b"2").unwrap();
        store.put("b", b"3", b"three").unwrap();
        store.rollback();
        assert_eq!(store.get("a", b"1").unwrap(), Some(b"one".to_vec()));
        assert_eq!(store.get("a", b"2").unwrap(), Some(b"two".to_vec()));
        assert_eq!(store.get("b", b"3").unwrap(), None);

        store.delete("a", b"2").unwrap();
        assert_eq!(store.pending().len(), 1);
        assert_eq!(store.pending().len(), 1);
        let changes = store.commit();
        assert_eq!(
            changes,
            vec![Change {
                label: "a".into(),
                key: b"2".to_vec(),
                value: None
            }]
        );
        assert!(store.commit().is_empty());
    }

    #[test]
    fn export_leaves_out_uncommitted_writes() {
        let store = MemoryStore::new();
        store.put("a", b"1", b"one").unwrap();
        store.commit();
        store.put("a", b"1", b"changed").unwrap();
        let copy = MemoryStore::import(store.export());
        assert_eq!(copy.get("a", b"1").unwrap(), Some(b"one".to_vec()));
        assert_eq!(copy.list("a").unwrap().len(), 1);
    }
}
