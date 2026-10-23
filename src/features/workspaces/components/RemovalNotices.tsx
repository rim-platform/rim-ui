import { useAuthStore } from "../../auth/state/useAuthStore";
import { removalAccountKey, removalMessage, useRemovalNotices } from "../state/useRemovalNotices";

export function RemovalNotices() {
  const userId = useAuthStore((state) => state.session?.userId);
  const accounts = useRemovalNotices((state) => state.accounts);
  const dismiss = useRemovalNotices((state) => state.dismiss);
  if (!userId) return null;
  const account = removalAccountKey(userId);
  return (accounts[account] ?? []).map((notice) => (
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
