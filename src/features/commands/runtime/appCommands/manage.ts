import type { InfiniteData } from "@tanstack/react-query";
import { MutationObserver } from "@tanstack/react-query";

import {
  ConversationTypeEnum,
  DmRequestStatus,
} from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import type { MessagesPage } from "../../../../core/types/messages";
import { toast } from "../../../../shared/toast";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { useAuthStore } from "../../../auth/state/useAuthStore";
import { findCachedConversation } from "../../../conversations/api/useConversation";
import { directPeerId } from "../../../conversations/utils";
import type { DmRequestView } from "../../../relay/api/relayApi";
import { incomingRequestOf } from "../../../relay/components/useDmRequestActions";
import { isDirectSpace } from "../../../relay/state/useRelayStore";
import { clearMessageFlagOptions } from "../../../workspaces/api/useModeration";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { CommandArgumentType } from "../../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo, CommandDefinition } from "../../types";
import { currentCommandContext } from "../commandContext";
import type { LocalHandler } from "../commandDispatcher";
import {
  useManageCommandStore,
  type ManageRequest,
  type RequestAction,
} from "../../state/useManageCommandStore";
import { useSettingsIntentStore, type SettingsIntent } from "../../state/useSettingsIntentStore";
import { localCommand } from "./localCommand";
import { refuseManage } from "./manageAvailability";
import { showWorkspace, targetWorkspaceOf } from "./targetWorkspace";
import { OPEN_A_CONVERSATION, SELECT_A_MESSAGE, selectedMessageOf } from "./messageContext";

/** The person a contact or block command acts on, when it is not the open DM's other person. */
function personArgument(description: string): { arguments: CommandArgumentInfo[] } {
  return {
    arguments: [
      {
        name: "user_id",
        title: "Person",
        description,
        argumentType: CommandArgumentType.USER_ID,
        required: false,
      },
    ],
  };
}

export const MANAGE_COMMANDS: CommandDefinition[] = [
  localCommand(
    "moderation.open_reports",
    "Moderation",
    "Open Reports",
    "Open the workspace's reports",
  ),
  localCommand(
    "moderation.resolve_report",
    "Moderation",
    "Resolve Report…",
    "Choose an open report and mark it resolved",
  ),
  localCommand(
    "moderation.dismiss_report",
    "Moderation",
    "Dismiss Report…",
    "Choose an open report and dismiss it",
  ),
  localCommand(
    "moderation.clear_flag",
    "Moderation",
    "Clear Flag",
    "Clear the automatic check's flag on the selected message",
  ),
  localCommand(
    "moderation.block_principal",
    "Moderation",
    "Block Account…",
    "Block an account from this server",
  ),
  localCommand(
    "moderation.unblock_principal",
    "Moderation",
    "Unblock Account…",
    "Lift the server's block on an account",
  ),
  localCommand(
    "moderation.unblock_ip",
    "Moderation",
    "Unblock Address…",
    "Lift the server's block on an IP address",
  ),
  localCommand(
    "moderation.clear_profile",
    "Moderation",
    "Clear Profile…",
    "Clear the profile of an account on this server",
  ),
  localCommand(
    "workspace.revoke_invite",
    "Workspace",
    "Revoke Invite…",
    "Choose an invite link and stop it admitting people",
  ),
  localCommand(
    "workspace.accept_join_request",
    "Workspace",
    "Accept Join Request…",
    "Choose a request to join the workspace and admit the person",
  ),
  localCommand(
    "workspace.decline_join_request",
    "Workspace",
    "Decline Join Request…",
    "Choose a request to join the workspace and decline it",
  ),
  localCommand("bots.new", "Bots & Webhooks", "New Bot…", "Make a bot account for a program"),
  localCommand("bots.edit", "Bots & Webhooks", "Edit Bot…", "Choose a bot and change it"),
  localCommand(
    "bots.deactivate",
    "Bots & Webhooks",
    "Deactivate Bot…",
    "Choose a bot and deactivate it for good",
  ),
  localCommand(
    "bots.new_webhook",
    "Bots & Webhooks",
    "New Webhook…",
    "Make an incoming webhook for the open channel",
  ),
  localCommand(
    "bots.revoke_webhook",
    "Bots & Webhooks",
    "Revoke Webhook…",
    "Choose an incoming webhook and stop its URL working",
  ),
  localCommand(
    "plugins.install",
    "Plugins",
    "Install Plugin…",
    "Choose how to install a plugin",
    true,
    {
      arguments: [
        {
          name: "source",
          title: "From",
          description: "Where the plugin comes from; asked when left out.",
          argumentType: CommandArgumentType.STRING,
          required: false,
          allowedValues: ["folder", "git"],
        },
      ],
    },
  ),
  localCommand(
    "plugins.toggle",
    "Plugins",
    "Turn Plugin On or Off…",
    "Choose a plugin and turn it on or off",
  ),
  localCommand(
    "plugins.update",
    "Plugins",
    "Update Plugin…",
    "Choose a plugin installed from git and update it",
  ),
  localCommand(
    "plugins.uninstall",
    "Plugins",
    "Uninstall Plugin…",
    "Choose a plugin and uninstall it",
  ),
  localCommand(
    "plugins.revoke_ai_access",
    "Plugins",
    "Revoke a Plugin's Assistant Access…",
    "Choose a plugin and take back the commands the assistant may run",
  ),
  localCommand(
    "people.add_contact",
    "People",
    "Add to Contacts",
    "Add the person in this direct message, or one you choose, to your contacts",
    true,
    personArgument("The person to add; else the one in the open direct message, or asked."),
  ),
  localCommand(
    "people.remove_contact",
    "People",
    "Remove from Contacts",
    "Remove the person in this direct message, or one you choose, from your contacts",
    true,
    personArgument("The person to remove; else the one in the open direct message, or asked."),
  ),
  localCommand(
    "people.block",
    "People",
    "Block…",
    "Block the person in this direct message, or one you choose",
    true,
    personArgument("The person to block; else the one in the open direct message, or asked."),
  ),
  localCommand(
    "people.unblock",
    "People",
    "Unblock…",
    "Choose someone you blocked and unblock them",
  ),
  localCommand(
    "people.accept_request",
    "People",
    "Accept Message Request",
    "Accept the open message request",
  ),
  localCommand(
    "people.ignore_request",
    "People",
    "Ignore Message Request",
    "Ignore the open message request",
  ),
  localCommand(
    "people.report_request",
    "People",
    "Report Message Request…",
    "Report the open message request to the operators of the server your account is on",
    true,
    {
      arguments: [
        {
          name: "reason",
          title: "Reason",
          description: "Why you report it; asked when left out.",
          argumentType: CommandArgumentType.STRING,
          required: false,
        },
      ],
    },
  ),
  localCommand(
    "people.read_request_first",
    "People",
    "Read Message Request First",
    "Read the open message request's conversation before deciding",
  ),
];

