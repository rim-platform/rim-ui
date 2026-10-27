import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { asSentence, graphqlErrorMessage } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
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
import { resolveIdentity } from "../contacts/identity";
import { rememberRelays } from "../contacts/knownRelays";
import { relayCrypto } from "../crypto/relayCrypto";
import { relayProcessor } from "../runtime/relayRuntime";
import { cardRelays } from "../stream/relayStream";

/** The reasons a message request can be reported for. */
export const REPORT_REASONS = ["Spam", "Harassment", "Impersonation", "Other"];

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

/** The pending request of `conversationId` this account received, if any. */
export function incomingRequestOf(
  requests: DmRequestView[] | undefined,
  conversationId: string | null | undefined,
): DmRequestView | undefined {
  if (!conversationId) return undefined;
  return requests?.find((r) => r.conversationId === conversationId);
}

interface DmRequestActionsOptions {
  /**
   * Leave the conversation's view after Ignore or Block, for a view showing the conversation
   * itself.
   */
  closeOnDismiss?: boolean;
}

/**
 * The decisions on one message request, shared by the request inbox and the bar a request's
 * conversation shows instead of its composer: the sender's verified name, and Accept, Read first,
 * Ignore, Block and Report. Block asks first: `askBlock` opens the confirmation
 * (`confirmingBlock`), `block` runs it and says so in a toast. One runs at a time (`busy`); a
 * failure is a toast.
 */
export function useDmRequestActions(request: DmRequestView, options: DmRequestActionsOptions = {}) {
  const qc = useQueryClient();
  const sender = useQuery({
    queryKey: ["dmRequestSender", request.id],
    staleTime: Infinity,
    retry: false,
    queryFn: () => verifiedSenderName(request),
  });
  const [busy, setBusy] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const name = sender.data ?? "Unverified sender";
  const blockName = sender.data ?? "this sender";

  async function act(action: () => Promise<void>, failure: string): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["dmRequests"] });
      await qc.invalidateQueries({ queryKey: queryKeys.relayContacts });
      // An accepted conversation joins its space's list.
      const spaceId = request.heldItems[0]?.workspaceId;
      if (spaceId) await qc.invalidateQueries({ queryKey: queryKeys.conversations(spaceId) });
      return true;
    } catch (err) {
      toast.error(graphqlErrorMessage(err, failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function closeView() {
    const shell = useShellStore.getState();
    if (options.closeOnDismiss && shell.selectedConversationId === request.conversationId) {
      shell.setSelectedConversationId(null);
    }
  }

  /**
   * Catch up on an accepted conversation: while the request was pending its events never reached
   * this account, so nothing synced what the sender wrote meanwhile.
   */
  async function catchUpAccepted() {
    const spaceId = request.heldItems[0]?.workspaceId;
    if (!spaceId) return;
    const session = await e2eeSession();
    if (session) await processWelcomes(session).catch(() => []);
    requestCacheSync(spaceId, [request.conversationId]);
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.messages(spaceId, request.conversationId) }),
      qc.invalidateQueries({
        queryKey: queryKeys.cachedTimeline(spaceId, request.conversationId),
      }),
    ]);
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

  async function blockSender() {
    await blockPrincipal(request.fromPrincipalId);
    await qc.invalidateQueries({ queryKey: queryKeys.myBlockedPrincipals });
    const spaceId = await bindRequestSpace(request).catch(() => null);
    if (spaceId) {
      await leaveConversation(spaceId, request.conversationId).catch((err: unknown) =>
        logger.warn("[RIM:relay] leaving a blocked sender's conversation failed:", err),
      );
    }
  }

  return {
    name,
    senderUnverified: sender.isError,
    busy,
    blockName,
    confirmingBlock,
    askBlock: () => setConfirmingBlock(true),
    cancelBlock: () => setConfirmingBlock(false),
    accept: async () => {
      if (await act(() => acceptDmRequest(request.id), "Could not accept")) await catchUpAccepted();
    },
    readFirst,
    ignore: async () => {
      if (await act(() => ignoreDmRequest(request.id), "Could not ignore")) closeView();
    },
    block: async () => {
      setConfirmingBlock(false);
      if (await act(blockSender, "Could not block")) {
        toast.success(asSentence(`Blocked ${blockName}`));
        closeView();
      }
    },
    report: (reason: string) =>
      act(async () => {
        await reportDmRequest(request.id, reason);
        toast.success("Reported to your relay's operators");
      }, "Could not report"),
  };
}
