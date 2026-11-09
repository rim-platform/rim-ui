import { ConversationTypeEnum } from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { detectPlatform } from "../../../../core/runtime/runtime";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { toast } from "../../../../shared/toast";
import { AGENT_DESKTOP_ONLY_MESSAGE } from "../../../agent/agentAvailability";
import { useAgentEncryptedStore } from "../../../agent/state/useAgentEncryptedStore";
import { useAuthStore } from "../../../auth/state/useAuthStore";
import { findCachedConversation } from "../../../conversations/api/useConversation";
import {
  markConversationUnread,
  spaceMarksUnread,
} from "../../../conversations/api/useMarkAsUnread";
import { useConversationDialogStore } from "../../../conversations/state/useConversationDialogStore";
import { useInvitationActionsStore } from "../../../conversations/state/useInvitationActionsStore";
import { useMembersPanelStore } from "../../../conversations/state/useMembersPanelStore";
import type { ConversationSummary } from "../../../conversations/types";
import { canInviteTo } from "../../../conversations/utils";
import { useLensStore } from "../../../lenses/state/useLensStore";
import type { MessageSelectionTarget } from "../../../messages/state/useSelectedMessageStore";
import { useNotificationsPanelStore } from "../../../notifications/state/useNotificationsPanelStore";
import { isDirectSpace } from "../../../relay/state/useRelayStore";
import type { KnownServerInfo } from "../../../updater/api/serverInfoApi";
import { useUnreadsPageStore } from "../../../unreads/state/useUnreadsPageStore";
import type { ServerDetail } from "../../../workspaces/api/useWorkspace";
import { isGuest } from "../../../workspaces/role";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import type { CommandDefinition } from "../../types";
import { currentCommandContext } from "../commandContext";
import type { LocalHandler } from "../commandDispatcher";
import { localCommand, PLUGIN_RUNNABLE } from "./localCommand";
import { OPEN_A_CONVERSATION, openMessageList, selectedMessageInList } from "./messageContext";

const OPEN_AN_INVITATION = "Open an invitation first";
const UNREADS_ONLY = "This works on the Unreads page";

/** The conversation commands run in: its workspace and the conversation as cached, if known. */
function focusedConversation(commandContext: Record<string, unknown> | undefined): {
  workspaceId: string | undefined;
  conversationId: string | undefined;
  conversation: ConversationSummary | undefined;
} {
  const ctx = commandContext ?? currentCommandContext();
  const workspaceId = typeof ctx.workspaceId === "string" ? ctx.workspaceId : undefined;
  const conversationId = typeof ctx.conversationId === "string" ? ctx.conversationId : undefined;
  return {
    workspaceId,
    conversationId,
    conversation: findCachedConversation(queryClient, workspaceId, conversationId),
  };
}

/** The viewer's role in `workspaceId`, as cached. */
function roleIn(workspaceId: string) {
  return queryClient.getQueryData<ServerDetail>(queryKeys.server(workspaceId))?.viewerRole;
}

/** Clicks the composer button `selector` names, or says why the composer has none. */
function clickInComposer(selector: string, unavailable: string): void {
  const button = document.querySelector<HTMLElement>(selector);
  if (button) button.click();
  else toast.info(unavailable);
}

function startReply(_args: unknown, commandContext: Record<string, unknown> | undefined): void {
  const selected = selectedMessageInList(commandContext);
  if (selected && !selected.actions.reply(selected.messageId)) {
    toast.info("You can't reply in this conversation");
  }
}

function startEdit(_args: unknown, commandContext: Record<string, unknown> | undefined): void {
  const selected = selectedMessageInList(commandContext);
  if (selected && !selected.actions.edit(selected.messageId)) {
    toast.info("Only your own messages can be edited");
  }
}

/** A command that moves the open message list's selection. */
function selectHandler(target: MessageSelectionTarget): LocalHandler {
  return (_args, commandContext) => {
    const actions = openMessageList(commandContext);
    if (actions && !actions.select(target)) toast.info("There are no messages to select");
  };
}

/** Opens the open channel's lens picker, or says why it cannot. */
function openLensPicker(commandContext: Record<string, unknown> | undefined): void {
  const { conversationId, conversation } = focusedConversation(commandContext);
  if (!conversationId) {
    toast.info(OPEN_A_CONVERSATION);
    return;
  }
  if (conversation && conversation.conversationType !== ConversationTypeEnum.CHANNEL) {
    toast.info("Lenses are offered in channels");
    return;
  }
  useShellStore.getState().setMainSurface({ kind: "conversation" });
  useLensStore.getState().setLensPickerOpen(true);
}

