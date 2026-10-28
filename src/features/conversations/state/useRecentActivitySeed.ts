import { useEffect } from "react";

import { useDirectInbox } from "../../relay/api/useDirectInbox";
import { useRecentActivityStore } from "./useRecentActivityStore";

/**
 * Puts the direct conversations into the recent-activity log once the list is loaded, newest
 * activity first as the list is ordered, so the log is not empty right after launch. Places
 * that saw a live message keep their position.
 */
export function useRecentActivitySeed() {
  const { items } = useDirectInbox();
  useEffect(() => {
    useRecentActivityStore.getState().seed(
      items.map((c) => ({
        workspaceId: c.serverId,
        conversationId: c.id,
        threadId: null,
        at: 0,
      })),
    );
  }, [items]);
}
