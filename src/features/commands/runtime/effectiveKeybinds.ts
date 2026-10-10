import { useMemo } from "react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { profileKeybinds, type KeybindProfile } from "../profiles/keybindProfile";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import type { ResolvedKeybind } from "../types";
import { normalizeKeystroke } from "./keybindEngine";

function slot(keybind: ResolvedKeybind): string {
  return `${keybind.context} ${normalizeKeystroke(keybind.keystroke)}`;
}

/**
 * Every keybind in force on this device, one per keystroke and context, highest layer first:
 * bindings kept on this device (plugin and app commands), the user's and the workspace's
 * bindings from the server, the active profile, then the server's defaults. A keystroke a
 * higher layer holds, even turned off, is gone from the layers below; a keystroke the profile
 * frees is unbound.
 */
export function resolveEffectiveKeybinds(
  device: readonly ResolvedKeybind[],
  server: readonly ResolvedKeybind[] | undefined,
  profile: KeybindProfile,
): ResolvedKeybind[] {
  const serverKeybinds = server ?? [];
  const layers = [
    device,
    serverKeybinds.filter((keybind) => keybind.source !== "DEFAULT"),
    profileKeybinds(profile),
    serverKeybinds.filter((keybind) => keybind.source === "DEFAULT"),
  ];
  const taken = new Set<string>();
  const result: ResolvedKeybind[] = [];
  for (const layer of layers) {
    for (const keybind of layer) {
      const key = slot(keybind);
      if (taken.has(key)) continue;
      taken.add(key);
      // A freed keystroke only hides the layers below; it binds nothing itself.
      if (keybind.commandId) result.push(keybind);
    }
  }
  return result;
}

/** The keybinds in force on this device right now. */
export function useEffectiveKeybinds(): ResolvedKeybind[] {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: server } = useResolvedKeybinds(workspaceId ?? undefined);
  const device = useDeviceKeybindStore((s) => s.keybinds);
  const profile = useKeybindProfileStore((s) => s.profile);
  return useMemo(
    () => resolveEffectiveKeybinds(device, server, profile),
    [device, server, profile],
  );
}
