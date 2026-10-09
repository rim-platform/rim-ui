/**
 * Keeps the history archive current. After the cache syncs, an export of what changed is
 * scheduled; it runs at most once per {@link EXPORT_INTERVAL_MS} per account, because every
 * export writes a new segment file and a busy channel syncs every few seconds.
 *
 * Exporting when no archive is set up, or while it is locked on this device, is a quiet no-op:
 * the Settings panel is where the user sees and fixes that.
 */

import { logger } from "../../../core/logger";
import type { SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import type { CacheAccount } from "../../messages/api/messageCache";
import { ArchiveErrorCode, exportArchive, type ExportReport } from "../api/historyArchive";

/** Shortest gap between two exports of one account. */
export const EXPORT_INTERVAL_MS = 5 * 60_000;

const QUIET_CODES: ReadonlySet<string> = new Set([
  ArchiveErrorCode.NOT_CONFIGURED,
  ArchiveErrorCode.LOCKED,
]);

interface ExportDeps {
  exportNow: (account: CacheAccount) => Promise<SafeInvokeResult<ExportReport>>;
  delayMs: number;
}

interface Entry {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** A request came in while an export ran: schedule another after it. */
  again: boolean;
}

export function createArchiveExportScheduler(deps: ExportDeps) {
  const entries = new Map<string, Entry>();

  function schedule(key: string, account: CacheAccount, entry: Entry) {
    entry.timer = setTimeout(() => {
      void run(key, account, entry);
    }, deps.delayMs);
  }

  async function run(key: string, account: CacheAccount, entry: Entry) {
    entry.timer = null;
    entry.running = true;
    try {
      const result = await deps.exportNow(account);
      if (!result.ok) {
        const { error } = result;
        const quiet =
          error.kind === "ipc_unavailable" ||
          (error.kind === "backend_error" && QUIET_CODES.has(error.code));
        if (!quiet) logger.warn("[RIM:archive] export failed:", error);
      }
    } finally {
      entry.running = false;
      if (entry.again) {
        entry.again = false;
        schedule(key, account, entry);
      }
    }
  }

  /** Export the account's changes within {@link ExportDeps.delayMs}, once. */
  function request(account: CacheAccount) {
    const key = `${account.endpoint}\n${account.userId}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { timer: null, running: false, again: false };
      entries.set(key, entry);
    }
    if (entry.timer) return;
    if (entry.running) {
      entry.again = true;
      return;
    }
    schedule(key, account, entry);
  }

  return { request };
}

const scheduler = createArchiveExportScheduler({
  exportNow: exportArchive,
  delayMs: EXPORT_INTERVAL_MS,
});

/** Schedule an export of the account's new history. A no-op outside the desktop app. */
export function requestArchiveExport(account: CacheAccount) {
  scheduler.request(account);
}
