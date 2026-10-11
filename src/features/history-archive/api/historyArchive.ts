/**
 * The desktop app's history archive: the local message cache written as encrypted per-device
 * files to a folder the user picks, to the app's folder in their Google Drive, Dropbox or
 * OneDrive, to an S3 bucket, or to their own backup endpoint, and read back on another device. The work is on the Tauri side
 * (`src-tauri/src/history_archive`). This module is its typed surface.
 */

import { safeInvoke, type SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import type { CacheAccount } from "../../messages/api/messageCache";

/** The cloud services an archive can live in. */
export type CloudKind = "googleDrive" | "dropbox" | "oneDrive";

/** Where an archive lives. */
export type ArchiveProviderKind = "localFolder" | CloudKind | "s3" | "endpoint";

export interface ArchiveStatus {
  configured: boolean;
  provider: ArchiveProviderKind | null;
  /**
   * The folder, the signed-in cloud account (an email address), `bucket/prefix on host` for S3,
   * or the endpoint's URL.
   */
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

/** Where the bucket goes in an S3 request: `endpoint/bucket/key` or `bucket.endpoint/key`. */
export type S3Addressing = "path" | "virtualHost";

/** What the user typed to set up an S3 bucket. */
export interface S3Setup {
  endpoint: string;
  /** Empty: `us-east-1`. */
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  /** Kept in the secret vault once the archive is connected. */
  secretAccessKey: string;
  addressing: S3Addressing;
  /** Plain HTTP to a host that is not this computer. */
  allowInsecure: boolean;
}

/** An S3 bucket that passed the check, waiting for the archive's passphrase. */
export interface S3Check {
  connectionId: string;
  /** `bucket/prefix on host`. */
  location: string;
  hasArchive: boolean;
  version: number | null;
  /** The storage refuses to overwrite with `If-None-Match: *`. */
  conditionalWrites: boolean;
}

/** Virtual-hosted addressing for Amazon's own endpoints, path-style for any other. */
export function defaultS3Addressing(endpoint: string): S3Addressing {
  try {
    const host = new URL(endpoint.trim()).hostname;
    return host === "amazonaws.com" || host.endsWith(".amazonaws.com") ? "virtualHost" : "path";
  } catch {
    return "path";
  }
}

/** Plain HTTP to a host other than this computer, which a check refuses unless allowed. */
export function isRemotePlainHttp(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  return !(host === "localhost" || host === "::1" || /^127\./.test(host));
}

/**
 * Where to connect an archive: a folder, or a cloud account just signed in to, or an S3 bucket
 * or a backup endpoint just checked.
 */
export type ConnectTarget =
  { kind: "localFolder"; path: string } | { kind: "cloud"; connectionId: string };

export const CLOUD_SERVICE_NAMES: Record<CloudKind, string> = {
  googleDrive: "Google Drive",
  dropbox: "Dropbox",
  oneDrive: "OneDrive",
};

/** Whether an archive's place is a cloud service signed in to. */
export function isCloudKind(kind: ArchiveProviderKind | null): kind is CloudKind {
  return kind !== null && kind in CLOUD_SERVICE_NAMES;
}

export const ENDPOINT_NAME = "Backup endpoint";
export const S3_NAME = "S3";

/**
 * What to show as an archive's place: the folder, "Google Drive (ada@example.com)",
 * "S3 (rim/backups on s3.amazonaws.com)", or "Backup endpoint (https://…/backup)".
 */
export function archiveLocation(status: ArchiveStatus): string {
  if (!status.folder) return "";
  if (isCloudKind(status.provider)) {
    return `${CLOUD_SERVICE_NAMES[status.provider]} (${status.folder})`;
  }
  if (status.provider === "endpoint") return `${ENDPOINT_NAME} (${status.folder})`;
  if (status.provider === "s3") return `${S3_NAME} (${status.folder})`;
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

/** One device's backups of the account, from its entry in the archive. */
export interface DeviceBackup {
  deviceId: string;
  thisDevice: boolean;
  /** When the device last backed something up (Unix ms); `null` before its first backup. */
  lastExportMs: number | null;
  segments: number;
  /** Its entry is there but cannot be read. */
  unreadable: boolean;
}

/** A device whose last backup is older than this is pointed out. */
export const STALE_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

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
  S3_CREDENTIALS: "ARCHIVE_S3_CREDENTIALS",
  S3_FORBIDDEN: "ARCHIVE_S3_FORBIDDEN",
  S3_NO_BUCKET: "ARCHIVE_S3_NO_BUCKET",
  S3_REGION: "ARCHIVE_S3_REGION",
  S3_CLOCK: "ARCHIVE_S3_CLOCK",
  S3_NOT_S3: "ARCHIVE_S3_NOT_S3",
  S3_BROKEN: "ARCHIVE_S3_BROKEN",
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
 * Check an S3 bucket: write, read back, list and delete a probe object, then look for an
 * archive. The secret access key stays in memory on the Tauri side until the archive is
 * connected.
 */
export function checkS3(setup: S3Setup): Promise<SafeInvokeResult<S3Check>> {
  return safeInvoke<S3Check>("history_archive_s3_check", { setup });
}

/**
 * Drop a cloud sign-in or an endpoint or bucket check the user did not go on with (a Dropbox
 * sign-in is also revoked).
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

/** The query of the account's devices in the archive. */
export function archiveDevicesQueryKey(account: CacheAccount) {
  return ["historyArchiveDevices", account.endpoint, account.userId] as const;
}

/** Every device backing this account up into the archive, and when each last did. */
export function listArchiveDevices(
  account: CacheAccount,
): Promise<SafeInvokeResult<DeviceBackup[]>> {
  return safeInvoke<DeviceBackup[]>("history_archive_devices", { account });
}

export function restoreArchive(account: CacheAccount): Promise<SafeInvokeResult<RestoreReport>> {
  return safeInvoke<RestoreReport>("history_archive_restore", { account });
}
