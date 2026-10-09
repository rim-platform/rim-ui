import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, RotateCcw, UserMinus, UserPlus } from "lucide-react";

import { toast } from "../../../shared/toast";
import { currentCacheAccount } from "../../messages/api/messageCache";
import { getArchiveStatus, restoreArchive } from "../../history-archive/api/historyArchive";
import { describeRestore } from "../../history-archive/components/archiveReports";
import type { E2eeNotice } from "../utils/timeline";

interface E2eeNoticeRowProps {
  notice: E2eeNotice;
  nameOf: (principalId: string | null | undefined) => string;
  deviceNameOf: (deviceId: string | null | undefined) => string;
  /** The history was restored: re-read the timeline. */
  onRestored?: () => void;
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 flex items-center gap-3 text-xs text-rim-text-muted" role="note">
      <div className="h-px flex-1 bg-rim-line" />
      <span className="flex items-center gap-1.5">{children}</span>
      <div className="h-px flex-1 bg-rim-line" />
    </div>
  );
}

/** Whether a history archive is set up for the signed-in account on this device. */
function useArchiveConfigured(enabled: boolean): boolean {
  const account = currentCacheAccount();
  const { data } = useQuery({
    queryKey: ["historyArchiveConfigured", account?.endpoint, account?.userId],
    enabled: enabled && Boolean(account),
    staleTime: 60_000,
    queryFn: async () => {
      const status = account ? await getArchiveStatus(account) : null;
      return Boolean(status?.ok && status.value.configured);
    },
  });
  return data ?? false;
}

/** One of the encryption lines between timeline messages. */
export function E2eeNoticeRow({ notice, nameOf, deviceNameOf, onRestored }: E2eeNoticeRowProps) {
  const [restoring, setRestoring] = useState(false);
  const archiveConfigured = useArchiveConfigured(notice.kind === "earlier");

  if (notice.kind === "encryptedFrom") {
    return (
      <Line>
        <Lock className="h-3 w-3" aria-hidden />
        Messages from here on are end-to-end encrypted
      </Line>
    );
  }
  if (notice.kind === "member") {
    const Icon = notice.change === "added" ? UserPlus : UserMinus;
    return (
      <Line>
        <Icon className="h-3 w-3" aria-hidden />
        {nameOf(notice.principalId)} was {notice.change}
      </Line>
    );
  }
  if (notice.kind === "reset") {
    return (
      <Line>
        <RotateCcw className="h-3 w-3" aria-hidden />
        Encryption was reset by {nameOf(notice.principalId)}&apos;s {deviceNameOf(notice.deviceId)}
      </Line>
    );
  }

  async function restore() {
    const account = currentCacheAccount();
    if (!account) return;
    setRestoring(true);
    try {
      const status = await getArchiveStatus(account);
      if (!status.ok || !status.value.unlocked) {
        toast.info("Unlock the history archive in Settings first");
        return;
      }
      const result = await restoreArchive(account);
      if (result.ok) {
        toast.success(describeRestore(result.value));
        onRestored?.();
      } else {
        toast.error("The history archive could not be restored", {
          description: result.error.message,
        });
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Line>
      <span>
        Earlier messages were sent before this device joined
        {notice.count > 1 ? ` (${notice.count})` : ""}
      </span>
      {archiveConfigured && (
        <button
          type="button"
          onClick={() => void restore()}
          disabled={restoring}
          className="text-rim-accent hover:underline disabled:opacity-60"
        >
          {restoring ? "Restoring…" : "Restore from history archive"}
        </button>
      )}
    </Line>
  );
}
