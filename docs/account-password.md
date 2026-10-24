# Account password: the client crates

The account password is checked with OPAQUE (RFC 9807): the server keeps a registration record
that verifies the password without ever seeing it, and each sign-in gives the device two keys,
the export key (only the device knows it) and the session key (shared with the server). The
contract, the server side and the key derivations are in rim-server's documentation; this page
says where the client's half lives.

## What lives where

| Where | What |
|---|---|
| `src-tauri/crates/rim_opaque` | The suite (`RimOpaque`: OPRF and 3DH over ristretto255 with SHA-512, Argon2id at 64 MiB, 3 passes, 4 lanes), the client's registration and login flows (`ClientRegistrationFlow`, `ClientLoginFlow`, bound to the context `rim-opaque-v1`), and the derivations: the transport key, the unlock key, the recovery wrap key, the store keys, the device key wrap key, and the AES-256-GCM wraps of the data key, rewraps of an old unlock key and wraps of the device key's seed |
| `src-tauri/crates/rim_opaque/tests/vectors/opaque-v1.json` | One registration and one login from a seeded RNG, byte for byte; rim-server replays the same file, so both sides prove they run the same suite |
| `src-tauri/crates/rim_opaque_wasm` | The web app's `wasm-bindgen` facade: `OpaqueRegistration` and `OpaqueLogin` (constructor with the password, `request()`, `finish(response)`), `unlockKey` and `transportKey`. The flows keep their state and the password in the module and wipe them when they finish or are freed. A failure throws an `Error` named by its code (`OPAQUE_WRONG_PASSWORD`, `OPAQUE_MALFORMED`, `OPAQUE_INVALID`, `OPAQUE_USED`, …) |
| `src/features/auth/opaque/wasm/` | Its build, committed like the MLS module (`e2ee-web.md`, "The wasm build"): 183,185 bytes, 68,549 gzipped |
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
| `account_lock(principal)` | Drops the data key and closes the account's message cache databases, which hold the only copies of their keys in memory |
| `account_forget_keep(principal)` | Deletes the keep key and the keep wrap |

Every unlock returns `{webStoreKey, startedEmpty}`: the key that seals the webview's IndexedDB
records of the account, and whether the data key is new. A handle lasts two minutes and serves
one unlock.

After each unlock command, the account's key identity record and pending device links are
sealed under the data key if they were not yet (below). An unlock after a login or a signup also
wraps the device key under the server share it opened (below, "The device key's wrap").

## What the data key seals on the desktop

Each sealed value is AES-256-GCM (`rim_opaque::seal`) under a store key derived from the data
key, with the secret vault record's name as associated data, so a value copied under another
name does not open. While the account is locked, nothing below opens, and a command that needs it
answers `LOCKED`.

| Vault record | Store key | What is sealed |
|---|---|---|
| `key-identity-v1:<principal id>` | "desktop vault" | The device key, the identity key, a pending one, the backup key, the recovery kit's entropy and the keys a recovery replaced, in one `sealed` field. What names the keys stays under the vault key alone, for the sign-in list: the principal, the device's id and name, and whether the server and the person confirmed the keys |
| `device-link-v1:<link id>` | "desktop vault" | The whole pending link, as `{principalId, sealed}` |
| `message-cache-key-v1:<file stem>` | "cache key" | The account's message cache key (`local-message-cache.md`) |
| `plugin-setting-v1:<plugin>:<account>:<key>` | "desktop vault" | The secret setting's value, after `sealed-v1:` (`secret-vault.md`) |

- A signup, a recovery or a new device of a device link writes its keys before the account's
  first unlock. Those fields stay under the vault key alone until the unlock that follows, which
  seals them; so are records written before the data key existed.
- Until then those commands work as before. Once sealed, a locked account's record answers only
  the sign-in list and settling with the server; every command that uses a key answers `LOCKED`:
  signing in and the login proof for another server, device requests and delegations, this
  device's id and key, MLS statements, revoking a device, the recovery kit, syncing the key log,
  rotation, profile cards, plugin manifests, confirming a device link and the identity key
  backup. A sign-in therefore unlocks the account before it signs its proof.
- When the data key is new (the account started empty on this device), what was sealed under the
  earlier one no longer opens: the record keeps its names and loses its keys, and the message
  cache starts over. The device key comes back from its wrap under the server share (below),
  so the device still signs in; the identity key, the backup key and the recovery kit's entropy
  stay lost. When that wrap does not open either (missing, or the server share changed), the
  device key is lost too, sign-in answers `NO_KEYS`, and this device signs in again only after
  recovery or a new device link.
- The key identity index, the history archive keys, the AI provider keys and the offline session
  record are the app's and stay under the vault key alone.

### The device key's wrap

The key identity record also holds `deviceWrap`, under the vault key alone next to `sealed`:
base64url of `nonce ‖ ciphertext ‖ tag`, the device key's 32-byte seed sealed with AES-256-GCM
under `HKDF-SHA256(ikm = server share, salt = "rim.device-key.v1", info = principal id)`, with
the associated data `"rim.device-key.v1|<principal id>"` (`rim_opaque::device_key_wrap_key`,
`wrap_device_seed`, `unwrap_device_seed`).

- `account_unlock_after_login` and `account_unlock_after_signup` know the server share, so each
  writes the wrap again, under a new nonce, as it seals the record.
- When the record's sealed keys do not open under the data key the unlock holds (the account
  started empty), the device key is opened from the wrap with this login's share and sealed
  under the new data key.
- The share stays at the server across password changes and resets, so the wrap opens after a
  reset made on another device. Copied off the device, it opens only for someone who also has
  the server share, which the server releases only after a password check.
