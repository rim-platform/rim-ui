import { useCallback, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { ConversationTypeEnum, PostingPolicy } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { detectPlatform } from "../../../core/runtime/runtime";
import { AgentEncryptedWarning } from "../../agent/encrypted/AgentEncryptedSwitch";
import { cannotAskAbout } from "../../agents/runtime/askContext";
import { agentSwitchLabel, useAgentEncryptedStore } from "../../agent/state/useAgentEncryptedStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { runCommandFromClick, type ClickOptions } from "../../commands/runtime/runFromClick";
import { QUICK_ACCESS_SHORTCUT } from "../../commands/state/useQuickAccessStore";
import { canManageBots, webhooksAvailable } from "../../bots/availability";
import { useDeviceReadyForEncryption } from "../../e2ee/hooks/useE2eeConversation";
import { useConversationNotificationItems } from "../../notifications/hooks/useConversationNotificationItems";
import { blockTargetOf } from "../../relay/blocking/blockPerson";
import { useContacts } from "../../relay/api/useContacts";
import { isDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import { useCanModerate, useIsGuest, useMyServerRole } from "../../workspaces/api/useMyServerRole";
import { cachedChannelPosting } from "../api/useChannelPosting";
import { knownMessageToMarkUnread, spaceMarksUnread } from "../api/useMarkAsUnread";
import { formatSlowModeInterval } from "../api/useSlowMode";
import { ChannelPostingDialog } from "../components/ChannelPostingDialog";
import { SlowModeDialog } from "../components/SlowModeDialog";
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
import { isShownConversation, useOpenConversation } from "./useOpenConversation";

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
  kind: "slow-mode" | "posting" | "agent";
  conversation: ConversationSummary;
};

/**
 * The menu of a conversation, the same from its sidebar row and from the conversation
 * header's "…" button. Items the viewer cannot use are left out. Each item runs its command on
 * the menu's conversation as a context-menu run, with the confirmation the palette asks for;
 * Edit topic…, Slow mode… and Who can post… open the editors whose save runs theirs.
 *
 * - An invitation the viewer holds: Accept (on a device set up for encryption) and Decline.
 * - A channel: Join channel first for a public one the viewer is not in, then Mark as read
 *   (when unread) or Mark as unread (when read, on a host with read markers, unless what is
 *   loaded shows nothing by someone else), Notifications, Members, Invite people…, Edit topic…
 *   (Owner, Moderator or a private channel's creator), Ask agent about #name (in the desktop
 *   app, on a channel that isn't encrypted), Assign keybind…, the
 *   Owner/Moderator's Moderation section (Slow mode…, Who can post… unless the server has no
 *   posting policies, New webhook… on a plaintext channel when the server has incoming webhooks,
 *   Archive channel… or Unarchive channel),
 *   and Leave channel. An archived channel has only Members, Unarchive channel and Leave.
 * - A group: Mark as read or Mark as unread, Notifications, Members, Add people… (also in Direct
 *   messages), Assign keybind…, Leave group….
 * - A DM: Mark as read or Mark as unread, Notifications, Add to contacts or Remove from contacts
 *   (while the relay is on), Assign keybind…, Block… (its other person, while the relay is on and they
 *   are not blocked).
 *
 * @param workspaceId The workspace the list or header shows, whose role gates the moderation
 *   and whose notification settings and mutes stay loaded. A conversation's actions go to its
 *   own `serverId`.
 * @returns `getItems`, the items for a conversation when its menu opens, and `dialogs`, the
 *   slow-mode, posting and agent dialogs to render beside the surface.
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
  const { data: contacts } = useContacts();
  const myPrincipalId = useRelayStore((s) => s.account?.principalId ?? null);
  const openConversation = useOpenConversation();
  const [pending, setPending] = useState<PendingDialog | null>(null);

  const getItems = useCallback(
    (conversation: ConversationSummary, options: ConversationMenuOptions = {}) => {
      const { header = false, label } = options;
      const serverId = conversation.serverId;
      const conversationId = conversation.id;
      const ids = { server_id: serverId, conversation_id: conversationId };
      const name = conversationLabel(conversation);
      // Runs an item's command on this conversation, as a context-menu run.
      const run = (commandId: string, args?: Record<string, unknown>, options?: ClickOptions) =>
        void runCommandFromClick(commandId, args, {
          source: "menu",
          target: { workspaceId: serverId, conversationId },
          ...options,
        });

      if (isInvited(conversation, currentUserId)) {
        const items: DropdownMenuItem[] = [];
        if (deviceReady) {
          items.push({
            id: "accept-invite",
            label: "Accept",
            onSelect: () => run("chat.accept_invitation"),
          });
        }
        items.push({
          id: "decline-invite",
          label: "Decline",
          onSelect: () => run("chat.decline_invitation"),
        });
        return items;
      }

      const isChannel = conversation.conversationType === ConversationTypeEnum.CHANNEL;
      const isDm = conversation.conversationType === ConversationTypeEnum.DIRECT;
      const archived = isChannel && conversation.isArchived;
      const peer = isDm ? peerOf(conversation) : undefined;
      // Opens the conversation of a sidebar row, unless it is the one shown already.
      const show = () => {
        if (!isShownConversation(serverId, conversationId)) {
          openConversation(conversationId, serverId);
        }
      };

      const items: DropdownMenuItem[] = [];

      if (isChannel && !conversation.isMember && !conversation.isPrivate && !archived && !isGuest) {
        items.push({
          id: "join-channel",
          label: "Join channel",
          onSelect: () =>
            run("chat.join_channel", ids, {
              successToast: null,
              errorTitle: "Could not join the channel",
            }),
        });
      }

      if (!archived && (useUnreadStore.getState().counts[conversationId] ?? 0) > 0) {
        items.push({
          id: "mark-read",
          label: "Mark as read",
          onSelect: () => run("chat.mark_as_read", ids, { successToast: null }),
        });
      } else if (
        !archived &&
        spaceMarksUnread(serverId) &&
        knownMessageToMarkUnread(qc, serverId, conversationId, currentUserId) !== null
      ) {
        items.push({
          id: "mark-unread",
          label: "Mark as unread",
          onSelect: () => run("chat.mark_conversation_unread"),
        });
      }

      if (!archived && conversation.isMember) items.push(...notificationItems(conversation));

      if (!isDm || header) {
        items.push({
          id: "members",
          label: "Members",
          onSelect: () => run("workspace.toggle_conversation_members"),
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
          onSelect: () => run("chat.open_invite"),
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
        const isContact = contacts.some((c) => c.principalId === peerPrincipal);
        items.push(
          isContact
            ? {
                id: "remove-contact",
                label: "Remove from contacts",
                onSelect: () => run("people.remove_contact", { user_id: peer.userId }),
              }
            : {
                id: "add-contact",
                label: "Add to contacts",
                onSelect: () => run("people.add_contact", { user_id: peer.userId }),
              },
        );
      }

      const blockTarget = peer ? blockTargetOf(peer.userId, serverId) : null;

      // Agent sessions run in the desktop app only, and only a channel a grant could cover is
      // offered: never a direct message, a group or anything encrypted.
      if (
        !archived &&
        detectPlatform() === "desktop" &&
        cannotAskAbout(conversation, isDirectSpace(serverId)) === null
      ) {
        items.push({
          id: "ask-agent",
          label: `Ask agent about ${name}`,
          onSelect: () => run("agents.ask_about_conversation"),
        });
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
        items.push({
          id: "assign-keybind",
          label: "Assign keybind…",
          shortcut: QUICK_ACCESS_SHORTCUT,
          onSelect: () => run("settings.assign_keybind", label ? { label } : undefined),
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
          if (
            !conversation.encryptedAt &&
            canManageBots({ role, inDirectSpace: isDirectSpace(serverId), info }) &&
            webhooksAvailable(info)
          ) {
            moderation.push({
              id: "new-webhook",
              label: "New webhook…",
              onSelect: () => run("bots.new_webhook"),
            });
          }
        }
        moderation.push(
          archived
            ? {
                id: "unarchive",
                label: "Unarchive channel",
                onSelect: () =>
                  run("chat.unarchive_channel", ids, {
                    successToast: `Unarchived ${name}`,
                    errorTitle: "Could not unarchive the channel",
                  }),
              }
            : {
                id: "archive",
                label: "Archive channel…",
                onSelect: () =>
                  run("chat.archive_channel", ids, {
                    successToast: `Archived ${name}`,
                    errorTitle: "Could not archive the channel",
                  }),
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
          onSelect: () =>
            run("chat.leave_conversation", ids, {
              successToast: `Left ${name}`,
              errorTitle: "Could not leave the conversation",
            }),
        });
      }

      if (isDm && peer && blockTarget) {
        items.push({
          id: "block",
          label: "Block…",
          danger: true,
          separatorBefore: true,
          onSelect: () => run("people.block", { user_id: peer.userId }),
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
      isGuest,
      role,
      info,
      canModerate,
      workspaceId,
      notificationItems,
      openConversation,
      contacts,
      myPrincipalId,
    ],
  );

  const dialogs = (
    <>
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
    </>
  );

  return { getItems, dialogs };
}
