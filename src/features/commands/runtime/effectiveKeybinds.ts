import { useMemo } from "react";

import { commandOfferedHere } from "../../agent/agentAvailability";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { profileKeybinds, type KeybindProfile } from "../profiles/keybindProfile";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useActiveKeybindProfile } from "../state/useKeybindProfileStore";
import type { KeybindContext, ResolvedKeybind } from "../types";
import { normalizeKeystroke } from "./keybindEngine";

/** The context-and-keystroke slot a keybind occupies; one binding per slot fires. */
export function keybindSlot(context: KeybindContext, keystroke: string): string {
  return `${context} ${normalizeKeystroke(keystroke)}`;
}

function slot(keybind: ResolvedKeybind): string {
  return keybindSlot(keybind.context, keybind.keystroke);
}

/**
 * The listed keybinds holding `keystroke` in `context`, other than `exceptId`.
 */
export function slotHolders(
  keybinds: readonly ResolvedKeybind[],
  context: KeybindContext,
  keystroke: string,
  exceptId?: string,
): ResolvedKeybind[] {
  const wanted = keybindSlot(context, keystroke);
  return keybinds.filter((kb) => kb.id !== exceptId && slot(kb) === wanted);
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

/**
 * The keybinds Settings → Keybinds lists: every binding of this device and the user's and
 * workspace's from the server, each shown even when another holds its keys, then the defaults
 * in force (the active profile's, then the server's), each once and only where no binding
 * above holds its keys. A keystroke the profile frees lists nothing.
 */
export function listedKeybinds(
  device: readonly ResolvedKeybind[],
  server: readonly ResolvedKeybind[] | undefined,
  profile: KeybindProfile,
): ResolvedKeybind[] {
  const serverKeybinds = server ?? [];
  const own = [...device, ...serverKeybinds.filter((kb) => kb.source !== "DEFAULT")];
  const taken = new Set(own.map(slot));
  const defaults = resolveEffectiveKeybinds(
    [],
    serverKeybinds.filter((kb) => kb.source === "DEFAULT"),
    profile,
  );
  return [...own, ...defaults.filter((kb) => !taken.has(slot(kb)))];
}

/** The keybinds in force on this device right now, leaving out commands this app does not offer. */
export function useEffectiveKeybinds(): ResolvedKeybind[] {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: server } = useResolvedKeybinds(workspaceId ?? undefined);
  const device = useDeviceKeybindStore((s) => s.keybinds);
  const profile = useActiveKeybindProfile();
  return useMemo(
    () =>
      resolveEffectiveKeybinds(device, server, profile).filter((kb) =>
        commandOfferedHere(kb.commandId),
      ),
    [device, server, profile],
  );
}
