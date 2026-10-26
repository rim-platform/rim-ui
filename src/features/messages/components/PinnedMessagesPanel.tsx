import { useMemo, useCallback } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Pin } from "lucide-react";

import { usePinnedMessages } from "../api/usePinnedMessages";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useMessageDisplaySettingsStore } from "../state/useMessageDisplaySettingsStore";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { Avatar } from "../../../shared/ui/Avatar";
import { formatTime } from "../../../shared/utils/formatTime";
import { toast } from "../../../shared/toast";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { copyToClipboard } from "../../../shared/ui/contextMenu/menuActions";
import { queryKeys } from "../../../core/query/keys";
import type { MessageItem, MessagesPage } from "../../../core/types/messages";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnpinMessageMutation } from "../api/usePinMessage";
import { usePostingRights } from "../../conversations/api/useChannelPosting";

interface PinnedMessagesPanelProps {
  conversationId: string;
  workspaceId: string;
  onClose: () => void;
}

export function PinnedMessagesPanel({
  conversationId,
  workspaceId,
  onClose,
}: PinnedMessagesPanelProps) {
  const {
    data: pinnedMessages,
    isPending,
    isError,
  } = usePinnedMessages(workspaceId, conversationId);
  const memberLookup = useMemberLookup(workspaceId);
  const showInlineMedia = useMessageDisplaySettingsStore((s) => s.showInlineMedia);
  const memberDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [userId, info] of memberLookup.map) {
      map.set(userId, info.displayName);
    }
    return map;
  }, [memberLookup.map]);

  const handlePinnedKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const container = e.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>("[data-pinned-item]"));
    if (items.length === 0) return;
    const current = items.indexOf(e.target as HTMLElement);
    let next: number;
    if (e.key === "ArrowDown") {
      next = current < items.length - 1 ? current + 1 : 0;
    } else {
      next = current > 0 ? current - 1 : items.length - 1;
    }
    items[next].focus();
  }, []);

  const qc = useQueryClient();
  const unpinMessage = useUnpinMessageMutation();
  const canUnpin = usePostingRights(workspaceId, conversationId).pin;
  const contextMenu = useContextMenu();

  /** Scrolls the timeline to the message and flashes it, when it is loaded there. */
  const jumpTo = useCallback(
    (messageId: string) => {
      const timeline = qc.getQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, conversationId),
      );
      if (timeline?.pages.some((page) => page.items.some((m) => m.id === messageId))) {
        useShellStore.getState().setHighlightedMessageId(messageId);
      } else {
        toast.info("The message is not loaded", {
          description: "Scroll up to load older messages.",
        });
      }
    },
    [qc, workspaceId, conversationId],
  );

  const menuItems = (msg: MessageItem): DropdownMenuItem[] => [
    { id: "jump-to-message", label: "Jump to message", onSelect: () => jumpTo(msg.id) },
    { id: "copy-text", label: "Copy text", onSelect: () => copyToClipboard(msg.text ?? "") },
    ...(canUnpin
      ? [
          {
            id: "unpin-message",
            label: "Unpin message",
            separatorBefore: true,
            onSelect: () =>
              unpinMessage.mutate(
                { serverId: workspaceId, conversationId, messageId: msg.id },
                { onError: () => toast.error("Could not unpin the message") },
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full flex-col border-l border-rim-line bg-rim-panel">
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-2">
        <div className="flex items-center gap-2">
          <Pin className="h-4 w-4 text-rim-accent" />
          <h3 className="text-sm font-medium text-rim-text">Pinned Messages</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
        >
          &times;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isPending && <p className="text-sm text-rim-text-muted">Loading...</p>}
        {isError && <p className="text-sm text-rim-danger">Failed to load pinned messages.</p>}
        {!isPending && !isError && (!pinnedMessages || pinnedMessages.length === 0) && (
          <p className="text-sm text-rim-text-muted">No pinned messages yet.</p>
        )}
        {pinnedMessages && pinnedMessages.length > 0 && (
          <div className="space-y-3" onKeyDown={handlePinnedKeyDown}>
            {pinnedMessages.map((msg) => (
              <div
                key={msg.id}
                data-pinned-item
                tabIndex={0}
                {...contextMenu.bind(() => menuItems(msg), { label: "Pinned message actions" })}
                className="rounded-lg border border-rim-line bg-rim-void p-3 outline-none focus:ring-1 focus:ring-rim-accent"
              >
                <div className="flex items-center gap-2">
                  <Avatar
                    url={msg.author?.avatarUrl}
                    name={msg.author?.displayName ?? msg.author?.username ?? "?"}
                    userId={msg.authorId}
                    size="sm"
                  />
                  <span className="text-sm font-medium text-rim-text">
                    {msg.author?.displayName ?? msg.author?.username ?? msg.authorId.slice(0, 8)}
                  </span>
                  <span className="text-xs text-rim-text-faint">{formatTime(msg.sentAt)}</span>
                </div>
                <MarkdownRenderer
                  content={msg.text ?? ""}
                  className="mt-1 text-sm text-rim-text prose-rim"
                  memberMap={memberDisplayMap}
                  showInlineMedia={showInlineMedia}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {contextMenu.menu}
    </div>
  );
}
