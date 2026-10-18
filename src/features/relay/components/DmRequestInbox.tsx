import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { useShellStore } from "../../../shell/state/useShellStore";
import { leaveConversation } from "../../conversations/api/useChannelMembership";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import { processWelcomes } from "../../e2ee/runtime/groups";
import { e2eeSession } from "../../e2ee/runtime/session";
import { requestCacheSync } from "../../messages/runtime/messageCacheSync";
import {
  acceptDmRequest,
  blockPrincipal,
  ignoreDmRequest,
  reportDmRequest,
  type DmRequestView,
} from "../api/relayApi";
import { usePendingDmRequestsIn } from "../api/useDmRequests";
import { resolveIdentity } from "../contacts/identity";
import { rememberRelays } from "../contacts/knownRelays";
import { relayCrypto } from "../crypto/relayCrypto";
import { relayProcessor } from "../runtime/relayRuntime";
import { cardRelays } from "../stream/relayStream";
import { PrincipalFingerprint } from "./PrincipalFingerprint";

const REPORT_REASONS = ["Spam", "Harassment", "Impersonation", "Other"];

/** The sender's name from the request's card, verified against their key log, or `null`. */
async function verifiedSenderName(request: DmRequestView): Promise<string | null> {
  const relays = cardRelays(request.card);
  rememberRelays(request.fromPrincipalId, relays);
  const { identity } = await resolveIdentity(request.fromPrincipalId, relays);
  const card = await relayCrypto().verifyCard(
    request.fromPrincipalId,
    identity.keyLog,
    request.card,
  );
  return card.displayName;
}

/**
 * Bind the conversation of a request to its host by checking its held `DmInvite`, so it can be
 * read or left through the host. Returns the space, or `null` when no held item verifies.
 */
async function bindRequestSpace(request: DmRequestView): Promise<string | null> {
  const processor = relayProcessor();
  if (!processor) return null;
  for (const item of request.heldItems) {
    const event = await processor.verifyHeld(item);
    if (
      event?.event.type === "DmInvite" &&
      event.event.conversation_id === request.conversationId
    ) {
      return item.workspaceId;
    }
  }
  return null;
}

interface DmRequestInboxProps {
  /**
   * The requests shown: those of one workspace's conversations, with `null` those from
   * outside every workspace; all of them when left out.
   */
  workspaceId?: string | null;
}

/**
 * Message requests: DMs the person's settings take as requests, held by the relay until they
 * decide. Each shows the name from the sender's verified card and the fingerprint of their
 * principal id; the person may read the conversation first, then accept, ignore, block or
 * report. Requests a shared workspace lets through are accepted on their own.
 */
export function DmRequestInbox({ workspaceId }: DmRequestInboxProps) {
  const requests = usePendingDmRequestsIn(workspaceId);
  if (requests.length === 0) return null;
  return (
    <section className="mb-2 rounded-lg border border-rim-line" aria-label="Message requests">
      <h3 className="border-b border-rim-line px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
        Message requests ({requests.length})
      </h3>
      <ul className="divide-y divide-rim-line">
        {requests.map((request) => (
          <DmRequestRow key={request.id} request={request} />
        ))}
      </ul>
    </section>
  );
}

function DmRequestRow({ request }: { request: DmRequestView }) {
  const qc = useQueryClient();
  const sender = useQuery({
    queryKey: ["dmRequestSender", request.id],
    staleTime: Infinity,
    retry: false,
    queryFn: () => verifiedSenderName(request),
  });
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const name = sender.data ?? "Unverified sender";

  async function act(action: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["dmRequests"] });
      await qc.invalidateQueries({ queryKey: queryKeys.relayContacts });
      // An accepted conversation joins its space's list.
      const spaceId = request.heldItems[0]?.workspaceId;
      if (spaceId) await qc.invalidateQueries({ queryKey: queryKeys.conversations(spaceId) });
    } catch (err) {
      toast.error(graphqlErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  }

  async function readFirst() {
    const spaceId = await bindRequestSpace(request);
    if (!spaceId) {
      toast.error("The conversation could not be verified, so it cannot be read here.");
      return;
    }
    const session = await e2eeSession();
    if (session) await processWelcomes(session).catch(() => []);
    requestCacheSync(spaceId, [request.conversationId]);
    selectDirectConversation(spaceId, request.conversationId);
    useShellStore.getState().setMainSurface({ kind: "conversation" });
  }

  async function block() {
    await blockPrincipal(request.fromPrincipalId);
    const spaceId = await bindRequestSpace(request).catch(() => null);
    if (spaceId) {
      await leaveConversation(spaceId, request.conversationId).catch((err: unknown) =>
        logger.warn("[RIM:relay] leaving a blocked sender's conversation failed:", err),
      );
    }
  }

  return (
    <li className="space-y-2 px-3 py-2">
      <div>
        <p className="text-sm text-rim-text">{name}</p>
        <p className="text-xs text-rim-text-faint">
          <PrincipalFingerprint principalId={request.fromPrincipalId} />
          {sender.isError && " · their card could not be verified"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void act(() => acceptDmRequest(request.id), "Could not accept")}
        >
          Accept
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void readFirst()}>
          Read first
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void act(() => ignoreDmRequest(request.id), "Could not ignore")}
        >
          Ignore
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() => void act(block, "Could not block")}
        >
          Block
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReporting((v) => !v)}>
          Report
        </Button>
      </div>
      {reporting && (
        <div className="flex flex-wrap gap-1.5" aria-label="Report reason">
          {REPORT_REASONS.map((reason) => (
            <Button
              key={reason}
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await reportDmRequest(request.id, reason);
                  setReporting(false);
                  toast.success("Reported to your relay's operators");
                }, "Could not report")
              }
            >
              {reason}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}
