//! Tauri commands of key identity. Keyring work runs on the blocking pool, since a keyring
//! call can wait on an unlock prompt (see `secret_store`).

use tauri::State;
use zeroize::Zeroizing;

use super::statement::Statement;
use super::{
    CardContent, Challenge, EnrollmentDraft, EnrollmentStatements, KeyIdentityError,
    KeyIdentityState, LocalAccount, LogStatus, RecoveryStatements, ServerAccount,
};

async fn blocking<T, F>(state: &State<'_, KeyIdentityState>, f: F) -> Result<T, KeyIdentityError>
where
    T: Send + 'static,
    F: FnOnce(KeyIdentityState) -> Result<T, KeyIdentityError> + Send + 'static,
{
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || f(state))
        .await
        .map_err(|e| KeyIdentityError::Keyring(format!("key task failed: {e}")))?
}

/// Accounts on the server at `endpoint` this device holds keys for.
#[tauri::command]
pub async fn key_identity_accounts(
    state: State<'_, KeyIdentityState>,
    endpoint: String,
) -> Result<Vec<LocalAccount>, KeyIdentityError> {
    blocking(&state, move |s| s.accounts(&endpoint)).await
}

/// This computer's name, as the default device name.
#[tauri::command]
pub async fn key_identity_default_device_name() -> String {
    super::default_device_name()
}

/// Create the keys of a new identity. Returns the recovery kit to show once.
#[tauri::command]
pub async fn key_identity_begin_enrollment(
    state: State<'_, KeyIdentityState>,
    device_name: String,
) -> Result<EnrollmentDraft, KeyIdentityError> {
    blocking(&state, move |s| s.begin_enrollment(&device_name)).await
}

/// Store a draft's keys and sign what `enrollIdentityKey` needs over `challenge`.
#[tauri::command]
pub async fn key_identity_sign_enrollment(
    state: State<'_, KeyIdentityState>,
    draft_id: String,
    account: ServerAccount,
    challenge: Challenge,
) -> Result<EnrollmentStatements, KeyIdentityError> {
    blocking(&state, move |s| {
        s.sign_enrollment(&draft_id, &account, &challenge)
    })
    .await
}

/// Cancel an enrollment, removing its keys unless the server confirmed them.
#[tauri::command]
pub async fn key_identity_discard_enrollment(
    state: State<'_, KeyIdentityState>,
    draft_id: String,
) -> Result<(), KeyIdentityError> {
    blocking(&state, move |s| s.discard_enrollment(&draft_id)).await
}

/// Reconcile this device's keys with the signed-in account's `principalId`.
#[tauri::command]
pub async fn key_identity_settle(
    state: State<'_, KeyIdentityState>,
    account: ServerAccount,
    principal_id: Option<String>,
) -> Result<Option<LocalAccount>, KeyIdentityError> {
    blocking(&state, move |s| s.settle(&account, principal_id.as_deref())).await
}

/// Sign a login proof over `challenge` with this device's key.
#[tauri::command]
pub async fn key_identity_sign_login(
    state: State<'_, KeyIdentityState>,
    endpoint: String,
    principal_id: String,
    challenge: Challenge,
) -> Result<Statement, KeyIdentityError> {
    blocking(&state, move |s| {
        s.sign_login(&endpoint, &principal_id, &challenge)
    })
    .await
}

/// Verify the server's key log and settle a pending rotation against it.
#[tauri::command]
pub async fn key_identity_sync_log(
    state: State<'_, KeyIdentityState>,
    principal_id: String,
    key_log: Vec<Statement>,
) -> Result<LogStatus, KeyIdentityError> {
    blocking(&state, move |s| s.sync_log(&principal_id, &key_log)).await
}

#[tauri::command]
pub async fn key_identity_sign_revocation(
    state: State<'_, KeyIdentityState>,
    principal_id: String,
    key_log: Vec<Statement>,
    device_id: String,
) -> Result<Statement, KeyIdentityError> {
    blocking(&state, move |s| {
        s.sign_revocation(&principal_id, &key_log, &device_id)
    })
    .await
}

#[tauri::command]
pub async fn key_identity_begin_rotation(
    state: State<'_, KeyIdentityState>,
    principal_id: String,
    key_log: Vec<Statement>,
) -> Result<Statement, KeyIdentityError> {
    blocking(&state, move |s| s.begin_rotation(&principal_id, &key_log)).await
}

#[tauri::command]
pub async fn key_identity_sign_profile_card(
    state: State<'_, KeyIdentityState>,
    principal_id: String,
    key_log: Vec<Statement>,
    card: CardContent,
) -> Result<Statement, KeyIdentityError> {
    blocking(&state, move |s| {
        s.sign_profile_card(&principal_id, &key_log, &card)
    })
    .await
}

/// Sign a recovery rotation from a recovery kit, for a new identity key and this device.
#[tauri::command]
pub async fn key_identity_begin_recovery(
    state: State<'_, KeyIdentityState>,
    endpoint: String,
    kit: Zeroizing<String>,
    account_id: Option<String>,
    key_log: Vec<Statement>,
    device_name: String,
) -> Result<RecoveryStatements, KeyIdentityError> {
    blocking(&state, move |s| {
        s.begin_recovery(
            &endpoint,
            &kit,
            account_id.as_deref(),
            &key_log,
            &device_name,
        )
    })
    .await
}

/// Remove an account's keys from this device.
#[tauri::command]
pub async fn key_identity_forget(
    state: State<'_, KeyIdentityState>,
    principal_id: String,
) -> Result<(), KeyIdentityError> {
    blocking(&state, move |s| s.forget(&principal_id)).await
}
