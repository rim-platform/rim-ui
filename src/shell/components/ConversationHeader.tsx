import { useRef, useEffect, useCallback } from "react";
import { ArrowLeft, Hash, Pin, Search, UserPlus } from "lucide-react";

import { LensPicker } from "../../features/lenses/components/LensPicker";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspace } from "../../features/workspaces/api/useWorkspace";
import { useConversation } from "../../features/conversations/api/useConversation";
import { useDmRequestPending } from "../../features/conversations/api/useDmRequestPending";
import { ChannelIcon } from "../../features/conversations/components/ChannelIcon";
import { ConversationActionsMenu } from "../../features/conversations/components/ConversationActionsMenu";
import {
  canEditChannelTopic,
  directPeerId,
  isInvited,
  memberCountLabel,
  pendingMembersOf,
  untitledGroupName,
} from "../../features/conversations/utils";
import { useTopicEditStore } from "../../features/conversations/state/useTopicEditStore";
import { useShellStore, type DirectDraft } from "../state/useShellStore";
import { draftSpaceId, useDraftPeer } from "../../features/conversations/hooks/useDraftPeer";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMemberLookup } from "../../features/workspaces/hooks/useMemberLookup";
import { useUpdateTopicMutation } from "../../features/conversations/api/useUpdateTopic";
import { Avatar } from "../../shared/ui/Avatar";
import { HoverTooltip } from "../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../features/commands/hooks/useKeybindLabel";
import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useAgentsReadingChannel } from "../../features/agents/hooks/useAgentsReadingChannel";
import { botsInChannel, useWorkspaceBots } from "../../features/bots/hooks/useWorkspaceBots";
import type { ConversationSummary } from "../../features/conversations/types";
import {
  usePresenceStore,
  type PresenceStatus,
} from "../../features/presence/state/usePresenceStore";
import { ConversationTypeEnum } from "../../core/graphql/generated/schema-types";
import { InviteDialog } from "../../features/settings/components/InviteDialog";
import { useCanModerate, useIsOwner } from "../../features/workspaces/api/useMyServerRole";
import { PlaintextNotice } from "../../features/e2ee/components/PlaintextNotice";
import {
  useApplicableDirectOrigin,
  workspaceNameOf,
} from "../../features/conversations/state/directOrigin";
import { useMyServers } from "../../features/workspaces/api/useMyServers";
import { useRelayStore } from "../../features/relay/state/useRelayStore";
import { useShellWidth } from "../hooks/useShellWidth";
import { cn } from "../../shared/ui/cn";

/** The main area's header: the selected conversation, or the draft direct message. */
export function ConversationHeader() {
  const draft = useShellStore((s) => s.draftDirect);
  return draft ? <DraftDirectHeader draft={draft} /> : <SelectedConversationHeader />;
}

