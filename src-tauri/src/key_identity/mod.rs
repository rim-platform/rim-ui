//! Key identity on the desktop (master plan Stage 3, `rim-server/docs/specs/key-identity-v1.md`):
//! this device's keys, and the statements it signs with them.
//!
//! Keys never leave this module. The webview talks to the server; when it needs a signed
//! statement it asks here and sends what it gets back, so a compromised page can at most ask
//! for signatures, never read a key.
//!
//! - **Enrollment** creates an identity key, a recovery key and a device key. The recovery key
//!   is shown once, as the 12-word phrase of the recovery kit, and never stored. The identity
//!   and device keys are written to the keyring before the server is asked to enroll them, so
//!   an enrolled account never ends up without its keys; keys the server never accepted are
//!   cleaned up later.
//! - **Key-only signup** uses the same draft for an account that does not exist yet: its keys
//!   are stored before `signupWithKey` is sent and linked to the new account once it answers.
//! - **Sign-in** signs a login proof over a server challenge with the device key.
//! - **Rotation** stores the new identity key as pending until the server's log names it.
//! - **Recovery** signs a rotation with the recovery key from a kit, for a new identity key and
//!   a new device.

pub(crate) mod commands;
pub(crate) mod recovery_kit;
pub(crate) mod statement;
pub(crate) mod store;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use statement::{KeyHead, RotationSigner, SecretKey, Statement};
use store::{same_endpoint, AccountLink, KeyRecord, Keys, SecretStore};

#[derive(Debug, thiserror::Error)]
pub(crate) enum KeyIdentityError {
    #[error("{0}")]
    Invalid(String),
    #[error("key storage: {0}")]
    Keyring(String),
    #[error("crypto: {0}")]
    Crypto(String),
    #[error("this computer has no keys for that account")]
    NoKeys,
    #[error("this computer does not hold the account's current identity key")]
    NoIdentityKey,
    #[error("the enrollment was cancelled or already finished; start again")]
    NoDraft,
}

impl KeyIdentityError {
    fn code(&self) -> &'static str {
        match self {
            Self::Invalid(_) => "INVALID",
            Self::Keyring(_) => "KEYRING",
            Self::Crypto(_) => "CRYPTO",
            Self::NoKeys => "NO_KEYS",
            Self::NoIdentityKey => "NO_IDENTITY_KEY",
            Self::NoDraft => "NO_DRAFT",
        }
    }
}

impl Serialize for KeyIdentityError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("KeyIdentityError", 2)?;
        s.serialize_field("kind", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

type Result<T> = std::result::Result<T, KeyIdentityError>;

// ─── What the webview sees ───────────────────────────────────────────────────

/// An account this device holds keys for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAccount {
    pub(crate) principal_id: String,
    pub(crate) user_id: Option<String>,
    pub(crate) username: Option<String>,
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    /// This device holds the identity key (it enrolled the account).
    pub(crate) has_identity_key: bool,
    pub(crate) confirmed: bool,
}

/// A started enrollment: the new principal id and the recovery kit to show once.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnrollmentDraft {
    pub(crate) draft_id: String,
    pub(crate) principal_id: String,
    /// The whole kit text, to copy.
    pub(crate) recovery_kit: Zeroizing<String>,
    /// The kit's 12 words in order, to show as a numbered grid.
    pub(crate) recovery_phrase: Zeroizing<Vec<String>>,
}

/// What `enrollIdentityKey` takes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnrollmentStatements {
    pub(crate) key_log: Vec<Statement>,
    pub(crate) device: Statement,
    pub(crate) proof: Statement,
}

/// What a recovery `rotateIdentityKey` takes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryStatements {
    pub(crate) principal_id: String,
    /// The new device, to undo the recovery with if the server refuses it.
    pub(crate) device_id: String,
    pub(crate) entry: Statement,
    pub(crate) device: Statement,
}

/// A verified key log as this device sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogStatus {
    pub(crate) principal_id: String,
    pub(crate) seq: u32,
    /// This device holds the head's identity key, so it can add and revoke devices, rotate and
    /// publish the profile card.
    pub(crate) holds_identity_key: bool,
}

/// A challenge from `keyLoginChallenge`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Challenge {
    pub(crate) challenge_id: String,
    pub(crate) nonce: String,
}

