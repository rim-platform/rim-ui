//! Tauri commands that check server statements. They hold no state: the webview keeps the pins
//! and passes in the key a statement must verify under.

use crate::key_identity::statement::{replay, verified_card, Statement, VerifiedCard};
use crate::key_identity::KeyIdentityError;

use super::server::{self, HostEvent, HostResponse, ResponseExpectation, VerifiedDiscovery};

/// Verify a discovery document fetched for `origin`.
#[tauri::command]
pub async fn relay_verify_discovery(
    document: String,
    origin: String,
) -> Result<VerifiedDiscovery, KeyIdentityError> {
    server::verify_discovery(&document, &origin)
}

/// Verify a server key log on its own (a pin read back from storage).
#[tauri::command]
pub async fn relay_replay_server_log(
    log: Vec<Statement>,
) -> Result<server::ServerHead, KeyIdentityError> {
    server::replay_server_log(&log)
}

/// The `keySeq` a host response names, read before the key to check it with is chosen.
#[tauri::command]
pub async fn relay_host_response_key_seq(
    encoded: String,
    signature: String,
) -> Result<u32, KeyIdentityError> {
    Ok(HostResponse::read(&encoded, &signature)?.key_seq())
}

/// Check a host response against the request it answers, under `host_key`.
#[tauri::command]
pub async fn relay_verify_host_response(
    encoded: String,
    signature: String,
    host_key: String,
    expected: ResponseExpectation,
) -> Result<(), KeyIdentityError> {
    let response = HostResponse::read(&encoded, &signature)?;
    server::verify_host_response(&response, &host_key, &expected)
}

/// Read a host-event envelope; with `host_key`, also check its signature.
#[tauri::command]
pub async fn relay_read_host_event(
    envelope: Statement,
    host_key: Option<String>,
) -> Result<HostEvent, KeyIdentityError> {
    let event = server::read_host_event(&envelope)?;
    if let Some(key) = host_key {
        if !server::verify_host_event(&envelope, &key) {
            return Err(KeyIdentityError::Invalid(
                "host event: signature does not verify".into(),
            ));
        }
    }
    Ok(event)
}

/// Verify `principal_id`'s key log and the profile card against its head: what a person's relay
/// served about them, before their name or relays are shown or used.
#[tauri::command]
pub async fn relay_verify_card(
    principal_id: String,
    key_log: Vec<Statement>,
    card: Statement,
) -> Result<VerifiedCard, KeyIdentityError> {
    let head = replay(&key_log)?;
    if head.principal_id != principal_id {
        return Err(KeyIdentityError::Invalid(
            "the key log belongs to another account".into(),
        ));
    }
    verified_card(&card, &head)
}
