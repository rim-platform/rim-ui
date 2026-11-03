import { useMemo } from "react";

import type { MemberRemoval } from "../../../conversations/api/useMemberRemovals";
import { withEncryptionNotices, type EncryptionContext } from "../../../e2ee/utils/timeline";
import { useConversationMessages } from "../../api/useMessages";
import { useApplyLens, useLenses } from "../../../lenses/api/useLenses";
import { useLensStore } from "../../../lenses/state/useLensStore";
import { applyLensLocally } from "../../../lenses/utils/localLens";
import { withRemovalNotices } from "../../utils/removalNotices";

/**
 * The messages the timeline shows: the conversation's loaded pages flattened
 * oldest -> newest, or the active lens's results when a lens is applied. An encrypted
 * conversation's items carry its encryption notices (see `withEncryptionNotices`), and a
 * lens there is applied on this device to the loaded pages, matching encrypted messages
 * on metadata only. A channel's removals show as lines between its messages.
 */
export function useTimelineItems(
  workspaceId: string | null,
  conversationId: string | null,
  encryption?: EncryptionContext,
  removals?: MemberRemoval[],
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
    encryption ? null : activeLensId,
  );

  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversationMessages(workspaceId ?? undefined, conversationId ?? undefined);

  // Backend returns items oldest-first within each page; pages are in load
  // order (newest first), so reverse the pages for display.
  const isLensActive = Boolean(activeLensId);
  const serverLens = isLensActive && !encryption;
  const lensItems = lensQuery.data?.items;
  const pages = data?.pages;
  const items = useMemo(() => {
    if (serverLens) return lensItems ?? [];
    if (!pages) return [];
    const flat = [...pages].reverse().flatMap((p) => p.items);
    if (encryption && isLensActive) {
      return activeLens ? applyLensLocally(flat, activeLens.filterSpec) : [];
    }
    const shown = encryption ? withEncryptionNotices(flat, encryption) : flat;
    return removals?.length ? withRemovalNotices(shown, removals, !hasNextPage) : shown;
  }, [serverLens, isLensActive, activeLens, lensItems, pages, encryption, removals, hasNextPage]);

  return {
    items,
    isLensActive,
    activeLens,
    isPending: serverLens ? lensQuery.isPending : isPending,
    isError: serverLens ? lensQuery.isError : isError,
    hasNextPage: !serverLens && hasNextPage,
    isFetchingNextPage: !serverLens && isFetchingNextPage,
    fetchNextPage,
  };
}
