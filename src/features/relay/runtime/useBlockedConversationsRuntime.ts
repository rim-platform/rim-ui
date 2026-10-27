import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { isSchemaRefusal } from "../../../core/graphql/errors";
import { onWsConnected } from "../../../core/graphql/wsClient";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { processWelcomes } from "../../e2ee/runtime/groups";
import { e2eeSession } from "../../e2ee/runtime/session";
import { requestCacheSync } from "../../messages/runtime/messageCacheSync";
import { invalidateNotificationInbox } from "../../notifications/api/useNotifications";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { blockedPrincipalsQuery } from "../api/useBlockedPrincipals";
import {
  appliedBlockedKey,
  blockedKey,
  blockedListUnsupported,
  blockedPersonName,
} from "../inbox/blockedCreators";
import { blockedPrincipalOf, useBlockedConversations } from "../state/useBlockedConversations";
import { useRelayStore } from "../state/useRelayStore";
import { relayProcessor } from "./relayRuntime";

/** How often the blocked list is read again while the app is in front. */
const BLOCKED_POLL_MS = 120_000;

type BySpace = Record<string, Record<string, string>>;

/** Brings a conversation back from a block up to date: Welcomes, the space, its feed and views. */
async function catchUp(qc: QueryClient, spaceId: string, ids: string[]): Promise<void> {
  try {
    const session = await e2eeSession();
    if (session) await processWelcomes(session).catch(() => []);
    await relayProcessor()?.reconcileSpace(spaceId);
    requestCacheSync(spaceId, ids);
    await Promise.all(
      ids.flatMap((id) => [
        qc.invalidateQueries({ queryKey: queryKeys.messages(spaceId, id) }),
        qc.invalidateQueries({ queryKey: queryKeys.cachedTimeline(spaceId, id) }),
      ]),
    );
    await qc.invalidateQueries({ queryKey: queryKeys.unreadCounts(spaceId) });
    invalidateNotificationInbox(qc, spaceId);
  } catch (err) {
    logger.warn("[RIM:relay] catching up a conversation back from a block failed:", err);
  }
}

function onChanged(qc: QueryClient, prev: BySpace, next: BySpace): void {
  for (const spaceId of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const before = prev[spaceId] ?? {};
    const after = next[spaceId] ?? {};
    const hidden = Object.keys(after).filter((id) => !(id in before));
    const back = Object.keys(before).filter((id) => !(id in after));
    if (hidden.length > 0) {
      for (const id of hidden) useUnreadStore.getState().markRead(id);
      invalidateNotificationInbox(qc, spaceId);
    }
    if (back.length > 0) void catchUp(qc, spaceId, back);
  }
}

/** Leaves a hidden conversation: to this relay's Direct messages, saying why when it was on screen. */
function closeHidden(spaceId: string, conversationId: string, principalId: string): void {
  const onScreen = useShellStore.getState().mainSurface.kind === "conversation";
  const home = useRelayStore.getState().info?.directSpaceId ?? null;
  if (home && useWorkspaceStore.getState().workspaceId !== home) {
    useWorkspaceStore.getState().setWorkspaceId(home);
  } else {
    useShellStore.getState().setSelectedConversationId(null);
  }
  if (onScreen) {
    toast.info("Conversation hidden", {
      id: `blocked-conversation:${conversationId}`,
      description: `You blocked ${blockedPersonName(spaceId, principalId)}. It comes back when you unblock them in Settings → Direct messages.`,
    });
  }
}

/** Closes the open conversation when it is one that is hidden. */
function check(): void {
  const spaceId = useWorkspaceStore.getState().workspaceId;
  const conversationId = useShellStore.getState().selectedConversationId;
  const principalId = blockedPrincipalOf(spaceId, conversationId);
  if (spaceId && conversationId && principalId) closeHidden(spaceId, conversationId, principalId);
}

/**
 * Keeps conversations someone blocked started out of sight: reads the blocked list again on a
 * timer, on focus and on reconnect, refreshes the lists of direct spaces on other servers when it
 * changes, clears a conversation's unread count as it is hidden, closes it if it is open, and
 * catches it up when it comes back after an unblock. Mounted once in `AppShell`.
 */
export function useBlockedConversationsRuntime(): void {
  const qc = useQueryClient();
  const relayOn = useRelayStore((s) => s.info !== null);
  const blocked = useQuery({
    ...blockedPrincipalsQuery,
    enabled: relayOn && !blockedListUnsupported(),
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (isSchemaRefusal(q.state.error) ? false : BLOCKED_POLL_MS),
  });

  useEffect(
    () =>
      relayOn
        ? onWsConnected(
            () => void qc.invalidateQueries({ queryKey: queryKeys.myBlockedPrincipals }),
          )
        : undefined,
    [relayOn, qc],
  );

  const key = blocked.data ? blockedKey(blocked.data) : null;
  useEffect(() => {
    if (key === null || key === appliedBlockedKey()) return;
    for (const space of Object.values(useRelayStore.getState().spaces)) {
      if (space.kind !== "direct") continue;
      void qc.invalidateQueries({
        queryKey: queryKeys.conversations(space.spaceId),
        refetchType: "all",
      });
    }
  }, [key, qc]);

  useEffect(
    () =>
      useBlockedConversations.subscribe((state, prev) =>
        onChanged(qc, prev.bySpace, state.bySpace),
      ),
    [qc],
  );

  useEffect(() => {
    const unsubscribes = [
      useShellStore.subscribe(check),
      useWorkspaceStore.subscribe(check),
      useBlockedConversations.subscribe(check),
    ];
    check();
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  });
}
