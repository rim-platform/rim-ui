import { useEffect, useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { AuthorBan } from "../../../shared/utils/banStatus";
export { activeBan, banLabel, type AuthorBan } from "../../../shared/utils/banStatus";
import { handleMemberBanChanged } from "../../workspaces/state/memberEvents";

/** Refresh cached author status when the next temporary ban ends. */
export function useBanExpiry(
  workspaceId: string | null | undefined,
  authors: (AuthorBan | null | undefined)[],
): void {
  const qc = useQueryClient();
  const [revision, tick] = useReducer((value: number) => value + 1, 0);
  const expiries = JSON.stringify(
    authors
      .filter((author) => author?.banned && author.bannedUntil)
      .map((author) => author?.bannedUntil),
  );
  useEffect(() => {
    if (!workspaceId) return;
    const future = (JSON.parse(expiries) as string[])
      .map(Date.parse)
      .filter((time) => time > Date.now());
    if (!future.length) return;
    const timer = setTimeout(
      () => {
        handleMemberBanChanged(qc, workspaceId);
        tick();
      },
      Math.min(Math.max(1, Math.min(...future) - Date.now() + 1), 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [qc, workspaceId, expiries, revision]);
}
