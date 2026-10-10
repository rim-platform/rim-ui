//! Proof-of-work for a key-only signup on a relay in `pow` registration mode: the smallest
//! counter, as an 8-byte big-endian nonce, whose
//! `SHA-256("rim.pow.v1\0" || server id || "\0" || inception payload || nonce)` starts with the
//! relay's `powBits` zero bits. The search runs on every core and stops when cancelled.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::key_identity::KeyIdentityError;

/// Context bytes the hash starts with.
const POW_CONTEXT: &[u8] = b"rim.pow.v1\0";

/// Highest difficulty a server may ask for.
pub(crate) const MAX_POW_BITS: u32 = 40;

/// Counters one thread takes at a time.
const CHUNK: u64 = 1 << 14;

/// The hasher with everything before the nonce already fed in.
fn prefix(server_id: &str, inception_payload: &str) -> Sha256 {
    let mut hasher = Sha256::new();
    hasher.update(POW_CONTEXT);
    hasher.update(server_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(inception_payload.as_bytes());
    hasher
}

fn hash_from(prefix: &Sha256, counter: u64) -> [u8; 32] {
    let mut hasher = prefix.clone();
    hasher.update(counter.to_be_bytes());
    hasher.finalize().into()
}

/// The hash a nonce is judged by.
#[cfg(test)]
fn pow_hash(server_id: &str, inception_payload: &str, counter: u64) -> [u8; 32] {
    hash_from(&prefix(server_id, inception_payload), counter)
}

/// How many zero bits a hash starts with.
fn leading_zero_bits(hash: &[u8]) -> u32 {
    let mut bits = 0;
    for byte in hash {
        if *byte != 0 {
            return bits + byte.leading_zeros();
        }
        bits += 8;
    }
    bits
}

/// The smallest counter that meets `bits`, searched on `threads` threads: each takes the next
/// chunk of counters until a chunk starts above the best counter found, so every counter
/// below the answer is tried. `None` when `cancel` is set first.
fn solve(
    server_id: &str,
    inception_payload: &str,
    bits: u32,
    threads: usize,
    cancel: &AtomicBool,
) -> Option<u64> {
    let prefix = prefix(server_id, inception_payload);
    let next_chunk = AtomicU64::new(0);
    let best = AtomicU64::new(u64::MAX);
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            scope.spawn(|| loop {
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                let start = next_chunk
                    .fetch_add(1, Ordering::Relaxed)
                    .saturating_mul(CHUNK);
                if start >= best.load(Ordering::Relaxed) {
                    return;
                }
                for counter in start..start.saturating_add(CHUNK) {
                    if leading_zero_bits(&hash_from(&prefix, counter)) >= bits {
                        best.fetch_min(counter, Ordering::Relaxed);
                        return;
                    }
                }
            });
        }
    });
    if cancel.load(Ordering::Relaxed) {
        return None;
    }
    Some(best.load(Ordering::Relaxed))
}

/// Searches under way, by the id the webview gave each, to cancel them by.
#[derive(Default)]
pub(crate) struct PowState {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Find the proof-of-work for a signup at `server_id` with this inception payload: the nonce
/// as unpadded base64url, or `None` when `relay_cancel_pow` stopped it.
#[tauri::command]
pub async fn relay_solve_pow(
    state: State<'_, PowState>,
    job_id: String,
    server_id: String,
    inception_payload: String,
    bits: u32,
) -> Result<Option<String>, KeyIdentityError> {
    if !(1..=MAX_POW_BITS).contains(&bits) {
        return Err(KeyIdentityError::Invalid(format!(
            "a proof-of-work of {bits} bits is not one this app computes"
        )));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state
            .jobs
            .lock()
            .map_err(|_| KeyIdentityError::Invalid("proof-of-work lock poisoned".into()))?;
        if jobs.contains_key(&job_id) {
            return Err(KeyIdentityError::Invalid(
                "that proof-of-work is already running".into(),
            ));
        }
        jobs.insert(job_id.clone(), cancel.clone());
    }
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    let found = tauri::async_runtime::spawn_blocking(move || {
        solve(&server_id, &inception_payload, bits, threads, &cancel)
    })
    .await;
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.remove(&job_id);
    }
    let found =
        found.map_err(|e| KeyIdentityError::Invalid(format!("proof-of-work failed: {e}")))?;
    Ok(found.map(|counter| URL_SAFE_NO_PAD.encode(counter.to_be_bytes())))
}

