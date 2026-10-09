# History archive format, version 1

The desktop app writes the user's message history to a folder the user picks, encrypted, and
reads it back on another device (master plan Stage 2). There is no RIM server in this picture:
the folder is the user's own (a local disk, a USB drive, or a folder that Dropbox, Google Drive,
OneDrive, iCloud Drive or Syncthing keeps in sync), and only someone with the passphrase can
read it.

This document is the format. Anyone may write a reader or writer from it. The implementation is
`src-tauri/src/history_archive/`; the cache it is written from is `docs/local-message-cache.md`.

## Goals

- A new device with nothing but the folder and the passphrase gets the history back, and shows
  it before asking any server.
- Several devices write into one folder at the same time without ever writing the same file, so
  a sync client never has a conflict to resolve and one device can never clobber another's data.
- The folder holds ciphertext only. File names reveal neither the server, the user, nor the
  conversations.
- The key that encrypts the files is not derived from the passphrase, so a later stage can add
  another way to unlock it (Stage 3 identity keys) without re-encrypting anything.

## Layout

```text
<folder>/
  rim-archive.json                                  manifest
  accounts/<account tag>/
    devices/<device id>/
      head.rimx                                     the device's segment list
      seg-0000000001.rimx                           segments, numbered from 1
      seg-0000000002.rimx
      ...
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

A device writes only inside `accounts/<tag>/devices/<its own id>/`. Readers ignore any name they
do not expect: hidden temporary files (`.*.tmp`), a sync client's "conflicted copy" files, and
directories whose name is not an id (lowercase hex and `-`, 8 to 64 characters).

## Keys

| Key | What it is | Where it lives |
|---|---|---|
| Archive key | 32 random bytes, one per archive | Wrapped in the manifest; this device's copy in the OS keyring (`history-archive-key-v1:<archive id>`) |
| Passphrase key | Argon2id(passphrase, salt), 32 bytes | Never stored |
| File key | HKDF-SHA256(archive key, no salt, info `rim-history-archive v1 file key`) | Derived |
| Name key | HKDF-SHA256(archive key, no salt, info `rim-history-archive v1 name key`) | Derived |

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
know. Creating an archive is an exclusive create of the manifest (a hard link of a fully written
temporary file, or an exclusive open where the file system has no hard links): if two devices
create one in the same folder at once, one wins and the other joins it.

## Sealed files (`.rimx`)

Heads and segments share one envelope:

| Bytes | Field |
|---|---|
| 4 | `RIMX` |
| 1 | envelope version, `1` |
| 1 | kind: `1` segment, `2` head |
| 24 | XChaCha20-Poly1305 nonce, random |
| rest | ciphertext with its 16-byte tag |

The cipher key is the file key. The associated data is the 30-byte header followed by
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

Rows a device restored from the archive are not exported again by that device.

## Reading and restoring

1. Unlock the archive key (passphrase, or the device's keyring copy). Check the manifest's
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

## Not in version 1

- Cloud API providers (Google Drive, Dropbox): they come later behind the same provider trait
  as the local folder; a folder kept in sync by their desktop clients works today.
- Compaction: every export adds segments. A later writer may merge a device's own segments into
  fewer (only that device may), listing the new ones in its head before deleting the old.
- Signed messages and rollback detection (a drive restoring an older head) come with Stage 3
  identity keys.
- Restore reads the whole account into memory before writing it to the cache.
- Device clocks order resets (`resetAt` against `createdAtMs`); a device whose clock is far off
  can have its archived copies of a reset conversation skipped. They are the server's to resend.
