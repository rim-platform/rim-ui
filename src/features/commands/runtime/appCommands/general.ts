import type { Pipeline } from "../../../pipelines/api/usePipelines";
import type { CommandDefinition, CommandResult } from "../../types";
import { graphqlErrorMessage } from "../../../../core/graphql/errors";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { logger } from "../../../../core/logger";
import { toast } from "../../../../shared/toast";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { findCachedConversation } from "../../../conversations/api/useConversation";
import { openDirectWithMember } from "../../../conversations/state/openDirect";
import { ConversationTypeEnum } from "../../../../core/graphql/generated/schema-types";
import { backUpHistoryNow } from "../../../history-archive/backUpNow";
import type { Macro } from "../../../macros/api/useMacros";
import { accountMacrosOn } from "../../../macros/api/useAccountMacros";
import { isMacroId } from "../../../macros/runtime/macroCommands";
import { readMacroMoves } from "../../../macros/runtime/macroMoves";
import { runLegacyMacro } from "../../../macros/runtime/runLegacyMacro";
import { runMacro } from "../../../macros/runtime/runMacro";
import { useAuthStore } from "../../../auth/state/useAuthStore";
import { togglePipeline } from "../../../pipelines/api/usePipelines";
import { useRelayStore } from "../../../relay/state/useRelayStore";
import {
  SETTINGS_TABS,
  settingsTabCommandId,
  type SettingsTab,
} from "../../../settings/settingsTabs";

import { openLogFolder } from "../../../updater/api/logFolderApi";
import { useUpdaterStore } from "../../../updater/state/useUpdaterStore";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { useAppDialogStore } from "../../state/useAppDialogStore";
import { useQuickAccessStore } from "../../state/useQuickAccessStore";
import {
  moderatesWorkspace,
  settingsTabOffered,
  updateReady,
  updaterAvailable,
} from "./generalAvailability";
import { showWorkspace, targetWorkspaceOf } from "./targetWorkspace";

export { GENERAL_ARGUMENT_PROMPTS, GENERAL_COMMANDS } from "./generalDefinitions";

/** A command this app runs itself, as the dispatcher calls it. */
type Handler = (
  args: Record<string, unknown> | undefined,
  commandContext: Record<string, unknown> | undefined,
) => void | CommandResult;

function stringArg(args: Record<string, unknown> | undefined, ...names: string[]): string {
  for (const name of names) {
    const value = args?.[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function openSettings(tab: string): void {
  useShellStore.getState().setMainSurface({ kind: "settings", tab });
}

/** Runs `action` on the desktop window, or logs why it could not. */
async function onWindow(
  name: string,
  action: (window: import("@tauri-apps/api/window").Window) => Promise<void>,
): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await action(getCurrentWindow());
  } catch (error) {
    logger.warn(`[RIM:desktop] ${name} failed:`, error);
  }
}

async function checkForUpdates(): Promise<void> {
  if (!updaterAvailable()) {
    toast.info("Updates are checked in the desktop app.");
    return;
  }
  const store = useUpdaterStore.getState();
  if (!(await store.loadStatus())) {
    toast.info("Updates are not configured in this build");
    return;
  }
  const found = await store.checkNow();
  const { error, activity } = useUpdaterStore.getState();
  if (activity !== "idle") toast.info("An update is already being handled.");
  else if (error && !found) toast.error("The update check did not finish.", { description: error });
  else if (found)
    toast.info(`Version ${found.version} is available.`, {
      description: "Download it in Settings > About.",
    });
  else toast.success("You have the latest version.");
}

function assignKeybind(): void {
  const { selectedConversationId } = useShellStore.getState();
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) {
    toast.info("Open a workspace first.");
    return;
  }
  const conversation = selectedConversationId
    ? findCachedConversation(queryClient, workspaceId, selectedConversationId)
    : undefined;
  if (selectedConversationId && conversation) {
    const dm = conversation.conversationType === ConversationTypeEnum.DIRECT;
    useQuickAccessStore.getState().open({
      kind: dm ? "dm" : "channel",
      conversationId: conversation.id,
      serverId: conversation.serverId,
      label: conversation.title || (dm ? "Direct message" : "Conversation"),
    });
    return;
  }
  const label =
    queryClient.getQueryData<{ name?: string }>(queryKeys.server(workspaceId))?.name ?? "Workspace";
  useQuickAccessStore.getState().open({ kind: "workspace", workspaceId, label });
}

/** Runs the workspace macro `macroId` of the open workspace. */
async function runWorkspaceMacro(macroId: string): Promise<void> {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) {
    toast.info("Open a workspace first.");
    return;
  }
  const macro = queryClient
    .getQueryData<Macro[]>(queryKeys.macros(workspaceId))
    ?.find((m) => m.id === macroId);
  if (!macro) {
    toast.info("That macro is not in this workspace.");
    return;
  }
  const commands = queryClient.getQueryData<CommandDefinition[]>(
    queryKeys.commands("PALETTE", workspaceId),
  );
  await runLegacyMacro(macro, workspaceId, commands);
}

/**
 * Runs the macro `macroId` names: one of the person's macros (`user.<key>`), a workspace macro
 * that moved into them, or a workspace macro of the open workspace.
 */
