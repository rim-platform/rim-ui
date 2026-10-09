import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import { continueConversation, goneHome } from "../conversations/successor";
import { useRelayStore } from "../state/useRelayStore";

/**
 * Above the composer of a DM whose home has not answered for a week: continue it on this
 * person's relay. The new conversation shows in its place, with the old one's history kept on
 * this device.
 */
export function SuccessorOffer({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const origin = useRelayStore((s) => {
    const host = s.spaces[workspaceId]?.hostServerId;
    return host ? (s.origins[host] ?? host) : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!origin || !goneHome(workspaceId)) return null;

  async function moveOn() {
    setBusy(true);
    setError(null);
    try {
      const next = await continueConversation(workspaceId, conversationId);
      selectDirectConversation(next.spaceId, next.conversationId);
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not continue the conversation."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-rim-line bg-rim-warm/10 px-4 py-2 text-xs text-rim-warm">
      <span className="flex-1">
        {origin} has not answered for a week. Continue this conversation on your relay?
      </span>
      <Button size="sm" isLoading={busy} onClick={() => void moveOn()}>
        Continue here
      </Button>
      {error && (
        <span role="alert" className="w-full text-rim-danger">
          {error}
        </span>
      )}
    </div>
  );
}
