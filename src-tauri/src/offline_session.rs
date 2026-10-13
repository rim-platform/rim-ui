//! The account this device was last signed in to, so the app can open offline.
//!
//! On a cold start the webview checks its session cookie with the server's `me` query. When
//! the server cannot be reached, this record says who was signed in, so the app skips the
//! sign-in screen and shows that account's local message cache (`message_cache`) until the
//! server answers again. The session itself stays in the webview's cookie: the record keeps who
//! the account is and the session's CSRF token, which the app sends in `X-CSRF-Token` because
//! it cannot read the cookie of a server on another host. It never keeps the session token.
//!
//! An explicit sign-out is recorded too (`SignedOut`): the next start then lands on sign-in
//! even if the server still accepts the old cookie (the sign-out request failed offline).
//!
//! The record lives in the secret vault next to the cache key, never in a plain file.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::secret_store::SecretVault;

/// Secret name of the record.
const SECRET_NAME: &str = "offline-session-v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SessionRecord {
    /// Signed in to `endpoint` as `user_id`.
    SignedIn {
        endpoint: String,
        user_id: String,
        /// The session's CSRF token from the sign-in; absent in a record written without one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        csrf_token: Option<String>,
    },
    /// The user signed out of `endpoint`.
    SignedOut { endpoint: String },
}

