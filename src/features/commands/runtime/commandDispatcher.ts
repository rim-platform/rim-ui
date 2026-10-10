import type { CommandDefinition, CommandResult } from "../types";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { useCommandStore } from "../state/useCommandStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useAgentStore } from "../../agent/state/useAgentStore";
import { parsePluginCommandId } from "../../plugins/api/usePluginCommands";
import { CANCELLED_PAYLOAD, findPluginCommand } from "../../plugins/runtime/pluginCommandInfo";
import { usePluginConfirmStore } from "../../plugins/state/usePluginConfirmStore";
import type { PluginCommandResult } from "../../plugins/types";
import { WebCommandError, webPluginHost } from "../../plugins/web/webPluginHost";
import { safeInvoke, type SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useLensStore } from "../../lenses/state/useLensStore";
import { useIncidentStore } from "../../incidents/state/useIncidentStore";
import { useOnCallStore } from "../../oncall/state/useOnCallStore";
import { MARK_ALL_AS_READ } from "../../conversations/api/useMarkAsRead";
import { graphqlClient } from "../../../core/graphql/client";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { reloadCommands } from "../api/useCommands";
import type { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { canModerate } from "../../workspaces/role";
import {
  FEATURE_DISABLED,
  FeatureDisabledError,
  graphqlErrorCode,
  graphqlErrorMessage,
  TIMED_OUT,
} from "../../../core/graphql/errors";
import { getCachedFeatureEnabled } from "../../workspaces/api/useWorkspaceFeatures";
import { FEATURE_OFF_MESSAGE, featureForCommandId } from "../../workspaces/featureCatalog";
import { gql } from "graphql-request";
import { navigatePanel } from "../../../shell/navigation/spatialNavigation";
import { useLayoutPresetStore } from "../../../shell/state/useLayoutPresetStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";

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
  confirmedDangerous?: boolean;
  isPipe?: boolean;
}) => Promise<{ executeCommand: CommandResult }>;

/**
 * Toast text for a failed incident/on-call call: the server's own message when the
 * workspace feature is off (`FEATURE_DISABLED`), otherwise the handler's generic fallback.
 */
function commandFailureMessage(err: unknown, fallback: string): string {
  const code = graphqlErrorCode(err);
  return code === FEATURE_DISABLED || code === TIMED_OUT
    ? graphqlErrorMessage(err, fallback)
    : fallback;
}

/**
 * Refuse a command up front when the active workspace's cached flags say its feature is off
 * (Track 0.4). Covers the desktop-local `incident.*` / `oncall.*` handlers, which never reach
 * the server's own `FEATURE_DISABLED` gate, and keybinds that fire before the (already
 * server-filtered) command list loads. When the flags are not cached yet the command goes
 * ahead and the server decides.
 */
function assertFeatureEnabled(command: CommandDefinition): void {
  const feature = command.feature ?? featureForCommandId(command.id);
  if (!feature) return;
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (workspaceId && getCachedFeatureEnabled(workspaceId, feature) === false) {
    throw new FeatureDisabledError(FEATURE_OFF_MESSAGE[feature]);
  }
}

const RESOLVE_INCIDENT_GQL = gql`
  mutation ResolveIncident($incidentId: ID!) {
    resolveIncident(incidentId: $incidentId) {
      id
      status
      resolvedAt
    }
  }
`;

function resolveIncidentFromCommand(
  incidentId: string,
  workspaceId: string,
  conversationId: string,
) {
  graphqlClient
    .request(RESOLVE_INCIDENT_GQL, { incidentId })
    .then(() => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.activeIncident(workspaceId, conversationId),
      });
      toast.success("Incident resolved");
    })
    .catch((err: unknown) => {
      toast.error(commandFailureMessage(err, "Failed to resolve incident"));
    });
}

