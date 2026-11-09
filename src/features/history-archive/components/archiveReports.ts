/** How the Settings panel words an export or a restore. */

import type { SafeInvokeError } from "../../../core/tauri/safeInvoke";
import { ArchiveErrorCode, type ExportReport, type RestoreReport } from "../api/historyArchive";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function describeExport(report: ExportReport): string {
  if (report.messages === 0 && report.conversations === 0) return "Already up to date.";
  return `Backed up ${plural(report.messages, "message change")} in ${plural(report.segments, "file")}.`;
}

export function describeRestore(report: RestoreReport): string {
  let text = `Restored ${plural(report.messages, "message")} in ${plural(
    report.conversations,
    "new conversation",
  )} from ${plural(report.devices, "device")}.`;
  const { segmentsMissing: missing, segmentsDamaged: damaged } = report;
  if (missing > 0) {
    text += ` ${plural(missing, "file")} ${missing === 1 ? "has" : "have"} not synced to this folder yet; restore again later to pick ${missing === 1 ? "it" : "them"} up.`;
  }
  if (damaged > 0) {
    text += ` ${plural(damaged, "file")} could not be read and ${damaged === 1 ? "was" : "were"} skipped.`;
  }
  return text;
}

/** What a failed archive call says, in words for the person. */
export function errorText(error: SafeInvokeError): string {
  if (error.kind === "backend_error") {
    switch (error.code) {
      case ArchiveErrorCode.WRONG_PASSPHRASE:
        return "That passphrase does not open this archive.";
      case ArchiveErrorCode.NO_IDENTITY_WRAP:
        return "This device's keys do not open this archive. Enter the passphrase.";
      case ArchiveErrorCode.UNAVAILABLE:
        return "The archive cannot be reached. Is the drive connected, and are you online?";
      case ArchiveErrorCode.NOT_WRITABLE:
        return "RIM cannot write into this folder. Choose a folder you can write to.";
      case ArchiveErrorCode.MISMATCH:
        return "The folder now holds a different archive. Stop backing up here and choose it again.";
      case ArchiveErrorCode.CLOUD_AUTH:
        return `The sign-in did not work or is no longer valid (${error.message}). Sign in again; if this archive is already set up, stop backing up here first.`;
      case ArchiveErrorCode.TLS:
        return "The secure connection failed: the server's certificate is not trusted here, or that address does not speak HTTPS.";
      case ArchiveErrorCode.ENDPOINT_INSECURE:
        return "That address is plain HTTP to another computer. Use https://, or allow an unencrypted connection if the network is yours.";
      case ArchiveErrorCode.ENDPOINT_UNAUTHORIZED:
        return "The backup endpoint refused the credentials (401). Check the user name and password, or the token.";
      case ArchiveErrorCode.ENDPOINT_FORBIDDEN:
        return "The backup endpoint accepted the credentials but refuses access (403).";
      case ArchiveErrorCode.ENDPOINT_NOT_FOUND:
        return "No backup endpoint answers at that address (404). The URL should lead to the service's /backup route.";
      case ArchiveErrorCode.ENDPOINT_NOT_JSON:
        return "Something answered, but not as a backup endpoint: its listing is not JSON. Check the URL.";
      case ArchiveErrorCode.ENDPOINT_BROKEN:
        return `The backup endpoint does not keep files correctly: ${error.message}.`;
      case ArchiveErrorCode.S3_CREDENTIALS:
        return "The storage refused the access key or the secret. Check both, and that the key is active.";
      case ArchiveErrorCode.S3_FORBIDDEN:
        return "The access key is valid but may not use this bucket or prefix. It needs to read, write and list objects there.";
      case ArchiveErrorCode.S3_NO_BUCKET:
        return "There is no bucket of that name at this endpoint.";
      case ArchiveErrorCode.S3_REGION:
        return "The bucket is in another region. Check the region (Cloudflare R2 takes auto).";
      case ArchiveErrorCode.S3_CLOCK:
        return "This computer's clock is too far off for the storage. Set the correct time and try again.";
      case ArchiveErrorCode.S3_NOT_S3:
        return "Something answered, but not as S3 storage. Check the endpoint URL.";
      case ArchiveErrorCode.S3_BROKEN:
        return `The storage does not keep objects correctly: ${error.message}.`;
    }
  }
  return error.message;
}
