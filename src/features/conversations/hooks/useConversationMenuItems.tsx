import { useCallback, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { ConversationTypeEnum, PostingPolicy } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { detectPlatform } from "../../../core/runtime/runtime";
import type { HoverTarget } from "../../../shell/state/useHoverContextStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { AgentEncryptedWarning } from "../../agent/encrypted/AgentEncryptedSwitch";
import { agentSwitchLabel, useAgentEncryptedStore } from "../../agent/state/useAgentEncryptedStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  QUICK_ACCESS_SHORTCUT,
  useQuickAccessStore,
} from "../../commands/state/useQuickAccessStore";
import { useDeviceReadyForEncryption } from "../../e2ee/hooks/useE2eeConversation";
import { useConversationNotificationItems } from "../../notifications/hooks/useConversationNotificationItems";
import { useContacts, useRemoveContact } from "../../relay/api/useContacts";
import { useAddMemberContact } from "../../relay/contacts/useAddMemberContact";
import { isDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import { useCanModerate, useIsGuest, useMyServerRole } from "../../workspaces/api/useMyServerRole";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  useJoinChannelMutation,
  useSetConversationArchivedMutation,
} from "../api/useChannelMembership";
import {
  useAcceptConversationInviteMutation,
  useDeclineConversationInviteMutation,
} from "../api/useConversationInvite";
import { cachedChannelPosting } from "../api/useChannelPosting";
import { useMarkAsRead } from "../api/useMarkAsRead";
import { formatSlowModeInterval } from "../api/useSlowMode";
import { ChannelPostingDialog } from "../components/ChannelPostingDialog";
import { ConfirmActionDialog } from "../components/ConfirmActionDialog";
import { SlowModeDialog } from "../components/SlowModeDialog";
import { archiveConfirmation, leaveConfirmation } from "../conversationActionTexts";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import { useTopicEditStore } from "../state/useTopicEditStore";
import { useUnreadStore } from "../state/useUnreadStore";
import type { ConversationSummary } from "../types";
import {
  canEditChannelTopic,
  canInviteTo,
  canLeaveConversation,
  conversationLabel,
  directPeerId,
  isInvited,
  leaveNeedsConfirmation,
} from "../utils";
import { useLeaveConversation } from "./useLeaveConversation";
import { useOpenConversation } from "./useOpenConversation";

/** Where a conversation's menu is opened from. */
export interface ConversationMenuOptions {
  /**
   * The conversation header's "…" menu, about the open conversation: Members toggles the
   * members panel and is offered on a DM too, and the desktop app adds the agent's switch for
   * an encrypted conversation.
   */
  header?: boolean;
  /** The conversation's name as the row shows it, which the keybind assigner shows too. */
  label?: string;
}

type PendingDialog = {
  kind: "archive" | "leave" | "slow-mode" | "posting" | "agent";
  conversation: ConversationSummary;
};

/**
 * The menu of a conversation, the same from its sidebar row and from the conversation
 * header's "…" button. Items the viewer cannot use are left out.
 *
 * - An invitation the viewer holds: Accept (on a device set up for encryption) and Decline.
 * - A channel: Join channel first for a public one the viewer is not in, then Mark as read
 *   (when unread), Notifications, Members, Invite people…, Edit topic… (Owner, Moderator or a
 *   private channel's creator), Assign keybind…, the
 *   Owner/Moderator's Moderation section (Slow mode…, Who can post… unless the server has no
 *   posting policies, Archive channel… or Unarchive channel),
 *   and Leave channel. An archived channel has only Members, Unarchive channel and Leave.
 * - A group: Mark as read, Notifications, Members, Add people… (also in Direct messages),
 *   Assign keybind…, Leave group….
 * - A DM: Mark as read, Notifications, Add to contacts or Remove from contacts (while the
 *   relay is on), Assign keybind….
 *
 * @param workspaceId The workspace the list or header shows, whose role gates the moderation
 *   and whose notification settings and mutes stay loaded. A conversation's actions go to its
 *   own `serverId`.
 * @returns `getItems`, the items for a conversation when its menu opens, and `dialogs`, the
 *   confirmations and the slow-mode and posting dialogs to render beside the surface.
 */
