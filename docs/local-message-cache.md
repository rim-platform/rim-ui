# Local message cache

The desktop app keeps the messages of the conversations you open in an encrypted database on
this device (master plan Stage 2, PR 9). The timeline shows the cached copy first and falls back
to it when the server cannot be reached. The web app has no cache and behaves as before.

## Storage

- `src-tauri/src/message_cache/`: SQLCipher through `rusqlite` (`bundled-sqlcipher`; Windows
  builds a vendored OpenSSL). Files live in `<app data>/message-cache/`, one per account, named
  after a hash of (GraphQL endpoint, user id). The account is also written inside the file, so a
  database is never served to another account.
- One random 256-bit key per installation, stored in the OS keyring (`message-cache-key-v1`).
  All key handling is in `key.rs`; Stage 3 re-wraps this key under the device key. If the key is
  lost, the unreadable files are deleted and the cache refills from the server.
- `message.text` is its own column of a rowid table, so local search (PR 10) can add an
  external-content FTS5 index over it. Deleted messages stay as tombstones with no text,
  attachments, link previews or reactions.

## Sync

The server contract is rim-server `docs/message-change-feed.md`. The cache stores a cursor per
conversation and decides what to ask for; the webview makes the `messageChanges` call because it
holds the session cookie (`src/features/messages/runtime/messageCacheSync.ts`):

```text
input = message_cache_sync_begin(conversations)
while input: input = message_cache_sync_apply(await messageChanges(input))
```

- When: on startup and every WebSocket (re)connect for the 50 most recently viewed
  conversations, and for one conversation when a real-time message event for it arrives.
  Events carry no version, so they are only a signal. Opening a conversation starts following it.
- Changes are upserts keyed by message id that keep the higher `version`, so an edit seen before
  its create, or a stale page, never overwrites newer state.
- `hasMore` keeps a conversation pending; an interrupted sync resumes from the stored cursor.
- `RESET` drops the conversation's cached messages and applies the changes from the beginning.
- `NO_ACCESS` drops the conversation's messages and stops following it.
- A conversation is served from the cache only once a sync reached its end: a partial initial
  sync holds the oldest messages, which must not pass for the latest.

## Not yet

- A cold start with no connection still stops at the session check, and the sidebar lists come
  from the server, so offline reading works once the app is open, not from a cold start.
- Thread panes, pins, reactions and link previews still read from the server; the feed does not
  version reactions, pins or previews, so cached copies of those are as of the last sync.
- Local search (PR 10) and the drive archive come later.