function open(request: ManageRequest) {
  useManageCommandStore.getState().open(request);
}

function openSettings(tab: string, intent?: SettingsIntent) {
  if (intent) useSettingsIntentStore.getState().set(intent);
  useShellStore.getState().setMainSurface({ kind: "settings", tab });
}

/** A command that opens `request`, after the refusal check of `id`. */
function opens(id: string, request: ManageRequest): LocalHandler {
  return () => {
    if (!refuseManage(id)) open(request);
  };
}

function conversationOf(commandContext: Record<string, unknown> | undefined) {
  const ctx = commandContext ?? currentCommandContext();
  const workspaceId = typeof ctx.workspaceId === "string" ? ctx.workspaceId : undefined;
  const conversationId = typeof ctx.conversationId === "string" ? ctx.conversationId : undefined;
  return {
    workspaceId,
    conversationId,
    conversation: findCachedConversation(queryClient, workspaceId, conversationId),
  };
}

/** The other person of the open direct message, when one is open. */
function contextPerson(commandContext: Record<string, unknown> | undefined): string | undefined {
  const { conversation } = conversationOf(commandContext);
  if (conversation?.conversationType !== ConversationTypeEnum.DIRECT) return undefined;
  return directPeerId(conversation, useAuthStore.getState().session?.userId);
}

/**
 * A command on a person: the one its `user_id` argument names, else the other person of the
 * context's direct message; with neither, a picker of people. Block in a message request's
 * conversation answers the request instead, blocking the person who sent it.
 */
function personHandler(
  id: string,
  purpose: "add-contact" | "remove-contact" | "block",
): LocalHandler {
  return (args, commandContext) => {
    if (refuseManage(id)) return;
    // In a message request's conversation, the person to block is the one who sent it.
    const request = purpose === "block" ? contextRequest(commandContext) : undefined;
    if (request) {
      open({ kind: "request", action: "block", requestId: request.id });
      return;
    }
    const named = args?.user_id ?? args?.userId;
    const userId =
      typeof named === "string" && named.trim() !== "" ? named : contextPerson(commandContext);
    open({ kind: "person", purpose, userId });
  };
}

function clearFlag(_args: unknown, commandContext: Record<string, unknown> | undefined): void {
  if (refuseManage("moderation.clear_flag")) return;
  const { workspaceId, conversationId } = conversationOf(commandContext);
  const messageId = selectedMessageOf(commandContext);
  if (!workspaceId || !conversationId) {
    toast.info(OPEN_A_CONVERSATION);
    return;
  }
  if (!messageId) {
    toast.info(SELECT_A_MESSAGE);
    return;
  }
  const pages = queryClient.getQueryData<InfiniteData<MessagesPage>>(
    queryKeys.messages(workspaceId, conversationId),
  );
  const message = pages?.pages.flatMap((p) => p.items).find((m) => m.id === messageId);
  if (!message?.flagged) {
    toast.info("This message is not flagged");
    return;
  }
  void new MutationObserver(queryClient, clearMessageFlagOptions(queryClient))
    .mutate({ serverId: workspaceId, conversationId, messageId })
    .catch(() => undefined);
}

/**
 * Opens the new webhook form: for the channel of the context, or, with no conversation in the
 * context, the one in Settings > Bots that asks for the channel.
 */
