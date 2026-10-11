/**
 * The desktop app's history archive: the local message cache written as encrypted per-device
 * files to a folder the user picks, to the app's folder in their Google Drive or Dropbox, or to
 * their own backup endpoint, and read back on another device. The work is on the Tauri side
 * (`src-tauri/src/history_archive`). This module is its typed surface.
 */

import { safeInvoke, type SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import type { CacheAccount } from "../../messages/api/messageCache";

/** The cloud services an archive can live in. */
export type CloudKind = "googleDrive" | "dropbox";

/** Where an archive lives. */
export type ArchiveProviderKind = "localFolder" | CloudKind | "endpoint";

export interface ArchiveStatus {
  configured: boolean;
  provider: ArchiveProviderKind | null;
  /** The folder, the signed-in cloud account (an email address), or the endpoint's URL. */
  folder: string | null;
  archiveId: string | null;
  /** This installation's id; its files live under `devices/<deviceId>/` in the archive. */
  deviceId: string;
  /** This device holds the archive key and exports without asking for the passphrase. */
  unlocked: boolean;
}

/** A cloud service and whether this build can sign in to it (it has an OAuth client id). */
export interface CloudService {
  kind: CloudKind;
  available: boolean;
}

/** A cloud account just signed in to, waiting for the archive's passphrase. */
export interface CloudAuthorization {
  connectionId: string;
  kind: CloudKind;
  /** The signed-in account's email address. */
  account: string;
  hasArchive: boolean;
  version: number | null;
}

/** How requests to a backup endpoint prove who sends them; the secret is the password or token. */
export type EndpointAuth =
  | { mode: "none" }
  | { mode: "basic"; username: string }
  | { mode: "bearer" }
  | { mode: "header"; name: string };

/** What the user typed to set up a backup endpoint. */
export interface EndpointSetup {
  url: string;
  auth: EndpointAuth;
  /** The password or token; kept in the secret vault once the archive is connected. */
  secret: string | null;
  /** Plain HTTP to a host that is not this computer. */
  allowInsecure: boolean;
}

/** A backup endpoint that passed the check, waiting for the archive's passphrase. */
export interface EndpointCheck {
  connectionId: string;
  /** The URL requests go to (the `/backup` route). */
  url: string;
  hasArchive: boolean;
  version: number | null;
  /** The endpoint refuses to overwrite with `If-None-Match: *`. */
  exclusiveCreate: boolean;
}

/**
 * Where to connect an archive: a folder, or a cloud account just signed in to or a backup
 * endpoint just checked.
 */
export type ConnectTarget =
  { kind: "localFolder"; path: string } | { kind: "cloud"; connectionId: string };

export const CLOUD_SERVICE_NAMES: Record<CloudKind, string> = {
  googleDrive: "Google Drive",
  dropbox: "Dropbox",
};

export const ENDPOINT_NAME = "Backup endpoint";

/**
 * What to show as an archive's place: the folder, "Google Drive (ada@example.com)", or
 * "Backup endpoint (https://…/backup)".
 */
export function archiveLocation(status: ArchiveStatus): string {
  if (!status.folder) return "";
  if (status.provider === "googleDrive" || status.provider === "dropbox") {
    return `${CLOUD_SERVICE_NAMES[status.provider]} (${status.folder})`;
  }
  if (status.provider === "endpoint") return `${ENDPOINT_NAME} (${status.folder})`;
  return status.folder;
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
  NO_IDENTITY_WRAP: "ARCHIVE_NO_IDENTITY_WRAP",
  WRONG_PASSPHRASE: "ARCHIVE_WRONG_PASSPHRASE",
  UNAVAILABLE: "ARCHIVE_UNAVAILABLE",
  NOT_WRITABLE: "ARCHIVE_NOT_WRITABLE",
  MISMATCH: "ARCHIVE_MISMATCH",
  CLOUD_AUTH: "ARCHIVE_CLOUD_AUTH",
  CANCELLED: "ARCHIVE_CANCELLED",
  SERVICE_NOT_CONFIGURED: "ARCHIVE_SERVICE_NOT_CONFIGURED",
  TLS: "ARCHIVE_TLS",
  INVALID: "INVALID_ARGS",
  ENDPOINT_INSECURE: "ARCHIVE_ENDPOINT_INSECURE",
  ENDPOINT_UNAUTHORIZED: "ARCHIVE_ENDPOINT_UNAUTHORIZED",
  ENDPOINT_FORBIDDEN: "ARCHIVE_ENDPOINT_FORBIDDEN",
  ENDPOINT_NOT_FOUND: "ARCHIVE_ENDPOINT_NOT_FOUND",
  ENDPOINT_NOT_JSON: "ARCHIVE_ENDPOINT_NOT_JSON",
  ENDPOINT_BROKEN: "ARCHIVE_ENDPOINT_BROKEN",
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

export function listCloudServices(): Promise<SafeInvokeResult<CloudService[]>> {
  return safeInvoke<CloudService[]>("history_archive_cloud_services");
}

/**
 * Sign in to Google Drive or Dropbox in the system browser and look for an archive there.
 * Resolves when the user comes back from the browser; `cancelCloudSignIn` stops the wait.
 */
export function authorizeCloud(kind: CloudKind): Promise<SafeInvokeResult<CloudAuthorization>> {
  return safeInvoke<CloudAuthorization>("history_archive_cloud_authorize", { kind });
}

export function cancelCloudSignIn(): Promise<SafeInvokeResult<null>> {
  return safeInvoke<null>("history_archive_cloud_cancel");
}

/**
 * Check a backup endpoint: store, list and read back a probe file, then look for an archive.
 * The secret stays in memory on the Tauri side until the archive is connected.
 */
export function checkEndpoint(setup: EndpointSetup): Promise<SafeInvokeResult<EndpointCheck>> {
  return safeInvoke<EndpointCheck>("history_archive_endpoint_check", { setup });
}

/**
 * Drop a cloud sign-in or endpoint check the user did not go on with (a Dropbox sign-in is
 * also revoked).
 */
export function discardCloudSignIn(connectionId: string): Promise<SafeInvokeResult<null>> {
  return safeInvoke<null>("history_archive_cloud_discard", { connectionId });
}

/** Join the archive at `target` with its passphrase, or start one there if it has none. */
export function connectArchive(
  account: CacheAccount,
  target: ConnectTarget,
  passphrase: string,
): Promise<SafeInvokeResult<ConnectOutcome>> {
  return safeInvoke<ConnectOutcome>("history_archive_connect", { account, target, passphrase });
}

export function unlockArchive(
  account: CacheAccount,
  passphrase: string,
): Promise<SafeInvokeResult<ArchiveStatus>> {
  return safeInvoke<ArchiveStatus>("history_archive_unlock", { account, passphrase });
}

/** Stop archiving on this device. The archive's files stay; a cloud account is signed out. */
export function disconnectArchive(account: CacheAccount): Promise<SafeInvokeResult<null>> {
  return safeInvoke<null>("history_archive_disconnect", { account });
}

export function exportArchive(account: CacheAccount): Promise<SafeInvokeResult<ExportReport>> {
  return safeInvoke<ExportReport>("history_archive_export", { account });
}

export function restoreArchive(account: CacheAccount): Promise<SafeInvokeResult<RestoreReport>> {
  return safeInvoke<RestoreReport>("history_archive_restore", { account });
}
