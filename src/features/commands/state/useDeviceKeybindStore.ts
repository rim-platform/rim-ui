import { create } from "zustand";
import { persist } from "zustand/middleware";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { hostOf } from "../../relay/state/useRelayStore";
import { APP_COMMAND_KEYBINDS, hasCapability } from "../../updater/api/serverCapabilities";
import type { KnownServerInfo } from "../../updater/api/serverInfoApi";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { isLocalCommand } from "../runtime/localCommands";
import { isOpenPluginPanelCommand } from "../../plugins/pluginPanels";
import { openPluginSettingsTarget } from "../../plugins/pluginSettingsLink";
import type { KeybindContext, ResolvedKeybind } from "../types";

/**
 * Keybinds kept on this device rather than on the server: those that run a plugin's command,
 * open a plugin's panel or a plugin's settings, and those that run one of this app's own
 * commands where the server does not keep them. Plugins are installed per device and the
 * server knows none of these, so it refuses to store a binding to one; a server that lists
 * {@link APP_COMMAND_KEYBINDS} stores bindings to this app's own commands.
 */
export const DEVICE_KEYBIND_PREFIX = "device:";

export function isDeviceKeybind(keybindId: string): boolean {
  return keybindId.startsWith(DEVICE_KEYBIND_PREFIX);
}

/**
 * Whether the server keeps keybinds to this app's own commands for the open workspace: the
 * connected server lists {@link APP_COMMAND_KEYBINDS}, as its cached info says, and hosts the
 * open workspace. A workspace on another server lists that server's keybinds, so a binding
 * saved on the connected server would not show or run there.
 *
 * @param workspaceId - The open workspace; read from the workspace store when not given.
 */
export function appCommandKeybindsOnServer(
  workspaceId: string | null = useWorkspaceStore.getState().workspaceId,
): boolean {
  return (
    hasCapability(
      queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo),
      APP_COMMAND_KEYBINDS,
    ) && hostOf(workspaceId) === null
  );
}

/**
 * Whether a binding to `commandId` belongs on this device: a plugin, panel or plugin settings
 * command always, one of this app's own commands unless the server keeps those.
 *
 * @param appCommandsOnServer - Whether the server keeps bindings to this app's own commands;
 *   read with {@link appCommandKeybindsOnServer} when not given.
 */
export function bindsOnDevice(
  commandId: string,
  appCommandsOnServer: boolean = appCommandKeybindsOnServer(),
): boolean {
  if (
    commandId.startsWith("plugin.") ||
    isOpenPluginPanelCommand(commandId) ||
    openPluginSettingsTarget(commandId) !== null
  ) {
    return true;
  }
  return isLocalCommand(commandId) && !appCommandsOnServer;
}

export interface NewDeviceKeybind {
  keystroke: string;
  commandId: string;
  context: KeybindContext;
}

interface DeviceKeybindState {
  keybinds: ResolvedKeybind[];
  add: (keybind: NewDeviceKeybind) => void;
  update: (
    keybindId: string,
    patch: Partial<Pick<ResolvedKeybind, "keystroke" | "commandId" | "context" | "isEnabled">>,
  ) => void;
  remove: (keybindId: string) => void;
}

function newId(): string {
  return `${DEVICE_KEYBIND_PREFIX}${crypto.randomUUID()}`;
}

export const useDeviceKeybindStore = create<DeviceKeybindState>()(
  persist(
    (set) => ({
      keybinds: [],
      add: ({ keystroke, commandId, context }) =>
        set((state) => ({
          keybinds: [
            // One binding per keystroke and context: the new one replaces an older one.
            ...state.keybinds.filter((kb) => kb.keystroke !== keystroke || kb.context !== context),
            {
              id: newId(),
              keystroke,
              commandId,
              context,
              source: "USER",
              scope: "USER",
              isEnabled: true,
              presetArgs: null,
            },
          ],
        })),
      update: (keybindId, patch) =>
        set((state) => {
          const current = state.keybinds.find((kb) => kb.id === keybindId);
          if (!current) return state;
          const next = { ...current, ...patch };
          return {
            keybinds: state.keybinds
              // Like `add`, a keystroke and context bind one command only.
              .filter(
                (kb) =>
                  kb.id === keybindId ||
                  kb.keystroke !== next.keystroke ||
                  kb.context !== next.context,
              )
              .map((kb) => (kb.id === keybindId ? next : kb)),
          };
        }),
      remove: (keybindId) =>
        set((state) => ({ keybinds: state.keybinds.filter((kb) => kb.id !== keybindId) })),
    }),
    { name: "rim-device-keybinds", version: 1 },
  ),
);
