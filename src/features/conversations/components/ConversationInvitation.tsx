import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";

import { graphqlErrorCode, graphqlErrorMessage, NOT_FOUND } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { LinkBrowserHint } from "../../e2ee/components/LinkBrowserHint";
import {
  useDeviceReadyForEncryption,
  useEncryptionSupport,
} from "../../e2ee/hooks/useE2eeConversation";
import { BROWSER_NOTICES } from "../../e2ee/utils/browserNotices";
import { joinNames } from "../../e2ee/utils/names";
import { useOfferKeySetup } from "../../key-identity";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import {
  leaveInvitation,
  useAcceptConversationInviteMutation,
  useDeclineConversationInviteMutation,
  useInvitation,
} from "../api/useConversationInvite";
import type { ConversationSummary, ConversationSummaryPage } from "../types";
import { directPeerId, isInvited } from "../utils";

interface InvitationGateProps {
  workspaceId: string | null;
  conversationId: string | null;
  children: ReactNode;
}

/**
 * The open conversation, or, when the viewer is only invited to it, the invitation instead of
 * its messages and composer. Shows neither until the inbox says which, so nothing asks the
 * server for messages it refuses.
 */
export function InvitationGate({ workspaceId, conversationId, children }: InvitationGateProps) {
  const { invitation, known } = useInvitation(workspaceId, conversationId);
  if (workspaceId && conversationId && !known) return null;
  if (!invitation || !workspaceId) return <>{children}</>;
  return (
    <ConversationInvitation
      key={invitation.id}
      workspaceId={workspaceId}
      conversation={invitation}
    />
  );
}

/** What a device that is not ready for encryption can do about it, in one paragraph. */
function NotReadyHint({ keySetupAvailable }: { keySetupAvailable: boolean }) {
  const support = useEncryptionSupport();
  if (keySetupAvailable || support === "checking") return null;
  if (support === "noDeviceKey") return <LinkBrowserHint />;
  const notice = BROWSER_NOTICES[support];
  return notice ? <p>{notice}</p> : null;
}

/**
 * An invitation to an encrypted conversation: who is in it, and Join (this device is ready),
 * Set up encryption (it is not), or Decline. Built from the inbox entry alone: the server
 * refuses the conversation and its messages until the viewer joins.
 */
export function ConversationInvitation({
  workspaceId,
  conversation,
}: {
  workspaceId: string;
  conversation: ConversationSummary;
}) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId);
  const ready = useDeviceReadyForEncryption();
  const keySetup = useOfferKeySetup();
  const accept = useAcceptConversationInviteMutation();
  const decline = useDeclineConversationInviteMutation();
  const [error, setError] = useState<string | null>(null);
  const vars = { serverId: workspaceId, conversationId: conversation.id };

  const isDm = conversation.conversationType === ConversationTypeEnum.DIRECT;
  const nameOf = (id: string) => memberLookup.resolve(id).displayName;
  const peer = directPeerId(conversation, userId);
  const title = conversation.title || (isDm && peer ? nameOf(peer) : "Group");
  const members = conversation.memberIds.filter((id) => id !== userId).map(nameOf);
  const starter = conversation.createdBy ? nameOf(conversation.createdBy) : null;

  /** The invitation is gone (expired, withdrawn, handled elsewhere): read the inbox again. */
  async function refreshGone() {
    await qc.invalidateQueries({ queryKey: queryKeys.conversations(workspaceId) });
    const page = qc.getQueryData<ConversationSummaryPage>(queryKeys.conversations(workspaceId));
    const listed = page?.items.find((c) => c.id === conversation.id);
    if (listed && isInvited(listed, userId)) {
      setError("This invitation could not be found. Try again later.");
    } else if (!listed) {
      leaveInvitation(qc, workspaceId, conversation.id);
      toast.info("This invitation is no longer open");
    }
  }

  function fail(err: unknown, fallback: string) {
    if (graphqlErrorCode(err) === NOT_FOUND) void refreshGone();
    else setError(graphqlErrorMessage(err, fallback));
  }

  function join() {
    setError(null);
    accept.mutate(vars, { onError: (err) => fail(err, "Could not join the conversation") });
  }

  function refuse() {
    setError(null);
    decline.mutate(vars, { onError: (err) => fail(err, "Could not decline the invitation") });
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <section
        aria-label="Invitation"
        className="w-full max-w-md space-y-4 rounded-xl border border-rim-line bg-rim-panel p-5"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-rim-accent/10 p-2 text-rim-accent">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium text-rim-text">{title}</h2>
            <p className="text-xs text-rim-text-faint">
              {isDm ? "Direct message" : "Group"}
              {starter && !isDm && ` · started by ${starter}`}
            </p>
          </div>
        </div>

        {!isDm && members.length > 0 && (
          <p className="text-sm text-rim-text-muted">Members: {joinNames(members)}</p>
        )}

        <div className="space-y-2 text-sm text-rim-text-muted">
          <p className="text-rim-text">
            You were invited to an encrypted conversation.
            {ready
              ? " Joining shows the messages sent from then on, not the earlier ones."
              : " Set up a device for encryption to join."}
          </p>
          {!ready && <NotReadyHint keySetupAvailable={keySetup.available} />}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            isLoading={decline.isPending}
            disabled={accept.isPending}
            onClick={refuse}
          >
            Decline
          </Button>
          {ready ? (
            <Button
              type="button"
              size="sm"
              isLoading={accept.isPending}
              disabled={decline.isPending}
              onClick={join}
            >
              Join
            </Button>
          ) : (
            keySetup.available && (
              <Button type="button" size="sm" onClick={keySetup.offer}>
                Set up encryption
              </Button>
            )
          )}
        </div>
      </section>
    </div>
  );
}