/**
 * Ack via the primary unified-dispatch path (Track C1c): `incident.ack` is
 * `Mutating`/`dangerous:false`, and `requires_confirmation_for_initiator` only fires for the
 * `Restricted` tier, the `dangerous` flag, or agentic+>=Mutating dispatch — every C1 human ack
 * surface (palette/keybind/context-menu/banner button/paged-toast) is non-agentic, so this is
 * single-action with no confirmation prompt. There is deliberately no direct-mutation
 * fallback — this keeps ack consistent with the other three C1 builtins and pre-fits C2.
 */
function ackIncidentFromCommand(
  incidentId: string,
  workspaceId: string,
  conversationId: string,
  executeBackend: ExecuteBackendCommand,
) {
  executeBackend({ commandId: "incident.ack", args: { incidentId } })
    .then((res) => {
      if (res.executeCommand.status === "ERROR") {
        toast.error(res.executeCommand.message || "Failed to acknowledge incident");
        return;
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.activeIncident(workspaceId, conversationId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.incidentTimeline(incidentId) });
      toast.success("Incident acknowledged");
    })
    .catch((err: unknown) => {
      toast.error(commandFailureMessage(err, "Failed to acknowledge incident"));
    });
}

/** Reads the viewer's cached server role (no extra round-trip) to gate `oncall.take_shift`. */
function canManageOnCall(workspaceId: string): boolean {
  const server = queryClient.getQueryData<{ viewerRole: ServerMemberRoleGql }>(
    queryKeys.server(workspaceId),
  );
  return canModerate(server?.viewerRole);
}

// Registry of desktop-local command handlers. `dispatchCommand` checks this map FIRST for
// every dispatch path (palette AND keybind), so a bare keybind fires the handler with no
// args, and the handler supplies FE-computed args — see `incident.start`/`incident.resolve`
// above and the four Track C1 builtins below for the pattern.
const localHandlers: Record<
  string,
  (args: Record<string, unknown> | undefined, executeBackend: ExecuteBackendCommand) => void
