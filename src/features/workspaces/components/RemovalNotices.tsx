import { useEffect } from "react";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMyServers } from "../api/useMyServers";
import { removalAccountKey, removalMessage, useRemovalNotices } from "../state/useRemovalNotices";

export function RemovalNotices() {
  const userId = useAuthStore((state) => state.session?.userId);
  const accounts = useRemovalNotices((state) => state.accounts);
  const dismiss = useRemovalNotices((state) => state.dismiss);
  const { data: servers } = useMyServers(Boolean(userId));
  const account = userId ? removalAccountKey(userId) : null;
  const notices = account ? (accounts[account] ?? []) : [];
  const memberOf = new Set((servers ?? []).map((server) => server.id));
  const rejoined = notices
    .filter((notice) => memberOf.has(notice.workspaceId))
    .map((notice) => notice.workspaceId)
    .join(" ");
  // A workspace the viewer is a member of again needs no removal notice.
  useEffect(() => {
    if (!account || !rejoined) return;
    for (const workspaceId of rejoined.split(" ")) dismiss(account, workspaceId);
  }, [account, rejoined, dismiss]);
  if (!account) return null;
  return notices
    .filter((notice) => !memberOf.has(notice.workspaceId))
    .map((notice) => (
      <div
        key={notice.workspaceId}
        role="status"
        className="flex items-start gap-3 border-b border-rim-line bg-rim-panel px-4 py-3 text-sm text-rim-text"
      >
        <div className="min-w-0 flex-1">
          <p>{removalMessage(notice)}</p>
          {notice.reason && (
            <p className="whitespace-pre-wrap break-words text-rim-text-muted">
              Reason: {notice.reason}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss removal notice"
          onClick={() => dismiss(account, notice.workspaceId)}
          className="text-rim-text-muted hover:text-rim-text"
        >
          Dismiss
        </button>
      </div>
    ));
}