/// The profile card fields the webview chooses.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardContent {
    pub(crate) version: u32,
    pub(crate) display_name: String,
    pub(crate) relays: Vec<String>,
    /// The certificates of the devices to list. Only those that verify against the key log
    /// make it into the card.
    pub(crate) certificates: Vec<Statement>,
}

/// Who a key sign-in or enrollment is for on the server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerAccount {
    pub(crate) endpoint: String,
    pub(crate) user_id: String,
    pub(crate) username: String,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// The `audience` of a login proof: the `host[:port]` of the endpoint URL as written,
/// lowercased, the same rule the server applies to `RIM_PUBLIC_BASE_URL`.
pub(crate) fn audience(endpoint: &str) -> Result<String> {
    let invalid = || KeyIdentityError::Invalid(format!("not an absolute server URL: {endpoint}"));
    let (_, rest) = endpoint.trim().split_once("://").ok_or_else(invalid)?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let authority = authority.rsplit('@').next().unwrap_or_default();
    if authority.is_empty() {
        return Err(invalid());
    }
    Ok(authority.to_ascii_lowercase())
}

/// A device name as certificates allow it: trimmed, 1 to 64 characters, no control characters.
fn device_name(name: &str) -> Result<String> {
    let name: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(64)
        .collect();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(KeyIdentityError::Invalid("give this device a name".into()));
    }
    Ok(name)
}

/// This computer's name, as the default device name.
pub(crate) fn default_device_name() -> String {
    let host = hostname().unwrap_or_default();
    device_name(&host).unwrap_or_else(|_| "Desktop".to_string())
}

