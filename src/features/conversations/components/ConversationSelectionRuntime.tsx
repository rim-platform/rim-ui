import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { MessagesPage } from "../../messages/api/useMessages";
import { useDirectInbox } from "../../relay/api/useDirectInbox";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useJoinedChannels } from "../api/useChannels";
import { useInboxConversations } from "../api/useInboxConversations";
import { useUnreadStore } from "../state/useUnreadStore";

/**
 * What follows the open conversation, whether or not the conversation list is on screen: the
 * first conversation opens when none is, and the one left is marked read. The list is not
 * mounted while the sidebar is collapsed or, in a narrow window, while its drawer is closed.
 */
export function ConversationSelectionRuntime() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const direct = useIsDirectSpace(workspaceId);
  return direct ? <DirectSelection /> : <WorkspaceSelection />;
}

/** The first workspace conversation opens when nothing is open; a draft DM counts as open. */
function WorkspaceSelection() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const selectedId = useShellStore((s) => s.selectedConversationId);
  const draftOpen = useShellStore((s) => s.draftDirect !== null);
  const { data: channelsData } = useJoinedChannels(workspaceId ?? undefined);
  const { data: inboxData } = useInboxConversations(workspaceId ?? undefined);
  const channels = useMemo(
    () => (channelsData?.items ?? []).filter((c) => !c.isArchived),
    [channelsData],
  );
  const messages = useMemo(() => inboxData?.items ?? [], [inboxData]);
  const qc = useQueryClient();

  // A plugin panel the user has open stays over the conversation that opens.
  useEffect(() => {
    if (!selectedId && !draftOpen) {
      const first = channels[0] ?? messages[0];
      if (first) {
        useShellStore.getState().setSelectedConversationId(first.id, { keepPluginPanel: true });
      }
    }
  }, [selectedId, draftOpen, channels, messages]);

  // Snapshots the watermark of the conversation being left and clears its unread count locally.
  // A conversation its host still counts as unread stays so: there the read marker is the line,
  // and only reading to the end or marking it read moves it.
  const previousId = useRef<string | null>(null);
  useEffect(() => {
    const prevId = previousId.current;
    previousId.current = selectedId;
    if (!prevId || !workspaceId || prevId === selectedId) return;

    const unread = useUnreadStore.getState();
    const space = unread.spaceOf[prevId] ?? workspaceId;
    if (unread.countSources[space] === "markers" && (unread.counts[prevId] ?? 0) > 0) {
      unread.clearWatermark(prevId);
      return;
    }

    const cached = qc.getQueryData<{ pages: MessagesPage[] }>(
      queryKeys.messages(workspaceId, prevId),
    );
    if (cached?.pages && cached.pages.length > 0) {
      // The first page holds the newest messages, and its last item is the newest of them.
      const newestPage = cached.pages[0];
      const lastItem = newestPage?.items?.[newestPage.items.length - 1];
      if (lastItem?.sentAt) {
        useUnreadStore.getState().setWatermark(prevId, lastItem.sentAt);
      }
    }
    useUnreadStore.getState().markRead(prevId);
  }, [selectedId, workspaceId, qc]);

  return null;
}

/** The first conversation of the direct space shown opens when nothing is open. */
function DirectSelection() {
  const { items } = useDirectInbox();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const selectedId = useShellStore((s) => s.selectedConversationId);
  const draftOpen = useShellStore((s) => s.draftDirect !== null);
  useEffect(() => {
    if (selectedId || draftOpen) return;
    const first = items.find((c) => c.serverId === workspaceId);
    if (first) {
      useShellStore.getState().setSelectedConversationId(first.id, { keepPluginPanel: true });
    }
  }, [selectedId, draftOpen, items, workspaceId]);
  return null;
}
