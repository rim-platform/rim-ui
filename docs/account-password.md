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
| `src/core/accountVault/` | The web app's account lock: the derivations and AES-256-GCM wraps byte for byte as `rim_opaque` makes them (`crypto.ts`), the wraps of each account's data key (`dkWraps.ts`), the vault that holds the unlocked account's keys in memory and seals records under them (`accountVault.ts`, `sealedRecords.ts`), and the account's sealed small values (`sealedStorage.ts`) |
| `src/features/auth/runtime/accountUnlock.ts` | The web app's unlocks after a login, a signup, the recovery phrase and a kept session, and the lock at sign-out |
| `src/features/auth/runtime/unlockGate.ts` | Whether the signed-in account is unlocked; the app's shell renders nothing that reads its data until it is |
| `src/features/auth/api/passwordApi.ts` | The password's GraphQL calls (registration, login, change, reset), and the errors a sign-in reads: `PasswordLockedError`, `PasswordWaitError`, `WrongPasswordError` |
| `src/features/auth/runtime/opaqueFlows.ts` | One shape for the OPAQUE flows on either platform: `startRegistration` and `startLogin` run the WebAssembly module in the web app and the desktop's commands behind a handle, then serve the unlock or a password change's rewrap |
| `src/features/auth/runtime/passwordChanges.ts` | Changing the password and resetting it with the recovery phrase |
| `src/features/key-identity/api/keyIdentity.ts` | `signInWithPassword` and `signupWithKey`, the password and the device key together |
| `src/features/auth/password.ts`, `src/features/auth/components/Password*.tsx` | The PIN and passphrase rules and the screens that ask for the password |
| `src/core/graphql/sessionSecret.ts` | The session secret of an unkept session, in memory only |
| `src/features/auth/runtime/reloadWindow.ts` | The web app's reload window |
| `src/features/auth/api/sessionKeys.ts` | `sessionKeepKey`, `setReloadKey` and `reloadSession` |

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
| `account_unlock_after_signup(handle, principal, share, recoveryEntropy?, keep)` | A new data key, wrapped under the unlock key, and under the recovery phrase when its entropy is given. An account unlocked already (it signs up at the relay it switches to) keeps its data key and its recovery wrap |
| `account_unlock_kept(principal)` | Opens the keep wrap without the server, or null |
| `account_unlock_with_recovery(principal, entropy)` | Opens the recovery wrap, or null |
| `account_lock(principal)` | Drops the data key and closes the account's message cache databases, which hold the only copies of their keys in memory |
| `account_forget_keep(principal)` | Deletes the keep key and the keep wrap |
| `account_password_rewrap(loginHandle, sealedShare, registrationHandle, principal)` | A password change's rewrap: the old unlock key, from a finished login with the current password and the share it sealed, sealed under the new one, from the finished registration of the new password. The registration handle keeps the new unlock key |
| `account_password_commit(handle, principal)` | Once the server took the change: wraps the unlocked account's data key under the new unlock key the rewrap left under `handle` |
| `account_add_recovery_wrap(principal, entropy)` | Wraps the unlocked account's data key under its recovery phrase too, on a device that now holds the phrase |
| `key_identity_sign_password_reset(endpoint, principalId, entropy, challenge)` | A `password-reset` statement over a `passwordResetChallenge`, signed by the recovery key of the phrase's 16 bytes (base64url), for the server at `endpoint` |

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
| `lockAccount()` | Sign-out: the keys leave memory, the encrypted store closes, the sealed stores go back to their initial state, and the keep wrap goes. On the desktop it also runs `account_lock` |
| `unlockAfterLoginOnDesktop`, `unlockAfterSignupOnDesktop`, `unlockWithRecoveryOnDesktop` | The desktop's commands of the same unlocks, with the store key they hand over put in the vault |
| `addRecoveryWrapToUnlocked(entropy)` | Wraps the unlocked account's data key under its recovery phrase too |
| `passwordChangeRewrap(...)`, `commitPasswordChange(newUnlockKey)` | A password change's rewrap in the browser, and the wrap under the new unlock key once the server took it |
| `holdSession({sessionSecret, keepKey})` | After a sign-in or signup: holds the session secret and keeps it for a reload, or wraps the data key under the keep key |
| `lockAccount()` | Sign-out: the keys leave memory, the session secret and what the tab kept for a reload go, the encrypted store closes, the sealed stores go back to their initial state, and the keep wrap goes |

At start the unlock gate opens a kept account without the password: in the web app with the
keep key `sessionKeepKey` returns, on the desktop with `account_unlock_kept`.

