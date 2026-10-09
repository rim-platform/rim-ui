# End-to-end encrypted DMs and groups in the web app

A browser set up as a linked device (`web-linked-device.md`) reads and sends in encrypted DMs and
groups like the desktop app. It runs the same `rim_mls` crate (`docs/rim-mls.md`) compiled to
WebAssembly, keeps its MLS state and the decrypted messages in IndexedDB, and drives the same
runtime as the desktop (`src/features/e2ee/runtime/`), against a second backend with the Tauri
side's command surface. The contract is rim-server `docs/specs/e2ee-mls-v1.md` ("The web
client"); `e2ee-desktop.md` describes the desktop, whose behaviour the web matches.

## What lives where

| Where | What |
|---|---|
| `src-tauri/crates/rim_mls_wasm` | The `wasm-bindgen` facade: an `Engine` over one account's journaled `MemoryStore` (`changes`, `keep`, `rollback`, `export`), the crate's operations over base64url bytes and JSON text, a `DeviceDirectory` over the page's answers, `buildContent`, `planKeyPackageUpload`, `verifyReadd`, `mayHonorReadd`. A failure throws an `Error` named by its code (`E2EE_NO_GROUP`, …) |
| `src/features/e2ee/wasm/` | Its build (`wasm-bindgen --target web`), committed: `rim_mls_wasm.js`, `.d.ts`, `rim_mls_wasm_bg.wasm`, and `source.json` (the hash of the crate sources it was built from and its size) |
| `src/features/e2ee/web/` | The web backend: `store.ts` (the unit of work), `db.ts` (IndexedDB), `groupState.ts`, `feed.ts` (the client loop), `outgoing.ts`, `directory.ts`, `attachments.ts` (WebCrypto), `messageRows.ts`, `webCommands.ts` (the command surface and the cache calls), `webSession.ts` (whether this browser can take part), `mlsModule.ts`, `webAccount.ts` |
| `src/features/e2ee/api/e2eeCommands.ts` | Routes every command by its account: a web account (`{ …, principalId, deviceId, web: true }`) goes to `webE2eeCommands`, any other to the Tauri side. Attachments use WebCrypto outside Tauri |
| `src/features/messages/api/messageCache.ts` | Routes the cache calls the same way; `encryptedStoreAccount()` is the desktop's cache account or the web store's account |
| `src/features/e2ee/runtime/` | Shared with the desktop; `webReturn.ts` handles a browser coming back after 60 days |
| `scripts/build-wasm.mjs`, `scripts/wasm-sources.mjs` | The build, and the source hash a Vitest test checks |

The web backend and the module load lazily (dynamic imports): the desktop app never loads them,
and the web app loads the 2.4 MB module only once a signed-in account has a device key here.

## The wasm build

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.114 --locked   # the version rim_mls_wasm pins
npm run build:wasm
```

`build:wasm` runs `cargo build -p rim_mls_wasm --target wasm32-unknown-unknown --profile wasm`
(from `src-tauri/`, whose `.cargo/config.toml` selects getrandom's WebCrypto backend for that
target), then `wasm-bindgen --target web` into `src/features/e2ee/wasm/`, and writes
`source.json`. The `wasm` profile inherits `release` with `opt-level = "s"`, LTO and one codegen
unit; the desktop's `release` is unchanged. No `wasm-opt` pass (binaryen is not needed).

| | Bytes |
|---|---|
| `rim_mls_wasm_bg.wasm` | 2,426,824 |
| gzip -9 (`source.json`) | 692,971 |
| gzip -6 (as the Docker image's nginx serves it) | 699,817 |
| brotli -q 11 | 511,257 |

**The build is committed**, because `npm run build` must work without a Rust toolchain: CI's
build job and the Docker image build the web app with Node only, and Vitest loads the module.
`src/features/e2ee/web/wasmArtifact.test.ts` fails when `rim_mls` or `rim_mls_wasm` changed
since the committed build (it hashes their `Cargo.toml` and `src/`): run `npm run build:wasm`
and commit the result. `rim_mls` runs in the browser with `openmls`'s `js` feature (the clock
through `web-time`), getrandom 0.2's `js` and 0.3's `wasm_js` features, and its `sqlite` feature
off; libcrux runs its portable (non-SIMD) code.

The page compiles the module with `WebAssembly`; the Docker image's content security policy
allows that with `'wasm-unsafe-eval'` in `script-src` (and nothing else is evaluated).

## The headless browser gate

`rim_mls`'s whole test suite (vectors, formats, providers, the multi-device simulations,
tampering) and the facade's tests run in headless Chromium through `wasm-bindgen-test`:

```sh
npm run test:wasm
# = cd src-tauri && cargo test -p rim_mls -p rim_mls_wasm --no-default-features \
#     --target wasm32-unknown-unknown
```

The target's runner is `wasm-bindgen-test-runner` (from wasm-bindgen-cli); it starts
`chromedriver` from `PATH` (or `CHROMEDRIVER=/path/to/chromedriver`) and Chrome or Chromium,
headless. The test modules use `wasm_bindgen_test` as `#[test]` on wasm32, so the same tests run
natively with `cargo test`. Two tests stay native: the SQLite store's (no `sqlite` feature in
the browser). `wait` in the simulations spins on the clock in the browser, which cannot block a
thread.

