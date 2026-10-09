# History archive format, version 1

The desktop app writes the user's message history to a folder the user picks, encrypted, and
reads it back on another device (master plan Stage 2). There is no RIM server in this picture:
the folder is the user's own (a local disk, a USB drive, a folder that Dropbox, Google Drive,
OneDrive, iCloud Drive or Syncthing keeps in sync, or the app's own folder in the user's Google
Drive or Dropbox, reached through their APIs), and only someone with the passphrase can read it.

This document is the format. Anyone may write a reader or writer from it. The implementation is
`src-tauri/src/history_archive/`; the cache it is written from is `docs/local-message-cache.md`.

## Goals

- A new device with nothing but the folder and the passphrase gets the history back, and shows
  it before asking any server.
- Several devices write into one folder at the same time without ever writing the same file, so
  a sync client never has a conflict to resolve and one device can never clobber another's data.
- The folder holds ciphertext only. File names reveal neither the server, the user, nor the
  conversations.
- The key that encrypts the files is not derived from the passphrase, so it can be unlocked
  another way too (the identity key, "Identity key backup") without re-encrypting anything.

## Layout

```text
<folder>/
  rim-archive.json                                  manifest
  devices/<device id>/
    key-wraps.json                                  the archive key under identity keys
  accounts/<account tag>/
    devices/<device id>/
      head.rimx                                     the device's segment list
      seg-0000000001.rimx                           segments, numbered from 1
      seg-0000000002.rimx
      ...
      identity-backup.rimx                          the identity key, sealed under the backup key
```

- **Manifest** (`rim-archive.json`): plain JSON, written once by the device that creates the
  archive. Version 1 never rewrites it.
- **Account tag**: `hex(HMAC-SHA256(name key, account label))[0..32]`, where the account label
  is `<GraphQL endpoint without trailing slash>\n<user id>` (the same label the local cache
  writes into its database) and the name key is derived from the archive key (below). One folder
  can hold several accounts under one passphrase; nobody without the key can tell whose they are.
- **Device id**: a random UUID (lowercase, with dashes) per installation of the app, kept in
  `<app data>/history-archive/device-id`. Copying the app's data directory to another computer
  copies the id; the copy must not write to the same archive as the original.
- **Segments** are immutable: once a device's head lists a segment, its bytes never change.
- **Head**: the device's list of its segments. Only that device ever writes its head, and it
  writes it whole (temporary file, then rename) after the segments it lists.

**Why immutable per-device files.** The master plan sketched one file per conversation and
month, appended in place. Version 1 deliberately departs from that: a sync client (Dropbox,
Google Drive, OneDrive, Syncthing) that uploads a file while another device appends to it turns
the race into a "conflicted copy" or a lost write, and the Google Drive and Dropbox APIs cannot
append at all. Files that are written once, by one device, and never changed have neither
problem. The cost is more, smaller files; compaction (below) is left to a later version.

A device writes only inside `accounts/<tag>/devices/<its own id>/` and `devices/<its own id>/`.
Readers ignore any name they do not expect: hidden temporary files (`.*.tmp`), a sync client's "conflicted copy" files, and
directories whose name is not an id (lowercase hex and `-`, 8 to 64 characters).

## Keys

