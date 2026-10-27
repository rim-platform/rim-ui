//! The account lock on the desktop: the password check and each account's data key.
//!
//! Every account on this device has a data key (32 random bytes) that seals what the device
//! keeps for it. The key is held in memory only while the account is unlocked; at rest it is
//! wrapped (AES-256-GCM, `rim_opaque`) under each way of opening it:
//!
//! - the password wrap, under the unlock key the password's OPAQUE login and the server share
//!   give;
//! - the recovery wrap, under a key of the recovery phrase, on a device that held the phrase;
//! - the keep wrap of "Keep me signed in", under a keep key that lives in the secret vault, so
//!   a kept account opens without the server.
//!
//! The wraps are one secret vault record per account (`account-dk-v1:<principal>`), the keep
//! key another (`account-keep-v1:<principal>`). An OPAQUE flow runs here, not in the webview:
//! the webview gets a handle and the messages to send, and the export key and session key stay
//! in this process until the unlock that uses them. A handle lasts two minutes and serves once.

pub(crate) mod commands;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rim_opaque::keys::RECOVERY_ENTROPY_LEN;
use rim_opaque::{
    ClientLoginFlow, ClientRegistrationFlow, Key, OpaqueKey, StoreKeyLabel, TransportLabel,
    WrapKind, KEY_LEN,
};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::secret_store::SecretVault;

/// How long a handle of an OPAQUE flow lasts after its start.
const HANDLE_LIFETIME: Duration = Duration::from_secs(120);

fn wraps_name(principal_id: &str) -> String {
    format!("account-dk-v1:{principal_id}")
}

fn keep_name(principal_id: &str) -> String {
    format!("account-keep-v1:{principal_id}")
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum AccountLockError {
    /// The login did not verify: a wrong password, or none for the account.
    #[error("the password is wrong")]
    WrongPassword,
    /// The handle expired, was used, or never existed.
    #[error("this sign-in step expired or already finished; start again")]
    NoHandle,
    /// No wrap opens with this login, and the device holds a recovery wrap: what it kept for
    /// the account opens only with the recovery phrase, or the person chooses to start empty.
    #[error("this device's data for the account needs the recovery phrase")]
    NeedsRecovery,
    /// The account's data key is not in memory: nothing it seals opens until an unlock.
    #[error("this account is locked on this computer; sign in to unlock it")]
    Locked,
    /// The account's key record does not open under the data key the unlock opened, which is
    /// not new: the account is locked again and the record stays as it was.
    #[error("the keys on this computer for that account do not open with its data key")]
    KeysUnopened,
    #[error("{0}")]
    Invalid(String),
    #[error("key storage: {0}")]
    Vault(String),
    #[error("crypto: {0}")]
    Crypto(String),
}

impl AccountLockError {
    fn code(&self) -> &'static str {
        match self {
            Self::WrongPassword => "WRONG_PASSWORD",
            Self::NoHandle => "NO_HANDLE",
            Self::NeedsRecovery => "NEEDS_RECOVERY",
            Self::Locked => "LOCKED",
            Self::KeysUnopened => "KEYS_UNOPENED",
            Self::Invalid(_) => "INVALID",
            Self::Vault(_) => "VAULT",
            Self::Crypto(_) => "CRYPTO",
        }
    }
}

/// Serialized as `{ kind, message }`, the shape `safeInvoke` narrows.
impl Serialize for AccountLockError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AccountLockError", 2)?;
        s.serialize_field("kind", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<rim_opaque::Error> for AccountLockError {
    fn from(e: rim_opaque::Error) -> Self {
        match e {
            rim_opaque::Error::WrongPassword => Self::WrongPassword,
            rim_opaque::Error::Malformed(what) => Self::Invalid(format!("malformed {what}")),
            other => Self::Crypto(other.to_string()),
        }
    }
}

type Result<T> = std::result::Result<T, AccountLockError>;

/// Raw secret storage, by name. The secret vault in the app; memory in tests.
pub(crate) trait SecretStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>>;
    fn write(&self, name: &str, value: &str) -> Result<()>;
    /// Deleting what is not there is not an error.
    fn delete(&self, name: &str) -> Result<()>;
}

/// The secrets in the app's secret vault.
pub(crate) struct VaultSecretStore(pub(crate) Arc<SecretVault>);

impl SecretStore for VaultSecretStore {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>> {
        self.0
            .read(name)
            .map_err(|e| AccountLockError::Vault(e.to_string()))
    }