## Storage

One IndexedDB database, `rim-e2ee`; every record is keyed by the account first (`endpoint`
without a trailing `/`, `principalId`):

| Store | Key | Holds |
|---|---|---|
| `mls` | `[endpoint, principalId, label, key]` | `rim_mls`'s entries as its `MemoryStore` has them: OpenMLS state (`openmls.v1.*`), this device's MLS signature key and `mls-key` statement (`rim.device`), group records, key package records. Key and value base64url |
| `messages` | `[endpoint, principalId, id]` | The messages of the encrypted conversations this browser follows, as the desktop's cache rows: `text`, the server's JSON without text or envelope (`payload`, with `payload.e2ee`), `version`, `sentAtUs`, `e2eeState` (`decrypted`, `invalid`, `placeholder`, `outgoing`, `null` for plaintext from before encryption and tombstones). Indexes by time and by thread |
| `groups` | `[…, workspaceId, conversationId]` | `e2ee_conversation`'s fields (incarnation, next incarnation, join epoch, removal, leaves to verify, devices that failed, a misbehaving committer, a re-add wait, last update path, resets) and the re-adds this browser honored |
| `sync` | `[…, workspaceId, conversationId]` | The change feed's cursor, whether more is pending, whether the history was read once, last viewed |
| `outgoing` | `[…, messageId]` | Messages and edits until the server acknowledges them, with the content, franking key and commitment to send them again |
| `devices` | `[…, peerPrincipalId, deviceId]` | Devices whose certificate verified, with the certified key |
| `accounts` | `[endpoint, principalId]` | This device's public key (from its certificate) and when the browser last ran encryption |

**Write-through.** OpenMLS's storage is synchronous and IndexedDB is not, so the engine keeps
the account's state in memory, loaded from `mls` when the store opens. Every operation is one
unit of work (`WebStore.run`): it reads what it needs, runs the engine (whose `MemoryStore`
journals each entry it changes), and stages its records; then the journal's changed entries and
the staged records are written in **one IndexedDB transaction**. Only when it completes is the
journal kept (`keep`) and the result returned; if the operation throws or the transaction fails,
the journal is rolled back (`rollback`) and nothing is written. So:

- a message is decrypted once, together with storing its plaintext: a failed write leaves both
  undone, and the entry decrypts on the next sync;
- no envelope is sent and no Commit submitted before the state that produced it is stored, and
  no plaintext is shown before it is stored;
- units of work of one account run one at a time.

A panic in the module traps; the store then refuses further work in that page, and nothing the
trapped operation did was written. Reloading the page reloads the state from IndexedDB.

**One tab.** Two tabs would each advance their own copy of the group state. The tab that takes
the Web Lock `rim-e2ee:<endpoint>:<principalId>` (held while the page lives) runs encryption;
another tab says "Encrypted conversations are open in another tab of this browser" and looks
again every 30 seconds.

## How it runs

The webview runtime is the desktop's, unchanged in what it does:

- **Session** (`runtime/session.ts`): outside Tauri, `resolveWebSession` checks WebCrypto
  Ed25519 and IndexedDB, a confirmed device key for the signed-in user in `rim-key-identity`,
  the module, and the tab lock, then opens the store. Its answer is
  `useE2eeStore.webEncryption` (`ready`, `checking`, `noDeviceKey`, `otherTab`, `unsupported`)
  and `capabilities.encryptedConversations`.
- **Identity**: the MLS signature key is generated by the module; the `mls-key` statement is
  signed by the non-extractable WebCrypto device key over `rim.mls-key.v1\0`, and checked
  against the device's certificate as the server serves it. Re-add requests are signed the same
  way over `rim.mls-readd.v1\0`.