/// Stop a search `relay_solve_pow` is running; nothing happens when it already ended.
#[tauri::command]
pub async fn relay_cancel_pow(
    state: State<'_, PowState>,
    job_id: String,
) -> Result<(), KeyIdentityError> {
    if let Ok(jobs) = state.jobs.lock() {
        if let Some(cancel) = jobs.get(&job_id) {
            cancel.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vectors() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../protocol/pow-vectors.json"))
            .expect("pow-vectors.json is JSON")
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn counts_leading_zero_bits() {
        assert_eq!(leading_zero_bits(&[0x80]), 0);
        assert_eq!(leading_zero_bits(&[0x01]), 7);
        assert_eq!(leading_zero_bits(&[0x00, 0x2f]), 10);
        assert_eq!(leading_zero_bits(&[0x00, 0x00]), 16);
    }

    /// The server's known answer: 16 bits at the vector relay for key identity's inception.
    #[test]
    fn reproduces_the_server_vector() {
        let relay = "rims1_T5LLFxkrobgyvlf3WVxuvLlfqYSZAssRFgmvCfI2R-c";
        let inception = r#"{"v":2,"type":"inception","seq":0,"identityKey":"ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}"#;
        let counter = solve(relay, inception, 16, 4, &AtomicBool::new(false)).unwrap();
        assert_eq!(counter, 37283);
        assert_eq!(URL_SAFE_NO_PAD.encode(counter.to_be_bytes()), "AAAAAAAAkaM");
        assert_eq!(
            hex(&pow_hash(relay, inception, counter)),
            "00002f63d137749fda27201ccf9d282a4ed846287d49c55fea89a47617e78ed6"
        );
    }

    /// The vectors the web app's search reproduces too, so both find the same nonce.
    #[test]
    fn finds_the_shared_vectors_on_any_number_of_threads() {
        let v = vectors();
        for case in v["cases"].as_array().unwrap() {
            let server_id = case["serverId"].as_str().unwrap();
            let payload = case["inceptionPayload"].as_str().unwrap();
            let bits = case["bits"].as_u64().unwrap() as u32;
            let expected = case["counter"].as_u64().unwrap();
            for threads in [1, 3, 8] {
                let found = solve(server_id, payload, bits, threads, &AtomicBool::new(false));
                assert_eq!(found, Some(expected), "{}", case["description"]);
            }
            assert_eq!(
                URL_SAFE_NO_PAD.encode(expected.to_be_bytes()),
                case["nonce"].as_str().unwrap()
            );
            assert_eq!(
                hex(&pow_hash(server_id, payload, expected)),
                case["hash"].as_str().unwrap()
            );
        }
    }

    #[test]
    fn a_cancelled_search_finds_nothing() {
        let cancel = AtomicBool::new(true);
        assert_eq!(solve("rims1_x", "{}", MAX_POW_BITS, 2, &cancel), None);
    }

    #[test]
    fn a_search_stops_when_cancelled_from_another_thread() {
        let cancel = Arc::new(AtomicBool::new(false));
        let stopper = {
            let cancel = cancel.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(50));
                cancel.store(true, Ordering::Relaxed);
            })
        };
        assert_eq!(solve("rims1_x", "{}", MAX_POW_BITS, 2, &cancel), None);
        stopper.join().unwrap();
    }
}
