# Backup endpoint, version 1

The desktop app keeps its history archive (`history-archive-v1.md`) in a folder, in Google Drive
or Dropbox, or on a service the user runs: the **backup endpoint**. This document is that
service's protocol, so anyone can write one. It is one URL answering `GET` and `POST`; the files
it stores are the archive's, already encrypted, and it never needs to understand them.

The device side is `src-tauri/src/history_archive/cloud/endpoint.rs`. A reference service ships
next to this document: `backup-endpoint-reference.py`, a single Python 3 file using only the
standard library, which keeps the files under one directory. The app's tests run the endpoint
provider against it.

A write-only webhook is deliberately not the protocol: restoring on a new device, and several
devices sharing one archive, need read and list.

## The URL

The user types the endpoint's URL in Settings > History, "Your own server". When its path ends
in `/backup`, requests go to that URL; otherwise `/backup` is appended
(`https://backup.example.com` and `https://backup.example.com/backup` are the same endpoint;
`https://example.com/rim` becomes `https://example.com/rim/backup`). The URL has no user name,
password, query or fragment.

Every request carries exactly one query parameter, `path` or `list`, whose value is an archive
path, percent-encoded as `application/x-www-form-urlencoded` (a `/` may arrive as `%2F`).

## Paths

Archive paths are relative and `/`-separated (`accounts/<tag>/devices/<id>/head.rimx`). Every
segment is non-empty, is not `.` or `..`, and holds no `\`, `:` or NUL. Version 1 writes paths
of lowercase hex, digits, `-`, `.` and the fixed names of `history-archive-v1.md`, at most about
110 bytes long; a service may refuse paths over 1,024 bytes with 400.

A service must refuse (400) any path that would leave its storage, whatever the device sends. It
maps paths to its storage however it likes (directories on disk, object keys, database rows);
directories exist exactly while a file is under them.

## Requests

### Read a file

```http
GET /backup?path=accounts/0011…/devices/0f0e…/head.rimx
```

- `200` with the file's bytes exactly as stored. The `Content-Type` does not matter.
- `404` when there is no file at that path.

### List a directory

```http
GET /backup?list=accounts/0011…/devices
```

`list=` with an empty value is the root.

- `200` with a JSON array of the entries directly in that directory, files and directories,
  hidden names (starting with `.`) included:

  ```json
  [
    { "name": "0f0e0d0c-aaaa-4bbb-8ccc-123456789abc", "dir": true },
    { "name": "head.rimx", "dir": false }
  ]
  ```

  `name` is one path segment; `dir` says whether it is a directory. Other fields are ignored.
  The order is free, except for a service that ignores `If-None-Match` (below), which lists in
  the order it stored the entries, oldest first.
- `404`, or `200` with `[]`, for a directory that does not exist. The root always exists.

### Store a file

```http
POST /backup?path=accounts/0011…/devices/0f0e…/seg-0000000001.rimx
Content-Type: application/octet-stream

<the file's bytes>
```

The service stores the body whole under that path, creating the directories above it and
replacing any file already there. A reader sees the old bytes or the new ones, never a mix or a
truncated file: write to a temporary name, then rename over the target.

- `201` when the file is new, `204` when it replaced one. The device accepts any `2xx`.

### Exclusive create

```http
POST /backup?path=rim-archive.json
If-None-Match: *
```

The same, except that the service stores the body only if nothing is at the path, and otherwise
answers `412` and leaves the file alone. It must be atomic: of two devices creating one path at
once, exactly one gets `2xx` (a hard link of the fully written temporary file, an exclusive
open, a conditional insert). The device creates only the archive's manifest this way, once per
archive.

**A service that ignores the header still works.** The check (below) finds out, and from then on
the device creates a file without the service's help:

1. It reads the path. A file there means the name is taken.
2. It stores the bytes under a claim of its own in the same directory,
   `.<name>.<12 random hex digits>.claim`.
3. It lists the directory and keeps the claim for `<name>` that the listing names first. Since
   such a service lists in the order it stored, that is the oldest claim, and every device that
   lists agrees on it.
4. It copies the kept claim's bytes to the path. Every device does, so they all write the same
   bytes there; the one whose claim was kept has created the file, the others join it.

Claims stay behind: version 1 has no delete. They are small, hidden, and only ever made for the
manifest.

## Authentication

The user picks one at setup:

| Mode | Request header |
|---|---|
| None | none |
| User and password | `Authorization: Basic <base64(user:password)>` (RFC 7617) |
| Token | `Authorization: Bearer <token>` (RFC 6750) |
| Token in a header | `<header name the user typed>: <token>` |

The service answers `401` to missing or wrong credentials and `403` to valid ones it does not
allow; it should compare secrets in constant time. On the device, the password or token is kept
in the secret vault as `history-archive-cloud-v1:<connection id>`; the account's archive settings
file names the URL, the mode, and the user name or header name, never the secret. Stopping
backups on a device deletes the secret from its vault.

## Transport

HTTPS is required, with the certificate verified against the system's trust store, unless the
host is this computer (`localhost`, `127.0.0.0/8`, `::1`) or the user ticks "Allow an
unencrypted connection". Over plain HTTP the archive's files are still encrypted, but the
credentials travel in the clear and anyone on the way can withhold or replay files. Version 1
has no certificate pinning, self-signed certificate override or client certificates: use a
certificate the system trusts, or the override on a network the user controls.

## The check

Before an endpoint is used, Settings runs a check, which also stands for the provider's
"check writable":

1. `POST ?path=.rim-probe-<16 random hex digits>` with 32 random bytes.
2. `GET ?list=` (the root): it must be a JSON array of entries.
3. `GET ?path=.rim-probe-…`: it must return the same 32 bytes.
4. `POST ?path=.rim-probe-…` again with `If-None-Match: *`: `412` means the service honours
   exclusive creates; `2xx` or `501` means it does not, and the device uses claims. The answer
   is saved with the connection.
5. `GET ?path=rim-archive.json`, to tell the user whether an archive is already there.

The probe stays; a service may delete `.rim-probe-*` files whenever it likes. A failed check
names the problem:

| Found | Told |
|---|---|
| No connection, timeout, DNS failure | nothing answers at that address |
| TLS handshake or certificate failure | the secure connection failed |
| Plain HTTP to another computer, not allowed | use `https://`, or allow an unencrypted connection |
| `401` | the credentials were refused |
| `403` | the credentials were accepted, access refused |
| `404` or `405` to the probe's `POST` | no backup endpoint at that URL |
| A listing that is not a JSON array | not a backup endpoint |
| The probe not returned, or other bytes | the service does not keep files correctly |