impl SessionRecord {
    fn endpoint(&self) -> &str {
        match self {
            Self::SignedIn { endpoint, .. } | Self::SignedOut { endpoint } => endpoint,
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.endpoint().trim().is_empty() {
            return Err("session record needs an endpoint".into());
        }
        if let Self::SignedIn { user_id, .. } = self {
            if user_id.trim().is_empty() {
                return Err("signed-in session record needs a user id".into());
            }
        }
        Ok(())
    }
}

/// The endpoint as compared: surrounding whitespace and a trailing slash do not matter.
fn same_endpoint(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

/// Where the record is kept. The secret vault in the app; memory in tests.
pub(crate) trait RecordStore: Send + Sync {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
}

pub(crate) struct VaultRecordStore(Arc<SecretVault>);

impl RecordStore for VaultRecordStore {
    fn read(&self) -> Result<Option<String>, String> {
        self.0
            .read(SECRET_NAME)
            .map(|value| value.map(|value| value.to_string()))
            .map_err(|e| e.to_string())
    }

    fn write(&self, value: &str) -> Result<(), String> {
        self.0.write(SECRET_NAME, value).map_err(|e| e.to_string())
    }
}

/// Tauri-managed state.
pub(crate) struct OfflineSessionState {
    store: Arc<dyn RecordStore>,
}

impl OfflineSessionState {
    pub(crate) fn new(store: Arc<dyn RecordStore>) -> Self {
        Self { store }
    }

    /// The record for `endpoint`, or `None` when there is none, it is about another server,
    /// or it cannot be read (a record nobody can read is no record).
    fn load(&self, endpoint: &str) -> Option<SessionRecord> {
        let raw = match self.store.read() {
            Ok(Some(raw)) => raw,
            Ok(None) => return None,
            Err(e) => {
                log::warn!("[offline_session] {e}");
                return None;
            }
        };
        let record: SessionRecord = match serde_json::from_str(&raw) {
            Ok(record) => record,
            Err(e) => {
                log::warn!("[offline_session] stored record is not readable: {e}");
                return None;
            }
        };
        if record.validate().is_err() || !same_endpoint(record.endpoint(), endpoint) {
            return None;
        }
        Some(record)
    }

    fn save(&self, record: &SessionRecord) -> Result<(), String> {
        record.validate()?;
        let raw = serde_json::to_string(record).map_err(|e| e.to_string())?;
        self.store.write(&raw)
    }
}

pub(crate) fn init(vault: Arc<SecretVault>) -> OfflineSessionState {
    OfflineSessionState::new(Arc::new(VaultRecordStore(vault)))
}

/// The session record for the server at `endpoint`, or null when there is none.
#[tauri::command]
pub async fn offline_session_load(
    state: State<'_, OfflineSessionState>,
    endpoint: String,
) -> Result<Option<SessionRecord>, String> {
    let state = OfflineSessionState::new(state.store.clone());
    tauri::async_runtime::spawn_blocking(move || state.load(&endpoint))
        .await
        .map_err(|e| format!("offline session task failed: {e}"))
}

/// Replace the session record: on every sign-in, and on an explicit sign-out.
#[tauri::command]
pub async fn offline_session_save(
    state: State<'_, OfflineSessionState>,
    record: SessionRecord,
) -> Result<(), String> {
    let state = OfflineSessionState::new(state.store.clone());
    tauri::async_runtime::spawn_blocking(move || state.save(&record))
        .await
        .map_err(|e| format!("offline session task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct MemoryStore(Mutex<Option<String>>);

    impl RecordStore for MemoryStore {
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }

        fn write(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
    }

    struct BrokenStore;

    impl RecordStore for BrokenStore {
        fn read(&self) -> Result<Option<String>, String> {
            Err("no secret store".into())
        }

        fn write(&self, _value: &str) -> Result<(), String> {
            Err("no secret store".into())
        }
    }

    const ENDPOINT: &str = "http://localhost:8080/api";

    fn signed_in(user: &str) -> SessionRecord {
        SessionRecord::SignedIn {
            endpoint: ENDPOINT.into(),
            user_id: user.into(),
            csrf_token: None,
        }
    }

    fn memory_state() -> (Arc<MemoryStore>, OfflineSessionState) {
        let store = Arc::new(MemoryStore::default());
        (store.clone(), OfflineSessionState::new(store))
    }

    #[test]
    fn nothing_saved_loads_nothing() {
        let (_, state) = memory_state();
        assert_eq!(state.load(ENDPOINT), None);
    }

    #[test]
    fn a_sign_in_round_trips() {
        let (_, state) = memory_state();
        state.save(&signed_in("user-1")).unwrap();
        assert_eq!(state.load(ENDPOINT), Some(signed_in("user-1")));
    }

    #[test]
    fn a_sign_out_replaces_the_sign_in() {
        let (_, state) = memory_state();
        state.save(&signed_in("user-1")).unwrap();
        let signed_out = SessionRecord::SignedOut {
            endpoint: ENDPOINT.into(),
        };
        state.save(&signed_out).unwrap();
        assert_eq!(state.load(ENDPOINT), Some(signed_out));
    }

    #[test]
    fn the_record_is_only_for_its_own_server() {
        let (_, state) = memory_state();
        state.save(&signed_in("user-1")).unwrap();
        assert_eq!(state.load("https://other.example/api"), None);
        // A trailing slash is the same server.
        assert_eq!(
            state.load(&format!("{ENDPOINT}/")),
            Some(signed_in("user-1"))
        );
    }

    #[test]
    fn the_wire_shape_is_tagged_camel_case() {
        let json = serde_json::to_value(signed_in("user-1")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "state": "signedIn", "endpoint": ENDPOINT, "userId": "user-1" })
        );
        let parsed: SessionRecord = serde_json::from_value(
            serde_json::json!({ "state": "signedOut", "endpoint": ENDPOINT }),
        )
        .unwrap();
        assert_eq!(
            parsed,
            SessionRecord::SignedOut {
                endpoint: ENDPOINT.into()
            }
        );
    }

    #[test]
    fn the_csrf_token_round_trips_and_may_be_absent() {
        let (_, state) = memory_state();
        let with_token = SessionRecord::SignedIn {
            endpoint: ENDPOINT.into(),
            user_id: "user-1".into(),
            csrf_token: Some("tok".into()),
        };
        state.save(&with_token).unwrap();
        assert_eq!(state.load(ENDPOINT), Some(with_token.clone()));
        assert_eq!(
            serde_json::to_value(&with_token).unwrap()["csrfToken"],
            serde_json::json!("tok")
        );
        let parsed: SessionRecord = serde_json::from_value(
            serde_json::json!({ "state": "signedIn", "endpoint": ENDPOINT, "userId": "user-1" }),
        )
        .unwrap();
        assert_eq!(parsed, signed_in("user-1"));
    }

    #[test]
    fn incomplete_records_are_refused() {
        let (_, state) = memory_state();
        assert!(state.save(&signed_in("  ")).is_err());
        assert!(state
            .save(&SessionRecord::SignedOut {
                endpoint: String::new()
            })
            .is_err());
        assert_eq!(state.load(ENDPOINT), None);
    }

    #[test]
    fn an_unreadable_record_is_no_record() {
        let (store, state) = memory_state();
        store.write("not json").unwrap();
        assert_eq!(state.load(ENDPOINT), None);
        store
            .write(r#"{"state":"signedIn","endpoint":"http://localhost:8080/api","userId":""}"#)
            .unwrap();
        assert_eq!(state.load(ENDPOINT), None);
    }

    #[test]
    fn a_store_failure_loads_nothing_and_reports_on_save() {
        let state = OfflineSessionState::new(Arc::new(BrokenStore));
        assert_eq!(state.load(ENDPOINT), None);
        assert!(state.save(&signed_in("user-1")).is_err());
    }
}