/** Answers the invitation on screen, or says to open one. */
function answerInvitation(commandContext: Record<string, unknown> | undefined, accept: boolean) {
  const { conversationId } = focusedConversation(commandContext);
  const actions = useInvitationActionsStore.getState().actions;
  if (!actions || !conversationId || actions.conversationId !== conversationId) {
    toast.info(OPEN_AN_INVITATION);
    return;
  }
  if (!accept) actions.decline();
  else if (!actions.accept()) toast.info("Set up this device for encryption to join");
}

export const CONVERSATION_COMMANDS: CommandDefinition[] = [
  localCommand(
    "chat.start_reply",
    "Messages",
    "Reply",
    "Quote the selected message above the message box",
  ),
  localCommand("chat.start_edit", "Messages", "Edit Message", "Edit the selected message of yours"),
  localCommand(
    "chat.forward_message",
    "Messages",
    "Forward Message…",
    "Send the selected message to another conversation",
  ),
  localCommand(
    "chat.delete_attachment",
    "Messages",
    "Delete Attachment…",
    "Remove a failed upload from the selected message",
  ),
  localCommand(
    "chat.attach_file",
    "Messages",
    "Attach File…",
    "Choose a file to send in the open conversation",
  ),
  localCommand(
    "chat.insert_emoji",
    "Messages",
    "Insert Emoji…",
    "Pick an emoji to add to the message being written",
  ),
  localCommand(
    "chat.select_next_message",
    "Messages",
    "Select Next Message",
    "Move the selection to the next message",
    true,
    PLUGIN_RUNNABLE,
  ),
  localCommand(
    "chat.select_previous_message",
    "Messages",
    "Select Previous Message",
    "Move the selection to the previous message",
    true,
    PLUGIN_RUNNABLE,
  ),
  localCommand(
    "chat.select_first_message",
    "Messages",
    "Select First Message",
    "Move the selection to the first message loaded",
    true,
    PLUGIN_RUNNABLE,
  ),
  localCommand(
    "chat.select_last_message",
    "Messages",
    "Select Last Message",
    "Move the selection to the newest message",
    true,
    PLUGIN_RUNNABLE,
  ),
  localCommand(
    "chat.toggle_fold",
    "Messages",
    "Fold or Unfold Message",
    "Show more or less of the selected message's tall text",
  ),
  localCommand(
    "chat.open_invite",
    "Conversations",
    "Invite People…",
    "Add people to the open conversation",
  ),
  localCommand(
    "chat.browse_channels",
    "Conversations",
    "Browse Channels…",
    "See the channels in the open workspace and join one",
    true,
    PLUGIN_RUNNABLE,
  ),
  localCommand(
    "chat.accept_invitation",
    "Conversations",
    "Accept Invitation",
    "Join the conversation you are invited to",
  ),
  localCommand(
    "chat.decline_invitation",
    "Conversations",
    "Decline Invitation",
    "Turn down the invitation to the open conversation",
  ),
  localCommand(
    "chat.mark_conversation_unread",
    "Conversations",
    "Mark Conversation Unread",
    "Mark the open conversation unread from its newest message",
  ),
  localCommand(
    "chat.apply_lens",
    "Conversations",
    "Apply Lens…",
    "Choose a lens to filter the open channel",
  ),
  localCommand(
    "chat.clear_lens",
    "Conversations",
    "Clear Lens",
    "Show the open channel unfiltered",
  ),
  localCommand(
    "notifications.mark_read",
    "Notifications",
    "Mark Notification Read",
    "Open the notification inbox to mark an entry read",
  ),
  localCommand(
    "unreads.mark_all_shown",
    "Unreads",
    "Unreads: Mark All Shown as Read",
    "Mark every conversation shown on the Unreads page read, with a chance to undo",
  ),
  localCommand(
    "unreads.toggle_muted",
    "Unreads",
    "Unreads: Show or Hide Muted",
    "Show or hide the muted conversations on the Unreads page",
    true,
    PLUGIN_RUNNABLE,
  ),
  localCommand(
    "agents.allow_in_encrypted_conversation",
    "Agents",
    "Let the AI Agent Read This Conversation…",
    "Allow the AI agent to use the open encrypted conversation, after a warning",
    false,
  ),
];