    fn write(&self, name: &str, value: &str) -> Result<()> {
        self.0
            .write(name, value)
            .map_err(|e| AccountLockError::Vault(e.to_string()))
    }

    fn delete(&self, name: &str) -> Result<()> {
        self.0
            .delete(name)
            .map_err(|e| AccountLockError::Vault(e.to_string()))
    }
}

/// The wraps of one account's data key, as stored: base64url of `nonce ‖ ciphertext ‖ tag`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataKeyWraps {
    pub(crate) password_wrap: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) recovery_wrap: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) keep_wrap: Option<String>,
}

/// A handle's request: the flow's id and the OPAQUE message to send, base64url.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlowStart {
    pub(crate) handle: String,
    pub(crate) request: String,
}

/// What a registration's finish gives the webview: the `RegistrationUpload`, base64url.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistrationFinish {
    pub(crate) upload: String,
}

/// What a login's finish gives the webview: the `CredentialFinalization`, base64url.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginFinish {
    pub(crate) finalization: String,
}

/// What a password change's rewrap gives the webview: the old unlock key sealed under the new
/// one, base64url, for `passwordChangeFinish`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Rewrap {
    pub(crate) rewrap: String,
}

/// An unlocked account, as the webview sees it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Unlocked {
    /// base64url of the key that seals the webview's IndexedDB records of the account.
    pub(crate) web_store_key: Zeroizing<String>,
    /// The data key is new: what the device kept for the account under an earlier one no
    /// longer opens.
    pub(crate) started_empty: bool,
    /// The server share this unlock opened, which wraps the device key; never sent to the
    /// webview.
    #[serde(skip)]
    pub(crate) share: Option<Key>,
}

/// Where one OPAQUE flow is.
enum Stage {
    Registering {
        flow: Box<ClientRegistrationFlow>,
        password: Zeroizing<Vec<u8>>,
    },
    Registered {
        export_key: OpaqueKey,
    },
    LoggingIn {
        flow: Box<ClientLoginFlow>,
        password: Zeroizing<Vec<u8>>,
    },
    LoggedIn {
        export_key: OpaqueKey,
        session_key: OpaqueKey,
    },
    /// A password change whose rewrap is made: the new unlock key, to wrap the data key under
    /// once the server took the change.
    Rewrapped {
        principal_id: String,
        unlock_key: Key,
    },
}

struct Handle {
    stage: Stage,
    expires: Instant,
}

/// Tauri-managed state. Clones share everything.
#[derive(Clone)]
pub(crate) struct AccountLock {
    store: Arc<dyn SecretStore>,
    /// The data keys of the unlocked accounts, by principal id.
    unlocked: Arc<Mutex<HashMap<String, Key>>>,
    /// OPAQUE flows between their steps, by handle.
    handles: Arc<Mutex<HashMap<String, Handle>>>,
    /// Serializes read-modify-write of the stored wraps.
    records: Arc<Mutex<()>>,
}

pub(crate) fn init(vault: Arc<SecretVault>) -> AccountLock {
    AccountLock::new(Arc::new(VaultSecretStore(vault)))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn unb64(text: &str, what: &str) -> Result<Zeroizing<Vec<u8>>> {
    URL_SAFE_NO_PAD
        .decode(text.trim())
        .map(Zeroizing::new)
        .map_err(|_| AccountLockError::Invalid(format!("{what} is not base64url")))
}

fn key_of(bytes: &[u8], what: &str) -> Result<Key> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    if bytes.len() != KEY_LEN {
        return Err(AccountLockError::Invalid(format!(
            "{what} must be {KEY_LEN} bytes"
        )));
    }
    key.copy_from_slice(bytes);
    Ok(key)
}

fn entropy_of(text: &str) -> Result<Zeroizing<[u8; RECOVERY_ENTROPY_LEN]>> {
    let bytes = unb64(text, "the recovery entropy")?;
    let mut entropy = Zeroizing::new([0u8; RECOVERY_ENTROPY_LEN]);
    if bytes.len() != RECOVERY_ENTROPY_LEN {
        return Err(AccountLockError::Invalid(format!(
            "the recovery entropy must be {RECOVERY_ENTROPY_LEN} bytes"
        )));
    }
    entropy.copy_from_slice(&bytes);
    Ok(entropy)
}