function openWebhook(commandContext: Record<string, unknown> | undefined): void {
  const { workspaceId, conversationId, conversation } = conversationOf(commandContext);
  if (refuseManage("bots.new_webhook", workspaceId ?? null)) return;
  if (!conversationId) {
    openSettings("bots", { kind: "webhook-create" });
    return;
  }
  if (!conversation || conversation.conversationType !== ConversationTypeEnum.CHANNEL) {
    toast.info("Open a channel first");
    return;
  }
  open({ kind: "new-webhook", conversation });
}

/** The undecided message request this account received in the context's conversation. */
function contextRequest(
  commandContext: Record<string, unknown> | undefined,
): DmRequestView | undefined {
  const { conversationId } = conversationOf(commandContext);
  const pending = queryClient.getQueryData<DmRequestView[]>(
    queryKeys.dmRequests(DmRequestStatus.PENDING),
  );
  return incomingRequestOf(pending, conversationId);
}

/**
 * A command on the message request of the context's conversation; with none, the requests page.
 * Reporting takes its reason from a `reason` argument, else asks for one.
 */
function requestHandler(id: string, action: Exclude<RequestAction, "block">): LocalHandler {
  return (args, commandContext) => {
    if (refuseManage(id)) return;
    const request = contextRequest(commandContext);
    if (request) {
      const reason =
        action === "report" && typeof args?.reason === "string" && args.reason.trim() !== ""
          ? args.reason.trim()
          : undefined;
      open({ kind: "request", action, requestId: request.id, ...(reason && { reason }) });
      return;
    }
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    useShellStore.getState().setMainSurface({
      kind: "dm-requests",
      workspaceId: isDirectSpace(workspaceId) ? null : workspaceId,
    });
  };
}

export const MANAGE_HANDLERS: Record<string, LocalHandler> = {
  "moderation.open_reports": (args, commandContext) => {
    const workspaceId = targetWorkspaceOf(args, commandContext);
    if (refuseManage("moderation.open_reports", workspaceId) || !workspaceId) return;
    showWorkspace(workspaceId);
    openSettings("workspace-moderation");
  },
  "moderation.resolve_report": opens("moderation.resolve_report", {
    kind: "report",
    outcome: "resolve",
  }),
  "moderation.dismiss_report": opens("moderation.dismiss_report", {
    kind: "report",
    outcome: "dismiss",
  }),
  "moderation.clear_flag": clearFlag,
  "moderation.block_principal": opens("moderation.block_principal", {
    kind: "principal",
    purpose: "block",
  }),
  "moderation.unblock_principal": opens("moderation.unblock_principal", {
    kind: "unblock-principal",
  }),
  "moderation.unblock_ip": opens("moderation.unblock_ip", { kind: "unblock-ip" }),
  "moderation.clear_profile": opens("moderation.clear_profile", {
    kind: "principal",
    purpose: "clear-profile",
  }),
  "workspace.revoke_invite": opens("workspace.revoke_invite", { kind: "revoke-invite" }),
  "workspace.accept_join_request": opens("workspace.accept_join_request", {
    kind: "join-request",
    accept: true,
  }),
  "workspace.decline_join_request": opens("workspace.decline_join_request", {
    kind: "join-request",
    accept: false,
  }),
  "bots.new": () => {
    if (!refuseManage("bots.new")) openSettings("bots", { kind: "bot-create" });
  },
  "bots.edit": opens("bots.edit", { kind: "bot", action: "edit" }),
  "bots.deactivate": opens("bots.deactivate", { kind: "bot", action: "deactivate" }),
  "bots.new_webhook": (_args, commandContext) => openWebhook(commandContext),
  "bots.revoke_webhook": opens("bots.revoke_webhook", { kind: "revoke-webhook" }),
  "plugins.install": (args) => {
    if (refuseManage("plugins.install")) return;
    const source = args?.source === "folder" || args?.source === "git" ? args.source : undefined;
    openSettings("plugins", { kind: "plugin", action: "install", ...(source && { source }) });
  },
  "plugins.toggle": opens("plugins.toggle", { kind: "plugin", action: "toggle" }),
  "plugins.update": opens("plugins.update", { kind: "plugin", action: "update" }),
  "plugins.uninstall": opens("plugins.uninstall", { kind: "plugin", action: "uninstall" }),
  "plugins.revoke_ai_access": opens("plugins.revoke_ai_access", {
    kind: "plugin",
    action: "revoke-ai",
  }),
  "people.add_contact": personHandler("people.add_contact", "add-contact"),
  "people.remove_contact": personHandler("people.remove_contact", "remove-contact"),
  "people.block": personHandler("people.block", "block"),
  "people.unblock": opens("people.unblock", { kind: "unblock-person" }),
  "people.accept_request": requestHandler("people.accept_request", "accept"),
  "people.ignore_request": requestHandler("people.ignore_request", "ignore"),
  "people.report_request": requestHandler("people.report_request", "report"),
  "people.read_request_first": requestHandler("people.read_request_first", "read-first"),
};
