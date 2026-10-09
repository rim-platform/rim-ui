/**
 * The identity key's backup in the history archive, on the desktop: the device that holds the
 * identity key keeps a copy of it in the archive, sealed under a key only the recovery phrase
 * gives, and wraps the archive key under it. Another of the person's devices takes the identity
 * key over from that copy with the recovery phrase. The keys stay on the Tauri side
 * (`src-tauri/src/identity_backup`); this module passes it the server's key log, and the phrase
 * once, as the recovery flow does.
 */

import { safeInvoke, type SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import { logger } from "../../../core/logger";
import { ArchiveErrorCode, type ArchiveStatus } from "../../history-archive/api/historyArchive";
import { currentCacheAccount, type CacheAccount } from "../../messages/api/messageCache";
import {
  fetchMyKeyIdentity,
  keyCommand,
  listDeviceKeyAccounts,
  logStatements,
  type LogStatus,
  type MyKeyIdentity,
} from "./keyIdentity";

/** Where the account's history archive stands on this device. */
export type BackupArchiveState = "notConfigured" | "locked" | "ready";

/** The identity key's backup as this device sees it. */
export interface IdentityBackupStatus {
  archive: BackupArchiveState;
  /** This device holds the account's current identity key. */
  holdsIdentityKey: boolean;
  /** This device holds the key the backup is sealed under, so it can write one. */
  hasBackupKey: boolean;
  /** The archive holds this device's backup of the current identity key. */
  backedUp: boolean;
  /** The archive holds a copy of its key that the current identity key opens. */
  wrapped: boolean;
}

/** Error kinds of a takeover that the settings explain in their own words. */
export const IdentityBackupErrorCode = {
  NOT_FOUND: "IDENTITY_BACKUP_NOT_FOUND",
  UNREADABLE: "IDENTITY_BACKUP_UNREADABLE",
  STALE: "IDENTITY_BACKUP_STALE",
} as const;

function backupArgs(identity: MyKeyIdentity, account: CacheAccount) {
  return {
    account,
    principalId: identity.principalId,
    keyLog: logStatements(identity.keyLog),
  };
}

/**
 * Back up the identity key and wrap the archive key under it, if this device holds the key and
 * the archive is unlocked here; nothing that is already there is written again. Returns where
 * the backup stands, or `null` outside the desktop app or before enrollment.
 */
export async function syncIdentityBackup(
  identity: MyKeyIdentity,
): Promise<IdentityBackupStatus | null> {
  const account = currentCacheAccount();
  if (!account || !identity.principalId) return null;
  return keyCommand<IdentityBackupStatus>("identity_backup_sync", backupArgs(identity, account));
}

/**
 * Best-effort backup after the archive was set up or unlocked here, with the server's current
 * key log. A failure is logged: Settings > Security tries again and shows it.
 */
export async function backUpIdentityKeyQuietly(): Promise<void> {
  try {
    await syncIdentityBackup(await fetchMyKeyIdentity());
  } catch (err) {
    logger.warn("[RIM:keys] backing up the identity key failed:", err);
  }
}

/**
 * Turn the backup on, on a device that holds the identity key but not the backup key, with
 * the recovery phrase or `RK1-` key, which must belong to the account.
 */
export async function enableIdentityBackup(
  identity: MyKeyIdentity,
  secret: string,
): Promise<IdentityBackupStatus> {
  const account = currentCacheAccount();
  if (!account) throw new Error("The identity key backup is available in the desktop app.");
  return keyCommand<IdentityBackupStatus>("identity_backup_enable", {
    ...backupArgs(identity, account),
    secret,
  });
}

/**
 * Take the identity key over from its backup in the history archive, with the recovery phrase
 * or `RK1-` key. A failure carries the Tauri side's code (`IDENTITY_BACKUP_*`, `ARCHIVE_*`) so
 * the caller can explain it.
 */
export async function takeOverIdentityKey(
  identity: MyKeyIdentity,
  secret: string,
): Promise<SafeInvokeResult<LogStatus>> {
  const account = currentCacheAccount();
  if (!account) {
    return {
      ok: false,
      error: {
        kind: "ipc_unavailable",
        message: "The identity key backup is available in the desktop app.",
      },
    };
  }
  return safeInvoke<LogStatus>("identity_backup_take_over", {
    ...backupArgs(identity, account),
    secret,
  });
}

/** The account id this device holds the identity key of for `account`, if any. */
async function identityHolder(account: CacheAccount): Promise<string | null> {
  const local = await listDeviceKeyAccounts();
  return local.find((a) => a.userId === account.userId && a.hasIdentityKey)?.principalId ?? null;
}

/** Whether this device's identity key opens a copy of the archive key. */
export async function canUnlockArchiveWithKeys(account: CacheAccount): Promise<boolean> {
  const principalId = await identityHolder(account);
  if (!principalId) return false;
  const result = await safeInvoke<boolean>("identity_backup_can_unlock_archive", {
    account,
    principalId,
  });
  return result.ok && result.value;
}

/** Unlock the archive on this device with its identity key instead of the passphrase. */
export async function unlockArchiveWithKeys(
  account: CacheAccount,
): Promise<SafeInvokeResult<ArchiveStatus>> {
  const principalId = await identityHolder(account);
  if (!principalId) {
    return {
      ok: false,
      error: {
        kind: "backend_error",
        code: ArchiveErrorCode.NO_IDENTITY_WRAP,
        message: "This device holds no identity key for this account.",
      },
    };
  }
  return safeInvoke<ArchiveStatus>("identity_backup_unlock_archive", { account, principalId });
}
