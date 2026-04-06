import { useState, useRef, useEffect, useCallback } from "react";
import { Hash, MessageCircle, Pin, Search, Users, BellOff, Bell, UserPlus } from "lucide-react";

import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspace } from "../../features/workspaces/api/useWorkspace";
import { useInboxConversations } from "../../features/conversations/api/useInboxConversations";
import { useChannels } from "../../features/conversations/api/useChannels";
import { useShellStore } from "../state/useShellStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMemberLookup } from "../../features/workspaces/hooks/useMemberLookup";
import { useUpdateTopicMutation } from "../../features/conversations/api/useUpdateTopic";
import { Avatar } from "../../shared/ui/Avatar";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { usePresenceStore, type PresenceStatus } from "../../features/presence/state/usePresenceStore";
import { useMutedStore } from "../../features/conversations/state/useMutedStore";
import { useMuteConversationMutation, useUnmuteConversationMutation } from "../../features/conversations/api/useMuteConversation";
import { InviteDialog } from "../../features/settings/components/InviteDialog";

type ConversationTypeEnum = "CHANNEL" | "DIRECT" | "GROUP";

const typeIcon: Record<ConversationTypeEnum, typeof Hash> = {
  CHANNEL: Hash,
  DIRECT: MessageCircle,
  GROUP: Users,
};

