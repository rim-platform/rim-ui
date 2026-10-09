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
  lost, the unreadable files are deleted and the cache refills from the server. If the keyring
  cannot be reached, every cache call fails softly and the timeline reads from the server.
- Signing out keeps the account's database on the device (it is encrypted, and history on the
  user's own device is the point of Stage 2); signing back in to the same account reuses it. A
  sync still in flight when the signed-in account changes is discarded before it is applied.
- `message.text` is its own column, and `message.seq` is an `INTEGER PRIMARY KEY` that upserts
  never change, so the local search index (below) points at rows that survive a `VACUUM`.
  Deleted messages stay as tombstones with no text, attachments, link previews or reactions.
- The schema is versioned with `PRAGMA user_version` (`SCHEMA_VERSION` in `store.rs`); each
  version is one migration step that commits with its version number.

## Local search (PR 10)

Schema v2 adds `message_fts`, an external-content FTS5 index over `message.text`
(`content='message'`, `content_rowid='seq'`, `unicode61` with diacritics folded). It is a table of
the same SQLCipher database, so it is encrypted like the rest; there is no sidecar file.

- FTS5's standard external-content triggers on `message` keep it in step with every write the sync
  makes: a create indexes the text, an edit replaces the old entry, a delete (`NO_ACCESS`,
  `RESET`) removes it. Tombstones have no text, so a message deleted on the server is not
  searchable; nor is anything in a conversation the user lost access to, which the sync drops.
- Upgrading a v1 cache backfills the index once (`'rebuild'`) in the same transaction as the
  version bump.
- `message_cache_search` takes the free text and the parsed operators (`from:`, `in:`, `has:link`,
  `has:attachment`, `before:`, `after:`; the webview parses them, see
  `src/features/messages/api/localSearch.ts`) and returns hits newest first with the timeline's
  `(sentAt, id)` cursor, a `-bm25` rank, and a snippet that is HTML-escaped apart from its
  `<mark>` tags. Free text is never FTS5 syntax: each word becomes a quoted prefix term (`depl`
  finds `deploy`), `"quoted words"` a phrase, all of them required.
- Search covers one workspace of the signed-in account's own database, live messages only.

How the search overlay uses it is in `docs/search-ui.md`.

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

## Offline start

A user who signed in on this device before can open the app without a connection:

- The session record (`src-tauri/src/offline_session.rs`) is kept in the OS keyring: which
  account was signed in to which server, or that the user signed out. No token is stored; the
  session stays in the webview's cookie. When the startup session check cannot reach the
  server, the recorded account opens offline. When the server answers that the session is no
  longer valid, the app goes to sign-in as before.
- Snapshots (`message_cache/snapshot.rs`, schema v3) keep the last server answer of the
  signed-in user, the workspace list, and each workspace's joined channels, DMs and members in
  the same encrypted database. Each answer is saved; a query the server cannot be reached for
  is answered from its snapshot (`src/features/offline/api/offlineSnapshot.ts`). Those queries
  and the timeline run with TanStack Query's `offlineFirst` network mode, so they still try
  (and fall back) while the OS reports no network.
- While offline a banner says so and sending is off (typing still works). Writes fail at once
  instead of waiting to be replayed: mutations run with the `always` network mode.
- Offline mode re-checks the session on a timer that starts at 15 seconds and doubles after each
  miss up to two minutes (skipped while the OS reports no network or the window is hidden), and
  right away when the network, the window or the WebSocket comes back. The first answer leaves
  offline mode and refetches everything, or signs out when the server refuses the session
  (`UNAUTHENTICATED`, 401, 403); any other error keeps the app offline.
- A list served from its snapshot while the app thought it was online (a 5xx, a dropped
  network) switches the app to offline mode, so saved copies never pass for live ones.
- An explicit sign-out records `signedOut`, so the next start lands on sign-in without asking
  the server, even if the sign-out request never reached it. The encrypted cache stays.

## Not yet

- Thread panes, pins, reactions and link previews still read from the server; the feed does not
  version reactions, pins or previews, so cached copies of those are as of the last sync.
- On Linux the app's keyring backend is the kernel keyring (`keyring`'s `linux-native`), which
  does not survive a reboot, so the cache key is new after every reboot and the cache refills
  from the server. Moving the app to the Secret Service (`linux-native-sync-persistent`) fixes
  that for this key and the agent provider keys alike, and needs libdbus at build time.
- Local search covers the conversations the cache follows (opened on this device), not every
  conversation of the workspace. The drive archive comes later.
