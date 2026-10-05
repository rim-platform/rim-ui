import { useState, useRef, useEffect, useCallback } from "react";
import { Hash, Pin, Search, BellOff, Bell, UserPlus, AlertTriangle } from "lucide-react";

import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { LensPicker } from "../../features/lenses/components/LensPicker";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspace } from "../../features/workspaces/api/useWorkspace";
import { useConversation } from "../../features/conversations/api/useConversation";
import { ChannelIcon } from "../../features/conversations/components/ChannelIcon";
import { ConversationActionsMenu } from "../../features/conversations/components/ConversationActionsMenu";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useShellStore } from "../state/useShellStore";
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
import {
  ConversationTypeEnum,
  IncidentSeverityGql,
  IncidentPhaseNameGql,
  WorkspaceFeature,
} from "../../core/graphql/generated/schema-types";
import { useMutedStore } from "../../features/conversations/state/useMutedStore";
import {
  useMuteConversationMutation,
  useUnmuteConversationMutation,
} from "../../features/conversations/api/useMuteConversation";
import { InviteDialog } from "../../features/settings/components/InviteDialog";
import { IncidentBanner } from "../../features/incidents/components/IncidentBanner";
import { useIncidentStore } from "../../features/incidents/state/useIncidentStore";
import { useActiveIncident } from "../../features/incidents/api/useIncident";
import { useFeatureEnabled } from "../../features/workspaces/hooks/useFeatureEnabled";

export function ConversationHeader() {
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
  if (
    conversation &&
    conversation.conversationType === ConversationTypeEnum.DIRECT &&
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

  // Incident mode — only when the workspace has the incidents module on (Track 0.4). The
  // query is skipped when off, and any cached incident is ignored so turning the feature off
  // mid-session clears the banner immediately.
  const incidentsEnabled = useFeatureEnabled(WorkspaceFeature.INCIDENTS);
  const { data: fetchedActiveIncident } = useActiveIncident(workspaceId, conversationId, {
    enabled: incidentsEnabled,
  });
  const activeIncidentData = incidentsEnabled ? fetchedActiveIncident : undefined;
  const setActiveIncident = useIncidentStore((s) => s.setActiveIncident);
  const activeIncident = useIncidentStore((s) => s.activeIncident);
  const setShowStartDialog = useIncidentStore((s) => s.setShowStartDialog);

  useEffect(() => {
    if (activeIncidentData) {
      setActiveIncident({
        id: activeIncidentData.id,
        title: activeIncidentData.title,
        status: activeIncidentData.status,
        severity: activeIncidentData.severity ?? IncidentSeverityGql.SEV_4,
        currentPhase: IncidentPhaseNameGql.DETECTION,
        startedAt: activeIncidentData.startedAt,
        acknowledgedAt: activeIncidentData.acknowledgedAt ?? null,
        acknowledgedByUser: activeIncidentData.acknowledgedByUser
          ? {
              id: activeIncidentData.acknowledgedByUser.id,
              username: activeIncidentData.acknowledgedByUser.username,
              displayName: activeIncidentData.acknowledgedByUser.displayName ?? null,
              avatarUrl: activeIncidentData.acknowledgedByUser.avatarUrl ?? null,
            }
          : null,
        escalationRun: activeIncidentData.escalationRun
          ? {
              currentStepIndex: activeIncidentData.escalationRun.currentStepIndex,
              nextFireAt: activeIncidentData.escalationRun.nextFireAt ?? null,
              status: activeIncidentData.escalationRun.status,
            }
          : null,
      });
    } else {
      setActiveIncident(null);
    }
  }, [activeIncidentData, setActiveIncident]);

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
    <div>
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
              </p>
            )}
          </div>
        </div>
        {conversationId && (
          <div className="flex items-center gap-1">
            {incidentsEnabled && !activeIncident && (
              <HoverTooltip
                content={
                  <span className="text-xs text-rim-text whitespace-nowrap">Start incident</span>
                }
              >
                <button
                  type="button"
                  onClick={() => setShowStartDialog(true)}
                  aria-label="Start incident"
                  className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
                >
                  <AlertTriangle className="h-4 w-4" />
                </button>
              </HoverTooltip>
            )}
            <InviteButton onClick={() => setInviteOpen(true)} />
            <MuteToggleButton conversationId={conversationId} workspaceId={workspaceId ?? ""} />
            {isChannel && workspaceId && (
              <LensPicker serverId={workspaceId} conversationId={conversationId} />
            )}
            {isChannel && <PinnedMessagesButton />}
            <ChannelSearchButton
              conversationId={conversationId}
              displayTitle={displayTitle}
              openSearch={openSearch}
            />
            {conversation && workspaceId && (
              <ConversationActionsMenu workspaceId={workspaceId} conversation={conversation} />
            )}
          </div>
        )}
        <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      </div>
      {incidentsEnabled && activeIncident && workspaceId && conversationId && (
        <IncidentBanner serverId={workspaceId} conversationId={conversationId} />
      )}
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

function MuteToggleButton({
  conversationId,
  workspaceId,
}: {
  conversationId: string;
  workspaceId: string;
}) {
  const isMuted = useMutedStore((s) => s.mutedIds.has(conversationId));
  const muteConversation = useMuteConversationMutation();
  const unmuteConversation = useUnmuteConversationMutation();

  const label = isMuted ? "Unmute conversation" : "Mute conversation";

  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}
    >
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