export function ConversationHeader() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const openSearch = useSearchOverlayStore((s) => s.openWithScope);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const { data: workspace } = useWorkspace(workspaceId ?? undefined);
  const { data: convPage } = useInboxConversations(workspaceId ?? undefined);
  const { data: channelsPage } = useChannels(workspaceId ?? undefined);

  const conversation =
    convPage?.items.find((c) => c.id === conversationId) ??
    channelsPage?.items.find((c) => c.id === conversationId);
  const Icon = conversation ? typeIcon[conversation.conversationType as ConversationTypeEnum] ?? Hash : Hash;

  // For DMs, show the other user's name instead of "Untitled"
  let displayTitle = conversation?.title;
  let dmOtherUserId: string | undefined;
  if (
    conversation &&
    conversation.conversationType === "DIRECT" &&
    conversation.memberIds.length > 0
  ) {
    dmOtherUserId =
      conversation.memberIds.find((id) => id !== currentUserId) ?? conversation.memberIds[0];
    const dmOtherMember = memberLookup.resolve(dmOtherUserId);
    if (!displayTitle) {
      displayTitle = dmOtherMember.displayName;
    }
  }

  const dmAvatarUrl = dmOtherUserId ? memberLookup.resolve(dmOtherUserId).avatarUrl : undefined;

  const presenceStatus = usePresenceStore((s) =>
    dmOtherUserId ? s.presenceMap[dmOtherUserId] : undefined,
  ) as PresenceStatus | undefined;

  const inviteOpen = useShellStore((s) => s.showInviteDialog);
  const setInviteOpen = useShellStore((s) => s.setShowInviteDialog);

  const topic = conversation?.topic ?? null;
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const topicInputRef = useRef<HTMLInputElement>(null);
  const updateTopic = useUpdateTopicMutation();

  useEffect(() => {
    if (isEditingTopic && topicInputRef.current) {
      topicInputRef.current.focus();
    }
  }, [isEditingTopic]);

  const handleTopicClick = useCallback(() => {
    if (conversation?.conversationType === "CHANNEL") {
      setTopicDraft(topic ?? "");
      setIsEditingTopic(true);
    }
  }, [conversation?.conversationType, topic]);

  const handleTopicKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setIsEditingTopic(false);
    } else if (e.key === "Enter") {
      if (workspaceId && conversationId && topicDraft !== (topic ?? "")) {
        updateTopic.mutate({ serverId: workspaceId, conversationId, topic: topicDraft });
      }
      setIsEditingTopic(false);
    }
  }, [workspaceId, conversationId, topicDraft, topic, updateTopic]);

  return (
    <div className="flex h-10 items-center justify-between border-b border-rim-line px-4">
      <div className="flex min-w-0 items-center gap-3">
        {dmOtherUserId ? (
          <Avatar
            url={dmAvatarUrl}
            name={displayTitle ?? "?"}
            userId={dmOtherUserId}
            size="sm"
            presenceStatus={presenceStatus ?? null}
          />
        ) : (
          <Icon className="h-5 w-5 text-rim-text-muted" />
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-rim-text">
            {displayTitle ?? (conversationId ? "Untitled" : "No conversation")}
          </h2>
          {conversation?.conversationType === "CHANNEL" && (
            isEditingTopic ? (
              <input
                ref={topicInputRef}
                type="text"
                value={topicDraft}
                onChange={(e) => setTopicDraft(e.target.value)}
                onKeyDown={handleTopicKeyDown}
                onBlur={() => setIsEditingTopic(false)}
                placeholder="Set a topic..."
                className="w-full bg-transparent text-xs text-rim-text-muted outline-none placeholder:text-rim-text-faint"
              />
            ) : (
              <button
                type="button"
                onClick={handleTopicClick}
                className="block max-w-[400px] truncate text-xs text-rim-text-muted hover:text-rim-text"
              >
                {topic || "Set a topic..."}
              </button>
            )
          )}
          {conversation?.conversationType !== "CHANNEL" && (
            <p className="text-xs text-rim-text-faint">
              {workspace?.name ?? ""}
              {conversation && ` \u00b7 ${conversation.memberIds.length} members`}
            </p>
          )}
        </div>
      </div>
      {conversationId && (
        <div className="flex items-center gap-1">
          <InviteButton onClick={() => setInviteOpen(true)} />
          <MuteToggleButton conversationId={conversationId} workspaceId={workspaceId ?? ""} />
          {conversation?.conversationType === "CHANNEL" && (
            <PinnedMessagesButton />
          )}
          <ChannelSearchButton
            conversationId={conversationId}
            displayTitle={displayTitle}
            openSearch={openSearch}
          />
        </div>
      )}
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function InviteButton({ onClick }: { onClick: () => void }) {
  const keybind = useKeybindLabel("admin.invite_member");
  return (
    <HoverTooltip content={
      <span className="text-xs text-rim-text whitespace-nowrap">
        Invite member{keybind && <kbd className="ml-1.5 rounded border border-rim-line bg-rim-void px-1 py-0.5 text-[10px] font-mono text-rim-text-muted">{keybind}</kbd>}
      </span>
    }>
      <button
        type="button"
        onClick={onClick}
        aria-label="Invite member"
        className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <UserPlus className="h-4 w-4" />
      </button>
    </HoverTooltip>
  );
}

function PinnedMessagesButton() {
  const pinnedPanelOpen = useShellStore((s) => s.pinnedPanelOpen);
  const setPinnedPanelOpen = useShellStore((s) => s.setPinnedPanelOpen);

  return (
    <HoverTooltip content={<span className="text-xs text-rim-text whitespace-nowrap">Pinned messages</span>}>
      <button
        type="button"
        onClick={() => setPinnedPanelOpen(!pinnedPanelOpen)}
        aria-label="Pinned messages"
        className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <Pin className="h-4 w-4" />
      </button>
    </HoverTooltip>
  );
}

function MuteToggleButton({ conversationId, workspaceId }: { conversationId: string; workspaceId: string }) {
  const isMuted = useMutedStore((s) => s.mutedIds.has(conversationId));
  const muteConversation = useMuteConversationMutation();
  const unmuteConversation = useUnmuteConversationMutation();

  const label = isMuted ? "Unmute conversation" : "Mute conversation";

  return (
    <HoverTooltip content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}>
      <button
        type="button"
        onClick={() => {
          if (isMuted) {
            unmuteConversation.mutate({ serverId: workspaceId, conversationId });
          } else {
            muteConversation.mutate({ serverId: workspaceId, conversationId });
          }
        }}
        aria-label={label}
        className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        {isMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      </button>
    </HoverTooltip>
  );
}

function ChannelSearchButton({
  conversationId,
  displayTitle,
  openSearch,
}: {
  conversationId: string;
  displayTitle: string | undefined;
  openSearch: (scope: { kind: "conversation"; conversationId: string }) => void;
}) {
  const keystroke = useKeybindLabel("workspace.search_in_channel");
  const label = keystroke ? `Search in channel (${keystroke})` : "Search in channel";

  return (
    <HoverTooltip content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}>
      <button
        type="button"
        onClick={() => openSearch({ kind: "conversation", conversationId })}
        aria-label={`Search in ${displayTitle ? `#${displayTitle}` : "channel"}`}
        className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <Search className="h-4 w-4" />
      </button>
    </HoverTooltip>
  );
}
