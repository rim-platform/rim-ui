import type { CommandDefinition, CommandResult } from "../types";
import {
  argumentGiven,
  argumentTypesOf,
  camelCaseName,
  contextOnlyArgumentMessage,
  contextSuppliesArgument,
  formAsksFor,
} from "./commandArguments";
import { useCommandArgumentsStore } from "../state/useCommandArgumentsStore";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { useCommandStore, type TargetPickerKind } from "../state/useCommandStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useMembersPanelStore } from "../../conversations/state/useMembersPanelStore";
import { useNotificationsPanelStore } from "../../notifications/state/useNotificationsPanelStore";
import { useMemberDirectoryStore } from "../../workspaces/state/useMemberDirectoryStore";
import { isDirectSpace } from "../../relay/state/useRelayStore";
import { useAgentStore } from "../../agent/state/useAgentStore";
import { parsePluginCommandId } from "../../plugins/api/usePluginCommands";
import { withWebHealth } from "../../plugins/api/usePluginList";
import { CANCELLED_PAYLOAD, findPluginCommand } from "../../plugins/runtime/pluginCommandInfo";
import { withContextArguments } from "../../plugins/runtime/pluginContext";
import { usePluginConfirmStore } from "../../plugins/state/usePluginConfirmStore";
import { findOpenPluginPanelTarget, isOpenPluginPanelCommand } from "../../plugins/pluginPanels";
import { openPluginSettings, openPluginSettingsTarget } from "../../plugins/pluginSettingsLink";
import { panelSlot, type PluginCommandResult, type PluginInfo } from "../../plugins/types";
import { WebCommandError, webPluginHost } from "../../plugins/web/webPluginHost";
import { safeInvoke, type SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import {
  useUnreadsPageStore,
  type UnreadsPageControls,
} from "../../unreads/state/useUnreadsPageStore";
import { useLensStore } from "../../lenses/state/useLensStore";
import { markWorkspaceRead } from "../../conversations/api/useMarkAsRead";
import { markAsUnread, spaceMarksUnread } from "../../conversations/api/useMarkAsUnread";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { reloadCommands } from "../api/useCommands";
import { navigatePanel } from "../../../shell/navigation/spatialNavigation";
import { goBack, goForward } from "../../../shell/navigation/history";
import { useLayoutPresetStore } from "../../../shell/state/useLayoutPresetStore";
import { closeTopPanel } from "../../../shell/state/closeTopPanel";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { returnFromDirect } from "../../conversations/state/directOrigin";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import { cycleRecentActivity } from "./cycleRecentActivity";
import { EDIT_HOME_COMMAND_ID, editHome } from "../../home/editHome";
import { confirmConversationCommand } from "./conversationActionGate";
import { openWorkspaceAction, workspaceCommandOffered } from "../../workspaces/workspaceActions";
import { refuseBlockedConversation } from "../../relay/inbox/blockedCreators";
import { QUIT_COMMAND_ID } from "../../desktop-shell/availability";
import { requestQuit } from "../../desktop-shell/state/useQuitConfirmStore";
import { copyToClipboard } from "../../../shared/ui/contextMenu/menuActions";
import { findCachedConversation } from "../../conversations/api/useConversation";
import {
  CommandArgumentType,
  ConversationTypeEnum,
} from "../../../core/graphql/generated/schema-types";
import {
  OPEN_A_CONVERSATION,
  SELECT_A_MESSAGE,
  selectedMessageInList,
  selectedMessageOf,
} from "./appCommands/messageContext";
import { CONVERSATION_HANDLERS } from "./appCommands/conversation";
import { GENERAL_ARGUMENT_PROMPTS, GENERAL_HANDLERS } from "./appCommands/general";
import { AGENT_ARGUMENT_PROMPTS, AGENT_HANDLERS } from "./appCommands/agents";
import { AGENT_MANAGEMENT_COMMAND_IDS } from "./appCommands/agentCommandIds";
import { MANAGE_HANDLERS } from "./appCommands/manage";
import { withClientLabel } from "./localCommands";
import { tomorrowMorning } from "../../notifications/rules";
import {
  runWithHumanConfirmation,
  type ConfirmationProof,
  type HumanConfirmationOutcome,
} from "./humanConfirmation";

interface ConversationItem {
  id: string;
  serverId: string;
  conversationType: string;
  title: string;
  memberIds: string[];
}

interface ConversationPage {
  items: ConversationItem[];
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}

/**
 * Read the ordered list of conversations from the TanStack Query cache.
 * Channels first, then inbox (DMs/groups) — same order as ConversationList.
 */
function getCachedConversationIds(): string[] {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  const channels = queryClient.getQueryData<ConversationPage>(
    queryKeys.channels(workspaceId ?? undefined),
  );
  const inbox = queryClient.getQueryData<ConversationPage>(
    queryKeys.conversations(workspaceId ?? undefined),
  );
  return [...(channels?.items ?? []), ...(inbox?.items ?? [])].map((c) => c.id);
}

/**
 * Read unread conversation IDs from the unread store.
 * Returns only conversations that have a non-zero unread count,
 * in the same order as the conversation list.
 */
function getCachedUnreadConversationIds(): string[] {
  const counts = useUnreadStore.getState().counts;
  return getCachedConversationIds().filter((id) => (counts[id] ?? 0) > 0);
}

type ExecuteBackendCommand = (input: {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: Record<string, unknown>;
  isPipe?: boolean;
  confirmation?: ConfirmationProof;
}) => Promise<{ executeCommand: CommandResult }>;

/** Payload of the result of a command this app ran itself, which shows what it did. */
export const LOCAL_ACTION_PAYLOAD = Object.freeze({ local: true });

/** True for the result of a command this app ran itself without a result of its own. */
export function isLocalActionResult(result: { payload: unknown } | null | undefined): boolean {
  return result?.payload === LOCAL_ACTION_PAYLOAD;
}

/** The result of a local command that has something to say. */
function resultText(message: string): CommandResult {
  return { status: "SUCCESS", message, payload: null, followUpCommands: [] };
}

// Registry of desktop-local command handlers. `dispatchCommand` checks this map FIRST for
// every dispatch path (palette AND keybind), so a bare keybind fires the handler with no
// args, and the handler supplies any args it needs itself.
/** The space a navigation command's conversation is in: its `serverId`, else the open workspace. */
function spaceOf(args: Record<string, unknown>): string | null {
  return argString(args, "serverId", "server_id") ?? useWorkspaceStore.getState().workspaceId;
}

/**
 * The first non-blank string among `args[names]`: a command's argument under either of its
 * spellings, the camelCase of the client's own callers and the snake_case the server declares.
 */
export function argString(
  args: Record<string, unknown> | undefined,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = args?.[name];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** Runs one of the Unreads page's commands while the page is open; `false` when it is not. */
function onUnreadsPage(run: (controls: UnreadsPageControls) => void): boolean {
  const controls = useUnreadsPageStore.getState().controls;
  if (!controls) return false;
  run(controls);
  return true;
}

function openUnreads(): void {
  useShellStore.getState().setMainSurface({ kind: "unreads" });
}

/** The answer of the Unreads page's commands that act on the page's selection elsewhere. */
function onlyOnUnreadsPage(): void {
  toast.info("This works on the Unreads page");
}

/** Focuses the element `selector` names, or says that a conversation must be open first. */
function focusInConversation(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.focus();
  else toast.info(OPEN_A_CONVERSATION);
}

/**
 * A command this app runs itself: called with the command's arguments and the context it runs
 * in, it acts and returns nothing, or a result that says what happened.
 */
export type LocalHandler = (
  args: Record<string, unknown> | undefined,
  commandContext: Record<string, unknown> | undefined,
) => void | CommandResult;

const localHandlers: Record<string, LocalHandler> = {
  ...CONVERSATION_HANDLERS,
  ...MANAGE_HANDLERS,
  "workspace.open_command_palette": () => {
    useCommandStore.getState().toggleCommandPalette();
  },
  "workspace.open_settings": () => {
    useShellStore.getState().setMainSurface({ kind: "settings" });
  },
  "workspace.open_search": () => {
    // From Home and Unreads the search box starts with every workspace.
    const kind = useShellStore.getState().mainSurface.kind;
    useCommandStore
      .getState()
      .openSearchBox(kind === "home" || kind === "unreads" ? "everything" : "workspace");
  },
  "workspace.search_in_channel": () => {
    const convId = useShellStore.getState().selectedConversationId;
    if (convId) {
      useSearchOverlayStore
        .getState()
        .openWithScope({ kind: "conversation", conversationId: convId });
    } else {
      useSearchOverlayStore.getState().openWithScope({ kind: "all" });
    }
  },
  "workspace.open_marketplace": () => {
    useShellStore.getState().setMainSurface({ kind: "marketplace" });
  },
  "workspace.open_agents": () => {
    useShellStore.getState().setMainSurface({ kind: "settings", tab: "agents" });
  },
  "workspace.toggle_sidebar": () => {
    const shell = useShellStore.getState();
    // A narrow window has no sidebar to collapse: the command opens or closes the drawer.
    if (shell.shellWidth === "narrow") shell.toggleNavDrawer();
    else shell.toggleSidebar();
  },
  "workspace.open_home": () => {
    useShellStore.getState().setMainSurface({ kind: "home" });
  },
  [EDIT_HOME_COMMAND_ID]: () => editHome(),
  "workspace.open_unreads": openUnreads,
  // Off the Unreads page, moving and opening open the page; marking and undoing say where they
  // work.
  "workspace.unreads_next": () => {
    if (!onUnreadsPage((c) => c.next())) openUnreads();
  },
  "workspace.unreads_previous": () => {
    if (!onUnreadsPage((c) => c.previous())) openUnreads();
  },
  "workspace.unreads_mark_group": () => {
    if (!onUnreadsPage((c) => c.markGroup())) onlyOnUnreadsPage();
  },
  "workspace.unreads_open": () => {
    if (!onUnreadsPage((c) => c.open())) openUnreads();
  },
  "workspace.unreads_undo": () => {
    if (!onUnreadsPage((c) => c.undo())) onlyOnUnreadsPage();
  },
  "workspace.open_audit_log": () => {
    useShellStore.getState().setMainSurface({ kind: "audit-log" });
  },
  "workspace.open_message_requests": () => {
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    useNotificationsPanelStore.getState().setOpen(false);
    useShellStore.getState().setMainSurface({
      kind: "dm-requests",
      workspaceId: isDirectSpace(workspaceId) ? null : workspaceId,
    });
  },
  "workspace.toggle_pinned_messages": () => {
    const shell = useShellStore.getState();
    if (!shell.selectedConversationId) {
      toast.info("Open a conversation to see its pinned messages");
      return;
    }
    shell.setMainSurface({ kind: "conversation" });
    shell.setPinnedPanelOpen(!shell.pinnedPanelOpen);
  },
  "workspace.toggle_channel_bots": () => {
    const shell = useShellStore.getState();
    if (!shell.selectedConversationId) {
      toast.info("Open a channel to see its bots");
      return;
    }
    shell.setMainSurface({ kind: "conversation" });
    shell.setBotsPanelOpen(!shell.botsPanelOpen);
  },
  "workspace.toggle_notifications": () => {
    useNotificationsPanelStore.getState().toggle();
  },
  "workspace.toggle_conversation_members": () => {
    const shell = useShellStore.getState();
    if (!shell.selectedConversationId) {
      toast.info("Open a conversation to see its members");
      return;
    }
    shell.setMainSurface({ kind: "conversation" });
    shell.setActivePanel("inbox");
    useNotificationsPanelStore.getState().setOpen(false);
    useMembersPanelStore.getState().toggle();
  },
  "workspace.toggle_member_directory": () => {
    const shell = useShellStore.getState();
    shell.setMainSurface({ kind: "conversation" });
    shell.setActivePanel("inbox");
    useNotificationsPanelStore.getState().setOpen(false);
    useMembersPanelStore.getState().setOpen(false);
    useMemberDirectoryStore.getState().toggle();
  },
  "workspace.focus_composer": () => focusInConversation("[data-composer-input]"),
  "workspace.focus_message_list": () => focusInConversation("[data-message-list]"),
  "workspace.navigate_to_channel": (args) => {
    const conversationId = argString(args, "conversationId", "conversation_id");
    if (!args || !conversationId) return;
    if (refuseBlockedConversation(spaceOf(args), conversationId)) return;
    useShellStore.getState().setSelectedConversationId(conversationId);
  },
  "workspace.navigate_to_dm": (args) => {
    const conversationId = argString(args, "conversationId", "conversation_id");
    if (!args || !conversationId) return;
    const spaceId = spaceOf(args);
    if (refuseBlockedConversation(spaceId, conversationId)) return;
    if (spaceId) selectDirectConversation(spaceId, conversationId);
    else useShellStore.getState().setSelectedConversationId(conversationId);
  },
  "workspace.switch_workspace": (args) => {
    const workspaceId = argString(args, "workspaceId", "workspace_id");
    if (workspaceId) useWorkspaceStore.getState().setWorkspaceId(workspaceId);
  },
  "workspace.back_to_workspace": () => {
    returnFromDirect();
  },
  "workspace.open_bots": () => {
    if (!workspaceCommandOffered("workspace.open_bots")) {
      toast.info("Bots are managed by this workspace's owners and moderators.");
      return;
    }
    useShellStore.getState().setMainSurface({ kind: "settings", tab: "bots" });
  },
  "workspace.leave": () => openWorkspaceAction("leave"),
  "workspace.rename": () => openWorkspaceAction("rename"),
  "workspace.previous_channel": () => {
    const ids = getCachedConversationIds();
    if (ids.length === 0) return;
    const current = useShellStore.getState().selectedConversationId;
    const idx = current ? ids.indexOf(current) : -1;
    const prev = idx > 0 ? ids[idx - 1] : ids[ids.length - 1];
    useShellStore.getState().setSelectedConversationId(prev);
  },
  "workspace.next_channel": () => {
    const ids = getCachedConversationIds();
    if (ids.length === 0) return;
    const current = useShellStore.getState().selectedConversationId;
    const idx = current ? ids.indexOf(current) : -1;
    const next = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : ids[0];
    useShellStore.getState().setSelectedConversationId(next);
  },
  "workspace.next_unread_channel": () => {
    const unread = getCachedUnreadConversationIds();
    if (unread.length === 0) {
      toast.info("No unread conversations");
      return;
    }
    const current = useShellStore.getState().selectedConversationId;
    const allIds = getCachedConversationIds();
    const currentIdx = current ? allIds.indexOf(current) : -1;
    // Find the first unread channel after the current position
    const after = unread.find((id) => allIds.indexOf(id) > currentIdx);
    useShellStore.getState().setSelectedConversationId(after ?? unread[0]);
  },
  "workspace.previous_unread_channel": () => {
    const unread = getCachedUnreadConversationIds();
    if (unread.length === 0) {
      toast.info("No unread conversations");
      return;
    }
    const current = useShellStore.getState().selectedConversationId;
    const allIds = getCachedConversationIds();
    const currentIdx = current ? allIds.indexOf(current) : allIds.length;
    // The last unread conversation before the current position, wrapping to the last one.
    const before = [...unread].reverse().find((id) => allIds.indexOf(id) < currentIdx);
    useShellStore.getState().setSelectedConversationId(before ?? unread[unread.length - 1]);
  },
  "workspace.go_back": () => {
    if (!goBack()) toast.info("Nothing to go back to");
  },
  "workspace.go_forward": () => {
    if (!goForward()) toast.info("Nothing to go forward to");
  },
  "workspace.navigate_panel_left": () => {
    navigatePanel("left");
  },
  "workspace.navigate_panel_right": () => {
    navigatePanel("right");
  },
  "workspace.cycle_layout_preset": () => {
    useLayoutPresetStore.getState().cyclePresets();
  },
  "workspace.show_shortcuts": () => {
    useCommandStore.getState().toggleShortcutsPanel();
  },
  "workspace.toggle_vim_mode": () => {
    const profile = useKeybindProfileStore.getState();
    const on = !profile.profile.vimMode;
    profile.setVimMode(on);
    toast.info(on ? "Vim mode on" : "Vim mode off", { duration: 1500 });
  },
  "workspace.open_agent": () => {
    useAgentStore.getState().open();
  },
  "workspace.close_panel": () =>
    closeTopPanel()
      ? undefined
      : { status: "ERROR", message: "No panel is open", payload: null, followUpCommands: [] },
  "workspace.reopen_last_thread": () => {
    const lastThread = useShellStore.getState().lastClosedThreadId;
    if (lastThread) useShellStore.getState().openThreadForMessage(lastThread);
    else toast.info("No thread to reopen");
  },
  "workspace.cycle_recent_activity": () => {
    cycleRecentActivity();
  },
  "chat.create_channel": () => {
    // Switch to the conversation surface, then open the channel dialog
    useShellStore.getState().setMainSurface({ kind: "conversation" });
    useShellStore.getState().setShowNewChannelDialog(true);
  },
  "chat.create_group": () => {
    // Switch to the conversation surface, then open the new message picker
    useShellStore.getState().setMainSurface({ kind: "conversation" });
    useShellStore.getState().setShowNewMessagePicker(true);
  },
  "chat.scroll_to_bottom": () => {
    document.querySelector("[data-message-list]")?.scrollTo({ top: 999999, behavior: "smooth" });
  },
  "chat.scroll_to_top": () => {
    document.querySelector("[data-message-list]")?.scrollTo({ top: 0, behavior: "smooth" });
  },
  "chat.copy_message_text": (_args, commandContext) => {
    const selected = selectedMessageInList(commandContext);
    if (!selected) return;
    const text = selected.actions.textOf(selected.messageId);
    if (text === null) toast.info(SELECT_A_MESSAGE);
    else copyToClipboard(text);
  },
  "chat.open_thread": (args, commandContext) => {
    // The agent names the root message; a person's surfaces act on the selected message.
    const rootMessageId =
      argString(args, "rootMessageId", "root_message_id") ?? selectedMessageOf(commandContext);
    if (rootMessageId) useShellStore.getState().openThreadForMessage(rootMessageId);
    else toast.info(SELECT_A_MESSAGE);
  },
  "chat.reply_to_selected_message": (_args, commandContext) => {
    const selected = selectedMessageInList(commandContext);
    if (selected && !selected.actions.reply(selected.messageId)) {
      toast.info("You can't reply in this conversation");
    }
  },
  "chat.edit_message": (_args, commandContext) => {
    const selected = selectedMessageInList(commandContext);
    if (selected && !selected.actions.edit(selected.messageId)) {
      toast.info("Only your own messages can be edited");
    }
  },
  "chat.report_message": (_args, commandContext) => {
    const selected = selectedMessageInList(commandContext);
    if (selected && !selected.actions.report(selected.messageId)) {
      toast.info("Your own messages can't be reported");
    }
  },
  "chat.mark_all_as_read": () => {
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    if (!workspaceId) return;
    markWorkspaceRead(workspaceId);
  },
  "chat.mark_as_unread": (args, commandContext) => {
    const workspaceId = spaceOf(args ?? {});
    const conversationId =
      argString(args, "conversationId", "conversation_id") ??
      useShellStore.getState().selectedConversationId;
    const messageId =
      argString(args, "messageId", "message_id") ?? selectedMessageOf(commandContext);
    if (!workspaceId || !conversationId || !messageId) {
      toast.info("Select a message to mark unread from");
      return;
    }
    if (!spaceMarksUnread(workspaceId)) {
      toast.error("This workspace's server does not support marking unread yet");
      return;
    }
    void markAsUnread({ workspaceId, conversationId, messageId });
  },
  "workspace.reload_commands": () => {
    reloadCommands();
    return resultText("Commands reloaded");
  },
  "admin.invite_member": () => {
    useShellStore.getState().setShowInviteDialog(true);
  },
  "workspace.toggle_lens_picker": () => {
    const shell = useShellStore.getState();
    const conversationId = shell.selectedConversationId;
    if (!conversationId) {
      toast.info(OPEN_A_CONVERSATION);
      return;
    }
    const conversation = findCachedConversation(
      queryClient,
      useWorkspaceStore.getState().workspaceId ?? undefined,
      conversationId,
    );
    if (conversation && conversation.conversationType !== ConversationTypeEnum.CHANNEL) {
      toast.info("Lenses are offered in channels");
      return;
    }
    shell.setMainSurface({ kind: "conversation" });
    const store = useLensStore.getState();
    store.setLensPickerOpen(!store.lensPickerOpen);
  },
  "workspace.toggle_zen_mode": () => {
    const shell = useShellStore.getState();
    shell.toggleZenMode();
    const nowZen = useShellStore.getState().zenMode;
    toast.info(nowZen ? "Zen Mode on" : "Zen Mode off", { duration: 1500 });
  },
  "workspace.cycle_display_density": () => {
    const shell = useShellStore.getState();
    shell.cycleDisplayDensity();
    const density = useShellStore.getState().displayDensity;
    const labels: Record<string, string> = {
      comfortable: "Comfortable",
      compact: "Compact",
      "ultra-compact": "Ultra Compact",
    };
    toast.info(labels[density] ?? density, { duration: 1500 });
  },
  [QUIT_COMMAND_ID]: () => {
    void requestQuit();
  },
  ...GENERAL_HANDLERS,
  ...AGENT_HANDLERS,
};

/**
 * Commands a person may run without the argument they need, each with the argument's name as
 * the server declares it and what asks for it instead of running an incomplete command: a
 * client surface to `open`, or a `picker` of targets in the command palette. `alias` is the
 * argument's other spelling, which counts as given too.
 */
const argumentPrompts: Record<
  string,
  { argument: string; alias?: string } & ({ open: () => void } | { picker: TargetPickerKind })
> = {
  "chat.search_messages": {
    argument: "query",
    open: () => useSearchOverlayStore.getState().openWithScope({ kind: "all" }),
  },
  "workspace.navigate_to_channel": {
    argument: "conversation_id",
    alias: "conversationId",
    picker: "channel",
  },
  "workspace.navigate_to_dm": {
    argument: "conversation_id",
    alias: "conversationId",
    picker: "direct",
  },
  "workspace.switch_workspace": {
    argument: "workspace_id",
    alias: "workspaceId",
    picker: "workspace",
  },
  "chat.join_channel": {
    argument: "conversation_id",
    alias: "conversationId",
    picker: "joinableChannel",
  },
  ...GENERAL_ARGUMENT_PROMPTS,
  ...AGENT_ARGUMENT_PROMPTS,
};

/** The kind of target the palette asks for before it runs `commandId`, if it asks. */
export function targetPickerKind(commandId: string): TargetPickerKind | undefined {
  if (!Object.prototype.hasOwnProperty.call(argumentPrompts, commandId)) return undefined;
  const prompt = argumentPrompts[commandId];
  return "picker" in prompt ? prompt.picker : undefined;
}

/** Whether this app runs `commandId` itself, so it needs none of the server's arguments. */
export function hasLocalHandler(commandId: string): boolean {
  return Object.prototype.hasOwnProperty.call(localHandlers, commandId);
}

/** The argument a client surface asks for when `commandId` runs without it, if any. */
export function argumentPromptName(commandId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(argumentPrompts, commandId)
    ? argumentPrompts[commandId].argument
    : undefined;
}

/**
 * Opens the surface that asks for a command's missing argument.
 *
 * @returns `true` when the command has an argument prompt, runs as a single command rather
 * than a pipe stage and lacks a non-blank value for that argument; the prompt is then open.
 */
function openArgumentPrompt(
  commandId: string,
  args: Record<string, unknown> | undefined,
  isPipe: boolean | undefined,
): boolean {
  const prompt = argumentPrompts[commandId];
  if (!prompt || isPipe) return false;
  if (argString(args, prompt.argument, ...(prompt.alias ? [prompt.alias] : []))) return false;
  if ("picker" in prompt) {
    useCommandStore.getState().openTargetPicker({ commandId, kind: prompt.picker });
  } else {
    prompt.open();
  }
  return true;
}

/**
 * Runs the local handler of a `DESKTOP_LOCAL` command for the AI agent. The server refuses
 * to execute desktop-local commands, so agent tool calls for them land here instead of
 * `executeCommand`. Returns `false` when no local handler exists, and for the commands that
 * answer and manage agents, which run only from the person's own surfaces. Only meant for
 * `DESKTOP_LOCAL` commands: several backend commands also have local handlers that open a
 * dialog for a human, which is not what an agent call should do. The handler gets no selected
 * message: a command on one acts only on the message its arguments name.
 */
export function runDesktopLocalCommand(commandId: string, args?: Record<string, unknown>): boolean {
  // Answering and managing agents is the person's own act, never run for an agent.
  if (AGENT_MANAGEMENT_COMMAND_IDS.has(commandId)) return false;
  const handler = localHandlers[commandId];
  if (!handler) return false;
  handler(args, {});
  return true;
}

/**
 * Backend commands whose local handler acts on the arguments typed in the message box itself,
 * rather than leaving them to the server.
 */
const HANDLERS_TAKING_TYPED_ARGUMENTS: ReadonlySet<string> = new Set(["chat.mark_as_unread"]);

/**
 * Whether a run with `typedArgs` goes to the server instead of the local handler of `command`: a
 * backend command whose local handler opens a dialog or acts on the selected message, run with
 * arguments typed for the server.
 */
export function typedArgumentsGoToServer(
  command: Pick<CommandDefinition, "id" | "executionTarget">,
  typedArgs: Record<string, unknown> | undefined,
): boolean {
  return (
    command.executionTarget === "BACKEND" &&
    hasLocalHandler(command.id) &&
    !HANDLERS_TAKING_TYPED_ARGUMENTS.has(command.id) &&
    typedArgs !== undefined &&
    Object.keys(typedArgs).length > 0
  );
}

const MUTE_CONVERSATION_COMMAND_ID = "notifications.mute_conversation";

/**
 * Turns a person's "mute until tomorrow" into an explicit end at 09:00 on this device's clock,
 * because the server does not know the person's timezone. Other commands and durations are
 * returned unchanged.
 */
export function withLocalTomorrowMorning(
  commandId: string,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (commandId !== MUTE_CONVERSATION_COMMAND_ID || args?.duration !== "until_tomorrow") {
    return args;
  }
  return { ...args, duration: "until", until: tomorrowMorning().toISOString() };
}

export async function dispatchCommand(
  command: CommandDefinition,
  executeBackend: ExecuteBackendCommand,
  context?: {
    args?: Record<string, unknown>;
    commandContext?: Record<string, unknown>;
    /** Lets the plugin host run a dangerous plugin command without asking the user again. */
    confirmedDangerous?: boolean;
    isPipe?: boolean;
    /** Set when a plugin panel asks to run a command; the host then refuses other plugins' commands. */
    callerPluginId?: string;
    /**
     * Set when `args` were typed in the message box: a backend command then runs on the server
     * with them, even when this app has a handler that would run it without them.
     */
    typedArgs?: boolean;
    /**
     * Set by the surfaces a person runs commands from (the palette, keybinds, quick boxes): a
     * backend command lacking required arguments opens the argument form instead of failing,
     * and runs with what is filled in there.
     */
    askForArguments?: boolean;
    /** Called with the arguments a command runs with once the argument form has added to them. */
    onArguments?: (args: Record<string, unknown>) => void;
  },
): Promise<CommandResult | null> {
  // A command that lacks the argument a surface asks for opens that surface instead.
  if (openArgumentPrompt(command.id, context?.args, context?.isPipe)) {
    return {
      status: "SUCCESS",
      message: "",
      payload: LOCAL_ACTION_PAYLOAD,
      followUpCommands: [],
    };
  }

  // A local handler takes precedence, even over a backend target: it opens a dialog or acts as
  // the app does, unless arguments typed for the server were given.
  const localHandler = localHandlers[command.id];
  if (localHandler && !(context?.typedArgs && typedArgumentsGoToServer(command, context.args))) {
    const result = localHandler(context?.args, context?.commandContext);
    if (result) return result;
    return {
      status: "SUCCESS",
      message: "",
      payload: LOCAL_ACTION_PAYLOAD,
      followUpCommands: [],
    };
  }

  if (isOpenPluginPanelCommand(command.id)) {
    return openPluginPanelCommand(command);
  }

  const settingsTarget = openPluginSettingsTarget(command.id);
  if (settingsTarget) {
    openPluginSettings(settingsTarget);
    return { status: "SUCCESS", message: "", payload: null, followUpCommands: [] };
  }

  // Plugin commands (identified by composite ID like "plugin.my-plugin.command")
  const pluginCmd = parsePluginCommandId(command.id);
  if (pluginCmd) {
    // A command that requires a context gets its ids as arguments, and never runs without it.
    const requiredContext = [
      ...command.requiredContext,
      ...(findPluginCommand(command.id)?.required_context ?? []),
    ];
    const prepared = withContextArguments(requiredContext, context?.args, context?.commandContext);
    if (!prepared.ok) {
      return { status: "ERROR", message: prepared.message, payload: null, followUpCommands: [] };
    }
    return dispatchPluginCommand(
      pluginCmd.pluginId,
      pluginCmd.command,
      prepared.args,
      context?.confirmedDangerous,
      context?.callerPluginId,
    );
  }

  if (command.executionTarget === "DESKTOP_LOCAL") {
    logger.warn(`[RIM] No local handler for command: ${command.id}`);
    return {
      status: "ERROR",
      message: `No local handler for ${command.id}`,
      payload: null,
      followUpCommands: [],
    };
  }

  // A command on the selected message never reaches the server without one.
  if (
    !context?.isPipe &&
    command.requiredContext.includes("selected_message") &&
    !selectedMessageOf(context?.commandContext ?? {}) &&
    !argString(context?.args, "message_id", "messageId")
  ) {
    return { status: "ERROR", message: SELECT_A_MESSAGE, payload: null, followUpCommands: [] };
  }

  // A person's surface asks for the arguments it lacks, then runs the command with them.
  if (context?.askForArguments && !context.isPipe && !context.callerPluginId) {
    const asked = await askForMissingArguments(command, context.args, context.commandContext);
    if (asked.kind === "refused") {
      return { status: "ERROR", message: asked.message, payload: null, followUpCommands: [] };
    }
    if (asked.kind === "cancelled") {
      return {
        status: "ERROR",
        message: "Cancelled",
        payload: CANCELLED_PAYLOAD,
        followUpCommands: [],
      };
    }
    if (asked.kind === "filled") {
      context.onArguments?.(asked.args);
      return dispatchCommand(command, executeBackend, {
        ...context,
        args: withLocalTomorrowMorning(command.id, asked.args),
        askForArguments: false,
      });
    }
  }
  const args =
    context?.askForArguments && !context.isPipe && !context.callerPluginId
      ? withLocalTomorrowMorning(command.id, context.args)
      : context?.args;

  if (
    !context?.isPipe &&
    !(await confirmConversationCommand(command.id, args, context?.commandContext))
  ) {
    return {
      status: "ERROR",
      message: "Cancelled",
      payload: CANCELLED_PAYLOAD,
      followUpCommands: [],
    };
  }

  // Backend command: a dangerous one is held until the user confirms it in the dialog.
  const outcome = await runWithHumanConfirmation(
    async (confirmation) => {
      const result = await executeBackend({
        commandId: command.id,
        args,
        commandContext: context?.commandContext,
        isPipe: context?.isPipe,
        ...(confirmation && { confirmation }),
      });
      return result.executeCommand;
    },
    {
      commandId: command.id,
      title: withClientLabel(command).title || command.id,
      description: withClientLabel(command).description || undefined,
      args,
      argumentTypes: argumentTypesOf(command.arguments),
      sensitivity: command.sensitivity,
      dangerous: command.dangerous,
    },
  );
  return commandResultOf(outcome);
}

/** How asking for a command's missing arguments ended. */
type AskedArguments =
  | { kind: "complete" }
  | { kind: "filled"; args: Record<string, unknown> }
  | { kind: "cancelled" }
  | { kind: "refused"; message: string };

function contextString(context: Record<string, unknown> | undefined, key: string) {
  const value = context?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Asks for the required arguments of `command` that neither `args`, `commandContext` nor an
 * argument prompt supplies. One that only the context can supply (a message, a thread, selected
 * text) is never asked for: the command is refused with what to select first.
 *
 * @returns `complete` when nothing is missing, `filled` with `args` and the submitted values,
 *   `cancelled` when the person dismissed the form, or `refused` with the reason.
 */
async function askForMissingArguments(
  command: CommandDefinition,
  args: Record<string, unknown> | undefined,
  commandContext: Record<string, unknown> | undefined,
): Promise<AskedArguments> {
  const argumentContext = {
    workspaceId: contextString(commandContext, "workspaceId"),
    conversationId: contextString(commandContext, "conversationId"),
    selectedMessageId: contextString(commandContext, "selectedMessageId"),
  };
  const prompted = argumentPromptName(command.id);
  const missing = (command.arguments ?? []).filter(
    (argument) =>
      argument.required &&
      argument.name !== prompted &&
      !argumentGiven(args, argument.name) &&
      !contextSuppliesArgument(argument, argumentContext),
  );
  if (missing.length === 0) return { kind: "complete" };
  const contextOnly = missing.find((argument) => !formAsksFor(argument));
  if (contextOnly) {
    return { kind: "refused", message: contextOnlyArgumentMessage(contextOnly.argumentType) };
  }
  // The members and conversations offered are those of the workspace the command runs in.
  const givenWorkspace = (command.arguments ?? [])
    .filter((argument) => argument.argumentType === CommandArgumentType.WORKSPACE_ID)
    .map((argument) => argString(args, argument.name, camelCaseName(argument.name)))
    .find((value) => value !== undefined);
  const values = await useCommandArgumentsStore.getState().ask({
    title: withClientLabel(command).title || command.id,
    arguments: missing,
    workspaceId: givenWorkspace ?? argumentContext.workspaceId,
  });
  if (values === null) return { kind: "cancelled" };
  return { kind: "filled", args: { ...args, ...values } };
}

/** Opens the plugin panel an open-panel command names, when its plugin is running. */
function openPluginPanelCommand(command: CommandDefinition): CommandResult {
  const plugins = queryClient.getQueryData<PluginInfo[]>(queryKeys.plugins());
  const target = findOpenPluginPanelTarget(plugins && withWebHealth(plugins), command.id);
  if (!target) {
    return {
      status: "ERROR",
      message: "The plugin with this panel is not running",
      payload: null,
      followUpCommands: [],
    };
  }
  useShellStore
    .getState()
    .openPluginPanel(target.pluginId, target.panel.id, panelSlot(target.panel));
  return { status: "SUCCESS", message: "", payload: null, followUpCommands: [] };
}

/**
 * The `CommandResult` a confirmed run ends in. A cancelled or expired confirmation is an
 * `ERROR` with the cancelled payload, so callers show nothing more.
 */
export function commandResultOf(outcome: HumanConfirmationOutcome<CommandResult>): CommandResult {
  switch (outcome.kind) {
    case "completed":
      return outcome.result;
    case "cancelled":
    case "stale":
      return {
        status: "ERROR",
        message: "Cancelled",
        payload: CANCELLED_PAYLOAD,
        followUpCommands: [],
      };
    case "unconfirmed":
      return { status: "ERROR", message: outcome.message, payload: null, followUpCommands: [] };
  }
}

/**
 * Send a plugin command to its host: the web plugin host in this page for an
 * installed WebSandboxed plugin, else the desktop's Rust host (which the web
 * does not have, so a local-process command there needs the desktop app).
 * Both answer in the same shape.
 */
async function runPluginCommand(
  pluginId: string,
  command: string,
  args: Record<string, unknown>,
  confirmed: boolean,
  callerPluginId?: string,
): Promise<SafeInvokeResult<PluginCommandResult>> {
  const web = webPluginHost.resolve(pluginId, command) !== null || webPluginHost.knows(pluginId);
  if (!web) {
    return safeInvoke<PluginCommandResult>("plugin_execute_command", {
      pluginId,
      command,
      args,
      confirmedDangerous: confirmed,
      callerPluginId: callerPluginId ?? null,
    });
  }
  try {
    const output = await webPluginHost.execute({
      pluginId,
      commandId: command,
      args,
      confirmed,
      callerPluginId,
      initiator: "user",
    });
    return { ok: true, value: { status: "ok", payload: output.payload, message: output.message } };
  } catch (error) {
    const code = error instanceof WebCommandError ? error.kind : "INTERNAL_ERROR";
    const message = error instanceof Error ? error.message : String(error);
    const data = error instanceof WebCommandError ? error.data : undefined;
    return {
      ok: false,
      error:
        data === undefined
          ? { kind: "backend_error", code, message }
          : { kind: "backend_error", code, message, data },
    };
  }
}

async function dispatchPluginCommand(
  pluginId: string,
  command: string,
  args?: Record<string, unknown>,
  confirmedDangerous?: boolean,
  callerPluginId?: string,
): Promise<CommandResult> {
  // The host resolves the id against installed manifests, gates `dangerous`
  // commands on `confirmedDangerous`, and sends the command to the plugin.
  const run = (confirmed: boolean) =>
    runPluginCommand(pluginId, command, args ?? {}, confirmed, callerPluginId);
  let result = await run(confirmedDangerous ?? false);

  // The host refused a dangerous command nobody confirmed. Ask the user here,
  // whichever surface ran it (palette, keybind, panel), and run it only on a yes.
  if (
    !result.ok &&
    result.error.kind === "backend_error" &&
    result.error.code === "CONFIRMATION_REQUIRED" &&
    !confirmedDangerous
  ) {
    const qualifiedId = `plugin.${pluginId}.${command}`;
    const info = findPluginCommand(qualifiedId);
    const confirmed = await usePluginConfirmStore.getState().ask({
      // Without the plugin list the id cannot be split reliably (plugin ids
      // have dots), so the dialog names the whole command id.
      pluginName: info?.pluginName ?? "A plugin",
      commandTitle: info?.title ?? qualifiedId,
      description: info?.description ?? "",
      args: args ?? {},
    });
    if (!confirmed) {
      return {
        status: "ERROR",
        message: "Cancelled",
        payload: CANCELLED_PAYLOAD,
        followUpCommands: [],
      };
    }
    result = await run(true);
  }

  if (!result.ok) {
    logger.debug(`[RIM:Plugin] Failed to execute: ${pluginId}.${command}`, result.error);
    return {
      status: "ERROR",
      message:
        result.error.kind === "ipc_unavailable"
          ? "Plugin commands need the desktop app"
          : result.error.message.replace(/^plugin error: /, ""),
      payload: null,
      followUpCommands: [],
    };
  }
  return {
    status: "SUCCESS",
    message: result.value.message ?? "Plugin command executed",
    payload: result.value.payload,
    followUpCommands: [],
  };
}
