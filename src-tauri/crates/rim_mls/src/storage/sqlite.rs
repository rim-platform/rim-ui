//! Group state in SQLite, inside a transaction the caller owns.

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::sealed::{Backend, Entries, Sealed};
use super::{StorageError, Store};

/// The table group state lives in. The app applies it as one step of its database's schema
/// versioning; this crate never creates or migrates tables itself.
///
/// One row per entry: `label` names the kind (`openmls.v1.*` for OpenMLS state, `rim.*` for
/// this crate's records), `key` and `value` are bytes. The table holds private keys, so it only
/// belongs in an encrypted (SQLCipher) database.
pub const SCHEMA: &str = "
CREATE TABLE mls_storage (
    label TEXT NOT NULL,
    key   BLOB NOT NULL,
    value BLOB NOT NULL,
    PRIMARY KEY (label, key)
) WITHOUT ROWID;
";

/// A store over an open SQLite transaction. Every read and write of an operation goes through
/// the transaction, and nothing is committed here: the caller commits once it has also stored
/// what the operation produced (a decrypted message, an outgoing envelope), or drops the
/// transaction to undo both.
pub struct SqliteStore<'t> {
    conn: &'t Connection,
}

impl<'t> SqliteStore<'t> {
    pub fn new(transaction: &'t Transaction<'_>) -> Self {
        Self { conn: transaction }
    }
}

fn db_error(e: rusqlite::Error) -> StorageError {
    StorageError(format!("sqlite: {e}"))
}

impl Backend for SqliteStore<'_> {
    fn get(&self, label: &str, key: &[u8]) -> Result<Option<Vec<u8>>, StorageError> {
        self.conn
            .prepare_cached("SELECT value FROM mls_storage WHERE label = ?1 AND key = ?2")
            .and_then(|mut stmt| {
                stmt.query_row(params![label, key], |row| row.get(0))
                    .optional()
            })
            .map_err(db_error)
    }

    fn put(&self, label: &str, key: &[u8], value: &[u8]) -> Result<(), StorageError> {
        self.conn
            .prepare_cached(
                "INSERT INTO mls_storage (label, key, value) VALUES (?1, ?2, ?3)
                 ON CONFLICT (label, key) DO UPDATE SET value = excluded.value",
            )
            .and_then(|mut stmt| stmt.execute(params![label, key, value]))
            .map(|_| ())
            .map_err(db_error)
    }

    fn delete(&self, label: &str, key: &[u8]) -> Result<(), StorageError> {
        self.conn
            .prepare_cached("DELETE FROM mls_storage WHERE label = ?1 AND key = ?2")
            .and_then(|mut stmt| stmt.execute(params![label, key]))
            .map(|_| ())
            .map_err(db_error)
    }

    fn list(&self, label: &str) -> Result<Entries, StorageError> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT key, value FROM mls_storage WHERE label = ?1 ORDER BY key")
            .map_err(db_error)?;
        let rows = stmt
            .query_map(params![label], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }
}

impl Sealed for SqliteStore<'_> {
    fn backend(&self) -> &dyn Backend {
        self
    }
}

impl Store for SqliteStore<'_> {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_live_and_die_with_the_transaction() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();

        let tx = conn.transaction().unwrap();
        let store = SqliteStore::new(&tx);
        store.put("a", b"1", b"one").unwrap();
        assert_eq!(store.get("a", b"1").unwrap(), Some(b"one".to_vec()));
        drop(tx);

        let tx = conn.transaction().unwrap();
        let store = SqliteStore::new(&tx);
        assert_eq!(store.get("a", b"1").unwrap(), None);
        store.put("a", b"1", b"one").unwrap();
        store.put("a", b"1", b"uno").unwrap();
        store.put("b", b"2", b"two").unwrap();
        tx.commit().unwrap();

        let tx = conn.transaction().unwrap();
        let store = SqliteStore::new(&tx);
        assert_eq!(
            store.list("a").unwrap(),
            vec![(b"1".to_vec(), b"uno".to_vec())]
        );
        store.delete("b", b"2").unwrap();
        assert_eq!(store.get("b", b"2").unwrap(), None);
    }
}
