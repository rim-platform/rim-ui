//! This device's MLS identity and key packages.

use rim_mls::{
    plan_key_package_upload, DeviceRef, KeyPackageStatus, Mls, SignedStatement, SqliteStore,
};
use rusqlite::Transaction;
use serde::Deserialize;

use super::{b64, Result};

/// Make sure this device has an MLS signature key and an `mls-key` statement for it, signed
/// by `sign` (the device key, whose public key is `device_key`).
pub(crate) fn ensure_identity(
    tx: &Transaction<'_>,
    mls: &Mls,
    device: &DeviceRef,
    device_key: &str,
    sign: impl FnOnce(&[u8], String) -> SignedStatement,
) -> Result<SignedStatement> {
    Ok(mls.ensure_identity(&SqliteStore::new(tx), device, device_key, sign)?)
}

/// `myMlsKeyPackageStatus` for the group suite, as the webview read it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyPackageStatusInput {
    pub available: u32,
    #[serde(default)]
    pub last_resort_not_after: Option<String>,
    #[serde(default)]
    pub last_resort_claims: Option<u32>,
}

impl KeyPackageStatusInput {
    fn status(&self) -> KeyPackageStatus {
        KeyPackageStatus {
            available: self.available,
            last_resort_not_after: self
                .last_resort_not_after
                .as_deref()
                .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
                .map(|at| at.timestamp().max(0) as u64),
            last_resort_claims: self.last_resort_claims,
        }
    }
}

/// Delete the private keys of expired and replaced key packages, then generate what the server
/// needs: a top-up to 20 one-time packages below 10, at least `min_one_time` of them (fresh
/// packages after a re-add request), and a new last-resort package when the current one is
/// expiring or overused. Returns the `MLSMessage`s to upload, base64url.
pub(crate) fn refresh_key_packages(
    tx: &Transaction<'_>,
    mls: &Mls,
    status: Option<&KeyPackageStatusInput>,
    min_one_time: usize,
    now: u64,
) -> Result<Vec<String>> {
    let store = SqliteStore::new(tx);
    let pruned = mls.prune_key_packages(&store, now)?;
    if pruned > 0 {
        log::info!("[e2ee] deleted the keys of {pruned} old key packages");
    }
    let plan = plan_key_package_upload(
        &status
            .map(KeyPackageStatusInput::status)
            .unwrap_or_default(),
        now,
    );
    let mut packages =
        mls.generate_key_packages(&store, plan.one_time.max(min_one_time), false, now)?;
    if plan.last_resort {
        packages.extend(mls.generate_key_packages(&store, 1, true, now)?);
    }
    Ok(packages.iter().map(|p| b64(&p.message)).collect())
}