### The session secret and the reload window

A session signed in without "Keep me signed in" gets a session secret (32 bytes, base64url),
which the app holds in memory only. The GraphQL client sends it in `X-RIM-Session-Secret` on
every request, the WebSocket in its `connection_init` payload as `sessionSecret`, and every
upload or other request that is not a plain GET adds it through `authHeaders()`. Without it the
server treats a request as anonymous and closes the WebSocket with 4401, which signs out. Plain
GETs of files stay cookie-only. A session the desktop opens directly at another server is kept
with its keep key held by the app (`keepSignedIn` and `keepKeyHeld`), so it needs no secret, and
this server's secret never goes there.

A reload loses both the data key and the secret. While the account is unlocked, the tab keeps
them in `sessionStorage` under `rim:reload:<endpoint>`: base64url of `nonce ‖ ciphertext ‖ tag`,
AES-256-GCM under a reload key `setReloadKey` makes, authenticating the storage key, of
`{v: 1, principalId, dataKey, sessionSecret}`. At start, before it asks the server who is signed
in, the page calls `reloadSession`, which needs the cookie and the CSRF token but not the secret,
opens the stored value with the `reloadKey` it returns, seals it again under `nextReloadKey` and
unlocks the account. The server answers once, within 60 seconds of the session's WebSocket
closing; after that, after a browser restart or in a copied profile, it answers nothing, the
stored value goes and the account is locked.

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

## The password at sign-in, signup and after

`signInWithPassword(principalId, {password, keep}, options)` checks the password before the
device key signs, so the keys sealed under the data key are open when it does:

1. `passwordLoginStart` (the server counts a try: `RATE_LIMITED` with `retryAfterSeconds` reads as
   `PasswordWaitError`, "Try again in N minutes", and `PASSWORD_LOCKED` as `PasswordLockedError`);
2. the OPAQUE finish on this device, where a wrong password stops (`WrongPasswordError`);
3. `passwordLoginFinish`, which answers a single-use ticket, the sealed server share and the
   rewraps;
4. the unlock. When this device's data needs the recovery phrase, `options.onNeedsRecovery` asks
   the person for the phrase (`unlockWithRecovery`, then the unlock again) or to start empty
   (the unlock with `startEmpty`: the cached data and every key but the device key go, and the
   device keeps signing in through its device key wrap);
5. `keyLoginChallenge`, the device proof and `loginWithKey` with the ticket. A failure here locks
   the account again.

When the OPAQUE finish fails, the sign-in says "Wrong password" and nothing is signed or sent
after `passwordLoginStart`: every account of this server needs the ticket. With
`options.recoveryEntropy` (the person typed the phrase already, while recovering or resetting)
the phrase opens the data when it needs it, and the data key is wrapped under it afterwards.

`signupWithKey` registers the password first (`passwordRegistrationStart`, the OPAQUE finish, the
upload in `signupWithKey`'s `passwordRegistration`) and then unlocks the new account with a new
data key, wrapped under the draft's recovery phrase too. A signup whose answer was lost signs in
with the same password.

`changePassword` logs in with the current password once to open the server share, which both
unlock keys need, then runs `passwordChangeStart` and `passwordChangeFinish` with the rewrap, and
then wraps this device's data key under the new unlock key. `resetPassword` signs a
`password-reset` statement with the recovery key of the phrase (`signPasswordReset` in
`browser/recoveryKit.ts`, or `key_identity_sign_password_reset` on the desktop) and registers the
new password with `passwordResetStart` and `passwordResetFinish`; the sign-in that follows adds
the recovery wrap on this device.

"Keep me signed in" starts ticked in the desktop app and unticked in a browser. Every
`loginWithKey` and `signupWithKey` sends it as `keepSignedIn`, with `keepKeyHeld` true in the
desktop app, which writes its own keep wrap at the unlock, and false in the web app
(`keepSignedInArguments` in `passwordApi.ts`). What the server answers goes to `holdSession` once
the account is unlocked: the session secret of an unkept session is held before any other
request, and a kept web session's keep key wraps the data key. An expired session goes to the
sign-in screen: nothing signs in again with the device key alone.

### Switching relays

The relay switch checks the password at the new relay, or registers it there with the signup,
and wraps the desktop's data key under the unlock key the new relay's share gives as soon as it
enters the new relay. The password wrap under the old relay's share is replaced then. A switch
abandoned after that step therefore leaves an account that is not kept signed in on the
computer needing its recovery phrase (or starting empty) at its next sign-in at the old relay; a
kept account still opens with its keep wrap.