export const CONVERSATION_HANDLERS: Record<string, LocalHandler> = {
  "chat.start_reply": startReply,
  "chat.start_edit": startEdit,
  "chat.forward_message": (_args, commandContext) => {
    const selected = selectedMessageInList(commandContext);
    if (selected && !selected.actions.forward(selected.messageId)) {
      toast.info("This message can't be forwarded");
    }
  },
  "chat.delete_attachment": (_args, commandContext) => {
    const selected = selectedMessageInList(commandContext);
    if (selected && !selected.actions.deleteAttachment(selected.messageId)) {
      toast.info("This message has no failed upload to delete");
    }
  },
  "chat.attach_file": () =>
    clickInComposer("[data-composer-attach]", "Open a conversation you can write in first"),
  "chat.insert_emoji": () =>
    clickInComposer("[data-composer-emoji]", "Open a conversation you can write in first"),
  "chat.select_next_message": selectHandler("next"),
  "chat.select_previous_message": selectHandler("previous"),
  "chat.select_first_message": selectHandler("first"),
  "chat.select_last_message": selectHandler("last"),
  "chat.toggle_fold": (_args, commandContext) => {
    const selected = selectedMessageInList(commandContext);
    if (selected && !selected.actions.toggleFold(selected.messageId)) {
      toast.info("This message does not fold");
    }
  },
  "chat.open_invite": (_args, commandContext) => {
    const { workspaceId, conversationId, conversation } = focusedConversation(commandContext);
    if (!workspaceId || !conversationId) {
      toast.info(OPEN_A_CONVERSATION);
      return;
    }
    const info = queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo);
    const allowed =
      conversation !== undefined &&
      canInviteTo(conversation, {
        userId: useAuthStore.getState().session?.userId,
        role: roleIn(conversation.serverId),
        inDirectSpace: isDirectSpace(conversation.serverId),
        defaultWorkspaceId: info?.defaultWorkspace,
      });
    if (!allowed) {
      toast.info("You can't add people to this conversation");
      return;
    }
    useShellStore.getState().setMainSurface({ kind: "conversation" });
    useMembersPanelStore.getState().openInvite(conversationId);
  },
  "chat.browse_channels": () => {
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    if (!workspaceId || isDirectSpace(workspaceId)) {
      toast.info("Open a workspace first");
      return;
    }
    if (isGuest(roleIn(workspaceId))) {
      toast.info("Guests can't browse channels");
      return;
    }
    useConversationDialogStore.getState().openBrowseChannels(workspaceId);
  },
  "chat.accept_invitation": (_args, commandContext) => answerInvitation(commandContext, true),
  "chat.decline_invitation": (_args, commandContext) => answerInvitation(commandContext, false),
  "chat.mark_conversation_unread": (_args, commandContext) => {
    const { workspaceId, conversationId, conversation } = focusedConversation(commandContext);
    if (!workspaceId || !conversationId) {
      toast.info(OPEN_A_CONVERSATION);
      return;
    }
    const serverId = conversation?.serverId ?? workspaceId;
    if (!spaceMarksUnread(serverId)) {
      toast.error("This workspace's server does not support marking unread yet");
      return;
    }
    void markConversationUnread(
      queryClient,
      serverId,
      conversationId,
      useAuthStore.getState().session?.userId,
    );
  },
  "chat.apply_lens": (_args, commandContext) => openLensPicker(commandContext),
  "chat.clear_lens": (_args, commandContext) => {
    const { conversationId, conversation } = focusedConversation(commandContext);
    if (!conversationId) {
      toast.info(OPEN_A_CONVERSATION);
      return;
    }
    if (conversation && conversation.conversationType !== ConversationTypeEnum.CHANNEL) {
      toast.info("Lenses are offered in channels");
      return;
    }
    const lenses = useLensStore.getState();
    if (lenses.getActiveLens(conversationId) === null) {
      toast.info("No lens is applied here");
      return;
    }
    lenses.setActiveLens(conversationId, null);
  },
  // The inbox has no selected row, so the command opens it, where each entry marks itself read.
  "notifications.mark_read": () => {
    useNotificationsPanelStore.getState().setOpen(true);
  },
  "unreads.mark_all_shown": () => {
    const controls = useUnreadsPageStore.getState().controls;
    if (controls) controls.markAllShown();
    else toast.info(UNREADS_ONLY);
  },
  "unreads.toggle_muted": () => {
    const controls = useUnreadsPageStore.getState().controls;
    if (controls) controls.toggleMuted();
    else toast.info(UNREADS_ONLY);
  },
  "agents.allow_in_encrypted_conversation": (_args, commandContext) => {
    if (detectPlatform() !== "desktop") {
      toast.info(AGENT_DESKTOP_ONLY_MESSAGE);
      return;
    }
    const { conversationId, conversation } = focusedConversation(commandContext);
    if (!conversationId) {
      toast.info(OPEN_A_CONVERSATION);
      return;
    }
    if (!conversation?.encryptedAt) {
      toast.info("Only encrypted conversations need this");
      return;
    }
    if (conversationId in useAgentEncryptedStore.getState().allowed) {
      toast.info("The agent can already read this conversation");
      return;
    }
    // The warning is always shown: turning this on is the person's answer to it.
    useConversationDialogStore.getState().openAgentWarning(conversationId);
  },
};
