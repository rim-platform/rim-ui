import { useMemo, useState } from "react";
import { UserPlus, X } from "lucide-react";

import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useCanModerate, useMyServerRole } from "../../workspaces/api/useMyServerRole";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { RoleBadge, TimeoutMarker } from "../../workspaces/components/MemberBadges";
import { MemberMenuButton } from "../../workspaces/components/MemberMenuButton";
import { useUserContextMenu } from "../../workspaces/hooks/useUserContextMenu";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { ContactPicker, type PickedContact } from "../../relay/components/ContactPicker";
import {
  NotReadyError,
  notReadyNames,
  resolveDirectMembers,
  type ResolvedDirectMember,
} from "../../relay/conversations/startDirect";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { joinNames } from "../../e2ee/utils/names";
import { useConversation } from "../api/useConversation";
import {
  useAddConversationMembersMutation,
  useAddDirectConversationMembersMutation,
  useRemoveConversationMemberMutation,
} from "../api/useChannelMembership";
import { useLeaveConversation } from "../hooks/useLeaveConversation";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import type { ConversationSummary } from "../types";
import {
  canInviteTo,
  canLeaveConversation,
  conversationLabel,
  leaveNeedsConfirmation,
  pendingMembersOf,
  untitledGroupName,
} from "../utils";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { MemberPicker } from "./MemberPicker";

interface ConversationMembersPanelProps {
  workspaceId: string;
  conversationId: string;
  onClose: () => void;
}

/**
 * The open conversation's members, shown in the tool panel. Members add people to channels and
 * groups where the server lets them (`canInviteTo`); in the direct space every member of a group,
 * picking contacts and workspace people by principal id. Owner/Moderator can remove others; the
 * viewer's own row offers Leave. Rows show the workspace role and any timeout, and open the
 * person's menu on a right click, the ContextMenu key, a long press or their actions button. No
 * role badges in the direct space, where everyone is a guest.
 */
