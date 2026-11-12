import { useEffect, useMemo, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";

import { graphqlErrorCode } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { detectPlatform } from "../../../core/runtime/runtime";
import { Button } from "../../../shared/ui/Button";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useConversation } from "../../conversations/api/useConversation";
import { LinkBrowserHint } from "../../e2ee/components/LinkBrowserHint";
import { useConversationMessages } from "../../messages/api/useMessages";
import { MessageItem, type MessageItemHandlers } from "../../messages/components/MessageItem";
import { replyQuoteFor } from "../../messages/components/message-item/replyQuoteView";
import { computeGroups } from "../../messages/components/timeline/computeGroups";
import { messageAuthorView, useMessageMembers } from "../../messages/hooks/useMessageMembers";
import { jumpToNotification } from "../../notifications/runtime/jumpToNotification";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { removeBoxEverywhere } from "../api/homeLayoutApi";
import type { ChannelSettings } from "./settings";

/** How often a channel box of a workspace that is not open reads its messages again. */
export const OTHER_WORKSPACE_REFRESH_MS = 60_000;

const NOOP = () => undefined;

/** The handlers of a row that only shows its message: no reactions, replies or threads. */
const READ_ONLY_HANDLERS: MessageItemHandlers = {
  onOpenThread: NOOP,
  onToggleReaction: NOOP,
  canAddReaction: false,
  canStartThread: false,
};

/** Whether a failed read of a conversation means the person can no longer see it. */
function isGone(err: unknown): boolean {
  const code = graphqlErrorCode(err);
  return code === "NOT_FOUND" || code === "FORBIDDEN";
}

/** A line saying why the box shows nothing, with Remove, which takes the box off Home. */
function GoneLine({ boxId, text }: { boxId: string; text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-rim-text-muted">
      <span className="min-w-0 flex-1">{text}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => void removeBoxEverywhere(boxId)}
      >
        Remove
      </Button>
    </div>
  );
}

/**
 * The latest messages of one channel, through the same query and cache as its timeline, so they
 * update as the timeline does: as they arrive in the open workspace, and every minute in another.
 * They show as the timeline shows them, condensed and read-only. Showing them marks nothing read.
 */
export function ChannelBoxBody({ boxId, settings }: { boxId: string; settings: ChannelSettings }) {
  const { workspaceId, conversationId, count } = settings;
  const qc = useQueryClient();
  const openWorkspaceId = useWorkspaceStore((s) => s.workspaceId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId);
  const conversation = useConversation(workspaceId, conversationId);
  const gone = conversation.isError && isGone(conversation.error);
  const archived = conversation.data?.isArchived === true;
  // Messages are read once the channel is known to be one the person can see.
  const readable = Boolean(conversation.data) && !gone;
  const messages = useConversationMessages(
    readable ? workspaceId : undefined,
    readable ? conversationId : undefined,
  );
  const newestPage = messages.data?.pages[0]?.items;
  const shown = useMemo(() => (newestPage ?? []).slice(-count), [newestPage, count]);
  const members = useMessageMembers(memberLookup, shown);
  const rowGroups = useMemo(() => computeGroups(shown), [shown]);
  const elsewhere = workspaceId !== openWorkspaceId;

  // Messages of the open workspace arrive as they are sent; another workspace is read again.
  useEffect(() => {
    if (!elsewhere || gone) return;
    const timer = setInterval(() => {
      void qc.invalidateQueries({ queryKey: queryKeys.messages(workspaceId, conversationId) });
    }, OTHER_WORKSPACE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [elsewhere, gone, qc, workspaceId, conversationId]);

  if (gone) {
    return (
      <GoneLine boxId={boxId} text="You can't see this channel any more, or it was deleted." />
    );
  }
  if (archived) return <GoneLine boxId={boxId} text="This channel is archived." />;
  if (conversation.isError || messages.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-rim-text-muted">
        <span className="min-w-0 flex-1">Couldn&apos;t load this channel.</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            if (conversation.isError) void conversation.refetch();
            else void messages.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (!readable || messages.isPending) {
    return <p className="text-sm text-rim-text-muted">Loading…</p>;
  }
  // The timeline's own words, where this app holds no text of an encrypted conversation.
  if (shown.some((message) => message.encryption && !message.e2ee)) {
    return (
      <div className="text-sm text-rim-text-muted">
        {detectPlatform() !== "desktop" ? (
          <LinkBrowserHint />
        ) : (
          <p>This device holds no text of these messages.</p>
        )}
      </div>
    );
  }
  if (shown.length === 0) return <p className="text-sm text-rim-text-muted">No messages yet.</p>;

  function open(messageId: string, threadId: string | null) {
    void jumpToNotification(qc, { serverId: workspaceId, conversationId, messageId, threadId });
  }

  // A click on the message itself opens it; its links and buttons keep their own clicks.
  function onRowClick(e: MouseEvent, messageId: string, threadId: string | null) {
    if (e.target instanceof Element && e.target.closest("a, button, input, [role='button']"))
      return;
    open(messageId, threadId);
  }

  return (
    <div className="space-y-1">
      <ul className="-mx-2" aria-label="Latest messages">
        {shown.map((message, index) => {
          const parent = message.parentMessageId
            ? shown.find((m) => m.id === message.parentMessageId)
            : undefined;
          const rowGroup = rowGroups[index] ?? { isGrouped: false, isFirstInGroup: true };
          const author = messageAuthorView(message, memberLookup.resolve(message.authorId), {
            ownDomain: memberLookup.ownDomain,
            inDirectSpace: false,
            currentUserId,
          });
          return (
            <li
              key={message.id}
              className="group relative cursor-pointer rounded hover:bg-white/5"
              onClick={(e) => onRowClick(e, message.id, message.threadId ?? null)}
            >
              <MessageItem
                view={{
                  message: { ...message, reactions: [] },
                  replyTo: message.parentMessageId
                    ? replyQuoteFor(
                        message.parentMessageId,
                        parent,
                        parent ? memberLookup.resolve(parent.authorId).displayName : null,
                        (id) => members.displayMap?.get(id),
                      )
                    : null,
                  author,
                  isSelected: false,
                  isGrouped: rowGroup.isGrouped,
                  isFirstInGroup: rowGroup.isFirstInGroup,
                  displayDensity: "compact",
                  inThreadPane: true,
                }}
                handlers={READ_ONLY_HANDLERS}
                members={members}
              />
              <button
                type="button"
                aria-label={`Open the message from ${author.name} in its channel`}
                title="Open in its channel"
                onClick={() => open(message.id, message.threadId ?? null)}
                className="absolute right-1 top-1 rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-text focus-visible:opacity-100 group-hover:opacity-100"
              >
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
      {elsewhere && <p className="text-xs text-rim-text-faint">Updates every minute.</p>}
    </div>
  );
}
