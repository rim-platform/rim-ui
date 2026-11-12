import { queryClient } from "../../core/query/queryClient";
import { toast } from "../../shared/toast";
import { currentCacheAccount, type CacheAccount } from "../messages/api/messageCache";
import { archiveDevicesQueryKey, exportArchive, getArchiveStatus } from "./api/historyArchive";
import { describeExport, errorText } from "./components/archiveReports";

/** Why a back-up could not start, or `null` when the account's archive is ready for one. */
async function notReady(account: CacheAccount): Promise<string | null> {
  const status = await getArchiveStatus(account);
  if (!status.ok) return errorText(status.error);
  if (!status.value.configured) return "Set up the history archive in Settings > History first.";
  if (!status.value.unlocked) return "Unlock the history archive in Settings > History first.";
  return null;
}

/**
 * Writes this device's new history to the archive now, as Settings > History's Back up now
 * does, and toasts how it went. Says so when there is no archive to write to.
 */
export async function backUpHistoryNow(): Promise<void> {
  const account = currentCacheAccount();
  if (!account) {
    toast.info("The history archive is available in the desktop app.");
    return;
  }
  const reason = await notReady(account);
  if (reason) {
    toast.info(reason);
    return;
  }
  const result = await exportArchive(account);
  if (result.ok) {
    toast.success(describeExport(result.value));
    void queryClient.invalidateQueries({ queryKey: archiveDevicesQueryKey(account) });
  } else toast.error(errorText(result.error));
}
