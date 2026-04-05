import { useState, useEffect, useRef, useCallback } from "react";
import { Hash, MessageCircle, Users } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast";
import { useChannels } from "../../conversations/api/useChannels";
import { useInboxConversations } from "../../conversations/api/useInboxConversations";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useForwardMessageMutation } from "../api/useForwardMessage";

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

  const { data: channelsData } = useChannels(workspaceId);
  const { data: inboxData } = useInboxConversations(workspaceId);

  const channels = channelsData?.items ?? [];
  const directs = inboxData?.items ?? [];
  const allConversations = [...channels, ...directs];

  const filtered = allConversations.filter((c) => {
    let title = c.title;
    if (c.conversationType === "DIRECT" && !title) {
      const otherId = c.memberIds.find((id: string) => id !== currentUserId) ?? c.memberIds[0];
      title = memberLookup.resolve(otherId).displayName;
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

  const handleForward = useCallback(
    (targetConversationId: string) => {
      forwardMessage.mutate(
        {
          serverId: workspaceId,
          sourceConversationId,
          targetConversationId,
          messageId,
        },
        {
          onSuccess: () => {
            toast.success("Message forwarded");
            onClose();
          },
          onError: () => {
            toast.error("Failed to forward message");
          },
        },
      );
    },
    [forwardMessage, workspaceId, sourceConversationId, messageId, onClose],
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
        handleForward(filtered[focusedIndex].id);
      }
    }
  }

  function resolveTitle(conv: { title: string; conversationType: string; memberIds: string[] }): string {
    if (conv.conversationType === "DIRECT" && !conv.title) {
      const otherId = conv.memberIds.find((id) => id !== currentUserId) ?? conv.memberIds[0];
      return memberLookup.resolve(otherId).displayName;
    }
    return conv.title || "Untitled";
  }

  return (
    <Dialog open={open} onClose={onClose} title="Forward Message" maxWidth="max-w-md">
      <div className="mb-3 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text-muted line-clamp-2">
        {messageText || "(no text)"}
      </div>

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
                onClick={() => handleForward(conv.id)}
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