async function runMacroById(macroId: string): Promise<void> {
  if (!accountMacrosOn()) {
    await runWorkspaceMacro(macroId);
    return;
  }
  if (isMacroId(macroId)) {
    await runMacro(macroId);
    return;
  }
  const userId = useAuthStore.getState().session?.userId;
  const moved = userId ? readMacroMoves(userId)[macroId] : undefined;
  if (moved) await runMacro(moved);
  else await runWorkspaceMacro(macroId);
}

async function togglePipelineById(pipelineId: string): Promise<void> {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) {
    toast.info("Open a workspace first.");
    return;
  }
  const pipeline = queryClient
    .getQueryData<Pipeline[]>(queryKeys.pipelines(workspaceId))
    ?.find((p) => p.id === pipelineId);
  if (!pipeline) {
    toast.info("That pipeline is not in this workspace.");
    return;
  }
  try {
    await togglePipeline({ pipelineId, enabled: !pipeline.enabled });
    void queryClient.invalidateQueries({ queryKey: queryKeys.pipelines(workspaceId) });
    toast.success(`Pipeline "${pipeline.name}" turned ${pipeline.enabled ? "off" : "on"}`);
  } catch (err) {
    toast.error(graphqlErrorMessage(err, "Failed to toggle pipeline"));
  }
}

/**
 * Opens the Settings tab `tab` of the workspace the command acts in, opening that workspace
 * first, for its owners and moderators; tells anyone else it is theirs.
 */
function openIfModerator(
  tab: string,
  args: Record<string, unknown> | undefined,
  commandContext: Record<string, unknown> | undefined,
): void {
  const workspaceId = targetWorkspaceOf(args, commandContext);
  if (!workspaceId || !moderatesWorkspace(workspaceId)) {
    toast.info("This is for the owners and moderators of this workspace.");
    return;
  }
  showWorkspace(workspaceId);
  openSettings(tab);
}

/**
 * The Settings tab a tab command opens: Macros for Commands where the home server keeps the
 * person's macros as their own commands, else the tab itself.
 */
function settingsTabOpened(key: SettingsTab): SettingsTab {
  return key === "commands" && accountMacrosOn() ? "macros" : key;
}

const settingsTabHandlers: Record<string, Handler> = Object.fromEntries(
  SETTINGS_TABS.map((tab) => [
    settingsTabCommandId(tab.key),
    () => {
      const opened = settingsTabOpened(tab.key);
      if (!settingsTabOffered(opened)) {
        toast.info("That Settings page is not available here.");
        return;
      }
      openSettings(opened);
    },
  ]),
);

/** What each of {@link GENERAL_COMMANDS} does, by command id. */
export const GENERAL_HANDLERS: Record<string, Handler> = {
  ...settingsTabHandlers,
  "plugins.open_settings": () => openSettings("plugins"),
  "workspace.open_direct_messages": () => {
    const directSpaceId = useRelayStore.getState().info?.directSpaceId;
    if (!directSpaceId) {
      toast.info("Direct messages are not available here.");
      return;
    }
    useWorkspaceStore.getState().setWorkspaceId(directSpaceId);
    // Home and Unreads span every workspace, so the direct messages open in place of them.
    const shell = useShellStore.getState();
    if (shell.mainSurface.kind === "home" || shell.mainSurface.kind === "unreads") {
      shell.setMainSurface({ kind: "conversation" });
    }
  },
  "workspace.add": () => useAppDialogStore.getState().open("addWorkspace"),
  "workspace.open_workspace_settings": (args, commandContext) =>
    openIfModerator("workspace", args, commandContext),
  "workspace.open_join_requests": (args, commandContext) =>
    openIfModerator("workspace-moderation", args, commandContext),
  "people.set_status": () => useAppDialogStore.getState().open("status"),
  "people.view_profile": (args) => {
    const userId = stringArg(args, "userId", "user_id");
    if (userId) useAppDialogStore.getState().open("profile", userId);
  },
  "people.message": (args) => {
    const userId = stringArg(args, "userId", "user_id");
    if (userId) void openDirectWithMember(userId);
  },
  "app.sign_out": () => useAppDialogStore.getState().open("signOut"),
  "app.check_for_updates": () => void checkForUpdates(),
  "app.restart_to_update": () => {
    if (!updateReady()) {
      toast.info("No update is downloaded yet.");
      return;
    }
    void useUpdaterStore.getState().restartToUpdate();
  },
  "app.open_log_folder": () => {
    openLogFolder().catch((error: unknown) =>
      toast.error("The log folder could not be opened", {
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  },
  "app.minimize_window": () => void onWindow("minimize", (w) => w.minimize()),
  "app.toggle_maximize_window": () => void onWindow("toggleMaximize", (w) => w.toggleMaximize()),
  "app.close_window": () => void onWindow("close", (w) => w.close()),
  "settings.assign_keybind": assignKeybind,
  "settings.back_up_history": () => void backUpHistoryNow(),
  "app.run_macro": (args) => {
    const macroId = stringArg(args, "macroId", "macro_id");
    if (macroId) void runMacroById(macroId);
  },
  "app.toggle_pipeline": (args) => {
    const pipelineId = stringArg(args, "pipelineId", "pipeline_id");
    if (pipelineId) void togglePipelineById(pipelineId);
  },
};