The check retries once; a TLS failure is not retried.

## Status codes

| Status | To | Meaning to the device |
|---|---|---|
| `200` | `GET` | the file, or the listing |
| `201`, `204` (any `2xx`) | `POST` | stored |
| `400` | any | the request is malformed or the path refused; reported as an error |
| `401` | any | credentials missing or wrong |
| `403` | any | credentials valid, access refused |
| `404` | `GET ?path` | no such file |
| `404` | `GET ?list` | no such directory (an empty listing); at the root, not a backup endpoint |
| `404`, `405` | `POST` | not a backup endpoint at that URL |
| `412` | `POST` with `If-None-Match: *` | the name is taken |
| `413` | `POST` | the file is larger than the service takes; the backup fails |
| `429` | any | busy: retried, honouring `Retry-After` |
| `500`, `502`, `503`, `504` | any | retried |
| `501` | `POST` with `If-None-Match: *` | no exclusive create (only during the check) |
| `507` | `POST` | the service is full; the backup fails |

## Retries

As for every provider (`history-archive-v1.md`, "Retries and interrupted backups"): a `429`, a
`5xx` or a network failure is retried up to six attempts in all, waiting as `Retry-After` says
(at most 60 s) or with exponential backoff and jitter from 0.5 s to 16 s; a TLS failure is not
retried. A `POST` is retried like a `GET`: storing a file whole is idempotent. An exclusive
create whose `2xx` was lost is answered `412` on the retry; the device then joins the manifest,
which is its own.

## Size limits

- **Files.** A segment holds at most 4 MiB of plaintext and its envelope adds 46 bytes; heads,
  key wraps and the manifest are a few KiB, an identity backup under 1 KiB. A service must
  accept bodies of at least **8 MiB**: twice the largest file version 1 writes, which leaves
  room for additive changes within version 1. It answers `413` beyond its own limit. The
  reference service takes 64 MiB.
- **Time.** The device gives a request 180 s, so a 4 MiB upload must complete within that on the
  user's uplink.
- **Listings.** There is no paging. The device lists only the root, `devices/`, `accounts/` and
  `accounts/<tag>/devices/`, which hold one entry per account or device; it never lists a
  device's own directory, where segments accumulate. A service must answer listings of at least
  10,000 entries.
- **Paths.** At most 1,024 bytes (above).

## What the service learns

The same as any drive the archive is kept in: the file names (account tags, device ids, segment
numbers, none of which reveal the user, their server or their conversations), the files' sizes,
and when each is written or read, which shows when each device is active (a device exports a few
minutes after it syncs). It also sees each device's IP address and the credentials it was given.
Nothing else: it cannot read the history, the identity key backup or the key wraps. Like any
drive, it can delete, withhold or roll back files, with the consequences
`history-archive-v1.md` describes.

## Writing a service

What a service must get right, in order of how much it matters:

1. Store a file whole and atomically: temporary file, then rename.
2. Refuse paths that leave the storage.
3. Make `If-None-Match: *` atomic, or ignore it entirely and list in storage order. A service
   that half honours it (checks, then writes) can let two devices create two archives.
4. Answer listings as a JSON array of `{"name", "dir"}`.
5. Require credentials and serve HTTPS when it is reachable from another computer.

The reference service is plain HTTP on loopback by default:

```sh
python3 docs/specs/backup-endpoint-reference.py --dir ~/rim-backup --bearer "$(openssl rand -hex 24)"
```

To reach it from other computers, put a TLS-terminating reverse proxy (Caddy, nginx) in front of
it.

## Not in version 1

- Deleting files: probes and claims stay until the service removes them.
- Paged listings, resumable or chunked uploads.
- Certificate pinning, self-signed certificate overrides, client certificates.
- WebDAV (Nextcloud, ownCloud) as a provider of its own; this protocol's shape resembles it.
