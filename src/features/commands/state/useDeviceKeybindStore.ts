import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { KeybindContext, ResolvedKeybind } from "../types";

/**
 * Keybinds kept on this device rather than on the server: those that run a
 * plugin's command. Plugins are installed per device and the server knows none
 * of their commands, so it refuses to store a binding to one.
 */
export const DEVICE_KEYBIND_PREFIX = "device:";

export function isDeviceKeybind(keybindId: string): boolean {
  return keybindId.startsWith(DEVICE_KEYBIND_PREFIX);
}

/** Whether a binding to `commandId` belongs on this device (a plugin command). */
export function bindsOnDevice(commandId: string): boolean {
  return commandId.startsWith("plugin.");
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

/**
 * Device keybinds ahead of the server's, so a plugin command bound on this
 * device wins over a server binding of the same keystroke.
 */
export function withDeviceKeybinds(
  device: ResolvedKeybind[],
  server: ResolvedKeybind[],
): ResolvedKeybind[] {
  return device.length === 0 ? server : [...device, ...server];
}