fn check_principal(principal_id: &str) -> Result<()> {
    if principal_id.trim().is_empty() || principal_id.trim() != principal_id {
        return Err(AccountLockError::Invalid(
            "a principal id is required".into(),
        ));
    }
    Ok(())
}

impl AccountLock {
    pub(crate) fn new(store: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            unlocked: Arc::new(Mutex::new(HashMap::new())),
            handles: Arc::new(Mutex::new(HashMap::new())),
            records: Arc::new(Mutex::new(())),
        }
    }

    // ─── Handles ─────────────────────────────────────────────────────────────

    fn put_handle(&self, id: String, stage: Stage, expires: Instant) {
        let mut handles = lock(&self.handles);
        let now = Instant::now();
        handles.retain(|_, handle| handle.expires > now);
        handles.insert(id, Handle { stage, expires });
    }

    fn new_handle(&self, stage: Stage) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.put_handle(id.clone(), stage, Instant::now() + HANDLE_LIFETIME);
        id
    }

    /// Removes the handle and returns it, unless it expired.
    fn take_handle(&self, id: &str) -> Result<Handle> {
        let handle = lock(&self.handles)
            .remove(id)
            .ok_or(AccountLockError::NoHandle)?;
        if handle.expires <= Instant::now() {
            return Err(AccountLockError::NoHandle);
        }
        Ok(handle)
    }

    // ─── OPAQUE ──────────────────────────────────────────────────────────────

    /// Starts registering `password`.
    pub(crate) fn registration_start(&self, password: &str) -> Result<FlowStart> {
        let password = Zeroizing::new(password.as_bytes().to_vec());
        let (flow, request) = ClientRegistrationFlow::start(&password)?;
        let handle = self.new_handle(Stage::Registering {
            flow: Box::new(flow),
            password,
        });
        Ok(FlowStart {
            handle,
            request: b64(&request),
        })
    }

    /// Finishes the registration with the server's response and keeps the export key under
    /// the handle.
    pub(crate) fn registration_finish(
        &self,
        handle_id: &str,
        response: &str,
    ) -> Result<RegistrationFinish> {
        let handle = self.take_handle(handle_id)?;
        let Stage::Registering { flow, password } = handle.stage else {
            return Err(AccountLockError::NoHandle);
        };
        let response = unb64(response, "the registration response")?;
        let (upload, export_key) = flow.finish(&password, &response)?;
        self.put_handle(
            handle_id.to_string(),
            Stage::Registered { export_key },
            handle.expires,
        );
        Ok(RegistrationFinish {
            upload: b64(&upload),
        })
    }

    /// Starts a login with `password`.
    pub(crate) fn login_start(&self, password: &str) -> Result<FlowStart> {
        let password = Zeroizing::new(password.as_bytes().to_vec());
        let (flow, request) = ClientLoginFlow::start(&password)?;
        let handle = self.new_handle(Stage::LoggingIn {
            flow: Box::new(flow),
            password,
        });
        Ok(FlowStart {
            handle,
            request: b64(&request),
        })
    }

    /// Finishes the login with the server's response and keeps the export key and the session
    /// key under the handle. A wrong password ends the handle.
    pub(crate) fn login_finish(&self, handle_id: &str, response: &str) -> Result<LoginFinish> {
        let handle = self.take_handle(handle_id)?;
        let Stage::LoggingIn { flow, password } = handle.stage else {
            return Err(AccountLockError::NoHandle);
        };
        let response = unb64(response, "the credential response")?;
        let finished = flow.finish(&password, &response)?;
        self.put_handle(
            handle_id.to_string(),
            Stage::LoggedIn {
                export_key: finished.export_key,
                session_key: finished.session_key,
            },
            handle.expires,
        );
        Ok(LoginFinish {
            finalization: b64(&finished.finalization),
        })
    }

    // ─── Unlocking ───────────────────────────────────────────────────────────

    fn wraps(&self, principal_id: &str) -> Result<Option<DataKeyWraps>> {
        let Some(raw) = self.store.read(&wraps_name(principal_id))? else {
            return Ok(None);
        };
        match serde_json::from_str(&raw) {
            Ok(wraps) => Ok(Some(wraps)),
            Err(e) => {
                log::warn!("[account_lock] the data key wraps of an account are not readable: {e}");
                Ok(None)
            }
        }
    }

    fn put_wraps(&self, principal_id: &str, wraps: &DataKeyWraps) -> Result<()> {
        let raw = serde_json::to_string(wraps)
            .map_err(|e| AccountLockError::Vault(format!("cannot encode the wraps: {e}")))?;
        self.store.write(&wraps_name(principal_id), &raw)
    }

    fn keep_key(&self, principal_id: &str) -> Result<Option<Key>> {
        let Some(raw) = self.store.read(&keep_name(principal_id))? else {
            return Ok(None);
        };
        Ok(unb64(&raw, "the keep key")
            .and_then(|bytes| key_of(&bytes, "the keep key"))
            .map_err(|e| log::warn!("[account_lock] a stored keep key is not readable: {e}"))
            .ok())
    }

    /// Writes the keep wrap and its key when `keep`, and removes both when not.
    fn set_keep(
        &self,
        principal_id: &str,
        data_key: &Key,
        wraps: &mut DataKeyWraps,
        keep: bool,
    ) -> Result<()> {
        if !keep {
            wraps.keep_wrap = None;
            return self.store.delete(&keep_name(principal_id));
        }
        let keep_key = rim_opaque::random_key()?;
        wraps.keep_wrap = Some(b64(&rim_opaque::wrap_data_key(
            &keep_key,
            WrapKind::Keep,
            principal_id,
            data_key,
        )?));
        self.store.write(
            &keep_name(principal_id),
            &Zeroizing::new(b64(keep_key.as_ref())),
        )
    }

    /// Holds `data_key` as the account's and returns what the webview needs.
    fn hold(&self, principal_id: &str, data_key: Key, started_empty: bool) -> Unlocked {
        let web_store_key = rim_opaque::store_key(&data_key, StoreKeyLabel::WebStores);
        lock(&self.unlocked).insert(principal_id.to_string(), data_key);
        Unlocked {
            web_store_key: Zeroizing::new(b64(web_store_key.as_ref())),
            started_empty,
            share: None,
        }
    }

    /// Unlocks `principal_id` after a login: opens the server share with the session key,
    /// derives the unlock key, and opens the password wrap with it, or with an older unlock key
    /// one of `rewraps` holds (and then wraps it under the current one). A data key the recovery
    /// phrase already unlocked ([`Self::unlock_with_recovery`]) is used when no wrap opens.
    /// `keep` writes the keep wrap; without it, any keep wrap is removed.
    ///
    /// # Errors
    /// [`AccountLockError::NeedsRecovery`] when nothing opens, the device holds a recovery wrap
    /// and `start_empty` is false; the handle stays usable, for a call after the recovery phrase
    /// or with `start_empty`. With `start_empty`, or with no recovery wrap, the account starts
    /// over here with a new data key.
    pub(crate) fn unlock_after_login(
        &self,
        handle_id: &str,
        principal_id: &str,
        sealed_share: &str,
        rewraps: &[String],
        keep: bool,
        start_empty: bool,
    ) -> Result<Unlocked> {
        check_principal(principal_id)?;
        let handle = self.take_handle(handle_id)?;
        let expires = handle.expires;
        let Stage::LoggedIn {
            export_key,
            session_key,
        } = handle.stage
        else {
            return Err(AccountLockError::NoHandle);
        };
        let transport = rim_opaque::transport_key(&session_key, TransportLabel::ServerShare);
        let share = rim_opaque::open(&transport, &[], &unb64(sealed_share, "the server share")?)
            .map_err(|_| AccountLockError::Crypto("the server share did not open".into()))?;
        let share = key_of(&share, "the server share")?;
        let unlock_key = rim_opaque::derive_unlock_key(&export_key, &share, principal_id);

        let _guard = lock(&self.records);
        let stored = self.wraps(principal_id)?;
        let opened = match &stored {
            Some(wraps) => open_password_wrap(&unlock_key, principal_id, wraps, rewraps),
            None => None,
        }
        .or_else(|| lock(&self.unlocked).get(principal_id).cloned());
        let holds_recovery = stored.as_ref().is_some_and(|w| w.recovery_wrap.is_some());
        if opened.is_none() && holds_recovery && !start_empty {
            self.put_handle(
                handle_id.to_string(),
                Stage::LoggedIn {
                    export_key,
                    session_key,
                },
                expires,
            );
            return Err(AccountLockError::NeedsRecovery);
        }
        let started_empty = opened.is_none();
        let (data_key, mut wraps) = match opened {
            Some(data_key) => (data_key, stored.unwrap_or_default()),
            None => (rim_opaque::random_key()?, DataKeyWraps::default()),
        };
        wraps.password_wrap = b64(&rim_opaque::wrap_data_key(
            &unlock_key,
            WrapKind::Password,
            principal_id,
            &data_key,
        )?);
        self.set_keep(principal_id, &data_key, &mut wraps, keep)?;
        self.put_wraps(principal_id, &wraps)?;
        Ok(Unlocked {
            share: Some(share),
            ..self.hold(principal_id, data_key, started_empty)
        })
    }

    /// Unlocks an account after a signup registered its password: its data key wrapped under
    /// the unlock key of the registration's export key and `share` (the server share,
    /// base64url, in the clear), plus the recovery wrap when the recovery phrase's entropy
    /// (base64url of its 16 bytes) is given. A new account gets a new data key and loses any
    /// wraps it had here; an account unlocked already (signing up at another server) keeps its
    /// data key and its recovery wrap.
    pub(crate) fn unlock_after_signup(
        &self,
        handle_id: &str,
        principal_id: &str,
        share: &str,
        recovery_entropy: Option<&str>,
        keep: bool,
    ) -> Result<Unlocked> {
        check_principal(principal_id)?;
        let share = key_of(&unb64(share, "the server share")?, "the server share")?;
        let entropy = recovery_entropy.map(entropy_of).transpose()?;
        let handle = self.take_handle(handle_id)?;
        let Stage::Registered { export_key } = handle.stage else {
            return Err(AccountLockError::NoHandle);
        };
        let unlock_key = rim_opaque::derive_unlock_key(&export_key, &share, principal_id);
        let held = self.data_key(principal_id);
        let started_empty = held.is_none();
        let data_key = match held {
            Some(data_key) => data_key,
            None => rim_opaque::random_key()?,
        };

        let _guard = lock(&self.records);
        let kept_recovery = if started_empty {
            None
        } else {
            self.wraps(principal_id)?.and_then(|w| w.recovery_wrap)
        };
        let mut wraps = DataKeyWraps {
            password_wrap: b64(&rim_opaque::wrap_data_key(
                &unlock_key,
                WrapKind::Password,
                principal_id,
                &data_key,
            )?),
            recovery_wrap: kept_recovery,
            keep_wrap: None,
        };
        if let Some(entropy) = entropy {
            let recovery_key = rim_opaque::recovery_wrap_key(&entropy);
            wraps.recovery_wrap = Some(b64(&rim_opaque::wrap_data_key(
                &recovery_key,
                WrapKind::Recovery,
                principal_id,
                &data_key,
            )?));
        }
        self.set_keep(principal_id, &data_key, &mut wraps, keep)?;
        self.put_wraps(principal_id, &wraps)?;
        Ok(Unlocked {
            share: Some(share),
            ..self.hold(principal_id, data_key, started_empty)
        })
    }

    /// Unlocks a kept account with its keep key, without the server. `None` when the account
    /// is not kept here or its keep wrap does not open.
    pub(crate) fn unlock_kept(&self, principal_id: &str) -> Result<Option<Unlocked>> {
        check_principal(principal_id)?;
        let _guard = lock(&self.records);
        let (Some(wraps), Some(keep_key)) =
            (self.wraps(principal_id)?, self.keep_key(principal_id)?)
        else {
            return Ok(None);
        };
        let Some(keep_wrap) = wraps.keep_wrap else {
            return Ok(None);
        };
        let opened = unb64(&keep_wrap, "the keep wrap").and_then(|wrap| {
            Ok(rim_opaque::unwrap_data_key(
                &keep_key,
                WrapKind::Keep,
                principal_id,
                &wrap,
            )?)
        });
        match opened {
            Ok(data_key) => Ok(Some(self.hold(principal_id, data_key, false))),
            Err(e) => {
                log::warn!("[account_lock] a keep wrap did not open: {e}");
                Ok(None)
            }
        }
    }

    /// Unlocks an account with its recovery phrase's entropy (base64url of its 16 bytes).
    /// `None` when the account has no recovery wrap here or the phrase does not open it.
    pub(crate) fn unlock_with_recovery(
        &self,
        principal_id: &str,
        entropy: &str,
    ) -> Result<Option<Unlocked>> {
        check_principal(principal_id)?;
        let entropy = entropy_of(entropy)?;
        let _guard = lock(&self.records);
        let Some(recovery_wrap) = self.wraps(principal_id)?.and_then(|w| w.recovery_wrap) else {
            return Ok(None);
        };
        let recovery_key = rim_opaque::recovery_wrap_key(&entropy);
        let wrap = unb64(&recovery_wrap, "the recovery wrap")?;
        match rim_opaque::unwrap_data_key(&recovery_key, WrapKind::Recovery, principal_id, &wrap) {
            Ok(data_key) => Ok(Some(self.hold(principal_id, data_key, false))),
            Err(_) => Ok(None),
        }
    }

    /// Makes the rewrap of a password change: the old unlock key, from the export key of the
    /// finished login under `login_handle` and the server share it sealed (`sealed_share`),
    /// sealed under the new one, from the export key of the finished registration under
    /// `registration_handle` and the same share. The login handle is spent; the registration
    /// handle keeps the new unlock key for [`Self::password_commit`].
    pub(crate) fn password_rewrap(
        &self,
        login_handle: &str,
        sealed_share: &str,
        registration_handle: &str,
        principal_id: &str,
    ) -> Result<Rewrap> {
        check_principal(principal_id)?;
        let Stage::LoggedIn {
            export_key: old_export,
            session_key,
        } = self.take_handle(login_handle)?.stage
        else {
            return Err(AccountLockError::NoHandle);
        };
        let registration = self.take_handle(registration_handle)?;
        let expires = registration.expires;
        let Stage::Registered {
            export_key: new_export,
        } = registration.stage
        else {
            return Err(AccountLockError::NoHandle);
        };
        let transport = rim_opaque::transport_key(&session_key, TransportLabel::ServerShare);
        let share = rim_opaque::open(&transport, &[], &unb64(sealed_share, "the server share")?)
            .map_err(|_| AccountLockError::Crypto("the server share did not open".into()))?;
        let share = key_of(&share, "the server share")?;
        let old_key = rim_opaque::derive_unlock_key(&old_export, &share, principal_id);
        let new_key = rim_opaque::derive_unlock_key(&new_export, &share, principal_id);
        let rewrap = b64(&rim_opaque::rewrap_unlock_key(
            &new_key,
            &old_key,
            principal_id,
        )?);
        self.put_handle(
            registration_handle.to_string(),
            Stage::Rewrapped {
                principal_id: principal_id.to_string(),
                unlock_key: new_key,
            },
            expires,
        );
        Ok(Rewrap { rewrap })
    }

    /// Finishes a password change the server took: wraps the account's data key under the new
    /// unlock key [`Self::password_rewrap`] left under `handle`.
    ///
    /// # Errors
    /// [`AccountLockError::Locked`] while the account is locked, [`AccountLockError::NoHandle`]
    /// for a handle of another stage or account.
    pub(crate) fn password_commit(&self, handle_id: &str, principal_id: &str) -> Result<()> {
        check_principal(principal_id)?;
        let Stage::Rewrapped {
            principal_id: changed,
            unlock_key,
        } = self.take_handle(handle_id)?.stage
        else {
            return Err(AccountLockError::NoHandle);
        };
        if changed != principal_id {
            return Err(AccountLockError::NoHandle);
        }
        let data_key = self
            .data_key(principal_id)
            .ok_or(AccountLockError::Locked)?;
        let _guard = lock(&self.records);
        let mut wraps = self.wraps(principal_id)?.unwrap_or_default();
        wraps.password_wrap = b64(&rim_opaque::wrap_data_key(
            &unlock_key,
            WrapKind::Password,
            principal_id,
            &data_key,
        )?);
        self.put_wraps(principal_id, &wraps)
    }

    /// Wraps the unlocked account's data key under its recovery phrase too (`entropy`,
    /// base64url of its 16 bytes), on a device that now holds the phrase.
    ///
    /// # Errors
    /// [`AccountLockError::Locked`] while the account is locked, [`AccountLockError::Invalid`]
    /// when the device has no wraps for it.
    pub(crate) fn add_recovery_wrap(&self, principal_id: &str, entropy: &str) -> Result<()> {
        check_principal(principal_id)?;
        let entropy = entropy_of(entropy)?;
        let data_key = self
            .data_key(principal_id)
            .ok_or(AccountLockError::Locked)?;
        let _guard = lock(&self.records);
        let Some(mut wraps) = self.wraps(principal_id)? else {
            return Err(AccountLockError::Invalid(
                "this device has no data key wraps for the account".into(),
            ));
        };
        let recovery_key = rim_opaque::recovery_wrap_key(&entropy);
        wraps.recovery_wrap = Some(b64(&rim_opaque::wrap_data_key(
            &recovery_key,
            WrapKind::Recovery,
            principal_id,
            &data_key,
        )?));
        self.put_wraps(principal_id, &wraps)
    }

    /// Drops the account's data key from memory. Returns whether it was unlocked.
    pub(crate) fn lock_account(&self, principal_id: &str) -> bool {
        lock(&self.unlocked).remove(principal_id).is_some()
    }

    /// Removes "Keep me signed in": the keep key and the keep wrap.
    pub(crate) fn forget_keep(&self, principal_id: &str) -> Result<()> {
        check_principal(principal_id)?;
        let _guard = lock(&self.records);
        self.store.delete(&keep_name(principal_id))?;
        if let Some(mut wraps) = self.wraps(principal_id)? {
            if wraps.keep_wrap.take().is_some() {
                self.put_wraps(principal_id, &wraps)?;
            }
        }
        Ok(())
    }

    /// The account's data key, while it is unlocked.
    pub(crate) fn data_key(&self, principal_id: &str) -> Option<Key> {
        lock(&self.unlocked).get(principal_id).cloned()
    }

    /// Whether the account is unlocked.
    pub(crate) fn is_unlocked(&self, principal_id: &str) -> bool {
        lock(&self.unlocked).contains_key(principal_id)
    }

    /// Seals `plaintext` under the account's store key for `label` (AES-256-GCM, `aad` the
    /// record's name): base64url of `nonce ‖ ciphertext ‖ tag`.
    ///
    /// # Errors
    /// [`AccountLockError::Locked`] while the account is locked.
    pub(crate) fn seal_record(
        &self,
        principal_id: &str,
        label: StoreKeyLabel,
        aad: &str,
        plaintext: &[u8],
    ) -> Result<String> {
        let data_key = self
            .data_key(principal_id)
            .ok_or(AccountLockError::Locked)?;
        let key = rim_opaque::store_key(&data_key, label);
        Ok(b64(&rim_opaque::seal(&key, aad.as_bytes(), plaintext)?))
    }

    /// Opens what [`Self::seal_record`] sealed under the same `label` and `aad`.
    ///
    /// # Errors
    /// [`AccountLockError::Locked`] while the account is locked, and
    /// [`AccountLockError::Crypto`] when it does not open: another data key, another name, or
    /// damage.
    pub(crate) fn open_record(
        &self,
        principal_id: &str,
        label: StoreKeyLabel,
        aad: &str,
        sealed: &str,
    ) -> Result<Zeroizing<Vec<u8>>> {
        let data_key = self
            .data_key(principal_id)
            .ok_or(AccountLockError::Locked)?;
        let key = rim_opaque::store_key(&data_key, label);
        rim_opaque::open(&key, aad.as_bytes(), &unb64(sealed, "a sealed record")?)
            .map_err(|_| AccountLockError::Crypto("a sealed record did not open".into()))
    }
}

