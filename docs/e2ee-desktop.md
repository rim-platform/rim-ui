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
  another device re-adds it". The web app runs the same flows once the browser is a linked
  device (`e2ee-web.md`).
- Keyword notifications for encrypted groups at the "mentions" level are matched on this
  device after decrypting, as a desktop notification without an inbox entry.

New DMs and groups are created with `encrypted: true` when every member has a device set up
for encryption (`PrincipalDevice.mlsActive`); existing ones are upgraded by an eligible member's
desktop when it opens them and everyone is ready.

## Plugins, the agent, pipelines and lenses

The server cannot read an encrypted conversation, so whatever reads its text does it on this
device, and only when the person allowed it.

- **Plugins** read and post through the client message service (`docs/plugin-chat-methods.md`):
  reads come from the cache, posts go through the encrypted send path. An encrypted DM or group
  needs `chat.read.encrypted` or `chat.write.encrypted` on top of the plain capability, each
  with its own consent line, and the plugin's Activity in Settings counts the encrypted
  messages it read per day. A plugin never sees franking keys, attachment secrets, MLS state or
  ciphertext, nor placeholders or messages that could not be verified.
- **The agent** is off in every encrypted conversation until the person turns it on from the
  conversation's menu ("Agent: off in this conversation"), after the warning that the text of
  the conversation goes to the model provider; the switch is per conversation and kept on this
  device (`useAgentEncryptedStore`). When it is on, `chat.get_recent_messages` and
  `chat.search_messages` read the cache instead of the server, and `chat.post_message` sends
  through the encrypted send path after the person confirms each post
  (`src/features/agent/encrypted/`). A server-wide `chat.search_messages` adds this device's
  hits in the conversations the agent is on in. `chat.create_group` still creates a plaintext
  group on the server; this desktop then upgrades it as any plaintext group
  (`runtime/upgrade.ts`), once every member is ready.
- **Pipelines** run on the server on metadata only: a "Message contains" condition never
  matches an encrypted message, and the editor says so under the pattern.
- **Lenses** are applied on this device in an encrypted conversation, over the loaded pages:
  "Text contains" and "Has links" never match an encrypted message; author, attachments and
  pins match as usual (`src/features/lenses/utils/localLens.ts`). The lens editor says so
  under a text condition.

## Reporting an encrypted message

"Report Message" on an encrypted message sends `reportEncryptedMessage` with what the cache row
keeps in `payload.e2ee`: the exact content bytes (`content`, base64url of its UTF-8), the
franking key, the server's receipt and its key id, the sender's user and device ids, and
`sentAtUs`. The server recomputes the commitment and the receipt; a match stores the content
with the report, so it stays reportable after the sender deletes the message. The dialog says
that the content and attachments go to the moderators and nothing else from the conversation.
A placeholder (this device could not decrypt it), a message that could not be verified, and an
own message the server has not acknowledged yet cannot be reported; the dialog says why.

Moderators see a verified report in Settings → Workspace → Moderation as "Encrypted · verified".
"Show reported message" fetches `messageReport` (each fetch is an audit row, so it is fetched
once per opening) and shows:

- the body as plain text, `<@principalId>` mentions as `@name`;
- each attachment's name and size, downloaded from
  `/api/reports/{reportId}/attachments/{blobSha256}` and decrypted by
  `e2ee_reported_attachment_decrypt` with the entry of the verified content (hash, then size,
  checked), so a moderator outside the conversation can open it;
- the sender, their device, the conversation (its title when this device knows it) and the send
  time, and "Verified: this is the exact message <sender>'s device sent. Other messages in the
  conversation are not shown and are not verified.";
- when the server deletes the content (90 days after the report is closed);
- "Delete message", which deletes the message for everyone, also from a conversation the
  moderator is not in.

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
7. To try reports, make a third account a workspace Moderator. Report a message with an
   attachment from the DM, then open it in the moderator's Settings → Moderation, download the
   attachment and delete the message.

Tests: `cd src-tauri && cargo test e2ee` (against `rim_mls` and real cache databases, with an
in-process server), `cargo test plugin_view`, `npx vitest run src/features/e2ee
src/features/plugins/chat src/features/agent/encrypted`.