export function ConversationMembersPanel({
  workspaceId,
  conversationId,
  onClose,
}: ConversationMembersPanelProps) {
  const { data: conversation, isPending, isError } = useConversation(workspaceId, conversationId);
  const currentUserId = useAuthStore((st) => st.session?.userId);
  const memberLookup = useMemberLookup(workspaceId);
  // Invited members wait for a device set up for encryption and are not counted as members.
  const invitedCount = conversation ? pendingMembersOf(conversation).length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
        <h2 className="truncate text-sm font-medium text-rim-text">
          Members
          {conversation && (
            <span className="ml-1 text-rim-text-faint">
              {conversation.conversationType === ConversationTypeEnum.GROUP && !conversation.title
                ? (untitledGroupName(
                    conversation,
                    currentUserId,
                    (id) => memberLookup.resolve(id).displayName,
                  ) ?? conversationLabel(conversation))
                : conversationLabel(conversation)}{" "}
              &middot; {conversation.memberCount}
              {invitedCount > 0 && ` \u00b7 ${invitedCount} invited`}
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
  const role = useMyServerRole(workspaceId);
  const { info } = useServerInfo();
  const { data: workspaceMembers } = useServerMembers(workspaceId);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const [inviteIds, setInviteIds] = useState<string[]>([]);
  const [invitePeople, setInvitePeople] = useState<PickedContact[]>([]);
  const [resolving, setResolving] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const addMembers = useAddConversationMembersMutation();
  const addDirect = useAddDirectConversationMembersMutation();
  const removeMember = useRemoveConversationMemberMutation();
  const { leave, isPending: leavePending } = useLeaveConversation(workspaceId);

  const isDm = conversation.conversationType === ConversationTypeEnum.DIRECT;
  const canInvite = canInviteTo(conversation, {
    userId: currentUserId,
    role,
    inDirectSpace,
    defaultWorkspaceId: info?.defaultWorkspace,
  });
  const canLeave = canLeaveConversation(conversation);
  const canRemoveOthers = canModerate && !isDm;
  const userMenu = useUserContextMenu({
    workspaceId,
    conversation,
    onRemoveFromConversation: canRemoveOthers ? setConfirmRemoveId : undefined,
  });

  // The picker can also be opened from a conversation menu, which opens the panel with it.
  const inviting = useMembersPanelStore((s) => s.invitingIn === conversation.id);
  const { openInvite, closeInvite } = useMembersPanelStore.getState();

  // Members first, then whoever is invited and waits for a device set up for encryption; the
  // viewer leads their group.
  const pendingIds = useMemo(() => pendingMembersOf(conversation), [conversation]);
  const members = useMemo(() => {
    const byName = (a: { userId: string; displayName: string }, b: typeof a) => {
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      return a.displayName.localeCompare(b.displayName);
    };
    const rows = (ids: string[], pending: boolean) =>
      ids.map((userId) => ({ userId, pending, ...memberLookup.resolve(userId) })).sort(byName);
    return [...rows(conversation.memberIds, false), ...rows(pendingIds, true)];
  }, [conversation.memberIds, pendingIds, memberLookup, currentUserId]);

  // The principal ids of everyone in the conversation or invited, left out of the contact picker.
  const memberPrincipalIds = useMemo(() => {
    const ids = new Set([...conversation.memberIds, ...pendingIds]);
    return (workspaceMembers ?? []).flatMap((m) =>
      ids.has(m.userId) && m.principalId ? [m.principalId] : [],
    );
  }, [conversation.memberIds, pendingIds, workspaceMembers]);

  const pickedCount = inDirectSpace ? invitePeople.length : inviteIds.length;

  function cancelInvite() {
    closeInvite();
    setInviteIds([]);
    setInvitePeople([]);
  }

  function handleInvite() {
    if (inviteIds.length === 0) return;
    addMembers.mutate(
      { serverId: workspaceId, conversationId: conversation.id, userIds: inviteIds },
      {
        onSuccess: (updated) => {
          const waiting = pendingMembersOf(updated).filter((id) => inviteIds.includes(id));
          const added =
            inviteIds.length === 1 ? "Member added" : `${inviteIds.length} members added`;
          if (waiting.length === 0) toast.success(added);
          else {
            const names = joinNames(waiting.map((id) => memberLookup.resolve(id).displayName));
            toast.success(added, {
              description: `${names} ${waiting.length === 1 ? "joins" : "join"} once they set up a device for encryption.`,
            });
          }
          setInviteIds([]);
          closeInvite();
        },
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not add members")),
      },
    );
  }

  async function handleAddDirect() {
    if (invitePeople.length === 0) return;
    setResolving(true);
    let resolved: ResolvedDirectMember[];
    try {
      resolved = await resolveDirectMembers(
        invitePeople.map((p) => ({
          principalId: p.principalId,
          relayUrls: p.relayUrls,
          name: p.name,
        })),
      );
    } catch (err) {
      toast.error(graphqlErrorMessage(err, "Could not add members"));
      return;
    } finally {
      setResolving(false);
    }
    const missing = notReadyNames(resolved, true);
    if (conversation.encryptedAt && missing.length > 0) {
      toast.error(new NotReadyError(missing).message);
      return;
    }
    const n = resolved.length;
    addDirect.mutate(
      {
        serverId: workspaceId,
        conversationId: conversation.id,
        remoteMembers: resolved.map((r) => ({
          principalId: r.member.principalId,
          relayUrls: r.relayUrls,
        })),
      },
      {
        onSuccess: () => {
          toast.success(n === 1 ? "Member added" : `${n} members added`);
          setInvitePeople([]);
          closeInvite();
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
          onClick={() => openInvite(conversation.id)}
        >
          <UserPlus className="h-3.5 w-3.5" />
          {conversation.conversationType === ConversationTypeEnum.CHANNEL ? "Invite" : "Add people"}
        </Button>
      )}

      {canInvite && inviting && (
        <div className="rounded-lg border border-rim-line bg-rim-void">
          {inDirectSpace ? (
            <ContactPicker
              selected={invitePeople}
              onChange={setInvitePeople}
              onConfirm={() => void handleAddDirect()}
              onEscape={cancelInvite}
              excludePrincipalIds={memberPrincipalIds}
            />
          ) : (
            <MemberPicker
              workspaceId={workspaceId}
              selectedUserIds={inviteIds}
              onChange={setInviteIds}
              excludeUserIds={[...conversation.memberIds, ...pendingIds]}
              onConfirm={handleInvite}
              onEscape={closeInvite}
              autoFocus
              placeholder="Find people to invite..."
              listClassName="max-h-48"
            />
          )}
          <div className="flex justify-end gap-2 border-t border-rim-line p-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelInvite}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pickedCount === 0}
              isLoading={inDirectSpace ? addDirect.isPending || resolving : addMembers.isPending}
              onClick={inDirectSpace ? () => void handleAddDirect() : handleInvite}
            >
              Add{pickedCount > 0 ? ` (${pickedCount})` : ""}
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-0.5" aria-label="Conversation members">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const target = { userId: member.userId, displayName: member.displayName };
          return (
            <li
              key={member.userId}
              data-testid={`member-row-${member.userId}`}
              {...userMenu.bind(target)}
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
                  <RoleBadge role={inDirectSpace ? null : member.role} />
                  {member.pending && (
                    <span className="shrink-0 rounded border border-rim-accent/40 px-1 text-[10px] uppercase tracking-wider text-rim-accent">
                      Invited
                    </span>
                  )}
                </span>
                <TimeoutMarker until={member.timeoutUntil} />
                {member.pending && (
                  <span className="block text-[11px] text-rim-text-faint">
                    Waiting for a device set up for encryption
                  </span>
                )}
              </span>
              {isSelf && canLeave && !member.pending && (
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
                <MemberMenuButton
                  name={member.displayName}
                  onOpen={(button) => userMenu.openUnder(button, target)}
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
      {userMenu.element}

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