/// The data key the password wrap holds, opened with `unlock_key` or with an older unlock key
/// reached through `rewraps` (each holds the unlock key before a password change, sealed under
/// the one after it).
fn open_password_wrap(
    unlock_key: &Key,
    principal_id: &str,
    wraps: &DataKeyWraps,
    rewraps: &[String],
) -> Option<Key> {
    let wrap = URL_SAFE_NO_PAD.decode(&wraps.password_wrap).ok()?;
    let rewraps: Vec<Vec<u8>> = rewraps
        .iter()
        .filter_map(|r| URL_SAFE_NO_PAD.decode(r.trim()).ok())
        .collect();
    let mut keys = vec![unlock_key.clone()];
    let mut used = vec![false; rewraps.len()];
    let mut next = 0;
    while next < keys.len() {
        if let Ok(data_key) =
            rim_opaque::unwrap_data_key(&keys[next], WrapKind::Password, principal_id, &wrap)
        {
            return Some(data_key);
        }
        for (i, rewrap) in rewraps.iter().enumerate() {
            if used[i] {
                continue;
            }
            if let Ok(older) = rim_opaque::unwrap_rewrap(&keys[next], principal_id, rewrap) {
                used[i] = true;
                keys.push(older);
            }
        }
        next += 1;
    }
    None
}
