# Plugin chat methods (`rim.chat.*`)

The client message service lets a plugin read and post the person's messages. It is the
same for a web plugin and a local process: the web host calls it in the page, and the
Rust broker relays a local process's calls to it. Reads come from the device's local
messages only: the desktop's message cache, or in the web app the browser's encrypted store
once the browser is set up as a linked device (`e2ee-web.md`); posts go through the person's own send path and are encrypted where
the conversation is. The contract is the "Plugins and the client message service" section
of `../rim-server/docs/specs/e2ee-mls-v1.md`.

These methods are **routed, not frozen**: both hosts serve them, the shapes below are
listed under `x-notFrozen.definitions` in `protocol/plugin-protocol-v1.schema.json`, and
they may still change before they are frozen into protocol v1.

## Capabilities

| Capability | Lets the plugin | Consent line |
|---|---|---|
| `chat.read` | Call the three read methods in plaintext conversations | "Read your conversations: this plugin sees the messages stored on this device, except those of encrypted DMs and groups." |
| `chat.write` | Call `rim.chat.post_message` in plaintext conversations | "Post as you: this plugin sends messages in your name, except in encrypted DMs and groups." |
| `chat.read.encrypted` | Read encrypted DMs and groups too | "Read your encrypted DMs and groups: this plugin sees their decrypted text and can send it anywhere its other permissions allow." |
| `chat.write.encrypted` | Post in encrypted DMs and groups too | "Post as you in your encrypted DMs and groups: this plugin sends messages in your name there, encrypted like your own." |

- A manifest that asks for an encrypted capability without its plain one fails to install
  (`validation.rs`, `manifestRules.ts`, vectors in `protocol/manifest-vectors.json`). In
  the permission prompt, checking an encrypted capability checks its plain one and
  unchecking the plain one unchecks the encrypted one.
- The broker checks the plain capability for each method (`capability.rs`); a call
  without it is `CAPABILITY_DENIED` and never reaches the service. The service then
  refuses an encrypted conversation without the encrypted capability, also with
  `CAPABILITY_DENIED` (`capability denied: chat.read.encrypted`), even when the plugin
  holds `chat.read`.
- A conversation is encrypted when the server says so (`Conversation.encryptedAt`), when
  this device holds group state for it, or when any of its cached rows is encrypted. Its
  plaintext from before the upgrade is behind the encrypted capability as well.
- Each capability counts against the usual limit of 120 calls a minute per capability
  (`chat.read` for the three reads, `chat.write` for posting).
- The capabilities a plugin started with are the ones checked; revoking any capability
  stops the plugin.

## Methods

Every call works in the workspace open in the app. Ids of messages, conversations and
threads are the server's, and opaque to plugins.

### `rim.chat.list_messages`

Params `{ conversationId, before?, limit? }`: the newest `limit` (1 to 100, default 50)
messages of the conversation, thread replies included, older than the message `before`
when given. Answers `{ messages, hasOlder }`, oldest first.

### `rim.chat.get_message`

Params `{ messageId }`. Answers `{ message }`, or `{ message: null }` when this device does
not have it or a plugin may not see it (below).

### `rim.chat.search_messages`

Params `{ query, conversationId?, limit? }`: search of the messages on this device, newest
first; the server is not asked. On the desktop it is the local full-text index (every word
matches as a prefix); in the web app a case-insensitive substring match over the text of the
browser's stored messages. Answers `{ messages }`. Without `conversationId` and without `chat.read.encrypted`, hits
in encrypted conversations are left out; naming an encrypted conversation without it is
refused.

### `rim.chat.post_message`

Params `{ conversationId, body, threadId? }`: posts `body` (1 to 10,000 characters) as the
person, as a reply in the thread `threadId` when given. In an encrypted conversation the
message goes through the encrypted send path, on the desktop or in a browser set up as a
linked device. Mentions are written as `<@principalId>` tokens. Answers `{ id }`, the new
message's id.

### The message

```json
{
  "id": "…", "conversationId": "…", "threadId": null,
  "author": { "principalId": "rimp1_…", "displayName": "Ada" },
  "text": "plan attached <@rimp1_…>",
  "sentAt": "2026-10-01T09:05:00.000002Z", "editedAt": null,
  "encrypted": true,
  "attachments": [{ "name": "plan.pdf", "mime": "application/pdf", "size": 48213 }]
}
```

`author` is a protocol `Principal`: the key-based id when the person has one, else the
provisional `rimp0_` id. `<@user>` mentions of plaintext messages are rewritten to
principal ids. `encrypted` says whether the message itself was end-to-end encrypted.

## What a plugin never gets

- Franking keys, franking receipts, attachment secrets or blob hashes, the decrypted
  content bytes, MLS group state, epochs, ciphertext, or keys of any kind.
- Attachment bytes: only name, type and size.
- Raw user ids.
- Rows this device could not decrypt (placeholders), messages that could not be
  verified, tombstones, and this device's sends the server has not acknowledged yet.

The projection is in Rust on the desktop (`src-tauri/src/message_cache/plugin_view.rs`)
and in TypeScript in the web app (`src/features/e2ee/web/pluginView.ts`); both are tested
against the shared vector `protocol/plugin-chat-vectors.json`.

## Errors

| Code | When |
|---|---|
| `CAPABILITY_DENIED` (-32000) | The plain capability is missing, or the conversation is encrypted and the encrypted one is |
| `RATE_LIMITED` (-32001) | More than 120 calls a minute on the capability |
| `INVALID_PARAMS` (-32602) | A param is missing or out of range, the conversation or thread is unknown, `before` names no message of the conversation, no workspace is open |
| `INTERNAL_ERROR` (-32603) | `data.reason` `notCached`: the conversation is not fully stored on this device yet (the app starts caching it; try again shortly). `noCache`: the app keeps no messages here (a browser not set up as a linked device). `noEncryption`: an encrypted conversation cannot be written from here (a browser not set up as a linked device). Otherwise the app failed |

## Audit

The host records, per plugin, when each capability was given and revoked and how many
encrypted messages the service handed it per day (`encrypted: true` messages in any
answer). Settings > Plugins > Activity shows both, with a Revoke button per capability.
On the desktop the record is in the Rust `PluginStateStore` (`audit`, kept through
updates, dropped on uninstall); on the web in the plugin's install record in IndexedDB.
Grant events are capped at 200 and daily counts at 90 days.

## Where it lives

| Concern | Where |
|---|---|
| Service, param checks, encrypted gate, audit counting | `src/features/plugins/chat/messageService.ts` |
| Wiring to the cache, the send paths and the stores | `src/features/plugins/chat/appMessageService.ts` |
| The cache's plugin projection and its commands | `src-tauri/src/message_cache/plugin_view.rs`, `commands.rs` (`message_cache_plugin_*`) |
| Local-process relay | `src-tauri/src/plugin_host/chat_relay.rs`, `broker.rs` (`Routed::Chat`), `commands.rs` (`plugin_chat_respond`); the page side `src/features/plugins/chat/usePluginChatRelay.ts` |
| Web host | `src/features/plugins/web/pluginSession.ts` (the `chat` hook), `webPluginHost.ts` |
| SDK | `host.chat` in `sdk/plugin-sdk/src/plugin.ts` |