#[cfg(unix)]
fn hostname() -> Option<String> {
    let mut buf = [0u8; 256];
    // SAFETY: the buffer is valid for `buf.len()` bytes and gethostname writes at most that.
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    if rc != 0 {
        return None;
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    let name = String::from_utf8_lossy(&buf[..end]).to_string();
    // "laptop.local" reads better as "laptop".
    Some(name.split('.').next().unwrap_or_default().to_string())
}

#[cfg(not(unix))]
fn hostname() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

fn key(text: &Zeroizing<String>) -> Result<SecretKey> {
    SecretKey::from_text(text)
}

fn local_account(link: &AccountLink, record: &KeyRecord) -> LocalAccount {
    LocalAccount {
        principal_id: record.principal_id.clone(),
        user_id: link.user_id.clone(),
        username: link.username.clone(),
        device_id: record.device_id.clone(),
        device_name: record.device_name.clone(),
        has_identity_key: record.identity_seed.is_some(),
        confirmed: record.confirmed,
    }
}

/// The identity key of `record` that is the head's, promoting a pending one the head names.
/// A pending key is dropped only once the log reaches the seq its rotation creates with
/// another key; a log that ends before it (a stale copy, or the rotation still in flight)
/// leaves it pending. Returns `None` when this device holds no key the head names.
fn identity_at_head(record: &mut KeyRecord, head: &KeyHead) -> Result<(Option<SecretKey>, bool)> {
    let mut changed = false;
    if let Some(pending) = record.pending_identity_seed.take() {
        let target = record.pending_identity_seq.unwrap_or(0);
        if key(&pending)?.public_key() == head.identity_key {
            record.identity_seed = Some(pending);
            record.pending_identity_seq = None;
            changed = true;
        } else if head.seq >= target {
            // That seq holds another key: the rotation never landed.
            record.pending_identity_seq = None;
            changed = true;
        } else {
            record.pending_identity_seed = Some(pending);
        }
    }
    match &record.identity_seed {
        Some(text) => {
            let current = key(text)?;
            if current.public_key() == head.identity_key {
                Ok((Some(current), changed))
            } else {
                Ok((None, changed))
            }
        }
        None => Ok((None, changed)),
    }
}

#[derive(Clone)]
struct Draft {
    principal_id: String,
    identity_seed: SecretKey,
    device_seed: SecretKey,
    device_id: String,
    device_name: String,
    inception: Statement,
    certificate: Statement,
}

// ─── State ───────────────────────────────────────────────────────────────────

/// Tauri-managed state. Clones share everything.
#[derive(Clone)]
pub(crate) struct KeyIdentityState {
    store: Arc<dyn SecretStore>,
    drafts: Arc<Mutex<HashMap<String, Draft>>>,
    /// Serializes read-modify-write of the keyring entries.
    lock: Arc<Mutex<()>>,
}

pub(crate) fn init() -> KeyIdentityState {
    KeyIdentityState::new(Arc::new(store::KeyringSecretStore))
}

impl KeyIdentityState {
    pub(crate) fn new(store: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            drafts: Arc::new(Mutex::new(HashMap::new())),
            lock: Arc::new(Mutex::new(())),
        }
    }

    fn keys(&self) -> Keys<'_> {
        Keys(self.store.as_ref())
    }

    fn guard(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.lock
            .lock()
            .map_err(|_| KeyIdentityError::Keyring("key store lock poisoned".into()))
    }

    fn record(&self, principal_id: &str) -> Result<KeyRecord> {
        self.keys()
            .record(principal_id)?
            .ok_or(KeyIdentityError::NoKeys)
    }

    /// Accounts on `endpoint` this device can sign in to.
    pub(crate) fn accounts(&self, endpoint: &str) -> Result<Vec<LocalAccount>> {
        let _guard = self.guard()?;
        let mut out = Vec::new();
        for link in self.keys().links()? {
            if !same_endpoint(&link.endpoint, endpoint) {
                continue;
            }
            if let Some(record) = self.keys().record(&link.principal_id)? {
                out.push(local_account(&link, &record));
            }
        }
        Ok(out)
    }

    /// Create the keys of a new identity and its first device, held in memory until signed.
    pub(crate) fn begin_enrollment(&self, name: &str) -> Result<EnrollmentDraft> {
        let device_name = device_name(name)?;
        let identity_seed = SecretKey::generate()?;
        let recovery_entropy = recovery_kit::generate_entropy()?;
        let recovery_seed = recovery_kit::phrase_key(&recovery_entropy)?;
        let device_seed = SecretKey::generate()?;
        if identity_seed == recovery_seed || device_seed == identity_seed {
            return Err(KeyIdentityError::Crypto("random keys collided".into()));
        }
        let now = statement::now();
        let inception = statement::inception(&identity_seed, &recovery_seed.public_key(), &now);
        let principal_id = statement::principal_id(&inception.payload);
        let device_id = uuid::Uuid::now_v7().to_string();
        let certificate = statement::device_cert(
            &identity_seed,
            &statement::DeviceCertInput {
                principal_id: &principal_id,
                device_id: &device_id,
                device_key: &device_seed.public_key(),
                name: &device_name,
                key_seq: 0,
                issued_at: &now,
            },
        );
        let recovery_kit = recovery_kit::format_kit(&principal_id, &recovery_entropy)?;
        let recovery_phrase = recovery_kit::phrase_words(&recovery_entropy)?;
        drop(recovery_seed);
        drop(recovery_entropy);

        let draft_id = uuid::Uuid::new_v4().to_string();
        self.drafts
            .lock()
            .map_err(|_| KeyIdentityError::Keyring("draft lock poisoned".into()))?
            .insert(
                draft_id.clone(),
                Draft {
                    principal_id: principal_id.clone(),
                    identity_seed,
                    device_seed,
                    device_id,
                    device_name,
                    inception,
                    certificate,
                },
            );
        Ok(EnrollmentDraft {
            draft_id,
            principal_id,
            recovery_kit,
            recovery_phrase,
        })
    }

    /// Store a draft's keys for `account` and sign what `enrollIdentityKey` needs. The draft
    /// stays until the enrollment settles, so a failed attempt can be retried with the same
    /// keys (the recovery kit already shown belongs to them).
    pub(crate) fn sign_enrollment(
        &self,
        draft_id: &str,
        account: &ServerAccount,
        challenge: &Challenge,
    ) -> Result<EnrollmentStatements> {
        self.sign_draft(
            draft_id,
            &account.endpoint,
            Some(&account.user_id),
            &account.username,
            challenge,
        )
    }

    /// Store a draft's keys for a new account named `username` on `endpoint` and sign what
    /// `signupWithKey` needs. The account has no user id until the server answers; settling
    /// with the one it returns links the keys to it. A refused attempt removes the keys with
    /// `remove_draft_keys` and keeps the draft for a retry.
    pub(crate) fn sign_signup(
        &self,
        draft_id: &str,
        endpoint: &str,
        username: &str,
        challenge: &Challenge,
    ) -> Result<EnrollmentStatements> {
        let username = username.trim();
        if username.is_empty() {
            return Err(KeyIdentityError::Invalid("choose a username".into()));
        }
        self.sign_draft(draft_id, endpoint, None, username, challenge)
    }

    /// Store a draft's keys again for a signup the server took after a failed attempt removed
    /// them, so the account it created has its keys on this device.
    pub(crate) fn restore_draft_keys(
        &self,
        draft_id: &str,
        endpoint: &str,
        username: &str,
    ) -> Result<()> {
        audience(endpoint)?;
        let draft = self.draft(draft_id)?;
        self.store_draft(&draft, endpoint, None, username.trim())
    }

    /// Store a draft's keys, linked to the account on `endpoint`, and sign its log, its device
    /// certificate and a login proof over `challenge`.
    fn sign_draft(
        &self,
        draft_id: &str,
        endpoint: &str,
        user_id: Option<&str>,
        username: &str,
        challenge: &Challenge,
    ) -> Result<EnrollmentStatements> {
        let audience = audience(endpoint)?;
        let draft = self.draft(draft_id)?;
        self.store_draft(&draft, endpoint, user_id, username)?;

        let proof = statement::login(
            &draft.device_seed,
            &statement::LoginInput {
                challenge_id: &challenge.challenge_id,
                nonce: &challenge.nonce,
                audience: &audience,
                principal_id: &draft.principal_id,
                device_id: &draft.device_id,
            },
        );
        Ok(EnrollmentStatements {
            key_log: vec![draft.inception.clone()],
            device: draft.certificate.clone(),
            proof,
        })
    }

    /// Write a draft's keys and link them to the account on `endpoint`. Keys the server has
    /// already confirmed stay confirmed, and a link that knows the account's user id keeps it.
    fn store_draft(
        &self,
        draft: &Draft,
        endpoint: &str,
        user_id: Option<&str>,
        username: &str,
    ) -> Result<()> {
        let _guard = self.guard()?;
        let keys = self.keys();
        let confirmed = keys
            .record(&draft.principal_id)?
            .is_some_and(|r| r.confirmed);
        keys.put_record(&KeyRecord {
            v: 1,
            principal_id: draft.principal_id.clone(),
            device_id: draft.device_id.clone(),
            device_name: draft.device_name.clone(),
            device_seed: draft.device_seed.to_text(),
            identity_seed: Some(draft.identity_seed.to_text()),
            pending_identity_seed: None,
            pending_identity_seq: None,
            confirmed,
            replaced: None,
        })?;
        let mut links = keys.links()?;
        let same = |l: &AccountLink| {
            same_endpoint(&l.endpoint, endpoint) && l.principal_id == draft.principal_id
        };
        let known_user_id = links
            .iter()
            .find(|l| same(l))
            .and_then(|l| l.user_id.clone());
        links.retain(|l| !same(l));
        links.push(AccountLink {
            endpoint: endpoint.to_string(),
            principal_id: draft.principal_id.clone(),
            user_id: user_id.map(str::to_string).or(known_user_id),
            username: Some(username.to_string()),
        });
        keys.put_links(&links)
    }

    /// A copy of a held draft, so the draft lock is never held together with the store lock.
    fn draft(&self, draft_id: &str) -> Result<Draft> {
        self.drafts
            .lock()
            .map_err(|_| KeyIdentityError::Keyring("draft lock poisoned".into()))?
            .get(draft_id)
            .cloned()
            .ok_or(KeyIdentityError::NoDraft)
    }

    /// Drop a draft the person cancelled or the server refused, with any keys it stored that
    /// the server never confirmed.
    pub(crate) fn discard_enrollment(&self, draft_id: &str) -> Result<()> {
        let draft = self
            .drafts
            .lock()
            .map_err(|_| KeyIdentityError::Keyring("draft lock poisoned".into()))?
            .remove(draft_id);
        match draft {
            Some(draft) => self.forget_unconfirmed(&draft.principal_id),
            None => Ok(()),
        }
    }

    /// Remove the keys a draft stored that the server never confirmed, keeping the draft: a
    /// retry stores and signs the same keys again, so the recovery kit already shown stays
    /// theirs.
    pub(crate) fn remove_draft_keys(&self, draft_id: &str) -> Result<()> {
        let draft = self.draft(draft_id)?;
        self.forget_unconfirmed(&draft.principal_id)
    }

    /// Remove keys of `principal_id` the server never confirmed, putting back the confirmed
    /// keys an unconfirmed recovery replaced, if any. Confirmed keys are left alone.
    pub(crate) fn forget_unconfirmed(&self, principal_id: &str) -> Result<()> {
        let _guard = self.guard()?;
        let keys = self.keys();
        match keys.record(principal_id)? {
            Some(record) if !record.confirmed => match record.replaced {
                Some(previous) => keys.put_record(&previous),
                None => keys.forget(principal_id),
            },
            _ => Ok(()),
        }
    }

    /// Reconcile this device's keys with what the server says about the signed-in account:
    /// its `principalId` (`null` before enrollment). Keys the server shows are confirmed and
    /// linked to the account; unconfirmed keys for the same account it does not show are
    /// removed, unless an enrollment of this run still holds them (its answer may come after
    /// the server's). Returns this device's keys for the account, if any.
    pub(crate) fn settle(
        &self,
        account: &ServerAccount,
        server_principal_id: Option<&str>,
    ) -> Result<Option<LocalAccount>> {
        let guard = self.guard()?;
        // Read under the store lock, after any `sign_enrollment` that got there first: a draft
        // still held here may be in flight to the server, so its keys are never leftovers.
        let drafting: Vec<String> = self
            .drafts
            .lock()
            .map_err(|_| KeyIdentityError::Keyring("draft lock poisoned".into()))?
            .values()
            .map(|d| d.principal_id.clone())
            .collect();
        let keys = self.keys();
        let mut links = keys.links()?;
        let mut result = None;

        if let Some(principal_id) = server_principal_id {
            if let Some(mut record) = keys.record(principal_id)? {
                if !record.confirmed || record.replaced.is_some() {
                    record.confirmed = true;
                    record.replaced = None;
                    keys.put_record(&record)?;
                }
                links.retain(|l| {
                    !(same_endpoint(&l.endpoint, &account.endpoint)
                        && l.principal_id == principal_id)
                });
                let link = AccountLink {
                    endpoint: account.endpoint.clone(),
                    principal_id: principal_id.to_string(),
                    user_id: Some(account.user_id.clone()),
                    username: Some(account.username.clone()),
                };
                result = Some(local_account(&link, &record));
                links.push(link);
            }
        }

        // Unconfirmed keys linked to this account that the server does not show.
        let mut stale = Vec::new();
        for link in &links {
            let same_account = same_endpoint(&link.endpoint, &account.endpoint)
                && link.user_id.as_deref() == Some(account.user_id.as_str())
                && Some(link.principal_id.as_str()) != server_principal_id
                && !drafting.contains(&link.principal_id);
            if !same_account {
                continue;
            }
            match keys.record(&link.principal_id)? {
                Some(record) if record.confirmed => {}
                _ => stale.push(link.principal_id.clone()),
            }
        }
        links.retain(|l| {
            !(same_endpoint(&l.endpoint, &account.endpoint) && stale.contains(&l.principal_id))
        });
        keys.put_links(&links)?;
        for principal_id in stale {
            if !links.iter().any(|l| l.principal_id == principal_id) {
                keys.delete_record(&principal_id)?;
            }
        }
        drop(guard);
        // An enrollment the server confirmed is finished.
        if let (Some(principal_id), Some(_)) = (server_principal_id, &result) {
            if let Ok(mut drafts) = self.drafts.lock() {
                drafts.retain(|_, d| d.principal_id != principal_id);
            }
        }
        Ok(result)
    }

    /// Sign a login proof over `challenge` for `endpoint` with this device's key.
    pub(crate) fn sign_login(
        &self,
        endpoint: &str,
        principal_id: &str,
        challenge: &Challenge,
    ) -> Result<Statement> {
        let audience = audience(endpoint)?;
        let record = {
            let _guard = self.guard()?;
            self.record(principal_id)?
        };
        let device_seed = key(&record.device_seed)?;
        Ok(statement::login(
            &device_seed,
            &statement::LoginInput {
                challenge_id: &challenge.challenge_id,
                nonce: &challenge.nonce,
                audience: &audience,
                principal_id,
                device_id: &record.device_id,
            },
        ))
    }

    /// Verify the server's key log for `principal_id`, settle a pending rotation against it,
    /// and say whether this device holds the head's identity key.
    pub(crate) fn sync_log(&self, principal_id: &str, log: &[Statement]) -> Result<LogStatus> {
        let head = Self::head(principal_id, log)?;
        let _guard = self.guard()?;
        let holds_identity_key = match self.keys().record(principal_id)? {
            Some(mut record) => {
                let (identity, changed) = identity_at_head(&mut record, &head)?;
                if changed {
                    self.keys().put_record(&record)?;
                }
                identity.is_some()
            }
            None => false,
        };
        Ok(LogStatus {
            principal_id: head.principal_id,
            seq: head.seq,
            holds_identity_key,
        })
    }

    fn head(principal_id: &str, log: &[Statement]) -> Result<KeyHead> {
        let head = statement::replay(log)?;
        if head.principal_id != principal_id {
            return Err(KeyIdentityError::Invalid(
                "the server's key log belongs to another account".into(),
            ));
        }
        Ok(head)
    }

    /// The identity key at the log's head, or `NoIdentityKey`.
    fn identity(&self, principal_id: &str, head: &KeyHead) -> Result<(KeyRecord, SecretKey)> {
        let mut record = self.record(principal_id)?;
        let (identity, changed) = identity_at_head(&mut record, head)?;
        if changed {
            self.keys().put_record(&record)?;
        }
        let identity = identity.ok_or(KeyIdentityError::NoIdentityKey)?;
        Ok((record, identity))
    }

    /// Revoke `device_id`: this device signs its own retirement with its device key; any other
    /// device needs the identity key.
    pub(crate) fn sign_revocation(
        &self,
        principal_id: &str,
        log: &[Statement],
        device_id: &str,
    ) -> Result<Statement> {
        let head = Self::head(principal_id, log)?;
        let _guard = self.guard()?;
        let record = self.record(principal_id)?;
        let now = statement::now();
        if record.device_id == device_id {
            let device_seed = key(&record.device_seed)?;
            return Ok(statement::revocation(
                &device_seed,
                true,
                principal_id,
                device_id,
                &now,
            ));
        }
        let (_, identity) = self.identity(principal_id, &head)?;
        Ok(statement::revocation(
            &identity,
            false,
            principal_id,
            device_id,
            &now,
        ))
    }

    /// Start an identity rotation: a new identity key, stored as pending, and the rotation
    /// entry signed by the current one. The recovery key and every device stay.
    pub(crate) fn begin_rotation(
        &self,
        principal_id: &str,
        log: &[Statement],
    ) -> Result<Statement> {
        let head = Self::head(principal_id, log)?;
        let _guard = self.guard()?;
        let (mut record, identity) = self.identity(principal_id, &head)?;
        // A rotation already pending for this seq (its answer lost, or a retry) is signed again
        // with the same key: if the first one landed, a new key would be lost with it.
        let next = match (&record.pending_identity_seed, record.pending_identity_seq) {
            (Some(pending), Some(seq)) if seq == head.seq + 1 => key(pending)?,
            _ => {
                let next = SecretKey::generate()?;
                record.pending_identity_seed = Some(next.to_text());
                record.pending_identity_seq = Some(head.seq + 1);
                self.keys().put_record(&record)?;
                next
            }
        };
        Ok(statement::rotation(
            &head,
            RotationSigner::Identity,
            &identity,
            &next.public_key(),
            &statement::now(),
        ))
    }

    /// Sign a profile card at the log's head.
    pub(crate) fn sign_profile_card(
        &self,
        principal_id: &str,
        log: &[Statement],
        card: &CardContent,
    ) -> Result<Statement> {
        let head = Self::head(principal_id, log)?;
        let _guard = self.guard()?;
        let (_, identity) = self.identity(principal_id, &head)?;
        let display_name = card.display_name.trim();
        if display_name.is_empty() {
            return Err(KeyIdentityError::Invalid(
                "a profile card needs a name".into(),
            ));
        }
        let devices = card
            .certificates
            .iter()
            .map(|certificate| statement::certified_device(certificate, &head))
            .collect::<Result<Vec<_>>>()?;
        Ok(statement::profile_card(
            &identity,
            &statement::ProfileCardInput {
                principal_id,
                version: card.version,
                key_seq: head.seq,
                display_name,
                relays: &card.relays,
                devices: &devices,
                issued_at: &statement::now(),
            },
        ))
    }

    /// Take an account back with its recovery kit: verify that the server's log ends at the
    /// kit's recovery key, create a new identity key and device key, store them, and sign the
    /// recovery rotation and the new device's certificate. `kit` is a whole kit of either
    /// version, a bare 12-word phrase or a bare `RK1-` key.
    pub(crate) fn begin_recovery(
        &self,
        endpoint: &str,
        kit: &str,
        account_id: Option<&str>,
        log: &[Statement],
        name: &str,
    ) -> Result<RecoveryStatements> {
        let device_name = device_name(name)?;
        let (principal_id, recovery_seed) = recovery_kit::parse_kit(kit, account_id)?;
        if log.is_empty() {
            return Err(KeyIdentityError::Invalid(
                "this server has no account with that account id".into(),
            ));
        }
        let head = Self::head(&principal_id, log)?;
        if recovery_seed.public_key() != head.recovery_key {
            return Err(KeyIdentityError::Invalid(
                "this recovery phrase or key does not belong to that account".into(),
            ));
        }

        let _guard = self.guard()?;
        let existing = self.keys().record(&principal_id)?;
        if let Some(mut record) = existing.clone() {
            if identity_at_head(&mut record, &head)?.0.is_some() {
                return Err(KeyIdentityError::Invalid(
                    "this computer still holds the account's identity key: sign in with it \
                     instead of recovering"
                        .into(),
                ));
            }
        }
        // Keys the server confirmed stay recoverable until the server takes the recovery.
        let replaced = match existing {
            Some(record) if record.confirmed => Some(Box::new(KeyRecord {
                replaced: None,
                ..record
            })),
            Some(record) => record.replaced,
            None => None,
        };

        let identity_seed = SecretKey::generate()?;
        let device_seed = SecretKey::generate()?;
        let now = statement::now();
        let identity_key = identity_seed.public_key();
        if identity_key == head.recovery_key || identity_key == head.identity_key {
            return Err(KeyIdentityError::Crypto("random keys collided".into()));
        }
        let entry = statement::rotation(
            &head,
            RotationSigner::Recovery,
            &recovery_seed,
            &identity_key,
            &now,
        );
        let device_id = uuid::Uuid::now_v7().to_string();
        let device = statement::device_cert(
            &identity_seed,
            &statement::DeviceCertInput {
                principal_id: &principal_id,
                device_id: &device_id,
                device_key: &device_seed.public_key(),
                name: &device_name,
                key_seq: head.seq + 1,
                issued_at: &now,
            },
        );

        let keys = self.keys();
        let new_device_id = device_id.clone();
        keys.put_record(&KeyRecord {
            v: 1,
            principal_id: principal_id.clone(),
            device_id,
            device_name,
            device_seed: device_seed.to_text(),
            identity_seed: Some(identity_seed.to_text()),
            pending_identity_seed: None,
            pending_identity_seq: None,
            confirmed: false,
            replaced,
        })?;
        let mut links = keys.links()?;
        if !links
            .iter()
            .any(|l| same_endpoint(&l.endpoint, endpoint) && l.principal_id == principal_id)
        {
            links.push(AccountLink {
                endpoint: endpoint.to_string(),
                principal_id: principal_id.clone(),
                user_id: None,
                username: None,
            });
            keys.put_links(&links)?;
        }
        Ok(RecoveryStatements {
            principal_id,
            device_id: new_device_id,
            entry,
            device,
        })
    }

    /// Undo a recovery the server refused: the keys it made go, and the confirmed keys it
    /// replaced, if any, come back. Keys the server has confirmed since are left alone.
    pub(crate) fn discard_recovery(&self, principal_id: &str, device_id: &str) -> Result<()> {
        let _guard = self.guard()?;
        let keys = self.keys();
        match keys.record(principal_id)? {
            Some(record) if !record.confirmed && record.device_id == device_id => {
                match record.replaced {
                    Some(previous) => keys.put_record(&previous),
                    None => keys.forget(principal_id),
                }
            }
            _ => Ok(()),
        }
    }

    /// Remove a principal's keys from this device.
    pub(crate) fn forget(&self, principal_id: &str) -> Result<()> {
        let _guard = self.guard()?;
        self.keys().forget(principal_id)
    }
}

#[cfg(test)]
mod tests;
