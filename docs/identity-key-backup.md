# Identity key backup (desktop)

The identity key adds and removes devices, replaces itself and signs the profile card. Without a
backup it lives only on the computer that enrolled the account (or recovered it), and losing that
computer leaves the recovery rotation as the only way back, which signs out every device. With
the history archive set up, the computer that holds the identity key keeps a copy of it in the
archive, sealed under a key only the recovery phrase gives; another of the person's computers
takes the identity key over from that copy with the phrase. The holder also wraps the archive key
under the identity key, a second way to unlock the archive beside the passphrase.

The format, the derivations and the known-answer vectors are in
`docs/specs/history-archive-v1.md`, "Identity key backup". This page says what lives where and
how to try it.

## What lives where

| What | Where |
|---|---|
| Identity key, backup key | This computer's secret vault record for the account (`key-identity-v1:<account id>`, see `secret-vault.md`). The backup key is derived from the recovery phrase at enrollment, key-only signup, recovery or takeover; the phrase itself is never stored. |
| Backup record | `accounts/<account tag>/devices/<device id>/identity-backup.rimx` in the archive, one per computer that holds the identity key, sealed under the backup key. |
| Archive key wrap | `devices/<device id>/key-wraps.json` in the archive, one `identity-v1` entry per account, under a key derived from the identity key. |

The code:

- `src-tauri/src/key_identity/backup.rs`: the backup record's plaintext, the archive key wrap
  key, and the takeover against the replayed key log. `recovery_kit.rs` derives the backup key
  from a phrase or a `RK1-` key.
- `src-tauri/src/history_archive/identity.rs`: writes and reads the backup files and the wrap
  files, and unlocks the archive from a wrap.
- `src-tauri/src/identity_backup/`: joins the two and holds the `identity_backup_*` commands. The
  webview passes the server's key log and, for a takeover or turning the backup on, the phrase
  once; seeds, the backup key and the wrap key never reach it.
- `src/features/key-identity/api/identityBackup.ts` and `components/IdentityKeyBackup.tsx`:
  Settings > Security, "Identity key backup".
- `src/features/history-archive/components/HistoryArchiveSettings.tsx`: "Unlock with this
  device's keys" when the archive is locked here and this computer's identity key opens a wrap,
  and a backup right after the archive is set up or unlocked.

## When the backup is written

Whenever Settings > Security checks the key log on the computer that holds the identity key,
and right after the archive is set up, joined or unlocked there. Nothing that is already in the
archive is written again, so a rewrite happens only after enrollment, a rotation (the backup
then carries the new key, and the wrap under the old key is replaced), a recovery or a takeover.
A computer that holds the identity key but enrolled before the backup existed asks for the
recovery phrase once ("Turn on backup") and keeps the backup key from then on.

## Trying it

Two computers (or two OS users, each with its own secret vault), the same server, and an archive
both can reach (a shared folder, the same Google Drive, Dropbox or OneDrive account, the same S3
bucket, or the same backup endpoint):

1. On computer A, sign in and set up key sign-in in Settings > Security. Save the recovery kit.
2. On A, set up the history archive in Settings > History. Back in Settings > Security,
   "Identity key backup" says the archive holds a copy.
3. Link computer B from A ("Link a device"), and on B join the same archive with its passphrase
   in Settings > History.
4. On B, open Settings > Security, choose "Take over the identity key...", and type the
   recovery phrase. B now says it holds the identity key: "Link a device", "Replace identity
   key..." and the profile card are available there. A keeps its copy.

If A replaces its identity key while its archive is out of reach (a drive unplugged), B's
takeover says the copy is of an older key until A, with the archive back, backs up the new one.

To try the unlock path, quit A and remove the archive key from its secret vault (the
`history-archive-key-v1:<archive id>` record in `secrets.vault`; the other records still open);
Settings > History then offers "Unlock with this device's keys" beside the passphrase.

## Limits

- A takeover needs the archive set up and unlocked on the computer taking over, so the person
  needs both the archive's passphrase and the recovery phrase.
- Unlocking with the identity key is offered only where the archive is already set up and its
  key was lost; joining an archive on a new computer still takes the passphrase.
- The old holder is not told about a takeover; both computers hold the identity key until one of
  them replaces it.
