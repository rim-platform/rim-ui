# rim_mls

`src-tauri/crates/rim_mls` is the end-to-end encryption engine of encrypted DMs and groups: MLS
(RFC 9420) through OpenMLS, behind RIM's own types. It is the only code that names OpenMLS types;
the app passes conversation ids, device ids, message content and `MLSMessage` bytes in and out.
The contract it implements is rim-server `docs/specs/e2ee-mls-v1.md`; the library choice is
`docs/decisions/mls-library-2026-10-09.md` there.

## Versions

| Crate | Version | Use |
|---|---|---|
| `openmls` | `=0.9.1` | MLS |
| `openmls_traits` | `=0.6.0`, feature `draft-ietf-mls-pq-ciphersuites` | the provider and storage traits |
| `openmls_libcrux_crypto` | `=0.4.0`, feature `draft-ietf-mls-pq-ciphersuites` | the crypto provider clients use |
| `openmls_rust_crypto` | `=0.6.0` (dev) | the named fallback; the second implementation the cross-provider tests compare |

The post-quantum feature is enabled on `openmls_traits` and the provider rather than on `openmls`:
`openmls`'s feature also names `openmls_sqlite_storage?/…`, and cargo then counts that crate's
`rusqlite` 0.37 in the `links = "sqlite3"` check against the app's `rusqlite` 0.40, which fails
to resolve. In `openmls` itself the feature only changes the default capabilities, which RIM sets
explicitly. Every group uses `MLS_128_MLKEM768X25519_AES128GCM_SHA256_Ed25519` (0x004F): X-Wing
(X25519 + ML-KEM-768) key agreement, AES-128-GCM, SHA-256, Ed25519.

## API

`Mls::new()` builds the libcrux engine. Every operation takes the store it runs on:

| Operation | What it does |
|---|---|
| `mls_key_payload`, `install_mls_key_statement`, `ensure_identity`, `mls_key_statement`, `forget_identity` | This device's MLS signature key (Ed25519, generated here) and the `mls-key` statement the device key signs for it. The device key never enters the crate: `ensure_identity` takes a closure that signs `context`, `payload` |
| `generate_key_packages`, `prune_key_packages`, `plan_key_package_upload` | Key packages (`MLSMessage` bytes and `KeyPackageRef`, last-resort or one-time, 90-day lifetime), deleting private keys of expired or replaced ones, and what to upload given the server's status |
| `create_group` | Group at epoch 0 for a `ConversationGroup` (conversation id + incarnation, group id `rim1` ‖ UUID ‖ u32), first Commit adding the claimed devices |
| `commit`, `self_update` | One Commit with every pending add and remove (a re-add is both for one device), with an update path and the membership summary as authenticated data |
| `commit_accepted`, `commit_rejected` | The server's answer: merge, or drop (`STALE_EPOCH`; a refused group creation deletes the group) |
| `process_commit` | Another device's Commit: merged, with `summary_matches` (the authenticated summary names exactly the adds and removes), the added and removed devices and the leaves to verify. This device's own Commit is recognized by its bytes (the answer to a submit that got no reply). A Commit the library refuses gives `CannotProcess` and the group waits for a re-add |
| `join` | A Welcome for the expected conversation and incarnation; returns every leaf to verify |
| `encrypt`, `reencrypt` | Application data `0x01` ‖ franking key ‖ content, authenticated data `{messageId, franking, mentions, mentionAll}`; `reencrypt` resends the same content and franking key in the new epoch after `STALE_EPOCH` |
| `decrypt` | Once per message: `Message` (content, sender device, franking key and commitment), `Invalid` (decrypted but breaks a rule: never show its content), or `Own` (this device's own message) |
| `group_status`, `leaves`, `delete_group`, `prepare_readd` | Epoch, pending Commit and re-add state; the members; deleting state; the signed-request payload for a re-add (the group state goes) |

Pure helpers: `verify_leaf` / `verify_leaves` with the app's `DeviceDirectory`, `MessageContent`
(build, strict parse, the content rules), `AuthenticatedData`, `franking_commitment`,
`franking_receipt` (the server's receipt, for its tests), `encrypt_attachment` /
`decrypt_attachment`, `ReaddRequest` (payload and verification), `commit_rank` / `commit_delay`.

### Leaf verification

The crate checks what it can alone (the credential is an `mls-key` statement, its signature
under the device key, the leaf's signature key is the stated MLS key, no two leaves are the same
device) and asks the app the rest through `DeviceDirectory`: the device's certificate status
(certified with its key, revoked, unknown, or a key log that does not replay) and whether the
principal is a member. The app implements it over `key_identity::statement::{replay,
certified_device}` and the server's `principalDevices`. Commits and Welcomes are processed before
verification (refusing them would fork the group); verification runs after, outside the
transaction, so the app can refetch key logs.

## Storage

Group state lives in the account's SQLCipher cache database (`message_cache`, schema v5), one
table:

```sql
CREATE TABLE mls_storage (label TEXT NOT NULL, key BLOB NOT NULL, value BLOB NOT NULL,
                          PRIMARY KEY (label, key)) WITHOUT ROWID;
```

- `openmls.v1.<kind>` rows are OpenMLS's state (tree, group context, epoch and message secrets,
  key package and HPKE private keys, …): the key is the JSON of OpenMLS's key value, the value
  its JSON, as OpenMLS's own memory storage writes them.
- `rim.device` holds this device's MLS signature key and statement; `rim.group` per group the
  pending Commit (its bytes, to recognize it when it comes back) and the re-add state;
  `rim.key_package` per key package its lifetime and whether it was replaced.

`SqliteStore::new(&rusqlite::Transaction)` is the store: the crate takes the caller's
transaction and never commits. That is the decrypt-once guarantee: the app opens one
transaction, decrypts the entry (advancing the ratchet), writes its plaintext row, and commits;
if anything fails before the commit, both are undone and the entry decrypts again next time.
The same holds for sending: the outgoing envelope and the state it advanced commit together.
A transaction (rather than a connection) is the type so that a store can only exist inside one.

`MemoryStore` is the same in memory, for tests and for the web build: writes are journaled,
`pending()` lists the changed entries without committing them (to write through to IndexedDB),
`commit()` keeps them (and returns them), `rollback()` undoes them, `export()` / `import()` copy
a whole store.

## In the browser

`crates/rim_mls_wasm` is the web app's facade over this crate, built with the `sqlite` feature
off; on wasm32 the crate enables `openmls`'s `js` feature and getrandom's WebCrypto backends.
The test suite runs in headless Chromium with `wasm-bindgen-test` (`npm run test:wasm`). See
`e2ee-web.md`.

## Tests

```sh
cd src-tauri
cargo test -p rim_mls                       # everything
cargo test -p rim_mls --no-default-features --target wasm32-unknown-unknown  # in a browser
cargo test -p rim_mls simulation            # the multi-device simulations
cargo test -p rim_mls sizes -- --nocapture  # message sizes
cargo test -p rim_mls write_appendix_a_fixtures -- --ignored  # re-record the fixtures
```

- `providers`: both providers create, join and decrypt a 0x004F group; a group of one provider
  is joined and read with the other; the authenticated data is framed into Commits as well as
  application messages, and editing it breaks the Commit.
- `vectors`: Ed25519 (RFC 8032 tests 1 to 3) and HKDF (RFC 5869 A.1 to A.3), HMAC (RFC 4231),
  HPKE base mode (RFC 9180 A.1: DeriveKeyPair, open, export) and the Wycheproof AES-GCM vectors
  with 96-bit nonces through both providers' `OpenMlsCrypto`; X25519 (RFC 7748 5.2 and 6.1) and
  the X-Wing draft vectors (key pair from seed, decapsulation) through both providers' HPKE
  backends; ML-KEM-768 NIST ACVP keyGen, encapsulation and decapsulation through
  `libcrux-ml-kem` and RustCrypto `ml-kem` as linked. The HPKE API cannot take a vector's
  encapsulation randomness, so X-Wing encapsulation is checked as a property (each provider opens
  what the other sealed). The vector files are in `src/tests/vectors/`.
- `formats`: the spec's appendix A byte for byte, and the recorded fixtures
  (`src/tests/fixtures/appendix_a.json`): one key package of the A.2 device with its
  `KeyPackageRef`, and one PrivateMessage of the A.4 application data with the receiving device's
  group state, which also shows that state written by this OpenMLS release still loads.
- `simulation` (against `sequencer`, an in-process server with the spec's rules, including its
  claims: never a package within 14 days of expiry, and for a re-add the newest one-time package
  uploaded after the request, so the device uploads after asking): 3 users × 3
  devices; devices linked and revoked; members leaving and joining; racing committers in rank
  order; a submit without an answer; a message refused as stale and resent; a device offline past
  Commit retention re-added; lost state re-added with a new key; a Commit that cannot be
  processed; an added key package that expired before a device processed the Commit; an
  incarnation; decrypt once; a crash between decrypt and store.
- `tampering`: every leaf-verification failure; application messages whose authenticated data or
  content lies (invalid); Commits whose summary lies (flagged by receivers, refused by the
  server).

## Sizes

| What | Bytes |
|---|---|
| Key package (`MLSMessage`) | 3,027 |
| Welcome, 10 devices | 33,784 |
| Welcome, 100 devices | 305,565 |
| First Commit, 10 / 100 devices (key packages inline, update path) | 35,786 / 327,956 |
| Self-update Commit, 10 / 100 devices | 17,526 / 126,582 |
| A two-character message | 752 |

## Native code

`cargo tree -p rim_mls -e normal,build -i cc` reaches `cc` only through `libsqlite3-sys`
(SQLCipher), which the app already builds. The libcrux crates' build scripts only set SIMD cfgs;
no other dependency compiles C.
