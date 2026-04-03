import { Hash, MessageCircle, Search, Users } from "lucide-react";

import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspace } from "../../features/workspaces/api/useWorkspace";
import { useInboxConversations } from "../../features/conversations/api/useInboxConversations";
import { useChannels } from "../../features/conversations/api/useChannels";
import { useShellStore } from "../state/useShellStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMemberLookup } from "../../features/workspaces/hooks/useMemberLookup";
import { Avatar } from "../../shared/ui/Avatar";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { usePresenceStore, type PresenceStatus } from "../../features/presence/state/usePresenceStore";

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

  return (
    <div className="flex h-10 items-center justify-between border-b border-rim-line px-4">
      <div className="flex items-center gap-3">
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
        <div>
          <h2 className="text-sm font-medium text-rim-text">
            {displayTitle ?? (conversationId ? "Untitled" : "No conversation")}
          </h2>
          <p className="text-xs text-rim-text-faint">
            {workspace?.name ?? ""}
            {conversation && ` \u00b7 ${conversation.memberIds.length} members`}
          </p>
        </div>
      </div>
      {conversationId && (
        <ChannelSearchButton
          conversationId={conversationId}
          displayTitle={displayTitle}
          openSearch={openSearch}
        />
      )}
    </div>
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
