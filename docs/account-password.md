# Account password: the client crates

The account password is checked with OPAQUE (RFC 9807): the server keeps a registration record
that verifies the password without ever seeing it, and each sign-in gives the device two keys,
the export key (only the device knows it) and the session key (shared with the server). The
contract, the server side and the key derivations are in rim-server's documentation; this page
says where the client's half lives.

## What lives where

| Where | What |
|---|---|
| `src-tauri/crates/rim_opaque` | The suite (`RimOpaque`: OPRF and 3DH over ristretto255 with SHA-512, Argon2id at 64 MiB, 3 passes, 4 lanes), the client's registration and login flows (`ClientRegistrationFlow`, `ClientLoginFlow`, bound to the context `rim-opaque-v1`), and the derivations: the transport key, the unlock key, the recovery wrap key, the store keys, and the AES-256-GCM wraps of the data key and rewraps of an old unlock key |
| `src-tauri/crates/rim_opaque/tests/vectors/opaque-v1.json` | One registration and one login from a seeded RNG, byte for byte; rim-server replays the same file, so both sides prove they run the same suite |
| `src-tauri/crates/rim_opaque_wasm` | The web app's `wasm-bindgen` facade: `OpaqueRegistration` and `OpaqueLogin` (constructor with the password, `request()`, `finish(response)`), `unlockKey` and `transportKey`. The flows keep their state and the password in the module and wipe them when they finish or are freed. A failure throws an `Error` named by its code (`OPAQUE_WRONG_PASSWORD`, `OPAQUE_MALFORMED`, `OPAQUE_INVALID`, `OPAQUE_USED`, …) |
| `src/features/auth/opaque/wasm/` | Its build, committed like the MLS module (`e2ee-web.md`, "The wasm build"): 183,185 bytes, 68,548 gzipped |
| `src/features/auth/opaque/opaqueModule.ts` | Loads the module on first use, from the screens that ask for the password only |
| `src-tauri/src/account_lock/` | The desktop's account lock: the OPAQUE flows run in Rust, behind a handle, so the export key and the session key never reach the webview, and each account's data key is unwrapped there |
| `src/features/auth/api/accountLock.ts` | The webview's wrappers of the account lock's commands |

## The desktop's account lock

Each account on the device has a data key, 32 random bytes, held in memory only while the
account is unlocked. The secret vault (`secret-vault.md`) keeps its wraps:

| Vault record | What |
|---|---|
| `account-dk-v1:<principal id>` | JSON `{passwordWrap, recoveryWrap?, keepWrap?}`, each base64url of `nonce ‖ ciphertext ‖ tag` |
| `account-keep-v1:<principal id>` | The keep key of "Keep me signed in", base64url |

| Command | What it does |
|---|---|
| `opaque_registration_start(password)`, `opaque_registration_finish(handle, response)` | A registration; the finish returns the upload and keeps the export key under the handle |
| `opaque_login_start(password)`, `opaque_login_finish(handle, response)` | A login; the finish returns the finalization and keeps the export key and the session key. A wrong password is `WRONG_PASSWORD` and ends the handle |
| `account_unlock_after_login(handle, principal, sealedShare, rewraps, keep, startEmpty)` | Opens the server share with the transport key, derives the unlock key and opens the password wrap, directly or through the rewraps (then wraps it under the current key), or takes the data key the recovery phrase just unlocked. When nothing opens and the device holds a recovery wrap, it answers `NEEDS_RECOVERY`, changes nothing and keeps the handle: the app offers the recovery phrase (`account_unlock_with_recovery`, then this call again) or starting empty (this call with `startEmpty`). With no recovery wrap, or with `startEmpty`, the account starts over with a new data key (`startedEmpty`). `keep` writes the keep wrap; without it, any keep wrap goes |
| `account_unlock_after_signup(handle, principal, share, recoveryEntropy?, keep)` | A new data key, wrapped under the unlock key, and under the recovery phrase when its entropy is given |
| `account_unlock_kept(principal)` | Opens the keep wrap without the server, or null |
| `account_unlock_with_recovery(principal, entropy)` | Opens the recovery wrap, or null |
| `account_lock(principal)` | Drops the data key, closes the account's message cache databases and wipes the cache key held in memory |
| `account_forget_keep(principal)` | Deletes the keep key and the keep wrap |

Every unlock returns `{webStoreKey, startedEmpty}`: the key that seals the webview's IndexedDB
records of the account, and whether the data key is new. A handle lasts two minutes and serves
one unlock.
