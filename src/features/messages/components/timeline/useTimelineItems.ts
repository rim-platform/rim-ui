import { useMemo } from "react";

import { useConversationMessages } from "../../api/useMessages";
import { useApplyLens, useLenses } from "../../../lenses/api/useLenses";
import { useLensStore } from "../../../lenses/state/useLensStore";

/**
 * The messages the timeline shows: the conversation's loaded pages flattened
 * oldest -> newest, or the active lens's results when a lens is applied.
 */
export function useTimelineItems(workspaceId: string | null, conversationId: string | null) {
  const activeLensId = useLensStore((s) =>
    conversationId ? (s.activeLenses[conversationId] ?? null) : null,
  );
  const { data: lensesList } = useLenses(workspaceId ?? undefined, conversationId ?? undefined);
  const activeLens = useMemo(
    () => lensesList?.find((l) => l.id === activeLensId) ?? null,
    [lensesList, activeLensId],
  );
  const lensQuery = useApplyLens(
    workspaceId ?? undefined,
    conversationId ?? undefined,
    activeLensId,
  );

  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversationMessages(workspaceId ?? undefined, conversationId ?? undefined);

  // Backend returns items oldest-first within each page; pages are in load
  // order (newest first), so reverse the pages for display.
  const isLensActive = Boolean(activeLensId);
  const lensItems = lensQuery.data?.items;
  const pages = data?.pages;
  const items = useMemo(() => {
    if (isLensActive) return lensItems ?? [];
    if (!pages) return [];
    return [...pages].reverse().flatMap((p) => p.items);
  }, [isLensActive, lensItems, pages]);

  return {
    items,
    isLensActive,
    activeLens,
    isPending: isLensActive ? lensQuery.isPending : isPending,
    isError: isLensActive ? lensQuery.isError : isError,
    hasNextPage: !isLensActive && hasNextPage,
    isFetchingNextPage: !isLensActive && isFetchingNextPage,
    fetchNextPage,
  };
}
