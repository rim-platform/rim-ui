import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";

import { selectDirectConversation } from "../../conversations/state/directSelection";
import { fetchConversationPredecessor, type PredecessorView } from "../api/relayApi";
import { useRelayStore } from "../state/useRelayStore";

/** The direct space this account uses on `host` (this relay's own when `host` is this relay). */
function directSpaceOn(host: string): string | null {
  const { info, spaces } = useRelayStore.getState();
  if (info?.serverId === host) return info.directSpaceId;
  return (
    Object.values(spaces).find((s) => s.kind === "direct" && s.hostServerId === host)?.spaceId ??
    null
  );
}

/**
 * The link between a conversation whose home is gone and the one that continues it, shown at
 * the top of either, so the two read as one timeline: the earlier part stays readable from this
 * device's copy.
 */
export function ConversationContinuity({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const qc = useQueryClient();
  const direct = useRelayStore(
    (s) => s.info?.directSpaceId === workspaceId || s.spaces[workspaceId]?.kind === "direct",
  );
  const here = useRelayStore(
    (s) => s.spaces[workspaceId]?.hostServerId ?? s.info?.serverId ?? null,
  );
  const origins = useRelayStore((s) => s.origins);
  const own = useQuery({
    queryKey: ["conversationPredecessor", workspaceId, conversationId],
    enabled: direct,
    staleTime: Infinity,
    retry: false,
    queryFn: () => fetchConversationPredecessor(workspaceId, conversationId),
  });
  if (!direct) return null;

  const predecessor = own.data?.predecessor;
  if (predecessor) {
    const space = directSpaceOn(predecessor.hostServerId);
    return (
      <div className="flex items-center gap-2 border-b border-rim-line px-4 py-1.5 text-xs text-rim-text-muted">
        <History className="h-3.5 w-3.5" />
        <span className="flex-1">
          Continues an earlier conversation on{" "}
          {origins[predecessor.hostServerId] ?? predecessor.hostServerId}.
        </span>
        {space && (
          <button
            type="button"
            className="text-rim-accent hover:underline"
            onClick={() => selectDirectConversation(space, predecessor.conversationId)}
          >
            Show earlier messages
          </button>
        )}
      </div>
    );
  }

  const successor = qc
    .getQueriesData<PredecessorView>({ queryKey: ["conversationPredecessor"] })
    .find(
      ([, view]) =>
        view?.predecessor?.conversationId === conversationId &&
        view.predecessor.hostServerId === here,
    );
  if (!successor) return null;
  const [key, view] = successor;
  const successorSpace = String(key[1]);
  return (
    <div className="flex items-center gap-2 border-b border-rim-line px-4 py-1.5 text-xs text-rim-text-muted">
      <History className="h-3.5 w-3.5" />
      <span className="flex-1">This conversation continues in a new one.</span>
      <button
        type="button"
        className="text-rim-accent hover:underline"
        onClick={() => view && selectDirectConversation(successorSpace, view.id)}
      >
        Open it
      </button>
    </div>
  );
}
