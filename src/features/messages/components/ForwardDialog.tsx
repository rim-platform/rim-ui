import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Hash, MessageCircle, Users } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast";
import { useChannels } from "../../conversations/api/useChannels";
import { useInboxConversations } from "../../conversations/api/useInboxConversations";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useForwardMessageMutation } from "../api/useForwardMessage";
import { useSendMessageMutation, type MessagesPage } from "../api/useMessages";
import { queryKeys } from "../../../core/query/keys";
import type { MessageItem } from "../../../core/types/messages";
import { detectPlatform } from "../../../core/runtime/runtime";
import { sendEncrypted } from "../../e2ee/runtime/send";
import { toUserMentions } from "../../e2ee/utils/content";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import type { ConversationSummary } from "../../conversations/types";
import { directPeerId, isInvited, untitledGroupName } from "../../conversations/utils";

interface ForwardDialogProps {
  open: boolean;
  onClose: () => void;
  messageId: string;
  messageText: string;
  workspaceId: string;
  sourceConversationId: string;
}

type ConversationTypeEnum = "CHANNEL" | "DIRECT" | "GROUP";

const typeIcon: Record<ConversationTypeEnum, typeof Hash> = {
  CHANNEL: Hash,
  DIRECT: MessageCircle,
  GROUP: Users,
};

