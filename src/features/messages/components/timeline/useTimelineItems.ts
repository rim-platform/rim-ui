import { useMemo } from "react";

import { withEncryptionNotices, type EncryptionContext } from "../../../e2ee/utils/timeline";
import { useConversationMessages } from "../../api/useMessages";
import { useApplyLens, useLenses } from "../../../lenses/api/useLenses";
import { useLensStore } from "../../../lenses/state/useLensStore";

/**
 * The messages the timeline shows: the conversation's loaded pages flattened
 * oldest -> newest, or the active lens's results when a lens is applied. An encrypted
 * conversation's items carry its encryption notices (see `withEncryptionNotices`).
 */
export function useTimelineItems(
  workspaceId: string | null,
  conversationId: string | null,
  encryption?: EncryptionContext,
) {
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
    const flat = [...pages].reverse().flatMap((p) => p.items);
    return encryption ? withEncryptionNotices(flat, encryption) : flat;
  }, [isLensActive, lensItems, pages, encryption]);

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
