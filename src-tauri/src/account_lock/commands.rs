//! Tauri commands of the account lock. They run on the blocking pool: an OPAQUE finish runs
//! Argon2id at 64 MiB, and the wraps live in the secret vault file.
//!
//! Each unlock then seals under the data key what the device keeps for the account under the
//! vault key alone: its key identity record and pending device links. An unlock after a login
//! or signup also wraps the device key under the server share it saw, and brings back a device
//! key that a new data key lost.

use tauri::State;

use rim_opaque::Key;

use super::{AccountLock, AccountLockError, FlowStart, LoginFinish, RegistrationFinish, Unlocked};
use crate::key_identity::KeyIdentityState;
use crate::message_cache::MessageCacheState;

async fn blocking<T, F>(state: &State<'_, AccountLock>, f: F) -> Result<T, AccountLockError>
where
    T: Send + 'static,
    F: FnOnce(AccountLock) -> Result<T, AccountLockError> + Send + 'static,
{
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || f(state))
        .await
        .map_err(|e| AccountLockError::Crypto(format!("account lock task failed: {e}")))?
}

/// What an unlock returns, with the server share it opened, if any.
trait UnlockOutcome {
    fn share(&self) -> Option<&Key>;
}

impl UnlockOutcome for Unlocked {
    fn share(&self) -> Option<&Key> {
        self.share.as_ref()
    }
}

impl UnlockOutcome for Option<Unlocked> {
    fn share(&self) -> Option<&Key> {
        self.as_ref().and_then(|unlocked| unlocked.share.as_ref())
    }
}

/// Seals `principal`'s records under the data key an unlock just held, wrapping the device key
/// under the server `share` when the unlock saw it. A record that cannot be sealed stays as it
/// was and is sealed at a later unlock.
pub(crate) fn seal_after_unlock(keys: &KeyIdentityState, principal: &str, share: Option<&Key>) {
    if let Err(e) = keys.seal_at_rest(principal, share) {
        log::warn!("[account_lock] could not seal an account's keys at its unlock: {e}");
    }
}

/// Runs the unlock `f` on the blocking pool, then [`seal_after_unlock`].
async fn unlocking<T, F>(
    state: &State<'_, AccountLock>,
    keys: &State<'_, KeyIdentityState>,
    principal: String,
    f: F,
) -> Result<T, AccountLockError>
where
    T: UnlockOutcome + Send + 'static,
    F: FnOnce(AccountLock) -> Result<T, AccountLockError> + Send + 'static,
{
    let keys = keys.inner().clone();
    blocking(state, move |s| {
        let unlocked = f(s)?;
        seal_after_unlock(&keys, &principal, unlocked.share());
        Ok(unlocked)
    })
    .await
}

/// Start registering `password`: a handle and the `RegistrationRequest`, base64url.
#[tauri::command]
pub async fn opaque_registration_start(
    state: State<'_, AccountLock>,
    password: String,
) -> Result<FlowStart, AccountLockError> {
    let password = zeroize::Zeroizing::new(password);
    blocking(&state, move |s| s.registration_start(&password)).await
}

/// Finish a registration with the server's `RegistrationResponse` (base64url). Returns the
/// `RegistrationUpload`; the export key stays under the handle.
#[tauri::command]
pub async fn opaque_registration_finish(
    state: State<'_, AccountLock>,
    handle: String,
    response: String,
) -> Result<RegistrationFinish, AccountLockError> {
    blocking(&state, move |s| s.registration_finish(&handle, &response)).await
}

/// Start a login with `password`: a handle and the `CredentialRequest`, base64url.
#[tauri::command]
pub async fn opaque_login_start(
    state: State<'_, AccountLock>,
    password: String,
) -> Result<FlowStart, AccountLockError> {
    let password = zeroize::Zeroizing::new(password);
    blocking(&state, move |s| s.login_start(&password)).await
}

/// Finish a login with the server's `CredentialResponse` (base64url). Returns the
/// `CredentialFinalization`; the export key and the session key stay under the handle.
/// `WRONG_PASSWORD` when the login does not verify.
#[tauri::command]
pub async fn opaque_login_finish(
    state: State<'_, AccountLock>,
    handle: String,
    response: String,
) -> Result<LoginFinish, AccountLockError> {
    blocking(&state, move |s| s.login_finish(&handle, &response)).await
}

/// Unlock `principal` after a login: `sealedShare` is the server share sealed under the
/// login's transport key, `rewraps` the server's rewraps of older unlock keys, `keep` whether
/// the account stays signed in on this device, `startEmpty` whether to start over here when
/// nothing opens although the device holds a recovery wrap (otherwise `NEEDS_RECOVERY`).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn account_unlock_after_login(
    state: State<'_, AccountLock>,
    keys: State<'_, KeyIdentityState>,
    handle: String,
    principal: String,
    sealed_share: String,
    rewraps: Vec<String>,
    keep: bool,
    start_empty: bool,
) -> Result<Unlocked, AccountLockError> {
    unlocking(&state, &keys, principal.clone(), move |s| {
        s.unlock_after_login(
            &handle,
            &principal,
            &sealed_share,
            &rewraps,
            keep,
            start_empty,
        )
    })
    .await
}

/// Unlock a new `principal` after the signup registered its password: `share` is the server
/// share in the clear, `recoveryEntropy` the recovery phrase's 16 bytes when this device holds
/// them, all base64url.
#[tauri::command]
pub async fn account_unlock_after_signup(
    state: State<'_, AccountLock>,
    keys: State<'_, KeyIdentityState>,
    handle: String,
    principal: String,
    share: String,
    recovery_entropy: Option<String>,
    keep: bool,
) -> Result<Unlocked, AccountLockError> {
    unlocking(&state, &keys, principal.clone(), move |s| {
        s.unlock_after_signup(
            &handle,
            &principal,
            &share,
            recovery_entropy.as_deref(),
            keep,
        )
    })
    .await
}

/// Unlock a kept `principal` without the server, or null when it is not kept here.
#[tauri::command]
pub async fn account_unlock_kept(
    state: State<'_, AccountLock>,
    keys: State<'_, KeyIdentityState>,
    principal: String,
) -> Result<Option<Unlocked>, AccountLockError> {
    unlocking(&state, &keys, principal.clone(), move |s| {
        s.unlock_kept(&principal)
    })
    .await
}

/// Unlock `principal` with its recovery phrase's 16 bytes (base64url), or null when this
/// device has no recovery wrap for it or the phrase does not open it.
#[tauri::command]
pub async fn account_unlock_with_recovery(
    state: State<'_, AccountLock>,
    keys: State<'_, KeyIdentityState>,
    principal: String,
    entropy: String,
) -> Result<Option<Unlocked>, AccountLockError> {
    unlocking(&state, &keys, principal.clone(), move |s| {
        s.unlock_with_recovery(&principal, &entropy)
    })
    .await
}

/// Lock `principal`: drop its data key and close its message cache databases, which hold the
/// only copies of their keys in memory.
#[tauri::command]
pub async fn account_lock(
    state: State<'_, AccountLock>,
    cache: State<'_, MessageCacheState>,
    principal: String,
) -> Result<(), AccountLockError> {
    state.lock_account(&principal);
    cache.close_principal(&principal);
    Ok(())
}

/// Stop keeping `principal` signed in on this device: delete its keep key and keep wrap.
#[tauri::command]
pub async fn account_forget_keep(
    state: State<'_, AccountLock>,
    principal: String,
) -> Result<(), AccountLockError> {
    blocking(&state, move |s| s.forget_keep(&principal)).await
}