> = {
  "workspace.open_command_palette": () => {
    useCommandStore.getState().toggleCommandPalette();
  },
  "workspace.open_settings": () => {
    useShellStore.getState().setMainSurface({ kind: "settings" });
  },
  "workspace.open_search": () => {
    useSearchOverlayStore.getState().openWithScope({ kind: "all" });
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
  "workspace.toggle_sidebar": () => {
    useShellStore.getState().toggleSidebar();
  },
  "workspace.focus_composer": () => {
    document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
  },
  "workspace.focus_message_list": () => {
    document.querySelector<HTMLDivElement>("[data-message-list]")?.focus();
  },
  "workspace.navigate_to_channel": (args) => {
    if (args?.conversationId) {
      useShellStore.getState().setSelectedConversationId(args.conversationId as string);
    } else {
      // No specific channel — open command palette so the user can pick one
      useCommandStore.getState().openCommandPalette();
    }
  },
  "workspace.navigate_to_dm": (args) => {
    if (args?.conversationId) {
      useShellStore.getState().setSelectedConversationId(args.conversationId as string);
    }
  },
  "workspace.switch_workspace": (args) => {
    if (args?.workspaceId) {
      useWorkspaceStore.getState().setWorkspaceId(args.workspaceId as string);
    }
  },
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
    if (unread.length === 0) return;
    const current = useShellStore.getState().selectedConversationId;
    const allIds = getCachedConversationIds();
    const currentIdx = current ? allIds.indexOf(current) : -1;
    // Find the first unread channel after the current position
    const after = unread.find((id) => allIds.indexOf(id) > currentIdx);
    useShellStore.getState().setSelectedConversationId(after ?? unread[0]);
  },
  "workspace.previous_unread_channel": () => {
    const unread = getCachedUnreadConversationIds();
    if (unread.length === 0) return;
    const current = useShellStore.getState().selectedConversationId;
    const allIds = getCachedConversationIds();
    const currentIdx = current ? allIds.indexOf(current) : allIds.length;
    // The last unread conversation before the current position, wrapping to the last one.
    const before = [...unread].reverse().find((id) => allIds.indexOf(id) < currentIdx);
    useShellStore.getState().setSelectedConversationId(before ?? unread[unread.length - 1]);
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
  "workspace.close_panel": () => {
    const shell = useShellStore.getState();
    if (shell.isThreadOpen) {
      shell.closeThread();
    } else if (shell.mainSurface.kind !== "conversation") {
      shell.setMainSurface({ kind: "conversation" });
    }
  },
  "workspace.reopen_last_thread": () => {
    const lastThread = useShellStore.getState().lastClosedThreadId;
    if (lastThread) useShellStore.getState().openThreadForMessage(lastThread);
  },
  "workspace.cycle_recent_activity": () => {
    // Cycle to the next conversation in the list (wrapping), same as next_channel.
    // A dedicated recent-activity stack can be added later when the backend tracks it.
    const ids = getCachedConversationIds();
    if (ids.length === 0) return;
    const current = useShellStore.getState().selectedConversationId;
    const idx = current ? ids.indexOf(current) : -1;
    const next = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : ids[0];
    useShellStore.getState().setSelectedConversationId(next);
  },
  "chat.create_channel": () => {
    // Ensure we're on the conversation surface, then open the channel dialog
    useShellStore.getState().setMainSurface({ kind: "conversation" });
    useShellStore.getState().setShowNewChannelDialog(true);
  },
  "chat.create_group": () => {
    // Ensure we're on the conversation surface, then open the new message picker
    useShellStore.getState().setMainSurface({ kind: "conversation" });
    useShellStore.getState().setShowNewMessagePicker(true);
  },
  "chat.scroll_to_bottom": () => {
    document.querySelector("[data-message-list]")?.scrollTo({ top: 999999, behavior: "smooth" });
  },
  "chat.scroll_to_top": () => {
    document.querySelector("[data-message-list]")?.scrollTo({ top: 0, behavior: "smooth" });
  },
  "chat.copy_message_text": () => {
    logger.debug("[RIM] copy_message_text: handled at context menu level");
  },
  "chat.open_thread": (args) => {
    // The context menu opens threads itself; the agent (Track 4.1) passes the root message id.
    if (typeof args?.rootMessageId === "string") {
      useShellStore.getState().openThreadForMessage(args.rootMessageId);
    } else {
      logger.debug("[RIM] open_thread: handled at context menu level");
    }
  },
  "chat.mark_all_as_read": () => {
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    if (workspaceId) {
      useUnreadStore.getState().markAllRead();
      graphqlClient.request(MARK_ALL_AS_READ, { input: { workspaceId } }).catch(() => {
        toast.error("Failed to mark all as read");
      });
    }
  },
  "workspace.reload_commands": () => {
    reloadCommands();
  },
  "admin.invite_member": () => {
    useShellStore.getState().setShowInviteDialog(true);
  },
  "workspace.toggle_lens_picker": () => {
    const store = useLensStore.getState();
    store.setLensPickerOpen(!store.lensPickerOpen);
  },
  "incident.start": () => {
    useIncidentStore.getState().setShowStartDialog(true);
  },
  "incident.advance_phase": () => {
    // Handled via the banner UI — this is a fallback entry point
    const incident = useIncidentStore.getState().activeIncident;
    if (!incident) {
      toast.error("No active incident");
    }
    // The banner dropdown handles the actual phase advance
  },
  "incident.resolve": () => {
    const incident = useIncidentStore.getState().activeIncident;
    if (!incident) {
      toast.error("No active incident");
      return;
    }
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    const conversationId = useShellStore.getState().selectedConversationId;
    if (!workspaceId || !conversationId) return;
    resolveIncidentFromCommand(incident.id, workspaceId, conversationId);
  },
  "incident.generate_postmortem": () => {
    const incident = useIncidentStore.getState().activeIncident;
    if (!incident) {
      toast.error("No active incident");
      return;
    }
    useIncidentStore.getState().setShowPostmortem(true);
  },
  // ── Track C1 builtins (oncall.who / oncall.take_shift / incident.ack / incident.escalate)
  "incident.ack": (_args, executeBackend) => {
    const incident = useIncidentStore.getState().activeIncident;
    if (!incident) {
      toast.error("No active incident");
      return;
    }
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    const conversationId = useShellStore.getState().selectedConversationId;
    if (!workspaceId || !conversationId) return;
    ackIncidentFromCommand(incident.id, workspaceId, conversationId, executeBackend);
  },
  "incident.escalate": (_args, executeBackend) => {
    const incident = useIncidentStore.getState().activeIncident;
    if (!incident) {
      toast.error("No active incident");
      return;
    }
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    const conversationId = useShellStore.getState().selectedConversationId;
    if (!workspaceId || !conversationId) return;
    executeBackend({ commandId: "incident.escalate", args: { incidentId: incident.id } })
      .then((res) => {
        if (res.executeCommand.status === "ERROR") {
          toast.error(res.executeCommand.message || "Failed to escalate incident");
          return;
        }
        queryClient.invalidateQueries({
          queryKey: queryKeys.activeIncident(workspaceId, conversationId),
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.incidentTimeline(incident.id) });
        toast.success("Incident escalated");
      })
      .catch((err: unknown) =>
        toast.error(commandFailureMessage(err, "Failed to escalate incident")),
      );
  },
  "oncall.who": () => {
    useShellStore.getState().setMainSurface({ kind: "incidents", tab: "oncall" });
  },
  "oncall.take_shift": () => {
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    if (!workspaceId) return;
    if (!canManageOnCall(workspaceId)) {
      toast.error("Managing on-call requires Moderator");
      return;
    }
    // The backend command stays a general primitive requiring explicit args — correct for
    // macro/pipeline/agent use. The interactive FE supplies them via this modal on confirm
    // (createOnCallOverride), not by re-dispatching this command with args.
    useOnCallStore.getState().openOverrideModal();
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
};

const noBackend: ExecuteBackendCommand = () =>
  Promise.reject(new Error("desktop-local commands do not reach the backend"));

/**
 * Runs the local handler of a `DESKTOP_LOCAL` command for the AI agent (Track 4.1). The
 * server refuses to execute desktop-local commands, so agent tool calls for them land here
 * instead of `executeCommand`. Returns `false` when no local handler exists. Only meant for
 * `DESKTOP_LOCAL` commands: several backend commands also have local handlers that open a
 * dialog for a human, which is not what an agent call should do.
 */
export function runDesktopLocalCommand(commandId: string, args?: Record<string, unknown>): boolean {
  const handler = localHandlers[commandId];
  if (!handler) return false;
  handler(args, noBackend);
  return true;
}

export async function dispatchCommand(
  command: CommandDefinition,
  executeBackend: ExecuteBackendCommand,
  context?: {
    args?: Record<string, unknown>;
    commandContext?: Record<string, unknown>;
    confirmedDangerous?: boolean;
    isPipe?: boolean;
    /** Set when a plugin panel asks to run a command; the host then refuses other plugins' commands. */
    callerPluginId?: string;
  },
): Promise<CommandResult | null> {
  // Feature-gated commands (Track 0.4) are refused before any handler runs. Throws
  // `FeatureDisabledError`, which callers surface like the server's `FEATURE_DISABLED`.
  assertFeatureEnabled(command);

  // Local handlers always take precedence — even if the backend marks a
  // command as "Backend", the frontend may have a local handler that opens
  // a dialog or performs a client-side action instead.
  const localHandler = localHandlers[command.id];
  if (localHandler) {
    localHandler(context?.args, executeBackend);
    return { status: "SUCCESS", message: "Executed locally", payload: null, followUpCommands: [] };
  }

  // Plugin commands (identified by composite ID like "plugin.my-plugin.command")
  const pluginCmd = parsePluginCommandId(command.id);
  if (pluginCmd) {
    return dispatchPluginCommand(
      pluginCmd.pluginId,
      pluginCmd.command,
      context?.args,
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

  // Backend command
  const result = await executeBackend({
    commandId: command.id,
    args: context?.args,
    commandContext: context?.commandContext,
    confirmedDangerous: context?.confirmedDangerous,
    isPipe: context?.isPipe,
  });

  return result.executeCommand;
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
