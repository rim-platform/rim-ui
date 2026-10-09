# Secret vault

The desktop app keeps its secrets in one encrypted file: the message cache key, the history
archive keys and cloud refresh tokens, the offline session record, the key identity records and
pending device links, and the AI provider keys. The OS credential store holds a single entry, the
key that opens the file. The code is `src-tauri/src/secret_store.rs`.

Keeping the secrets out of the credential store lifts its size limit (Windows Credential Manager
takes about 2.5 KB per credential, and `keyring` stores strings as UTF-16) and asks a Linux
desktop keyring for one key per run instead of one record at a time.

## The key

- 32 random bytes, generated on first use and stored as unpadded base64url in the OS credential
  store under the service `com.rim.rim-ui`, user name `vault-key-v1`.
- macOS: Keychain. Windows: Credential Manager. Linux: the desktop keyring service (Secret
  Service over D-Bus: GNOME Keyring, KWallet or KeePassXC). With no Secret Service running, or
  the keyring locked, every secret fails with an error that says so; nothing falls back to a
  store that would not persist.
- It is read once per run and kept in memory for the rest of it.

## The file

`<app data>/secrets.vault`, next to `message-cache/`, owner-only (`0600`) on Unix:

```json
{
  "format": "rim-secret-vault",
  "v": 1,
  "records": {
    "<name>": { "nonce": "<base64url>", "sealed": "<base64url>" }
  }
}
```

- Each record is sealed on its own with XChaCha20-Poly1305 under the vault key, with a new random
  24-byte nonce on every write. `sealed` is the ciphertext with its 16-byte tag.
- The associated data is `rim-secret-vault v1`, a zero byte, then the record's name, so a record
  copied under another name does not open.
- Base64url is unpadded.
- Every write replaces the whole file: a temporary `secrets.vault.tmp` in the same directory is
  written, flushed to disk and renamed over the vault. A temporary file left by a crash is
  ignored and replaced by the next write.
- One lock in the process serializes every read, write and delete. The file is read on every
  call; besides the key, the only thing remembered between calls is which names the credential
  store does not hold (below).

## Moving secrets in from the credential store

Secrets written straight to the credential store move into the vault the first time they are
read, without the app having to list them:

- `read(name)`: the vault's record if there is one. Otherwise the credential store's entry of that
  name is read once; if there is one it is written into the vault, deleted from the store and
  returned. A name the store does not hold is not asked about again in the same run.
- `write(name, value)`: the vault only.
- `delete(name)`: the vault, and the credential store too unless the name is known to be gone from
  it this run. A failure to delete from the store is logged, not returned.

## When the vault does not open

- A file that does not parse, is not a `rim-secret-vault`, or has a record that does not open
  under the key is never overwritten. It is renamed to
  `secrets.vault.unreadable-<UTC timestamp>`, a warning is logged, and the call that found it
  fails with "the secret vault could not be opened; the keys it held are lost on this
  computer (…)". The next call starts a fresh vault.
- A vault whose key is missing from the credential store (or is not a 32-byte base64url value)
  is the same case, unless the vault holds no records; a new key is generated on the next call.
- A vault of a newer version (`v` above 1) is left untouched and every call fails with "the
  secret vault was written by a newer version of RIM".
- A credential store that cannot be read (no Secret Service, a locked or dismissed keyring)
  fails the call with the store's error and leaves the vault alone.

What each feature does with a lost secret is its own: the message cache deletes the database it
can no longer open and refills from the server, the history archive asks for the passphrase
again, and key sign-in needs the recovery phrase or another linked device.

## Trying it

- The records' names are visible in the file; their values are not. Removing one record from
  `records` while the app is closed loses only that secret: every other record still opens.
- Deleting `vault-key-v1` from the credential store (Seahorse, Keychain Access or Credential
  Manager) and starting the app moves the vault aside on the first secret it needs.
