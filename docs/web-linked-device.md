# The web app as a linked device

The web app never holds an identity key. It gets a device key of its own by pasting a link code
shown on the desktop app (Settings > Security > Link a device), and signs in with that key. It
does not enroll, sign up with a key, recover, or link other devices: those need the identity key
and stay in the desktop app. The contract is `../rim-server/docs/specs/device-linking-v1.md`
("Web client", "Channel cryptography", "Client rules — New device", appendix A) and
`../rim-server/docs/specs/key-identity-v1.md`; `device-linking-desktop.md` describes the desktop
side.

## What lives where

- `src/features/key-identity/api/keyBackend.ts`: the `KeyBackend` interface for the key work of
  signing in and of becoming a new device (list local accounts, default device name, sign a login
  proof, settle, forget, link offer / open answer / accept / end), with the Tauri implementation
  (`tauriKeyBackend`, the `key_identity_*` commands) and `keyBackend()`, which picks the Tauri one
  inside the desktop app and the browser one otherwise. `linkNewDevice` (`deviceLink.ts`) and
  `signInWithDeviceKey` (`keyIdentity.ts`) are the same code on both platforms.
- `src/features/key-identity/browser/`:
  - `bytes.ts`: strict unpadded base64url (no padding, no other alphabet, canonical trailing
    bits), base32, SHA-256.
  - `statements.ts`: the login proof (statement version 2, fields in the vectors' order, signed
    over `rim.login.v1\0 || payload`), and the verifying half of `statement.rs`: `replay` of a key
    log (versions 1 and 2, never back from 2 to 1, `prev`, signer rules, principal id from the
    inception bytes) and `certifiedDevice`, with Ed25519 `verify` in SubtleCrypto.
  - `channel.ts`: the link code reader (exactly TAB, LF, FF, CR and SPACE removed; 334 characters
    at most; the version a decimal above 0 without leading zeros; strict link id and secret; the
    endpoint's charset), HKDF-SHA256 per direction derived straight into a non-extractable
    AES-256-GCM key, seal and open with the AAD rule, the offer plaintext (same field order as
    `Offer` in Rust, `platform: "web"`), the strict answer reader, and the fingerprint over the
    exact offer bytes.
  - `keyStore.ts`: IndexedDB.
  - `browserKeyBackend.ts`: `browserKeyBackend`, the links in progress (in memory), the login
    `audience`, the default device name ("Firefox on Linux").
- `src/core/runtime/ed25519.ts`: probes once per page whether the browser can generate a
  non-extractable Ed25519 key and has IndexedDB. `RuntimeProvider` exposes the answer as
  `deviceKeyStore` (`checking`, `browser`, `unsupported`) and turns `capabilities.deviceKeys` on
  for the web when it is `browser`. `capabilities.identityKeys` (desktop only) gates enrollment,
  key-only signup, recovery and the old device's linking.
- Sign-in page: `DeviceKeySignIn` ("Sign in as … with this device", for each stored account) and
  `LinkThisDevice` ("Link this browser with its code"), both with the weaker-keys notice
  (`BrowserKeyNotice`). A browser without Ed25519 or IndexedDB gets a line saying why it cannot be
  linked. Recovery is not offered.

## Storage

One IndexedDB database, `rim-key-identity`, store `deviceKeys`, one record per account on a
server, keyed by `[endpoint, principalId]` (the endpoint trimmed, trailing `/` removed):

| Field | Holds |
|---|---|
| `deviceKey` | the Ed25519 private key as a `CryptoKey`, generated with `extractable: false` and stored by structured clone |
| `deviceId`, `deviceName` | from the certificate the old device signed |
| `confirmed` | the server has shown this principal on the signed-in account |
| `userId`, `username` | the account it signs in to; unknown until the first sign-in |

The public key is never stored separately: the server has it in the certificate. After a key is
stored the app asks for persistent storage (`navigator.storage.persist()`), best effort, so the
browser does not evict it under storage pressure.

The link secret, the channel keys and the new device key of a link in progress live only in the
page's memory. Nothing is written until the answer's certificate names exactly the offered device
id and key and verifies against the account's `keyLog` at its `keySeq`; a reload abandons the link
(if the old device had already certified the key, it revokes that unused device once the link
ends). `FORBIDDEN` at the first sign-in
removes the keys, as on the desktop; other failures keep them for the sign-in screen. Nothing logs
the code, the secret or a key.

## Encrypted conversations

A linked browser also reads and sends in end-to-end encrypted DMs and groups: its device key signs
the `mls-key` statement of an MLS key the browser keeps, and the decrypted messages live in an
encrypted-conversation store in IndexedDB (`rim-e2ee`). See `e2ee-web.md`.

## Keys in a browser are weaker

The key cannot be exported (the browser holds its bytes; the page only holds a handle), but:

- any script that runs in the page (a malicious extension, an XSS bug, a compromised dependency)
  can ask the browser to sign with it while the page is open, so it can sign in as this device;
- clearing the site's data, or a browser that evicts storage, deletes it;
- private windows may not keep IndexedDB, or keep it only for the session;
- encrypted conversations in this browser are only as safe as this browser profile: their MLS
  keys and decrypted messages are in its IndexedDB (`e2ee-web.md`, "Limits").

The sign-in page says so next to both key actions, and the desktop's confirmation card says so for
a `web` offer. Revoke a browser you no longer use from the desktop's device list.

## Known gaps

- `JSON.parse` keeps the last of two fields with one name, where the Tauri side refuses the
  payload. The answer is authenticated by the channel and its certificate still has to verify, and
  the key log was accepted by a server that refuses duplicates.
- Ed25519 is verified by the browser's WebCrypto. In front of it the module refuses keys and `R`
  values of small order (the 8 small-order encodings, sign bit ignored), non-canonical key
  encodings (`y` at or above the field prime) and scalars at or above the group order, which is at
  least as strict as the desktop's `verify_strict`.
- The web app takes a pasted code only (no camera), and only for its own GraphQL endpoint.
- Mobile browsers (`platform: "mobile"`) keep their reduced capabilities and are not linked.

## Trying it against a desktop old device

1. Run the server and the desktop app against it; on the desktop, sign in, set up key sign-in in
   Settings > Security, and choose "Link a device".
2. Run the web app (`npm run dev`) with `VITE_GRAPHQL_ENDPOINT` set to the same endpoint the
   desktop uses (the code carries it and the browser refuses another), in a browser with WebCrypto
   Ed25519 (current Chrome, Firefox or Safari). The server's CORS settings must allow the dev
   origin with credentials.
3. On the sign-in page choose "Link this browser with its code", paste the code, and keep the
   fingerprint in view; on the desktop compare it (the card marks the device as a browser) and
   confirm. The browser signs in; the desktop lists it under Devices.
4. Sign out in the browser: the sign-in page now offers "Sign in as … with this device". Revoking
   the browser on the desktop makes that sign-in answer `FORBIDDEN`, and the page offers to remove
   its keys.

The automated tests run the same flow in Vitest against Node's WebCrypto and `fake-indexeddb`,
with the old device simulated from the known-answer keys
(`src/features/key-identity/browser/browserKeyBackend.test.ts`).
