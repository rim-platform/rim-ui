import { Hash, MessageCircle, Users } from "lucide-react";

import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspace } from "../../features/workspaces/api/useWorkspace";
import { useInboxConversations } from "../../features/conversations/api/useInboxConversations";
import { useChannels } from "../../features/conversations/api/useChannels";
import { useShellStore } from "../state/useShellStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMemberLookup } from "../../features/workspaces/hooks/useMemberLookup";
type ConversationTypeEnum = "CHANNEL" | "DIRECT" | "GROUP";

const typeIcon: Record<ConversationTypeEnum, typeof Hash> = {
  CHANNEL: Hash,
  DIRECT: MessageCircle,
  GROUP: Users,
};

export function ConversationHeader() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
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
  if (
    conversation &&
    !displayTitle &&
    conversation.conversationType === "DIRECT" &&
    conversation.memberIds.length > 0
  ) {
    const otherMemberId =
      conversation.memberIds.find((id) => id !== currentUserId) ?? conversation.memberIds[0];
    displayTitle = memberLookup.resolve(otherMemberId).displayName;
  }

  return (
    <div className="flex items-center border-b border-rim-line px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-rim-text-muted" />
        <div>
          <h2 className="text-sm font-medium text-white">
            {displayTitle ?? (conversationId ? "Untitled" : "No conversation")}
          </h2>
          <p className="text-xs text-rim-text-faint">
            {workspace?.name ?? ""}
            {conversation && ` \u00b7 ${conversation.memberIds.length} members`}
          </p>
        </div>
      </div>
    </div>
  );
}
