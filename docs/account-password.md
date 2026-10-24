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
| `src/core/accountVault/` | The web app's account lock: the derivations and AES-256-GCM wraps byte for byte as `rim_opaque` makes them (`crypto.ts`), the wraps of each account's data key (`dkWraps.ts`), the vault that holds the unlocked account's keys in memory and seals records under them (`accountVault.ts`, `sealedRecords.ts`), and the account's sealed small values (`sealedStorage.ts`) |
| `src/features/auth/runtime/accountUnlock.ts` | The web app's unlocks after a login, a signup, the recovery phrase and a kept session, and the lock at sign-out |
| `src/features/auth/runtime/unlockGate.ts` | Whether the signed-in account is unlocked; the app's shell renders nothing that reads its data until it is |

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

## The web app's account lock

The web app keeps the same data key per account and browser, wrapped the same way, and does in
TypeScript what `account_lock` does in Rust: the export key and the session key come from the
OPAQUE module, the unlock key and the transport key from its `unlockKey` and `transportKey`, and
every other derivation and wrap from WebCrypto (`src/core/accountVault/crypto.ts`, whose tests
open values sealed by another implementation from the desktop's test inputs).

The wraps are one record per account in the `dataKeys` store of IndexedDB `rim-key-identity`,
keyed `[endpoint, principalId]`: `{passwordWrap, recoveryWrap?, keepWrap?}`, each base64url of
`nonce ‖ ciphertext ‖ tag`. The record itself is not sealed.

| Function (`accountUnlock.ts`) | What it does |
|---|---|
| `unlockAfterLogin({endpoint, principalId, exportKey, sessionKey, serverShare, rewraps, startEmpty?})` | As `account_unlock_after_login`, with the same rule: when nothing opens and the browser holds a recovery wrap, it throws `NeedsRecoveryError` (`NEEDS_RECOVERY`) and changes nothing. The keep wrap goes; a kept session writes a new one |
| `unlockAfterSignup({endpoint, principalId, exportKey, serverShare, recoveryEntropy})` | As `account_unlock_after_signup`, with the share in the clear |
| `unlockWithRecovery(endpoint, principalId, entropy)` | Opens the recovery wrap; `false` when there is none or the phrase does not open it |
| `keepUnlocked(keepKey)`, `unlockKept(endpoint, principalId, keepKey)` | "Keep me signed in": the server holds the keep key with the session, and the browser keeps the keep wrap |
| `unlockKeptOnDesktop(endpoint, principalId)` | `account_unlock_kept`; the webview gets the store key alone |
| `lockAccount()` | Sign-out: the keys leave memory, the encrypted store closes, the sealed stores go back to their initial state, and the keep wrap goes |

### What the data key seals in the browser

Each unlock puts the data key in the account vault, which derives the "web stores" key
(`HKDF-SHA256(ikm = data key, salt = "rim.store.v1", info = "web stores")`), a non-extractable
AES-GCM key. A sealed field is `{v: 1, iv, ct}`: AES-256-GCM under that key with a random 12-byte
nonce, authenticating `"<db>/<store>/<record key as JSON>"`, so a record moved under another key
does not open. The fields a store looks records up by stay plain; every other field is sealed in
one `data` field. A record that does not open under the unlocked account reads as absent, and
reading or writing a sealed store while locked throws `VaultLockedError` (`VAULT_LOCKED`).

| Database | Store | Plain |
|---|---|---|
| `rim-key-identity` | `deviceKeys` | endpoint, principal, device id and name, user id and name, `confirmed`, `kitConfirmed`, and `deviceWrap` (below); the device key, identity key, pending identity key, recovery kit entropy and the keys a recovery replaced are sealed, each private key wrapped as pkcs8 and unwrapped as a non-extractable key |
| `rim-key-identity` | `deviceLinks` | link id, endpoint, principal, device id and key; the certificate and the answer are sealed. Written only while the account is unlocked |
| `rim-e2ee` | every store | the key fields, and the conversation, thread and time of a message, which the timeline and thread indexes read |
| `rim-relay` | every store but `servers` | the key fields; the pinned servers are public and stay plain |
| `rim-plugins` | `installs`, `storage`, `settings` | the key fields and an install's bundle hash; `bundles` and `principalIds` are public and stay plain |
| `rim-account` | `kv` | `[endpoint, principalId, name]`; the value is sealed |

`rim-account` holds what the app kept per account in localStorage: drafts
(`rim-drafts`), removal notices (`rim-workspace-removals`), pending join requests elsewhere
(`rim:remote-join-requests:<account>`), the dismissed "not encrypted" dialogs
(`rim.e2ee.plaintextNoticeSeen`) and the agent's conversations and switches (`rim-agent-store`,
`rim-agent-encrypted`). At unlock they are read into memory and their stores hydrate; at lock
they go back to their initial state. The app removes those localStorage keys at start.

Opening a database written by an earlier version empties the stores it wrote unsealed, with no
migration: the account's keys in this browser are gone, and it signs in again after recovery or
a new device link.

- A signup, a recovery or a new device of a device link writes the keys before the account's
  first unlock in this browser. They stay unsealed, as extractable keys, until that unlock seals
  them; until then a sign-in signs with them as before. Once sealed, signing needs the account
  unlocked, so a sign-in unlocks before it signs its proof.
- `deviceWrap` is the device key's 32-byte seed sealed under
  `HKDF-SHA256(ikm = server share, salt = "rim.device-key.v1", info = principal id)` with the
  associated data `"rim.device-key.v1|<principal id>"`, as the desktop writes it. Each unlock
  after a login or a signup writes it again; when the account starts empty, the device key comes
  back from it and is sealed under the new data key, and the other keys stay lost.
- While the account is locked, its key record reads with its keys absent, for the sign-in list,
  and a change to its plain fields (settling with the server) writes the sealed field back
  unchanged.