| Key | What it is | Where it lives |
|---|---|---|
| Archive key | 32 random bytes, one per archive | Wrapped in the manifest; this device's copy in the secret vault (`history-archive-key-v1:<archive id>`) |
| Passphrase key | Argon2id(passphrase, salt), 32 bytes | Never stored |
| File key | HKDF-SHA256(archive key, no salt, info `rim-history-archive v1 file key`) | Derived |
| Name key | HKDF-SHA256(archive key, no salt, info `rim-history-archive v1 name key`) | Derived |
| Identity wrap key | HKDF-SHA256(identity seed, salt `rim.history-archive.v1`, info `archive key wrap`) | Derived by a device holding the identity key |
| Backup key | HKDF-SHA256(recovery phrase entropy, or a version 1 kit's seed, salt `rim.recovery-phrase.v1`, info `identity backup key`) | The secret vault record of a device that holds the identity key |

- The passphrase must be at least 12 characters. There is no recovery: losing the passphrase and
  every device that holds the key loses the archive, by design.
- Argon2id parameters are stored with the wrap. Version 1 writes 64 MiB memory, 3 iterations,
  1 lane, and a 16-byte random salt. Readers refuse parameters outside 8 KiB to 1 GiB of memory,
  1 to 16 iterations or 1 to 16 lanes, since the manifest comes from a shared folder.
- Wrapping is XChaCha20-Poly1305 under the passphrase key with a random 24-byte nonce and the
  associated data `rim-history-archive v1 key wrap\0<archive id>`.

## Manifest

```json
{
  "format": "rim-history-archive",
  "version": 1,
  "archiveId": "6f1c8a52-1d7e-4f0a-9a43-1c2b8a1f0e55",
  "createdAt": "2026-10-09T08:00:00+00:00",
  "keyWraps": [
    {
      "kind": "passphrase",
      "kdf": {
        "algorithm": "argon2id",
        "memoryKib": 65536,
        "iterations": 3,
        "parallelism": 1,
        "salt": "<base64, 16 bytes>"
      },
      "nonce": "<base64, 24 bytes>",
      "wrapped": "<base64, 32-byte key + 16-byte tag>"
    }
  ]
}
```

A reader tries every `passphrase` wrap it understands and skips wraps of a `kind` it does not
know. The manifest only ever holds `passphrase` wraps: the archive key's wraps under identity keys
(`identity-v1`, "Identity key backup") have the same entry shape but live in per-device files,
because they change with every identity rotation and the manifest is never rewritten. Creating an archive is an exclusive create of the manifest (a hard link of a fully written
temporary file, or an exclusive open where the file system has no hard links): if two devices
create one in the same folder at once, one wins and the other joins it.

## Sealed files (`.rimx`)

Heads and segments share one envelope:

| Bytes | Field |
|---|---|
| 4 | `RIMX` |
| 1 | envelope version, `1` |
| 1 | kind: `1` segment, `2` head, `3` identity backup |
| 24 | XChaCha20-Poly1305 nonce, random |
| rest | ciphertext with its 16-byte tag |

The cipher key is the file key, except for an identity backup, which is sealed under the backup
key ("Identity key backup"). The associated data is the 30-byte header followed by
`\0<archive id>\0<account tag>\0<device id>\0<file name>`. A file moved to another device's
folder, renamed to another sequence number, or swapped between a head and a segment therefore
fails to decrypt.

## Head

The plaintext of `head.rimx` is JSON:

```json
{
  "v": 1,
  "archiveId": "6f1c8a52-…",
  "deviceId": "0f0e0d0c-…",
  "updatedAtMs": 1760000000000,
  "segments": [
    { "seq": 1, "sha256": "<hex of the sealed file>", "events": 812, "createdAtMs": 1759990000000 }
  ]
}
```

A reader takes a device's segments from its head, not from a directory listing, and checks each
file against its `sha256`. A listed segment that is not in the folder yet (a sync client still
downloading it) is reported as missing, not as an error; a later read picks it up.

## Segments

The plaintext of a segment is UTF-8 JSON lines. The first line is the segment header, every
other line an event. Each line is an object with a `t` field naming its type.

```text
{"t":"segment","v":1,"archiveId":"…","deviceId":"…","seq":3,"createdAtMs":1760000000000}
{"t":"msg","workspaceId":"…","conversationId":"…","id":"…","threadId":null,"authorId":"…","version":42,"sentAtUs":1759999999000000,"editedAt":null,"deleted":false,"text":"hello","payload":{…},"sig":null}
{"t":"conv","workspaceId":"…","conversationId":"…","cursor":"42","complete":true,"lastViewedAt":1759999990000,"resetAt":null,"maxVersion":42}
```

A segment holds at most 4 MiB of plaintext; one export writes as many as it needs.

### `msg`: a message at one version

The message as the server's change feed (rim-server `docs/message-change-feed.md`) last gave it
to the device. Creates, edits and deletes are not separate event kinds: an edit is the same
message at a higher `version`, a delete is a tombstone (`deleted: true`, `text: null`, no
attachments, link previews or reactions in `payload`).

- `version`: the feed's per-conversation version. Higher wins.
- `sentAtUs`: microseconds since the epoch.
- `payload`: the rest of the message as the app renders it (the `MessageWithReactions`
  fragment), without `text`.
- `sig`: the author's signature. Messages archived before Stage 3 (identity keys) carry `null`
  and are **unsigned**: readers accept them and must not treat them as a failed verification.
  Until then, integrity comes from the AEAD: nobody without the archive key can forge or alter a
  file.

### `conv`: where a device's sync of a conversation stood

- `cursor`: the change-feed cursor. Every message up to it is in this device's segments, in this
  segment or an earlier one (a writer must write a `conv` event only after, or with, every
  message it covers).
- `complete`: the device held the conversation's whole history at `cursor`.
- `resetAt`: when the device last saw the server answer `RESET` for the conversation (Unix ms),
  or `null`. A `RESET` means the server was restored from a backup and its versions started over.
- `maxVersion`: the highest message version the device held.

## Writing (export)

A device exports from its local cache, incrementally. The cache numbers every change to a
message or to a conversation's sync state, and remembers per archive and device how far it has
exported. An export:

1. Reads a batch of changed messages (at most 5,000) in one transaction. The last batch also
   reads the changed conversation states, in the same transaction as its messages.
2. Writes the batch as new segments, numbered after the last one in its head.
3. Rewrites its head to list them.
4. Records in the cache that the batch is archived.

A crash between steps repeats the batch next time, which the version rule makes harmless. The
app exports a few minutes after the cache syncs and on demand from Settings > History.

Rows a device restored from an archive are not exported back into that archive. If the device
later moves to another archive, they are exported there like any other row, so the new archive
holds the device's whole history.

## Reading and restoring

1. Unlock the archive key (passphrase, or the device's stored copy). Check the manifest's
   `archiveId` before writing: a device never writes into a folder that now holds another
   archive, or into an empty folder where its archive used to be (an unplugged drive).
2. List `accounts/<tag>/devices/`, read each head, then each listed segment.
3. Merge:
   - **Messages**: per message id, the highest `version` wins across all devices. A message
     event in a segment created before the conversation's latest `resetAt` (from any device) is
     stale and skipped.
   - **Conversation state**: taken only from a device whose segments were all readable, from a
     segment created at or after the latest reset, and whose own `resetAt` equals that latest
     reset. Among those, a complete state wins over an incomplete one, then the higher
     `maxVersion`, then the later segment.
   - A conversation with archived messages but no state to trust is restored with no cursor: the
     app syncs it from the beginning.
4. Write into the cache in one transaction. Between the archive and the cache, and later between
   the cache and the server, the **higher version wins; on a tie the copy already in the cache
   stays** (both are the same server state). A conversation the cache did not follow is followed
   from the archive's cursor, so its history shows at once and the next sync asks the server only
   for what is newer. A conversation the cache already follows keeps its own sync state.

When the server is the authority (it answers `RESET` for a restored cursor, or `NO_ACCESS`),
the cache does what it does for any cursor: drops the conversation and refetches it, or drops it
and stops following it.

## Identity key backup

The identity key (rim-server `docs/specs/key-identity-v1.md`) adds devices, rotates and publishes
the profile card. It lives in the secret vault of the device that enrolled the account. The
archive keeps two things for it, both written only by a device that holds the account's current
identity key:

- a **backup of the identity key**, sealed under a key that only the recovery phrase gives, so
  another of the person's devices can take the identity key over when the first one is gone;
- a **wrap of the archive key under the identity key**, a second way to unlock the archive
  beside the passphrase.

### Backup key

`HKDF-SHA256(ikm = the 16 bytes of the recovery phrase, salt = "rim.recovery-phrase.v1",
info = "identity backup key")`, 32 bytes. The recovery key uses the same salt with
`info = "recovery key"`, so neither key can be derived from the other.

An account enrolled with a version 1 kit (`RK1-`) has no phrase: its backup key is the same HKDF
over the kit's 32-byte recovery seed. There, whoever holds the recovery seed can derive the
backup key (but not the other way round), which gives them nothing they could not already do
with a recovery.

The entropy exists only while the kit is shown (enrollment, key-only signup) or typed
(recovery). The device keeps the **backup key**, never the entropy, in its secret vault record
next to the identity key. A device that holds the identity key without a backup key (enrolled before
the backup existed) gets one when the person types the phrase or `RK1-` key in Settings >
Security; the app checks it against the key log's `recoveryKey` first.

### The backup record

`accounts/<account tag>/devices/<device id>/identity-backup.rimx`, a sealed file of kind `3`
whose cipher key is the backup key (not the file key), with a fresh random nonce per write. Its
associated data binds it, like every sealed file, to the archive, the account, the device and the
file name. The plaintext is JSON:

```json
{
  "v": 1,
  "principalId": "rimp1_…",
  "keySeq": 3,
  "identitySeed": "ed25519:<base64url, 32 bytes>",
  "pendingIdentitySeed": "ed25519:<base64url, 32 bytes>",
  "pendingKeySeq": 4
}
```

- `keySeq`: the key log `seq` whose head names `identitySeed`, as the writer verified it.
- `identitySeed`: the identity key as the secret vault stores it, algorithm tag and seed.
- `pendingIdentitySeed`, `pendingKeySeq`: present while a rotation the writer sent has not been
  confirmed: the new key and the `seq` its rotation creates.

The file is not listed in the device's head; readers that do not know it never open it.

### When it is written

A device writes its backup and its wrap whenever it holds the head's identity key and the
archive is unlocked on it: when the archive is set up or joined, when the identity key is
enrolled, recovered or taken over, after a rotation, and whenever Settings > Security checks the
key log. It writes only what changed: a backup that already opens to the same plaintext and a
wrap that already opens to the archive key are left alone.

### Taking the identity key over

On a device that holds only a device key for the account, with the archive set up and unlocked:

1. The person types the recovery phrase (or `RK1-` key). The app derives the recovery key and
   checks it is the `recoveryKey` of the server's key log, replayed on the device.
2. It derives the backup key, lists `accounts/<tag>/devices/`, and opens every
   `identity-backup.rimx` it finds. A file that does not open, or names another `principalId`,
   is skipped.
3. It keeps the seed (current or pending) whose public key is the head's `identityKey`. If none
   is, every backup predates the last rotation, and the takeover stops: the device that holds
   the current key backs it up the next time it runs.
4. It stores the identity key and the backup key in its secret vault record and writes a backup
   and a wrap of its own.

The old device keeps its copy; nothing is revoked or signed. The new holder can add and revoke
devices, rotate and publish the profile card from then on.

### Wraps under the identity key (`identity-v1`)

`devices/<device id>/key-wraps.json`, plain JSON, written whole by that device only:

```json
{
  "format": "rim-history-archive-key-wraps",
  "v": 1,
  "archiveId": "6f1c8a52-…",
  "deviceId": "0f0e0d0c-…",
  "keyWraps": [
    {
      "kind": "identity-v1",
      "account": "<account tag>",
      "nonce": "<base64, 24 bytes>",
      "wrapped": "<base64, 32-byte key + 16-byte tag>"
    }
  ]
}
```

- The cipher key is the **identity wrap key**, `HKDF-SHA256(ikm = identity seed, salt =
  "rim.history-archive.v1", info = "archive key wrap")`, the nonce is random, and the
  associated data is `rim-history-archive v1 identity key wrap\0<archive id>\0<account tag>`.
- A device keeps one `identity-v1` entry per account: writing a wrap under a new identity key
  (after a rotation) replaces its entry for that account, so the old key's wrap is gone. Entries
  of a kind it does not know are kept as they are.
- **Unlocking** ("Unlock with this device's keys", beside the passphrase when this device holds
  an identity key for the account): list `devices/`, read each `key-wraps.json` of this archive,
  and try each `identity-v1` entry with the wrap key of every identity key the device holds
  (current and pending). A wrap under a key it does not hold fails authentication and is
  skipped. The unwrapped key is used only if its account tag for this account equals the
  entry's `account`.

The file sits outside `accounts/` because a device that needs it does not have the archive key
yet, and the account tag is derived from that key.

### What a drive provider learns

It sees which devices hold an identity key for which account tag, how big the backup is (larger
while a rotation is pending), and when each file is rewritten (after setup, enrollment, rotation
or takeover). It learns neither the identity key, its public key, nor whose account it is. The
backup key carries the phrase's 128 bits and the wrap key the identity key's 256: neither can be
guessed offline. Someone with the archive's passphrase can read the history but not the backup.
A provider can delete or roll back these files: a deleted backup stops a takeover, and a backup
older than the last rotation is refused by the key log check; a forged one fails authentication.

### Known-answer vectors

Never use these for a real account.

| Item | Value |
|---|---|
| Phrase entropy | `000102030405060708090a0b0c0d0e0f` |
| Backup key from it | `2438cbcffe2da40ecca624572cc87e128658014f3c05c2431ba039b03a4035bf` |
| Version 1 recovery seed | `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f` |
| Backup key from it | `4262b4cecee03da62eaa49f56889412370a08500e57b11e3ac9a06f7b1a8c302` |
| Identity seed | `202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f` (stored as `ed25519:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8`) |
| Identity wrap key from it | `4a91b2fbae43381b5dc85eb455dce1c22ed89ed182aeb4e6b31ff46cbf2f57c9` |

A sealed backup under the phrase's backup key, archive id
`6f1c8a52-1d7e-4f0a-9a43-1c2b8a1f0e55`, account tag `00112233445566778899aabbccddeeff`, device id
`0f0e0d0c-0b0a-4908-8706-050403020100`, nonce `404142434445464748494a4b4c4d4e4f5051525354555657`,
and the plaintext (no whitespace)

```text
{"v":1,"principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","keySeq":0,"identitySeed":"ed25519:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8"}
```

is these 199 bytes (SHA-256 `605e2cd7439fecc24fdcec24950a7ec63d700eb4d8660f1251385557053bc315`):

```text
52494d580103404142434445464748494a4b4c4d4e4f50515253545556572c99
273079b132162a65eb3fedb5f5250ee55435c15895077b742fb1f2b709847ec9
124e45c8d94a4ddeb6ac6930670ce9752afd0a96a0ccc85fc164349d35ac667e
4848c3c32ebf0af8090fccd7e804aaae05cf481c4b177f185facaac4635db959
0bcd6f6f08607adca293a305e98ed592aa712c602e443752ccf6eee733b92f05
5243e1cd6e338f9fcf35f1f58d6076d4fabcf69c4133f0edf402da8c60a58807
bd105bb3844de3
```

An `identity-v1` wrap of the archive key `606162…7f` (32 bytes counting up) under the identity
seed's wrap key, for the same archive id and account tag, with nonce
`gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaX` (bytes `80` to `97`), has `wrapped`
`7V00oND8ZorkpfnJFKA1z3b3F5NjQ06pY20vPcfQuPMCMMGaNR231yQTWGP0EPFv`.

## Versioning

- `version` in the manifest is the archive format version; the envelope byte and `v` in heads
  and segment headers are 1 in this version.
- **Within version 1, changes are additive only**: new event types (`t`), new key wrap kinds,
  new optional fields. Readers skip event types and wrap kinds they do not know and ignore
  unknown fields. A writer never changes the meaning of an existing field.
- **Anything else is version 2**: a new envelope, cipher, key derivation, layout, or a change in
  what an existing field means. A reader refuses an archive whose `version` is newer than it
  knows, and tells the user to update.
- Following the master plan's compatibility rule, each release reads the current and the
  previous version. A writer that upgrades an archive must keep it readable by the previous
  release until the archive's manifest says otherwise.

## Providers

The layout above is written through a provider with five operations: read a file, write a file
whole (replacing it), create a file only if its name is free, list the directories in a
directory, and check that the place can be written. Nothing appends or renames, so any storage
with whole-file uploads can hold an archive. The implementation is
`src-tauri/src/history_archive/provider.rs` and `cloud/`.

### Local folder

Archive paths are paths under the folder. A write goes to a hidden temporary file
(`.<name>.<random>.tmp`) and is renamed over the target; a create is a hard link of the
temporary file (or an exclusive open where there are no hard links).

### Google Drive

- **Place**: the app's `appDataFolder`, with the scope `drive.appdata`. It is hidden from the
  Drive interface and from every other app, and the app cannot see any other file. The user can
  delete it under Drive settings, Manage apps, "Delete hidden app data". It belongs to the OAuth
  client: a build with another client id has another `appDataFolder`.
- **Names**: Drive has file ids, not paths, and allows several files with one name. Every file
  is stored directly in `appDataFolder` with its whole archive path as its name
  (`accounts/<tag>/devices/<id>/head.rimx`); directories are the prefixes of those names.
- **Several files with one name**: the oldest (`createdTime`, then file id) is the file. They
  arise from two devices creating the manifest at once, or from an upload that is retried after
  its answer was lost.
- **Create**: Drive has no exclusive create. The device uploads, then lists the name: when an
  older file exists, it deletes its own upload and joins that one. Two devices racing see the
  same two files and agree on the older.
- **Write**: an existing file's content is replaced in place (a media upload to its id), so a
  segment left behind by an interrupted export is overwritten, not joined by a second file.

### Dropbox

- **Place**: the app folder (`Apps/<app name>/`) of a Dropbox app with "App folder" access,
  which sees nothing else in the user's Dropbox. Archive paths are paths under it, so the folder
  holds exactly the local layout: copied to a disk, it is a local folder archive, and the other
  way round.
- **Write**: an upload in `overwrite` mode, which replaces the file whole.
- **Create**: an upload in `add` mode with `autorename` off and `strict_conflict` on, which fails
  when the name is taken.

### Sign-in and tokens

- OAuth 2.0 for native apps (RFC 8252): the system browser signs the user in and redirects to a
  one-shot listener on the loopback interface; PKCE (S256) protects the code, and a random
  `state` must match. Google redirects to `http://127.0.0.1:<any free port>/callback`; Dropbox
  only accepts registered redirect URIs, so it uses `http://localhost:<fixed port>/callback`
  (53241 unless the build says otherwise).
- The refresh token is kept in the secret vault as `history-archive-cloud-v1:<connection id>`.
  The account's archive settings file names the provider, the connection id and the signed-in
  email address, never a token. Access tokens live in memory and are refreshed shortly before
  they expire, or once when the service refuses one.
- A sign-in is kept only when the user connects the archive with its passphrase. Stopping
  backups on a device, or leaving a sign-in unused, deletes its refresh token from the secret
  vault first and then, for Dropbox only, revokes it (once, best effort; a failed revoke is logged
  and does not undo the sign-out). Dropbox revokes one token and leaves the user's other
  devices signed in. Google cannot: revoking any token removes the user's whole grant to the
  OAuth client and invalidates every device's refresh tokens, so RIM never calls Google's
  revoke endpoint, and a user who wants RIM's access gone everywhere removes it in their
  Google account settings (Security, Third-party apps with account access). Google keeps a
  limited number of refresh tokens per user and client and silently drops the oldest beyond
  it, so a device that has been signed in very many times may need to sign in again. The
  archive itself stays.
- Client ids are build configuration (the README says how to get them); none is committed.

### Retries and interrupted backups

A rate limit (HTTP 429, or a 403 naming a rate limit on Drive), a 5xx answer or a network
failure is retried up to six attempts in all, waiting as `Retry-After` says (at most 60 s) or
with exponential backoff and jitter from 0.5 s to 16 s. A service that stays busy fails the
export, which runs again later.

An export interrupted at any point resumes safely, because the head is the commit point:
segments are written before the head that lists them, readers take segments only from the head,
and the cache marks a batch archived only after its head is written. The next export writes the
same batch again under the same sequence numbers, replacing whatever the interrupted one left.

## Not in version 1

- OneDrive, iCloud Drive and other cloud APIs: a folder kept in sync by their desktop clients
  works.
- Telling a device that a cloud sign-in was revoked elsewhere before the next backup fails.
- Compaction: every export adds segments. A later writer may merge a device's own segments into
  fewer (only that device may), listing the new ones in its head before deleting the old.
- Signed messages and rollback detection (a drive restoring an older head) come with Stage 3
  identity keys.
- Unlocking with the identity key when joining an archive on a new device: the wrap is offered
  only to a device that already has the archive set up and lost its key.
- Restore reads the whole account into memory before writing it to the cache.
- Device clocks order resets (`resetAt` against `createdAtMs`); a device whose clock is far off
  can have its archived copies of a reset conversation skipped. They are the server's to resend.
