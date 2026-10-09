/**
 * The desktop app's history archive (master plan Stage 2): the local message cache written as
 * encrypted per-device files to a folder the user picks, and read back on another device. The
 * format is `docs/specs/history-archive-v1.md`; the work is on the Tauri side
 * (`src-tauri/src/history_archive`). This module is its typed surface.
 */

import { safeInvoke, type SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import type { CacheAccount } from "../../messages/api/messageCache";

export interface ArchiveStatus {
  configured: boolean;
  folder: string | null;
  archiveId: string | null;
  /** This installation's id; its files live under `devices/<deviceId>/` in the archive. */
  deviceId: string;
  /** This device holds the archive key and exports without asking for the passphrase. */
  unlocked: boolean;
}

export interface FolderInfo {
  hasArchive: boolean;
  version: number | null;
}

export interface ConnectOutcome {
  status: ArchiveStatus;
  /** The folder had no archive and a new one was started. */
  created: boolean;
}

export interface ExportReport {
  segments: number;
  messages: number;
  conversations: number;
}

export interface RestoreReport {
  devices: number;
  segmentsRead: number;
  /** Listed by a device but not in the folder yet (its sync client is still downloading). */
  segmentsMissing: number;
  segmentsDamaged: number;
  messages: number;
  conversations: number;
}

/** Shortest passphrase the archive accepts (`MIN_PASSPHRASE_CHARS` on the Rust side). */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * A passphrase's length as the Rust side counts it: Unicode code points, not UTF-16 units, so
 * an emoji counts once here too.
 */
export function passphraseLength(passphrase: string): number {
  return [...passphrase].length;
}

/** Error codes the archive commands return in `backend_error.code`. */
export const ArchiveErrorCode = {
  NOT_CONFIGURED: "ARCHIVE_NOT_CONFIGURED",
  LOCKED: "ARCHIVE_LOCKED",
  WRONG_PASSPHRASE: "ARCHIVE_WRONG_PASSPHRASE",
  UNAVAILABLE: "ARCHIVE_UNAVAILABLE",
  NOT_WRITABLE: "ARCHIVE_NOT_WRITABLE",
  MISMATCH: "ARCHIVE_MISMATCH",
} as const;

export function pickArchiveFolder(): Promise<SafeInvokeResult<string | null>> {
  return safeInvoke<string | null>("history_archive_pick_folder");
}

export function inspectArchiveFolder(folder: string): Promise<SafeInvokeResult<FolderInfo>> {
  return safeInvoke<FolderInfo>("history_archive_inspect_folder", { folder });
}

export function getArchiveStatus(account: CacheAccount): Promise<SafeInvokeResult<ArchiveStatus>> {
  return safeInvoke<ArchiveStatus>("history_archive_status", { account });
}

/** Join the archive in `folder` with its passphrase, or start one there if it has none. */
export function connectArchive(
  account: CacheAccount,
  folder: string,
  passphrase: string,
): Promise<SafeInvokeResult<ConnectOutcome>> {
  return safeInvoke<ConnectOutcome>("history_archive_connect", { account, folder, passphrase });
}

export function unlockArchive(
  account: CacheAccount,
  passphrase: string,
): Promise<SafeInvokeResult<ArchiveStatus>> {
  return safeInvoke<ArchiveStatus>("history_archive_unlock", { account, passphrase });
}

/** Stop archiving on this device. The archive's files stay in the folder. */
export function disconnectArchive(account: CacheAccount): Promise<SafeInvokeResult<null>> {
  return safeInvoke<null>("history_archive_disconnect", { account });
}

export function exportArchive(account: CacheAccount): Promise<SafeInvokeResult<ExportReport>> {
  return safeInvoke<ExportReport>("history_archive_export", { account });
}

export function restoreArchive(account: CacheAccount): Promise<SafeInvokeResult<RestoreReport>> {
  return safeInvoke<RestoreReport>("history_archive_restore", { account });
}