export function useConversationMenuItems(workspaceId: string | null): {
  getItems: (
    conversation: ConversationSummary,
    options?: ConversationMenuOptions,
  ) => DropdownMenuItem[];
  dialogs: ReactNode;
} {
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const canModerate = useCanModerate(workspaceId ?? undefined);
  const isGuest = useIsGuest(workspaceId ?? undefined);
  const role = useMyServerRole(workspaceId ?? undefined);
  const { info } = useServerInfo();
  const notificationItems = useConversationNotificationItems(workspaceId);
  const deviceReady = useDeviceReadyForEncryption();
  const { mutate: markAsRead } = useMarkAsRead();
  const { mutate: join } = useJoinChannelMutation();
  const setArchived = useSetConversationArchivedMutation();
  const { mutate: archive } = setArchived;
  const { leave, isPending: leavePending } = useLeaveConversation(workspaceId);
  const { mutate: acceptInvite } = useAcceptConversationInviteMutation();
  const { mutate: declineInvite } = useDeclineConversationInviteMutation();
  const { data: contacts } = useContacts();
  const myPrincipalId = useRelayStore((s) => s.account?.principalId ?? null);
  const { addContact } = useAddMemberContact();
  const { mutate: removeContact } = useRemoveContact();
  const openConversation = useOpenConversation();
  const [pending, setPending] = useState<PendingDialog | null>(null);

  const runSetArchived = useCallback(
    (conversation: ConversationSummary, archived: boolean) => {
      const label = conversationLabel(conversation);
      archive(
        { serverId: conversation.serverId, conversationId: conversation.id, archived },
        {
          onSuccess: () => {
            setPending(null);
            toast.success(archived ? `Archived ${label}` : `Unarchived ${label}`);
          },
          onError: (err) => {
            setPending(null);
            toast.error(
              graphqlErrorMessage(
                err,
                archived ? "Could not archive the channel" : "Could not unarchive the channel",
              ),
            );
          },
        },
      );
    },
    [archive],
  );

  const getItems = useCallback(
    (conversation: ConversationSummary, options: ConversationMenuOptions = {}) => {
      const { header = false, label } = options;
      const serverId = conversation.serverId;
      const conversationId = conversation.id;
      const vars = { serverId, conversationId };

      if (isInvited(conversation, currentUserId)) {
        const items: DropdownMenuItem[] = [];
        if (deviceReady) {
          items.push({
            id: "accept-invite",
            label: "Accept",
            onSelect: () =>
              acceptInvite(vars, {
                onError: (err) =>
                  toast.error(graphqlErrorMessage(err, "Could not join the conversation")),
              }),
          });
        }
        items.push({
          id: "decline-invite",
          label: "Decline",
          onSelect: () =>
            declineInvite(vars, {
              onError: (err) =>
                toast.error(graphqlErrorMessage(err, "Could not decline the invitation")),
            }),
        });
        return items;
      }

      const isChannel = conversation.conversationType === ConversationTypeEnum.CHANNEL;
      const isDm = conversation.conversationType === ConversationTypeEnum.DIRECT;
      const archived = isChannel && conversation.isArchived;
      const peer = isDm ? peerOf(conversation) : undefined;
      // Opens the conversation of a sidebar row, unless it is the one shown already.
      const show = () => {
        if (!isShown(serverId, conversationId)) openConversation(conversationId, serverId);
      };

      const items: DropdownMenuItem[] = [];

      if (isChannel && !conversation.isMember && !conversation.isPrivate && !archived && !isGuest) {
        items.push({
          id: "join-channel",
          label: "Join channel",
          onSelect: () =>
            join(vars, {
              onError: (err) => toast.error(graphqlErrorMessage(err, "Could not join the channel")),
            }),
        });
      }

      if (!archived && (useUnreadStore.getState().counts[conversationId] ?? 0) > 0) {
        items.push({
          id: "mark-read",
          label: "Mark as read",
          onSelect: () =>
            markAsRead({
              conversationId,
              workspaceId: serverId,
              readAt: new Date().toISOString(),
            }),
        });
      }

      if (!archived && conversation.isMember) items.push(...notificationItems(conversation));

      if (!isDm || header) {
        items.push({
          id: "members",
          label: "Members",
          onSelect: () => {
            if (header) {
              useMembersPanelStore.getState().toggle();
              return;
            }
            show();
            useMembersPanelStore.getState().setOpen(true);
          },
        });
      }

      if (
        !archived &&
        canInviteTo(conversation, {
          userId: currentUserId,
          role,
          inDirectSpace: isDirectSpace(conversation.serverId),
          defaultWorkspaceId: info?.defaultWorkspace,
        })
      ) {
        items.push({
          id: "invite",
          label: isChannel ? "Invite people…" : "Add people…",
          onSelect: () => {
            show();
            useMembersPanelStore.getState().openInvite(conversationId);
          },
        });
      }

      if (
        isChannel &&
        !archived &&
        canEditChannelTopic(conversation, {
          userId: currentUserId,
          canModerate: canModerate && serverId === workspaceId,
        })
      ) {
        items.push({
          id: "edit-topic",
          label: "Edit topic…",
          onSelect: () => {
            show();
            useTopicEditStore.getState().start(conversationId, conversation.topic ?? "");
          },
        });
      }

      const peerPrincipal = peer?.principalId ?? null;
      if (peer && peerPrincipal && contacts && myPrincipalId && peerPrincipal !== myPrincipalId) {
        const name = peer.displayName || peer.username || "this person";
        const isContact = contacts.some((c) => c.principalId === peerPrincipal);
        items.push(
          isContact
            ? {
                id: "remove-contact",
                label: "Remove from contacts",
                onSelect: () =>
                  removeContact(peerPrincipal, {
                    onSuccess: () => toast.success(`Removed ${name} from your contacts`),
                    onError: (err) =>
                      toast.error(graphqlErrorMessage(err, `Could not remove ${name}`)),
                  }),
              }
            : {
                id: "add-contact",
                label: "Add to contacts",
                onSelect: () => void addContact(peerPrincipal, name),
              },
        );
      }

      // The agent runs in the desktop app only.
      if (header && detectPlatform() === "desktop" && conversation.encryptedAt) {
        const allowed = conversationId in useAgentEncryptedStore.getState().allowed;
        items.push({
          id: "agent",
          label: agentSwitchLabel(allowed),
          onSelect: () => {
            if (allowed) useAgentEncryptedStore.getState().setAllowed(conversationId, false);
            else setPending({ kind: "agent", conversation });
          },
        });
      }

      if (!archived) {
        const target: HoverTarget = {
          kind: isDm ? "dm" : "channel",
          conversationId,
          serverId,
          label: label || conversation.title || peer?.displayName || peer?.username || "Untitled",
        };
        items.push({
          id: "assign-keybind",
          label: "Assign keybind…",
          shortcut: QUICK_ACCESS_SHORTCUT,
          onSelect: () => useQuickAccessStore.getState().open(target),
        });
      }

      // Channels live in the workspace shown, whose role is the one known here.
      if (isChannel && canModerate && serverId === workspaceId) {
        const moderation: DropdownMenuItem[] = [];
        if (!archived) {
          moderation.push({
            id: "slow-mode",
            label: "Slow mode…",
            detail:
              conversation.slowModeSeconds > 0
                ? formatSlowModeInterval(conversation.slowModeSeconds)
                : undefined,
            onSelect: () => setPending({ kind: "slow-mode", conversation }),
          });
          const posting = cachedChannelPosting(qc, serverId, conversationId);
          if (posting?.supported !== false) {
            moderation.push({
              id: "posting",
              label: "Who can post…",
              detail: posting?.policy === PostingPolicy.MODERATORS ? "Moderators" : undefined,
              onSelect: () => setPending({ kind: "posting", conversation }),
            });
          }
        }
        moderation.push(
          archived
            ? {
                id: "unarchive",
                label: "Unarchive channel",
                onSelect: () => runSetArchived(conversation, false),
              }
            : {
                id: "archive",
                label: "Archive channel…",
                onSelect: () => setPending({ kind: "archive", conversation }),
              },
        );
        moderation[0] = { ...moderation[0], separatorBefore: true, sectionBefore: "Moderation" };
        items.push(...moderation);
      }

      if (canLeaveConversation(conversation)) {
        const confirm = leaveNeedsConfirmation(conversation);
        const what = isChannel ? "Leave channel" : "Leave group";
        items.push({
          id: "leave",
          label: confirm ? `${what}…` : what,
          danger: true,
          separatorBefore: true,
          onSelect: () => {
            if (confirm) setPending({ kind: "leave", conversation });
            else leave(conversation);
          },
        });
      }

      return items;

      /** The other person of a DM, from the member list of its workspace as cached. */
      function peerOf(dm: ConversationSummary): ServerMember | undefined {
        const peerId = directPeerId(dm, currentUserId);
        return qc
          .getQueryData<ServerMember[]>(queryKeys.serverMembers(dm.serverId))
          ?.find((m) => m.userId === peerId);
      }
    },
    [
      qc,
      currentUserId,
      deviceReady,
      acceptInvite,
      declineInvite,
      isGuest,
      role,
      info,
      canModerate,
      workspaceId,
      join,
      markAsRead,
      notificationItems,
      openConversation,
      contacts,
      myPrincipalId,
      removeContact,
      addContact,
      runSetArchived,
      leave,
    ],
  );

  const pendingLabel = pending ? conversationLabel(pending.conversation) : "";
  const dialogs = (
    <>
      {pending?.kind === "archive" && (
        <ConfirmActionDialog
          {...archiveConfirmation(pendingLabel)}
          danger
          isPending={setArchived.isPending}
          onConfirm={() => runSetArchived(pending.conversation, true)}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "agent" && (
        <AgentEncryptedWarning
          conversationId={pending.conversation.id}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "slow-mode" && (
        <SlowModeDialog
          workspaceId={pending.conversation.serverId}
          conversation={pending.conversation}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "posting" && (
        <ChannelPostingDialog
          workspaceId={pending.conversation.serverId}
          conversation={pending.conversation}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "leave" && (
        <ConfirmActionDialog
          {...leaveConfirmation(pendingLabel)}
          danger
          isPending={leavePending}
          onConfirm={() => {
            setPending(null);
            leave(pending.conversation);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );

  return { getItems, dialogs };
}

/** Whether the conversation surface shows `conversationId` of `workspaceId` now. */
function isShown(workspaceId: string, conversationId: string): boolean {
  const shell = useShellStore.getState();
  return (
    useWorkspaceStore.getState().workspaceId === workspaceId &&
    shell.selectedConversationId === conversationId &&
    shell.mainSurface.kind === "conversation"
  );
}