export function ForwardDialog({
  open,
  onClose,
  messageId,
  messageText,
  workspaceId,
  sourceConversationId,
}: ForwardDialogProps) {
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId);
  const forwardMessage = useForwardMessageMutation();
  const sendMessage = useSendMessageMutation();
  const qc = useQueryClient();
  const { data: serverMembers } = useServerMembers(workspaceId);
  /** An encrypted message forwarded into a plaintext conversation waits for a confirmation. */
  const [confirmPlaintext, setConfirmPlaintext] = useState<string | null>(null);

  const { data: channelsData } = useChannels(workspaceId);
  const { data: inboxData } = useInboxConversations(workspaceId);

  // Conversations the viewer is only invited to take no messages until they join.
  const allConversations = useMemo(
    () =>
      [...(channelsData?.items ?? []), ...(inboxData?.items ?? [])].filter(
        (c) => !isInvited(c, currentUserId),
      ),
    [channelsData?.items, inboxData?.items, currentUserId],
  );

  const filtered = allConversations.filter((c) => {
    let title = c.title;
    if (c.conversationType === "DIRECT" && !title) {
      const otherId = directPeerId(c, currentUserId);
      title = otherId ? memberLookup.resolve(otherId).displayName : title;
    }
    return (title ?? "").toLowerCase().includes(search.toLowerCase());
  });

  useEffect(() => {
    if (open) {
      setSearch("");
      setFocusedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setFocusedIndex(0);
  }, [search]);

  /** The forwarded message as the timeline holds it (decrypted, for an encrypted one). */
  const sourceItem = useCallback((): MessageItem | undefined => {
    const data = qc.getQueryData<InfiniteData<MessagesPage>>(
      queryKeys.messages(workspaceId, sourceConversationId),
    );
    return data?.pages.flatMap((p) => p.items).find((m) => m.id === messageId);
  }, [qc, workspaceId, sourceConversationId, messageId]);

  const handleForward = useCallback(
    async (targetConversationId: string, confirmed = false) => {
      const target = allConversations.find((c) => c.id === targetConversationId);
      const source = sourceItem();
      const sourceEncrypted = Boolean(source?.e2ee || source?.encryption);
      const targetEncrypted = Boolean(target?.encryptedAt);
      try {
        if (targetEncrypted) {
          // Encrypted conversations take new content: the text, and an encrypted source's files.
          if (detectPlatform() !== "desktop") throw new Error("Forward from the desktop app");
          const authorPrincipalId = source?.e2ee?.senderPrincipalId ?? source?.author?.principalId;
          const me = serverMembers?.find((m) => m.userId === currentUserId);
          await sendEncrypted(workspaceId, targetConversationId, {
            body: source?.text ?? messageText,
            author: {
              id: currentUserId ?? "",
              username: me?.username ?? "",
              displayName: me?.displayName ?? null,
              avatarUrl: me?.avatarUrl ?? null,
              principalId: me?.principalId ?? null,
            },
            forwardedFrom:
              source && authorPrincipalId
                ? {
                    messageId,
                    conversationId: sourceConversationId,
                    authorPrincipalId,
                    sentAt: source.sentAt,
                  }
                : null,
            forwardAttachments:
              source?.e2ee && source.attachments.length > 0
                ? {
                    messageId,
                    conversationId: sourceConversationId,
                    blobSha256: source.attachments.flatMap((a) =>
                      a.blobSha256 ? [a.blobSha256] : [],
                    ),
                  }
                : undefined,
          });
        } else if (sourceEncrypted) {
          if (!confirmed) {
            setConfirmPlaintext(targetConversationId);
            return;
          }
          const userOf = (principalId: string) =>
            serverMembers?.find((m) => m.principalId === principalId)?.userId;
          await sendMessage.mutateAsync({
            workspaceId,
            conversationId: targetConversationId,
            text: toUserMentions(source?.text ?? messageText, userOf),
            forwardedFromMessageId: messageId,
          });
        } else {
          await forwardMessage.mutateAsync({
            serverId: workspaceId,
            sourceConversationId,
            targetConversationId,
            messageId,
          });
        }
        toast.success("Message forwarded");
        setConfirmPlaintext(null);
        onClose();
      } catch {
        toast.error("Failed to forward message");
      }
    },
    [
      allConversations,
      sourceItem,
      serverMembers,
      currentUserId,
      workspaceId,
      sourceConversationId,
      messageId,
      messageText,
      sendMessage,
      forwardMessage,
      onClose,
    ],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[focusedIndex]) {
        void handleForward(filtered[focusedIndex].id);
      }
    }
  }

  function resolveTitle(
    conv: Pick<
      ConversationSummary,
      "title" | "conversationType" | "memberIds" | "pendingMemberIds"
    >,
  ): string {
    const otherId = directPeerId(conv, currentUserId);
    if (conv.conversationType === "DIRECT" && !conv.title && otherId) {
      return memberLookup.resolve(otherId).displayName;
    }
    if (conv.conversationType === "GROUP" && !conv.title) {
      const name = untitledGroupName(
        conv,
        currentUserId,
        (id) => memberLookup.resolve(id).displayName,
      );
      if (name) return name;
    }
    return conv.title || "Untitled";
  }

  return (
    <Dialog open={open} onClose={onClose} title="Forward Message" maxWidth="max-w-md">
      <div className="mb-3 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text-muted line-clamp-2">
        {messageText || "(no text)"}
      </div>

      {confirmPlaintext && (
        <div
          role="alertdialog"
          className="mb-3 rounded-lg border border-rim-warm/30 bg-rim-warm/10 px-3 py-2 text-xs text-rim-text"
        >
          <p>
            This message is end-to-end encrypted. Forwarding it posts its text unencrypted in the
            other conversation.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void handleForward(confirmPlaintext, true)}
              className="rounded bg-rim-accent px-2 py-1 text-rim-void"
            >
              Forward unencrypted
            </button>
            <button
              type="button"
              onClick={() => setConfirmPlaintext(null)}
              className="rounded px-2 py-1 text-rim-text-muted hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search conversations..."
        className="mb-2 w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40"
      />

      <div className="max-h-60 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-rim-text-muted">No conversations found.</p>
        ) : (
          filtered.map((conv, i) => {
            const Icon = typeIcon[conv.conversationType as ConversationTypeEnum] ?? Hash;
            const title = resolveTitle(conv);
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => void handleForward(conv.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                  i === focusedIndex
                    ? "bg-rim-accent/10 text-rim-text"
                    : "text-rim-text-muted hover:bg-white/5",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{title}</span>
              </button>
            );
          })
        )}
      </div>
    </Dialog>
  );
}
