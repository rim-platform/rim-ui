//! Last-known copies of what the app needs to open offline: the signed-in user, their
//! workspaces, and each workspace's sidebar lists (joined channels, DMs) and member directory.
//!
//! The webview saves each list whenever the server answers it and reads it back when the
//! server cannot be reached, so a cold start without network still shows the sidebar next to
//! the cached history. Values are the GraphQL answers as the UI holds them (opaque JSON here),
//! kept in the same encrypted database as the messages.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::store::CacheStore;
use super::CacheError;

/// Schema v4: the `snapshot` table (after the history archive's v3).
///
/// Account-wide snapshots (the user, the workspace list) have an empty `workspace_id`.
pub(super) const SCHEMA_SNAPSHOT: &str = "
CREATE TABLE snapshot (
    workspace_id TEXT NOT NULL,
    kind         TEXT NOT NULL,
    -- The answer as JSON.
    value        TEXT NOT NULL,
    -- Unix milliseconds.
    saved_at     INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, kind)
);
";

/// A snapshot larger than this is not kept (a sidebar list is a few hundred KiB at most).
const MAX_VALUE_BYTES: usize = 8 * 1024 * 1024;

/// What a snapshot holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SnapshotKind {
    /// The signed-in user (`me`). Account-wide.
    Me,
    /// The user's workspaces (`myServers`). Account-wide.
    Servers,
    /// The sidebar's channel list (`channels`, joined only).
    JoinedChannels,
    /// The sidebar's DM list (`inboxConversations`).
    Inbox,
    /// The workspace's member directory (`serverMembers`), for names and avatars.
    Members,
}

impl SnapshotKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Me => "me",
            Self::Servers => "servers",
            Self::JoinedChannels => "joinedChannels",
            Self::Inbox => "inbox",
            Self::Members => "members",
        }
    }

    fn is_account_wide(self) -> bool {
        matches!(self, Self::Me | Self::Servers)
    }

    /// The `workspace_id` column for this kind: empty for account-wide kinds, which take no
    /// workspace; required for the others.
    fn scope(self, workspace_id: Option<&str>) -> Result<String, CacheError> {
        match (self.is_account_wide(), workspace_id.map(str::trim)) {
            (true, None) => Ok(String::new()),
            (true, Some(_)) => Err(CacheError::Invalid(format!(
                "snapshot {} is not per workspace",
                self.as_str()
            ))),
            (false, Some(id)) if !id.is_empty() => Ok(id.to_string()),
            (false, _) => Err(CacheError::Invalid(format!(
                "snapshot {} needs a workspace",
                self.as_str()
            ))),
        }
    }
}

/// A snapshot as read back.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub value: serde_json::Value,
    /// Unix milliseconds of when it was saved.
    pub saved_at: i64,
}

impl CacheStore {
    /// Keep `value` as the latest `kind` snapshot, replacing the previous one.
    pub(crate) fn put_snapshot(
        &mut self,
        kind: SnapshotKind,
        workspace_id: Option<&str>,
        value: &serde_json::Value,
        now_ms: i64,
    ) -> Result<(), CacheError> {
        let scope = kind.scope(workspace_id)?;
        let json = serde_json::to_string(value)?;
        if json.len() > MAX_VALUE_BYTES {
            return Err(CacheError::Invalid(format!(
                "snapshot {} is {} bytes, over the {MAX_VALUE_BYTES} byte limit",
                kind.as_str(),
                json.len()
            )));
        }
        self.conn.execute(
            "INSERT INTO snapshot (workspace_id, kind, value, saved_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (workspace_id, kind)
             DO UPDATE SET value = excluded.value, saved_at = excluded.saved_at",
            params![scope, kind.as_str(), json, now_ms],
        )?;
        Ok(())
    }

