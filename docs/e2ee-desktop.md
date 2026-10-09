# End-to-end encrypted DMs and groups on the desktop

DMs and groups are end-to-end encrypted with MLS (RFC 9420); channels stay plaintext. The
contract is rim-server `docs/specs/e2ee-mls-v1.md`; the engine is the `rim_mls` crate
(`docs/rim-mls.md`). This page is how the desktop app puts them together.

## What lives where

| Where | What |
|---|---|
| `src-tauri/crates/rim_mls` | MLS through OpenMLS: identity, key packages, groups, Commits, Welcomes, encrypt and decrypt once, content and authenticated-data rules, franking, attachments |
| `src-tauri/src/e2ee/` | The app's side: Tauri commands, the change-feed handler that decrypts into the cache, leaf verification (`DeviceDirectory` over key logs and device certificates), sends with stored plaintext, attachments over raw IPC, sender-side link previews |
| `src-tauri/src/message_cache/` | The SQLCipher cache: MLS state (`mls_storage`, schema v5) and the e2ee tables (schema v6) live in the same file as the messages |
| `src-tauri/src/key_identity/` | The device key; it signs `mls-key` statements and re-add requests (`sign_mls`) and nothing else for e2ee |
| `src/features/e2ee/api/` | `documents.ts` (every e2ee GraphQL document), `e2eeApi.ts` (server calls), `e2eeCommands.ts` (Tauri commands) |
| `src/features/e2ee/runtime/` | The webview's driver: client loop inputs, groups (create, commit, settle, join, re-add, recovery), membership ranking, sending, events, the 12-hour key package refresh |
| `src/features/e2ee/` components, hooks, utils | Timeline notices, composer notices, lock marks, encrypted attachments, mention and keyword rules |

The webview holds the session cookie, so it makes every server call and hands the answers to
the Tauri side; the Tauri side never talks to the server for e2ee (apart from link previews,
which only the sender fetches).

### Cache tables (schema v6)

- `message.e2ee_state`: `decrypted`, `invalid` (decrypted, broke a rule, stored without content),
  `placeholder` (this device cannot decrypt it: sent before it joined, or in an older
  incarnation) or `outgoing` (sent here, not acknowledged yet). `NULL` for plaintext rows.
- `e2ee_conversation`: per conversation, the incarnation this device holds, an incarnation it
  is creating, the first epoch it can read, whether it was removed, whether leaves wait for
  verification, devices that failed verification, a committer whose summary lied, a pending
  re-add request, the last update path, and who reset each incarnation.
- `e2ee_outgoing`: messages and edits until the server acknowledges them, with the content and
  franking key to resend them in a newer epoch.
- `e2ee_verified_device`: devices whose certificate verified, with the certified key.
- `e2ee_readd_honored`: when this device last acted on a device's re-add request.

The row upsert keeps "higher version wins", with two exceptions: a placeholder never replaces
a readable row, and a readable row (decrypted, or restored from the archive) replaces a
placeholder whatever the versions. `RESET` drops plaintext rows and placeholders and keeps
decrypted ones. The archive skips placeholders and outgoing rows; decrypted rows carry
`payload.e2ee` (`docs/specs/history-archive-v1.md`).

## The client loop

The cache sync (`docs/local-message-cache.md`) drives it; nothing decrypts outside the feed.

```text
per feed page:
  for each conversation in it that is encrypted or has local group state:
    fetch mlsCommits(incarnation, from the local epoch)          (webview)
    fetch thread(id).rootMessageId for encrypted thread replies   (webview)
  message_cache_sync_apply(page, those inputs)                     (Tauri, one transaction)
    per encrypted entry, in version order:
      older incarnation, before the join epoch, or > 2 epochs back -> placeholder
      past the local epoch -> apply the handed-in Commits up to it first
      decrypt once -> decrypted row | invalid row | own message (keeps its stored plaintext)
    feed drained -> apply the remaining Commits
  notes -> webview: what stopped, leaves to verify, decrypted messages for keyword toasts
```

A conversation stops (its cursor stays, nothing past the entry is stored) when a Commit or a
thread root is missing, when the device has no state for the entry's incarnation, or when its
group waits for a re-add. The webview resolves it and syncs again: Welcomes are processed; a
device the server counts in the group but that has no state asks to be re-added; a device that
is not in the group gets placeholders.

Real-time `NewMessage` / `MessageUpdated` of encrypted messages are only signals, like
`MlsCommitAccepted`; the timeline re-reads the cache after each page.

## Sending

`sendEncrypted` (and `editEncrypted`) run under the conversation's lock:

1. Catch up (the loop above for this conversation). No group yet: create it. Pending removals:
   commit them first.
2. Encrypt files on the Tauri side (`e2ee_attachment_encrypt`: the secret stays there until the
   message is encrypted) and fetch link previews (`e2ee_link_preview`).
3. `e2ee_encrypt_message`: the content (client-chosen UUID v7, `<@principalId>` mentions,
   `replyTo`, `threadRootId`, `forwardedFrom`, attachments, previews) is encrypted and its
   plaintext row stored as `outgoing` in the same transaction.
4. `sendEncryptedMessage`. `STALE_EPOCH`: catch up, `e2ee_reencrypt_message` (same id, content
   and franking key), send again. `MLS_COMMIT_REQUIRED`: commit, re-encrypt, send. No answer:
   send the same bytes again. Any other refusal undoes the row (a refused edit puts the old
   text back) and gives the body back to the composer.
5. Upload the blobs with `blobSha256`, file name `encrypted`, type `application/octet-stream`.

Edits send the whole new content at `rev + 1`. Deletes, reactions and pins are unchanged.
Forwards into an encrypted conversation send new content (an encrypted source's blobs are
uploaded again under the new message); an encrypted message forwarded into a plaintext
conversation asks first, then uses `sendMessage(forwardedFromMessageId)`.

## Membership

`Conversation.mlsGroup` lists the group devices, pending adds and removes, and re-add requests.
On `MlsMembershipChanged` the device rechecks every leaf against fresh key logs and device lists,
then, if it can commit, waits `min(rank, 8) × 15 s` plus up to 3 s and commits every pending
change at once (after refetching and checking that its epoch is the server's). The device that
added or removed members commits at once; a member's own other device ranks first for its new
device. Also scheduled per conversation: creating a group nobody created within a minute, the
weekly self-update (a day's spread after it falls due), a new incarnation when a re-add waits
over 10 minutes or the group runs another suite.

A leaf that does not verify (after one refetch) stops sending in the conversation, shows
"Unverified device present", and is removed at once if the server agrees.

## Key packages and identity

On start and every 12 hours: `e2ee_ensure_identity` (the MLS key and its `mls-key` statement,
signed by the device key), then `myMlsKeyPackageStatus` → `e2ee_key_packages` (prune, top up to
20 below 10, a new last-resort package when needed) → `uploadMlsKeyPackages`. A re-add request
uploads 5 fresh one-time packages after the request.

## What the person sees

- A lock beside encrypted messages and conversations.
- "Messages from here on are end-to-end encrypted" where the conversation became encrypted, and
  "sent before encryption" on older plaintext messages.
- "Earlier messages were sent before this device joined", one line per run of placeholders,
  with "Restore from history archive" when an archive is set up.
- "Encryption was reset by <name>'s <device>" between incarnations.
- "A message from <sender> could not be verified" for invalid messages.
- Above the composer: "Not encrypted yet: <name> has not set up encryption on a desktop device";
  the unverified-device warning (sending stops); "This device can't read new messages until
  another device re-adds it"; in the web app, a pointer to the desktop app.
- Keyword notifications for encrypted groups at the "mentions" level are matched on this
  device after decrypting, as a desktop notification without an inbox entry.

New DMs and groups are created with `encrypted: true` when every member has a device set up
for encryption (`PrincipalDevice.mlsActive`); existing ones are upgraded by an eligible member's
desktop when it opens them and everyone is ready.

## Trying it with two desktops

Needs rim-server with the e2ee server work (S4-1) merged and running locally, and two accounts
that signed in with device keys (key-only signup or enrollment, `docs/device-linking-desktop.md`).

1. Run the server and export its schema: `curl -s http://localhost:8080/api/sdl > schema.graphql
   && npm run codegen`.
2. Start two desktop instances, each with its own app data: two computers or two OS users are
   simplest. On Linux one machine works with a second data directory: run `npm run tauri dev`
   for the first, and the built app (`npm run tauri build`) with
   `XDG_DATA_HOME=/tmp/rim-second src-tauri/target/release/rim-ui` for the second.
3. Sign in as each account. Each uploads key packages on start.
4. Open a new DM from one to the other: it is created encrypted, and the other side joins from
   the Welcome. Send, edit, delete, react, reply in a thread, attach a file.
5. For a migration, open an existing plaintext DM: the marker appears where it became
   encrypted.
6. Link a second device to one account: the other members' devices add it after their rank's
   delay; it shows earlier messages as one line and restores them from the history archive.

Tests: `cd src-tauri && cargo test e2ee` (against `rim_mls` and real cache databases, with an
in-process server), `npx vitest run src/features/e2ee`.
