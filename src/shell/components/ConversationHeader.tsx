import { useState, useRef, useEffect, useCallback } from "react";
import { Hash, Pin, Search, UserPlus } from "lucide-react";

import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { LensPicker } from "../../features/lenses/components/LensPicker";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspace } from "../../features/workspaces/api/useWorkspace";
import { useConversation } from "../../features/conversations/api/useConversation";
import { useDmRequestPending } from "../../features/conversations/api/useDmRequestPending";
import { ChannelIcon } from "../../features/conversations/components/ChannelIcon";
import { ConversationActionsMenu } from "../../features/conversations/components/ConversationActionsMenu";
import { directPeerId, isInvited, pendingMembersOf } from "../../features/conversations/utils";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useShellStore, type DirectDraft } from "../state/useShellStore";
import { draftSpaceId, useDraftPeer } from "../../features/conversations/hooks/useDraftPeer";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMemberLookup } from "../../features/workspaces/hooks/useMemberLookup";
import { useUpdateTopicMutation } from "../../features/conversations/api/useUpdateTopic";
import { Avatar } from "../../shared/ui/Avatar";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import {
  usePresenceStore,
  type PresenceStatus,
} from "../../features/presence/state/usePresenceStore";
import { ConversationTypeEnum } from "../../core/graphql/generated/schema-types";
import { InviteDialog } from "../../features/settings/components/InviteDialog";
import { useIsOwner } from "../../features/workspaces/api/useMyServerRole";
import { PlaintextNotice } from "../../features/e2ee/components/PlaintextNotice";

/** The main area's header: the selected conversation, or the draft direct message. */
export function ConversationHeader() {
  const draft = useShellStore((s) => s.draftDirect);
  return draft ? <DraftDirectHeader draft={draft} /> : <SelectedConversationHeader />;
}

/** A draft direct message's header: the person, and the workspace it is in. */
function DraftDirectHeader({ draft }: { draft: DirectDraft }) {
  const peer = useDraftPeer(draft);
  const { data: workspace } = useWorkspace(draftSpaceId(draft));
  return (
    <div className="flex h-10 items-center border-b border-rim-line px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar
          url={peer.avatarUrl}
          name={peer.name || "?"}
          userId={peer.avatarKey}
          size="sm"
          presenceStatus={peer.presence}
        />
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-rim-text">{peer.name}</h2>
          <p className="text-xs text-rim-text-faint">{workspace?.name ?? ""}</p>
        </div>
      </div>
    </div>
  );
}

function SelectedConversationHeader() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const openSearch = useSearchOverlayStore((s) => s.openWithScope);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const { data: workspace } = useWorkspace(workspaceId ?? undefined);
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const isChannel = conversation?.conversationType === ConversationTypeEnum.CHANNEL;
  const toggleMembers = useMembersPanelStore((s) => s.toggle);

  // For DMs, show the other user's name instead of "Untitled"
  let displayTitle = conversation?.title ?? undefined;
  let dmOtherUserId: string | undefined;
  if (conversation && conversation.conversationType === ConversationTypeEnum.DIRECT) {
    dmOtherUserId = directPeerId(conversation, currentUserId);
    if (dmOtherUserId && !displayTitle) {
      displayTitle = memberLookup.resolve(dmOtherUserId).displayName;
    }
  }
  // Invited members wait for a device set up for encryption and are not counted as members.
  const invitedCount = conversation ? pendingMembersOf(conversation).length : 0;
  // A viewer who is only invited sees the invitation, with nothing to search or act on yet.
  const viewerInvited = Boolean(conversation && isInvited(conversation, currentUserId));

  const dmAvatarUrl = dmOtherUserId ? memberLookup.resolve(dmOtherUserId).avatarUrl : undefined;

  const peerPresence = usePresenceStore((s) =>
    dmOtherUserId ? s.presenceMap[dmOtherUserId] : undefined,
  ) as PresenceStatus | undefined;
  // Hidden while the other member has the viewer's DM as a request they have not accepted.
  const requestPending = useDmRequestPending(workspaceId, conversationId);
  const presenceStatus = requestPending ? undefined : peerPresence;

  const inviteOpen = useShellStore((s) => s.showInviteDialog);
  const setInviteOpen = useShellStore((s) => s.setShowInviteDialog);
  // Only the Owner can create invites; the server refuses everyone else.
  const canInvite = useIsOwner(workspaceId ?? undefined);

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
    if (isChannel && !conversation?.isArchived) {
      setTopicDraft(topic ?? "");
      setIsEditingTopic(true);
    }
  }, [isChannel, conversation?.isArchived, topic]);

  const handleTopicKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setIsEditingTopic(false);
      } else if (e.key === "Enter") {
        if (workspaceId && conversationId && topicDraft !== (topic ?? "")) {
          updateTopic.mutate({ serverId: workspaceId, conversationId, topic: topicDraft });
        }
        setIsEditingTopic(false);
      }
    },
    [workspaceId, conversationId, topicDraft, topic, updateTopic],
  );

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
        ) : conversation ? (
          <ChannelIcon conversation={conversation} className="h-5 w-5 text-rim-text-muted" />
        ) : (
          <Hash className="h-5 w-5 text-rim-text-muted" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-rim-text">
              {displayTitle ?? (conversationId ? "Untitled" : "No conversation")}
            </h2>
            {isChannel && conversation && (
              <button
                type="button"
                onClick={toggleMembers}
                aria-label={`${conversation.memberCount} members`}
                className="text-xs text-rim-text-faint transition hover:text-rim-text"
              >
                {conversation.memberCount} {conversation.memberCount === 1 ? "member" : "members"}
              </button>
            )}
            {conversation?.isArchived && (
              <span className="rounded border border-rim-line px-1 text-[10px] uppercase tracking-wider text-rim-text-faint">
                Archived
              </span>
            )}
            <PlaintextNotice workspaceId={workspaceId} conversationId={conversationId} />
          </div>
          {isChannel &&
            (isEditingTopic ? (
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
            ))}
          {!isChannel && (
            <p className="text-xs text-rim-text-faint">
              {workspace?.name ?? ""}
              {conversation && ` \u00b7 ${conversation.memberCount} members`}
              {invitedCount > 0 && ` \u00b7 ${invitedCount} invited`}
            </p>
          )}
        </div>
      </div>
      {conversationId && (
        <div className="flex items-center gap-1">
          {canInvite && <InviteButton onClick={() => setInviteOpen(true)} />}
          {isChannel && workspaceId && (
            <LensPicker serverId={workspaceId} conversationId={conversationId} />
          )}
          {isChannel && <PinnedMessagesButton />}
          {!viewerInvited && (
            <ChannelSearchButton
              conversationId={conversationId}
              displayTitle={displayTitle}
              openSearch={openSearch}
            />
          )}
          {conversation && workspaceId && !viewerInvited && (
            <ConversationActionsMenu workspaceId={workspaceId} conversation={conversation} />
          )}
        </div>
      )}
      <InviteDialog open={inviteOpen && canInvite} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function InviteButton({ onClick }: { onClick: () => void }) {
  const keybind = useKeybindLabel("admin.invite_member");
  return (
    <HoverTooltip
      content={
        <span className="text-xs text-rim-text whitespace-nowrap">
          Invite member
          {keybind && (
            <kbd className="ml-1.5 rounded border border-rim-line bg-rim-void px-1 py-0.5 text-[10px] font-mono text-rim-text-muted">
              {keybind}
            </kbd>
          )}
        </span>
      }
    >
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
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">Pinned messages</span>}
    >
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
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}
    >
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
