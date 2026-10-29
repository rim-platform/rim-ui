import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../query/keys";
import type { MessagesPage } from "../types/messages";

/** A cached list item that may be the message whose flag changed. */
interface FlaggableItem {
  id: string;
  flagged?: boolean;
}

/** `items` with `flagged` set on `messageId`, or `items` itself when none of them changes. */
function withFlag<T extends FlaggableItem>(items: T[], messageId: string, flagged: boolean): T[] {
  if (!items.some((m) => m.id === messageId && (m.flagged ?? false) !== flagged)) return items;
  return items.map((m) => (m.id === messageId ? { ...m, flagged } : m));
}

/**
 * Set `flagged` on a message in the cached timeline of its conversation and in any cached
 * thread of that conversation that holds it.
 *
 * @param qc - The query client holding the caches.
 * @param workspaceId - The message's workspace.
 * @param conversationId - The message's conversation.
 * @param messageId - The message whose flag changed.
 * @param flagged - Whether the automatic check's flag is now on the message.
 */
export function setMessageFlagged(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  flagged: boolean,
) {
  qc.setQueryData<InfiniteData<MessagesPage>>(
    queryKeys.messages(workspaceId, conversationId),
    (old) => {
      if (!old) return old;
      let changed = false;
      const pages = old.pages.map((page) => {
        const items = withFlag(page.items, messageId, flagged);
        if (items === page.items) return page;
        changed = true;
        return { ...page, items };
      });
      return changed ? { ...old, pages } : old;
    },
  );
  qc.setQueriesData<{ items: FlaggableItem[] }>(
    { queryKey: ["threadMessages", workspaceId, conversationId] },
    (old) => {
      if (!old?.items) return old;
      const items = withFlag(old.items, messageId, flagged);
      return items === old.items ? old : { ...old, items };
    },
  );
}