/** A draft direct message's header: the person, and the workspace it is in. */
function DraftDirectHeader({ draft }: { draft: DirectDraft }) {
  const peer = useDraftPeer(draft);
  const { data: workspace } = useWorkspace(draftSpaceId(draft));
  const narrow = useShellWidth() === "narrow";
  return (
    <div
      className={cn(
        "flex items-center border-b border-rim-line px-4",
        narrow ? "h-auto min-h-10 flex-wrap py-1" : "h-10",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <BackToWorkspaceButton />
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
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const { data: workspace } = useWorkspace(workspaceId ?? undefined);
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const isChannel = conversation?.conversationType === ConversationTypeEnum.CHANNEL;
  const narrow = useShellWidth() === "narrow";

  // A DM shows the other person's name, a group without a title its members' names.
  let displayTitle = conversation?.title ?? undefined;
  if (
    conversation &&
    !displayTitle &&
    conversation.conversationType === ConversationTypeEnum.GROUP
  ) {
    displayTitle =
      untitledGroupName(
        conversation,
        currentUserId,
        (id) => memberLookup.resolve(id).displayName,
      ) ?? undefined;
  }
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

  const canModerate = useCanModerate(workspaceId ?? undefined);
  const canEditTopic = conversation
    ? canEditChannelTopic(conversation, { userId: currentUserId, canModerate })
    : false;
  const topic = conversation?.topic ?? null;
  const isEditingTopic = useTopicEditStore(
    (s) => conversationId !== null && s.conversationId === conversationId,
  );
  const topicDraft = useTopicEditStore((s) => s.draft);
  const {
    start: startTopicEdit,
    setDraft: setTopicDraft,
    stop: stopTopicEdit,
  } = useTopicEditStore.getState();
  const topicInputRef = useRef<HTMLInputElement>(null);
  const updateTopic = useUpdateTopicMutation();

  // The edit can start from a menu before the channel has loaded.
  const showTopicInput = isChannel && isEditingTopic && canEditTopic;
  useEffect(() => {
    if (showTopicInput && topicInputRef.current) {
      topicInputRef.current.focus();
    }
  }, [showTopicInput]);

  const handleTopicClick = useCallback(() => {
    if (conversationId && canEditTopic) {
      startTopicEdit(conversationId, topic ?? "");
    }
  }, [conversationId, canEditTopic, topic, startTopicEdit]);

  const handleTopicKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        stopTopicEdit();
      } else if (e.key === "Enter") {
        if (workspaceId && conversationId && topicDraft !== (topic ?? "")) {
          updateTopic.mutate({ serverId: workspaceId, conversationId, topic: topicDraft });
        }
        stopTopicEdit();
      }
    },
    [workspaceId, conversationId, topicDraft, topic, updateTopic, stopTopicEdit],
  );

  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-rim-line px-4",
        narrow ? "h-auto min-h-10 flex-wrap gap-y-1 py-1" : "h-10",
      )}
    >
      <div className={cn("flex min-w-0 items-center gap-3", narrow && "w-full")}>
        <BackToWorkspaceButton />
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
        ) : conversationId ? (
          <Hash className="h-5 w-5 text-rim-text-muted" />
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium text-rim-text">
              {displayTitle ?? (conversationId ? "Untitled" : "No conversation")}
            </h2>
            {isChannel && conversation && (
              <button
                type="button"
                onClick={() => void runCommandFromClick("workspace.toggle_conversation_members")}
                aria-label={memberCountLabel(conversation.memberCount)}
                className="whitespace-nowrap text-xs text-rim-text-faint transition hover:text-rim-text"
              >
                {memberCountLabel(conversation.memberCount)}
              </button>
            )}
            {conversation?.isArchived && (
              <span className="rounded border border-rim-line px-1 text-[10px] uppercase tracking-wider text-rim-text-faint">
                Archived
              </span>
            )}
            <PlaintextNotice workspaceId={workspaceId} conversationId={conversationId} />
          </div>
          {isChannel && (
            <div className="flex min-w-0 items-center gap-1.5">
              {showTopicInput ? (
                <input
                  ref={topicInputRef}
                  type="text"
                  value={topicDraft}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  onKeyDown={handleTopicKeyDown}
                  onBlur={stopTopicEdit}
                  placeholder="Set a topic..."
                  className="w-full bg-transparent text-xs text-rim-text-muted outline-none placeholder:text-rim-text-faint"
                />
              ) : canEditTopic ? (
                <button
                  type="button"
                  onClick={handleTopicClick}
                  className="block max-w-[400px] truncate text-xs text-rim-text-muted hover:text-rim-text"
                >
                  {topic || "Set a topic..."}
                </button>
              ) : topic ? (
                <p
                  className="block max-w-[400px] truncate text-xs text-rim-text-muted"
                  title={topic}
                >
                  {topic}
                </p>
              ) : null}
              {workspaceId && conversation && (
                <ChannelBotsLine workspaceId={workspaceId} conversation={conversation} />
              )}
            </div>
          )}
          {!isChannel && (
            <p className="text-xs text-rim-text-faint">
              {workspace?.name ?? ""}
              {conversation && ` \u00b7 ${memberCountLabel(conversation.memberCount)}`}
              {invitedCount > 0 && ` \u00b7 ${invitedCount} invited`}
            </p>
          )}
        </div>
      </div>
      {conversationId && (
        <div className="flex shrink-0 items-center gap-1">
          {canInvite && <InviteButton />}
          {isChannel && workspaceId && (
            <LensPicker serverId={workspaceId} conversationId={conversationId} />
          )}
          {isChannel && <PinnedMessagesButton />}
          {!viewerInvited && (
            <ConversationSearchButton displayTitle={displayTitle} isChannel={isChannel} />
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

/**
 * Returns to the workspace and conversation the shown DM was opened from; renders nothing when
 * it was not opened from one, or that workspace is no longer the viewer's.
 */
function BackToWorkspaceButton() {
  const origin = useApplicableDirectOrigin();
  const { data: servers } = useMyServers();
  const spaces = useRelayStore((s) => s.spaces);
  const forked = useRelayStore((s) => s.forked);
  const keybind = useKeybindLabel("workspace.back_to_workspace");
  const name = origin ? workspaceNameOf(origin.workspaceId, servers, spaces, forked) : null;
  if (!name) return null;
  return (
    <HoverTooltip
      content={
        <span className="text-xs text-rim-text whitespace-nowrap">
          Back to {name}
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
        onClick={() => void runCommandFromClick("workspace.back_to_workspace")}
        aria-label={`Back to ${name}`}
        className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="max-w-[180px] truncate">Back to {name}</span>
      </button>
    </HoverTooltip>
  );
}

/** Invite member: runs the invite command, which opens the invite dialog. */
function InviteButton() {
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
        onClick={() => void runCommandFromClick("admin.invite_member")}
        aria-label="Invite member"
        className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <UserPlus className="h-4 w-4" />
      </button>
    </HoverTooltip>
  );
}

/**
 * After a channel's topic: how many active bots are members, which opens Bots in this channel,
 * and, when a program connected on this device may read the channel, that it can. Nothing for an
 * encrypted channel, which a bot cannot join, or one with neither.
 */
function ChannelBotsLine({
  workspaceId,
  conversation,
}: {
  workspaceId: string;
  conversation: ConversationSummary;
}) {
  const bots = botsInChannel(useWorkspaceBots(workspaceId), conversation);
  const agents = useAgentsReadingChannel(workspaceId, conversation);
  const botsPanelOpen = useShellStore((s) => s.botsPanelOpen);
  const keystroke = useKeybindLabel("workspace.toggle_channel_bots");
  if (bots.length === 0 && agents.length === 0) return null;
  const count = bots.length === 1 ? "1 bot" : `${bots.length} bots`;
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-rim-text-faint">
      {bots.length > 0 && (
        <button
          type="button"
          onClick={() => void runCommandFromClick("workspace.toggle_channel_bots")}
          aria-expanded={botsPanelOpen}
          aria-keyshortcuts={keystroke ?? undefined}
          className="transition hover:text-rim-text"
        >
          {count}
        </button>
      )}
      {bots.length > 0 && agents.length > 0 && <span aria-hidden>·</span>}
      {agents.length > 0 && (
        <button
          type="button"
          onClick={() => {
            if (!botsPanelOpen) void runCommandFromClick("workspace.toggle_channel_bots");
          }}
          className="transition hover:text-rim-text"
        >
          {agents.length === 1 ? "your agent can read this" : "your agents can read this"}
        </button>
      )}
    </span>
  );
}

function PinnedMessagesButton() {
  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">Pinned messages</span>}
    >
      <button
        type="button"
        onClick={() => void runCommandFromClick("workspace.toggle_pinned_messages")}
        aria-label="Pinned messages"
        className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <Pin className="h-4 w-4" />
      </button>
    </HoverTooltip>
  );
}

/** Search in the open conversation: runs the command that opens search scoped to it. */
function ConversationSearchButton({
  displayTitle,
  isChannel,
}: {
  displayTitle: string | undefined;
  isChannel: boolean;
}) {
  const keystroke = useKeybindLabel("workspace.search_in_channel");
  const noun = isChannel ? "channel" : "conversation";
  const label = keystroke ? `Search in ${noun} (${keystroke})` : `Search in ${noun}`;
  const accessibleName = displayTitle
    ? `Search in ${isChannel ? `#${displayTitle}` : displayTitle}`
    : `Search in ${isChannel ? "channel" : "this conversation"}`;

  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}
    >
      <button
        type="button"
        onClick={() => void runCommandFromClick("workspace.search_in_channel")}
        aria-label={accessibleName}
        className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <Search className="h-4 w-4" />
      </button>
    </HoverTooltip>
  );
}
