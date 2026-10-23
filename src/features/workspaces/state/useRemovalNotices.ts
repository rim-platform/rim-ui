import { create } from "zustand";
import { persist } from "zustand/middleware";

import { getApiOrigin } from "../../../core/graphql/config";

export interface RemovalNotice {
  workspaceId: string;
  workspaceName?: string;
  cause: "ban" | "kick";
  until?: string | null;
  reason?: string | null;
}

export function removalAccountKey(userId: string): string {
  return `${getApiOrigin()}:${userId}`;
}

interface RemovalNotices {
  accounts: Record<string, RemovalNotice[]>;
  add: (account: string, notice: RemovalNotice) => void;
  dismiss: (account: string, workspaceId: string) => void;
}

/** Removal explanations stay visible for their account until explicitly dismissed. */
export const useRemovalNotices = create<RemovalNotices>()(
  persist(
    (set) => ({
      accounts: {},
      add: (account, notice) =>
        set((state) => ({
          accounts: {
            ...state.accounts,
            [account]: [
              ...(state.accounts[account] ?? []).filter(
                (item) => item.workspaceId !== notice.workspaceId,
              ),
              notice,
            ],
          },
        })),
      dismiss: (account, workspaceId) =>
        set((state) => ({
          accounts: {
            ...state.accounts,
            [account]: (state.accounts[account] ?? []).filter(
              (item) => item.workspaceId !== workspaceId,
            ),
          },
        })),
    }),
    { name: "rim-workspace-removals", partialize: (state) => ({ accounts: state.accounts }) },
  ),
);

export function removalMessage(notice: RemovalNotice): string {
  const name = notice.workspaceName ?? "this workspace";
  if (notice.cause === "kick") return `You were removed from ${name}`;
  const until = notice.until ? new Date(notice.until) : null;
  return `You were banned from ${name}${until && Number.isFinite(until.getTime()) ? ` until ${until.toLocaleString()}` : ""}`;
}
