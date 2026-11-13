import { ServerFeatureState } from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { detectPlatform, getRuntimeCapabilities } from "../../../../core/runtime/runtime";
import { useAuthStore } from "../../../auth/state/useAuthStore";
import { accountMacrosOn } from "../../../macros/api/useAccountMacros";
import { botsOfferedFor } from "../../../bots/availability";
import { desktopShellAvailable } from "../../../desktop-shell/availability";
import { isDirectSpace, useRelayStore } from "../../../relay/state/useRelayStore";
import {
  listedSettingsTab,
  SETTINGS_SECTION_TABS,
  SETTINGS_TABS,
  settingsTabCommandId,
  visibleSettingsTabs,
  type SettingsTab,
} from "../../../settings/settingsTabs";
import type { KnownServerInfo } from "../../../updater/api/serverInfoApi";
import { useUpdaterStore } from "../../../updater/state/useUpdaterStore";
import type { ServerDetail } from "../../../workspaces/api/useWorkspace";
import { canModerate } from "../../../workspaces/role";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";

/** The commands that act on the desktop window, the log folder or the history archive. */
export const DESKTOP_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "app.open_log_folder",
  "app.minimize_window",
  "app.toggle_maximize_window",
  "app.close_window",
  "settings.back_up_history",
]);

/** The command that checks for a new version, which only a build that can update offers. */
export const CHECK_FOR_UPDATES_COMMAND_ID = "app.check_for_updates";

/** The command that restarts into a downloaded update. */
export const RESTART_TO_UPDATE_COMMAND_ID = "app.restart_to_update";

/** The commands for the open workspace's owners and moderators. */
const MODERATOR_COMMANDS: ReadonlySet<string> = new Set([
  "workspace.open_workspace_settings",
  "workspace.open_join_requests",
]);

/** Whether this app can update itself. */
export function updaterAvailable(): boolean {
  return getRuntimeCapabilities(detectPlatform()).updater;
}

/** Whether an update is downloaded and waiting for a restart. */
export function updateReady(): boolean {
  return useUpdaterStore.getState().activity === "ready";
}

/** Whether the viewer is an Owner or Moderator of the open workspace, outside the direct space. */
export function moderatesOpenWorkspace(): boolean {
  return moderatesWorkspace(useWorkspaceStore.getState().workspaceId);
}

/** Whether the viewer is an Owner or Moderator of `workspaceId`, outside the direct space. */
export function moderatesWorkspace(workspaceId: string | null): boolean {
  if (!workspaceId || isDirectSpace(workspaceId)) return false;
  return canModerate(
    queryClient.getQueryData<ServerDetail>(queryKeys.server(workspaceId))?.viewerRole,
  );
}

/**
 * Whether the settings tab `key` shows for the viewer now, read from what is cached. A section
 * with a tab key of its own shows where the tab it is part of does.
 */
export function settingsTabOffered(key: SettingsTab): boolean {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  const info = queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo);
  const customEmoji = info?.features?.find((f) => f.key === "custom_emoji")?.state;
  const userId = useAuthStore.getState().session?.userId;
  const tabs = visibleSettingsTabs({
    canModerate: moderatesOpenWorkspace(),
    isOperator: queryClient.getQueryData(queryKeys.instanceOperator(userId)) === true,
    customEmoji: customEmoji === undefined || customEmoji === ServerFeatureState.ENABLED,
    botsManageable: botsOfferedFor(workspaceId),
    agentAvailable: getRuntimeCapabilities(detectPlatform()).agent,
    desktopShellAvailable: desktopShellAvailable(),
    inDirectSpace: isDirectSpace(workspaceId),
    accountMacros: accountMacrosOn(),
  });
  const listed = listedSettingsTab(key);
  return tabs.some((tab) => tab.key === listed);
}

const SETTINGS_TAB_BY_COMMAND = new Map(
  [...SETTINGS_TABS, ...SETTINGS_SECTION_TABS].map((tab) => [
    settingsTabCommandId(tab.key),
    tab.key,
  ]),
);

/** The settings tab the command `commandId` opens, if it is one of the Settings tab commands. */
export function settingsTabOfCommand(commandId: string): SettingsTab | undefined {
  return SETTINGS_TAB_BY_COMMAND.get(commandId);
}

/**
 * Whether the palette offers `commandId` in the open workspace: a Settings tab command where the
 * tab shows, the workspace commands to its owners and moderators, Direct Messages where there is
 * a direct space, every other command always.
 */
export function generalCommandOffered(commandId: string): boolean {
  const tab = settingsTabOfCommand(commandId);
  if (tab) return settingsTabOffered(tab);
  if (MODERATOR_COMMANDS.has(commandId)) return moderatesOpenWorkspace();
  if (commandId === "workspace.open_direct_messages") {
    return Boolean(useRelayStore.getState().info?.directSpaceId);
  }
  return true;
}

/**
 * Whether this app offers `commandId`: the desktop's commands only on the desktop, Check for
 * Updates only in a build that updates itself, every other command always.
 */
export function generalCommandOfferedHere(commandId: string): boolean {
  if (DESKTOP_ONLY_COMMANDS.has(commandId)) return desktopShellAvailable();
  if (commandId === CHECK_FOR_UPDATES_COMMAND_ID) return updaterAvailable();
  if (commandId === RESTART_TO_UPDATE_COMMAND_ID) return updaterAvailable();
  return true;
}