    /// The latest `kind` snapshot, or `None` when none was saved on this device.
    pub(crate) fn get_snapshot(
        &self,
        kind: SnapshotKind,
        workspace_id: Option<&str>,
    ) -> Result<Option<Snapshot>, CacheError> {
        let scope = kind.scope(workspace_id)?;
        let row: Option<(String, i64)> = self
            .conn
            .query_row(
                "SELECT value, saved_at FROM snapshot WHERE workspace_id = ?1 AND kind = ?2",
                params![scope, kind.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        row.map(|(value, saved_at)| {
            Ok(Snapshot {
                value: serde_json::from_str(&value)?,
                saved_at,
            })
        })
        .transpose()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::key::CacheKey;
    use super::super::AccountId;
    use super::*;

    const WS: &str = "ws-1";

    fn account(user: &str) -> AccountId {
        AccountId {
            endpoint: "http://localhost:8080/api".into(),
            user_id: user.into(),
        }
    }

    fn open(dir: &std::path::Path, user: &str) -> CacheStore {
        let key = CacheKey::from_bytes([3; 32]);
        CacheStore::open(&dir.join(format!("{user}.db")), &key, &account(user)).unwrap()
    }

    #[test]
    fn a_saved_snapshot_reads_back_and_the_next_one_replaces_it() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = open(dir.path(), "alice");
        assert_eq!(
            store
                .get_snapshot(SnapshotKind::JoinedChannels, Some(WS))
                .unwrap(),
            None
        );

        let first = json!({ "items": [{ "id": "c1", "title": "general" }] });
        store
            .put_snapshot(SnapshotKind::JoinedChannels, Some(WS), &first, 10)
            .unwrap();
        let second = json!({ "items": [{ "id": "c2", "title": "random" }] });
        store
            .put_snapshot(SnapshotKind::JoinedChannels, Some(WS), &second, 20)
            .unwrap();

        assert_eq!(
            store
                .get_snapshot(SnapshotKind::JoinedChannels, Some(WS))
                .unwrap(),
            Some(Snapshot {
                value: second,
                saved_at: 20
            })
        );
    }

    #[test]
    fn snapshots_are_per_kind_and_per_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = open(dir.path(), "alice");
        store
            .put_snapshot(SnapshotKind::Inbox, Some(WS), &json!(["dm in ws-1"]), 1)
            .unwrap();
        store
            .put_snapshot(SnapshotKind::Servers, None, &json!([{ "id": WS }]), 1)
            .unwrap();

        assert_eq!(
            store
                .get_snapshot(SnapshotKind::Inbox, Some("ws-2"))
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .get_snapshot(SnapshotKind::JoinedChannels, Some(WS))
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .get_snapshot(SnapshotKind::Inbox, Some(WS))
                .unwrap()
                .map(|s| s.value),
            Some(json!(["dm in ws-1"]))
        );
        assert_eq!(
            store
                .get_snapshot(SnapshotKind::Servers, None)
                .unwrap()
                .map(|s| s.value),
            Some(json!([{ "id": WS }]))
        );
    }

    #[test]
    fn the_workspace_is_required_exactly_for_per_workspace_kinds() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = open(dir.path(), "alice");
        let value = json!({});
        for (kind, workspace) in [
            (SnapshotKind::Me, Some(WS)),
            (SnapshotKind::Servers, Some(WS)),
            (SnapshotKind::JoinedChannels, None),
            (SnapshotKind::Inbox, Some("  ")),
            (SnapshotKind::Members, None),
        ] {
            assert!(matches!(
                store.put_snapshot(kind, workspace, &value, 1),
                Err(CacheError::Invalid(_))
            ));
            assert!(matches!(
                store.get_snapshot(kind, workspace),
                Err(CacheError::Invalid(_))
            ));
        }
    }

    #[test]
    fn an_oversized_snapshot_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = open(dir.path(), "alice");
        let huge = json!("x".repeat(MAX_VALUE_BYTES + 1));
        assert!(matches!(
            store.put_snapshot(SnapshotKind::Members, Some(WS), &huge, 1),
            Err(CacheError::Invalid(_))
        ));
        assert_eq!(
            store.get_snapshot(SnapshotKind::Members, Some(WS)).unwrap(),
            None
        );
    }

    #[test]
    fn snapshots_belong_to_their_account() {
        let dir = tempfile::tempdir().unwrap();
        let mut alice = open(dir.path(), "alice");
        alice
            .put_snapshot(SnapshotKind::Me, None, &json!({ "id": "alice" }), 1)
            .unwrap();
        let bob = open(dir.path(), "bob");
        assert_eq!(bob.get_snapshot(SnapshotKind::Me, None).unwrap(), None);
    }

    #[test]
    fn a_cache_at_the_archive_schema_gains_the_snapshot_table() {
        let dir = tempfile::tempdir().unwrap();
        // Take a fresh cache back to v3, as the history archive build left it.
        {
            let store = open(dir.path(), "alice");
            store
                .conn
                .execute_batch(
                    "DROP TABLE snapshot; DROP TABLE mls_storage; PRAGMA user_version = 3;",
                )
                .unwrap();
        }

        let mut store = open(dir.path(), "alice");
        let version: i32 = store
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, crate::message_cache::store::SCHEMA_VERSION);
        // The archive's v3 tables are still there.
        let counter: i64 = store
            .conn
            .query_row("SELECT count(*) FROM change_counter", [], |row| row.get(0))
            .unwrap();
        assert_eq!(counter, 1);
        store
            .put_snapshot(SnapshotKind::Me, None, &json!({ "id": "alice" }), 1)
            .unwrap();
        assert_eq!(
            store
                .get_snapshot(SnapshotKind::Me, None)
                .unwrap()
                .map(|s| s.value),
            Some(json!({ "id": "alice" }))
        );
    }

    #[test]
    fn the_kind_names_match_the_ui() {
        for (name, kind) in [
            ("me", SnapshotKind::Me),
            ("servers", SnapshotKind::Servers),
            ("joinedChannels", SnapshotKind::JoinedChannels),
            ("inbox", SnapshotKind::Inbox),
            ("members", SnapshotKind::Members),
        ] {
            let parsed: SnapshotKind = serde_json::from_value(json!(name)).unwrap();
            assert_eq!(parsed, kind);
            assert_eq!(kind.as_str(), name);
        }
    }
}
