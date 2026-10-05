import { useMemo, useState } from "react";
import { UserPlus, X } from "lucide-react";

import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useCanModerate, useIsGuest } from "../../workspaces/api/useMyServerRole";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { RoleBadge, TimeoutMarker } from "../../workspaces/components/MemberBadges";
import { MemberActionsMenu } from "../../workspaces/components/MemberActionsMenu";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { useConversation } from "../api/useConversation";
import {
  useAddConversationMembersMutation,
  useRemoveConversationMemberMutation,
} from "../api/useChannelMembership";
import { useLeaveConversation } from "../hooks/useLeaveConversation";
import type { ConversationSummary } from "../types";
import {
  canInviteToConversation,
  canLeaveConversation,
  conversationLabel,
  leaveNeedsConfirmation,
} from "../utils";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { MemberPicker } from "./MemberPicker";

interface ConversationMembersPanelProps {
  workspaceId: string;
  conversationId: string;
  onClose: () => void;
}

/**
 * The open conversation's members, shown in the tool panel. Any member but a guest can invite
 * (channels and groups); Owner/Moderator can remove others and open the per-member moderation
 * menu; the viewer's own row offers Leave. Rows show the workspace role and any timeout.
 */
export function ConversationMembersPanel({
  workspaceId,
  conversationId,
  onClose,
}: ConversationMembersPanelProps) {
  const { data: conversation, isPending, isError } = useConversation(workspaceId, conversationId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
        <h2 className="truncate text-sm font-medium text-rim-text">
          Members
          {conversation && (
            <span className="ml-1 text-rim-text-faint">
              {conversationLabel(conversation)} &middot; {conversation.memberCount}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={onClose}
          title="Close members"
          aria-label="Close members"
          className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isPending && <p className="px-2 py-4 text-sm text-rim-text-muted">Loading members...</p>}
        {isError && !conversation && (
          <p className="px-2 py-4 text-sm text-rim-danger">Failed to load members.</p>
        )}
        {conversation && <MembersList workspaceId={workspaceId} conversation={conversation} />}
      </div>
    </div>
  );
}

function MembersList({
  workspaceId,
  conversation,
}: {
  workspaceId: string;
  conversation: ConversationSummary;
}) {
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId);
  const canModerate = useCanModerate(workspaceId);
  const isGuest = useIsGuest(workspaceId);
  const [inviting, setInviting] = useState(false);
  const [inviteIds, setInviteIds] = useState<string[]>([]);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const addMembers = useAddConversationMembersMutation();
  const removeMember = useRemoveConversationMemberMutation();
  const { leave, isPending: leavePending } = useLeaveConversation(workspaceId);

  const isDm = conversation.conversationType === ConversationTypeEnum.DIRECT;
  const canInvite = canInviteToConversation(conversation) && !isGuest;
  const canLeave = canLeaveConversation(conversation);
  const canRemoveOthers = canModerate && !isDm;

  const members = useMemo(
    () =>
      conversation.memberIds
        .map((userId) => ({ userId, ...memberLookup.resolve(userId) }))
        .sort((a, b) => {
          if (a.userId === currentUserId) return -1;
          if (b.userId === currentUserId) return 1;
          return a.displayName.localeCompare(b.displayName);
        }),
    [conversation.memberIds, memberLookup, currentUserId],
  );

  function handleInvite() {
    if (inviteIds.length === 0) return;
    addMembers.mutate(
      { serverId: workspaceId, conversationId: conversation.id, userIds: inviteIds },
      {
        onSuccess: () => {
          toast.success(
            inviteIds.length === 1 ? "Member added" : `${inviteIds.length} members added`,
          );
          setInviteIds([]);
          setInviting(false);
        },
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not add members")),
      },
    );
  }

  function handleRemove(userId: string) {
    removeMember.mutate(
      { serverId: workspaceId, conversationId: conversation.id, userId },
      {
        onSuccess: () => setConfirmRemoveId(null),
        onError: (err) => {
          setConfirmRemoveId(null);
          toast.error(graphqlErrorMessage(err, "Could not remove the member"));
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      {canInvite && !inviting && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex w-full items-center justify-center gap-1.5"
          onClick={() => setInviting(true)}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Invite
        </Button>
      )}

      {canInvite && inviting && (
        <div className="rounded-lg border border-rim-line bg-rim-void">
          <MemberPicker
            workspaceId={workspaceId}
            selectedUserIds={inviteIds}
            onChange={setInviteIds}
            excludeUserIds={conversation.memberIds}
            onConfirm={handleInvite}
            onEscape={() => setInviting(false)}
            autoFocus
            placeholder="Find people to invite..."
            listClassName="max-h-48"
          />
          <div className="flex justify-end gap-2 border-t border-rim-line p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setInviting(false);
                setInviteIds([]);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={inviteIds.length === 0}
              isLoading={addMembers.isPending}
              onClick={handleInvite}
            >
              Add{inviteIds.length > 0 ? ` (${inviteIds.length})` : ""}
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-0.5" aria-label="Conversation members">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          return (
            <li
              key={member.userId}
              data-testid={`member-row-${member.userId}`}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
            >
              <MemberRowAvatar
                userId={member.userId}
                name={member.displayName}
                avatarUrl={member.avatarUrl ?? null}
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-sm text-rim-text">{member.displayName}</span>
                  {isSelf && <span className="text-xs text-rim-text-faint">(you)</span>}
                  <RoleBadge role={member.role} />
                </span>
                <TimeoutMarker until={member.timeoutUntil} />
              </span>
              {isSelf && canLeave && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    leaveNeedsConfirmation(conversation)
                      ? setConfirmLeave(true)
                      : leave(conversation)
                  }
                  aria-label="Leave"
                >
                  Leave
                </Button>
              )}
              {!isSelf && canRemoveOthers && confirmRemoveId !== member.userId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => setConfirmRemoveId(member.userId)}
                  aria-label={`Remove ${member.displayName}`}
                >
                  Remove
                </Button>
              )}
              {confirmRemoveId !== member.userId && (
                <MemberActionsMenu
                  workspaceId={workspaceId}
                  member={member}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                />
              )}
              {!isSelf && confirmRemoveId === member.userId && (
                <span className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    isLoading={removeMember.isPending}
                    onClick={() => handleRemove(member.userId)}
                    aria-label={`Confirm removing ${member.displayName}`}
                  >
                    Remove
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRemoveId(null)}
                  >
                    Cancel
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {confirmLeave && (
        <ConfirmActionDialog
          title={`Leave ${conversationLabel(conversation)}?`}
          description="You will need an invite from a member to rejoin."
          confirmLabel="Leave"
          danger
          isPending={leavePending}
          onConfirm={() => {
            setConfirmLeave(false);
            leave(conversation);
          }}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

function MemberRowAvatar({
  userId,
  name,
  avatarUrl,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
}) {
  const status = usePresenceStore((s) => s.presenceMap[userId]);
  return (
    <Avatar
      url={avatarUrl}
      name={name}
      userId={userId}
      size="sm"
      presenceStatus={status === "ONLINE" || status === "AWAY" ? status : "OFFLINE"}
    />
  );
}