- **Key packages**: on start and every 12 hours while a tab is open (`myMlsKeyPackageStatus`,
  `planKeyPackageUpload`, prune, top up, last resort). A closed browser uploads nothing.
- **The client loop** (`web/feed.ts`, a port of the desktop's `feed.rs` and cache sync): the
  encrypted conversations this browser follows (it follows a conversation once opened, and only
  encrypted ones), Commits applied up to each entry's epoch, decrypt once, placeholders,
  invalid rows, stops (`needCommits`, `noGroupState`, `awaitingReadd`, `needThreadRoot`) and
  `RESET` / `NO_ACCESS` as on the desktop.
- **Groups**: create, commit, settle, process, join, re-add requests and checks, incarnations,
  ranking: `web/groupState.ts` and `web/directory.ts` port `group.rs` and `directory.rs`; key
  logs are replayed and certificates checked with WebCrypto (`key-identity/browser`), the leaves
  by the module.
- **Sending**: the plaintext row is stored under the chosen UUID v7 before the envelope leaves;
  `STALE_EPOCH` re-encrypts the same content and franking key in the new epoch.
- **Attachments**: AES-256-GCM with HKDF-SHA256 in WebCrypto (appendix A.3, tested byte for
  byte); the content entry waits in the page until the message is encrypted.
- **Link previews**: none. A browser cannot read other sites' pages (CORS), so the web app sends
  encrypted messages without previews; it shows the previews a desktop sender embedded.
- **Keyword notifications**: matched after decrypting, as on the desktop, and shown with the
  Notifications API only when the person already allowed this site's notifications.
- **A browser unused for 60 days**: the other devices have removed it, or are about to (no key
  package upload in 60 days). When it comes back, before uploading key packages, it asks to be
  re-added where the server still counts it in a group and drops its old state elsewhere; its
  fresh key packages make it a pending add, and it joins through the Welcomes. Messages sent
  meanwhile show as "Earlier messages were sent before this device joined".
- **No migration from the web**: a browser creates new encrypted DMs and groups, but never
  upgrades an existing plaintext one (the upgrading device must be a desktop device). Where
  everyone is ready, the web app says "Not encrypted yet: everyone is ready, and a member's
  desktop app turns encryption on here when it opens this conversation. A browser does not."

## What the person sees

The desktop's timeline states and notices (`e2ee-desktop.md`, "What the person sees"), and:

- "Set up this browser as a linked device to read encrypted conversations" (no device key here);
- "This browser cannot run encrypted conversations" (no WebCrypto Ed25519, IndexedDB or
  WebAssembly);
- "Encrypted conversations are open in another tab of this browser. Close it to read them here.";
- next to the browser's key actions: "Encrypted conversations in this browser are only as safe
  as this browser profile."

The history archive is the desktop's: the web app offers no "Restore from history archive".

## Limits

- The MLS signature key and HPKE private keys are bytes in IndexedDB (OpenMLS signs and
  decapsulates synchronously); only the device key is a non-extractable WebCrypto key. Anything
  that can run script in the page, or read the browser profile, can read them.
- Clearing the site's data deletes the state and the plaintext; the device then needs a re-add
  in every group, and earlier messages are gone from this browser.
- Key packages are only refreshed while a tab is open; a browser closed for 60 days leaves its
  groups.
- No local search over encrypted messages, no history archive, no link previews in the web app.

## Trying it against a desktop

Needs rim-server with the e2ee server work running locally, a desktop app signed in with a
device key (`device-linking-desktop.md`), and the web app (`npm run dev`) linked to the same
account or another one (`web-linked-device.md`, "Trying it against a desktop old device"), in a
browser with WebCrypto Ed25519 and WebAssembly (current Chrome, Firefox or Safari).

1. Link the browser and sign in: the browser uploads key packages, and `principalDevices` shows it
   `mlsActive`.
2. From the desktop, open a new DM with the web account (or, with the browser linked to the same
   account, any encrypted DM): the browser joins from the Welcome; send from both sides, edit,
   delete, reply in a thread, attach a file.
3. Open the same account in a second tab: it says another tab runs encryption.
4. Clear the site's data and link again: the desktop re-adds the new device, which shows earlier
   messages as one line.

Tests: `npx vitest run src/features/e2ee` (the web backend against a simulated server with
`fake-indexeddb` and the committed module: create, join, send, receive, placeholders, invalid
rows, re-add, a failed write rolled back, a reload, stale sends, refused sends and edits,
incarnations, leaf checks, attachments against appendix A.3), and `npm run test:wasm`.
