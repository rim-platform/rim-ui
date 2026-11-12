import { useMemo } from "react";

import { commandOfferedHere } from "../../agent/agentAvailability";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { profileKeybinds, type KeybindProfile } from "../profiles/keybindProfile";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useActiveKeybindProfile } from "../state/useKeybindProfileStore";
import type { KeybindContext, ResolvedKeybind } from "../types";
import { normalizeKeystroke } from "./keybindEngine";
import { isLocalCommand } from "./localCommands";
import { useAccountMacrosOn } from "../../macros/api/useAccountMacros";
import { isMacroId } from "../../macros/runtime/macroCommands";

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
 * bindings kept on this device (plugin and app commands), the user's bindings to app commands
 * that the connected server keeps for a workspace another server hosts, the user's and the
 * workspace's bindings from the workspace's server, the active profile, then that server's
 * defaults. A keystroke a higher layer holds, even turned off, is gone from the layers below; a
 * keystroke the profile frees is unbound.
 *
 * @param homeApp - The connected server's bindings to app commands, from
 *   {@link useHomeAppKeybinds}; empty when the open workspace is the connected server's own.
 */
export function resolveEffectiveKeybinds(
  device: readonly ResolvedKeybind[],
  server: readonly ResolvedKeybind[] | undefined,
  profile: KeybindProfile,
  homeApp: readonly ResolvedKeybind[] = [],
): ResolvedKeybind[] {
  const serverKeybinds = server ?? [];
  const layers = [
    device,
    homeApp,
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
 * The keybinds Settings → Keybinds lists: every binding of this device, the user's app command
 * bindings of the connected server (`homeApp`) and the user's and workspace's from the
 * workspace's server, each shown even when another holds its keys, then the defaults in force
 * (the active profile's, then the server's), each once and only where no binding above holds
 * its keys. A keystroke the profile frees lists nothing.
 */
export function listedKeybinds(
  device: readonly ResolvedKeybind[],
  server: readonly ResolvedKeybind[] | undefined,
  profile: KeybindProfile,
  homeApp: readonly ResolvedKeybind[] = [],
): ResolvedKeybind[] {
  const serverKeybinds = server ?? [];
  const own = [...device, ...homeApp, ...serverKeybinds.filter((kb) => kb.source !== "DEFAULT")];
  const taken = new Set(own.map(slot));
  const defaults = resolveEffectiveKeybinds(
    [],
    serverKeybinds.filter((kb) => kb.source === "DEFAULT"),
    profile,
  );
  return [...own, ...defaults.filter((kb) => !taken.has(slot(kb)))];
}

/** A command whose default keys a binding above took, and that no listed binding runs. */
export interface UnboundCommand {
  commandId: string;
  /** The context of its first default whose keys were taken. */
  context: KeybindContext;
}

/**
 * The commands Settings → Keybinds lists with no key: a default of theirs (the active
 * profile's or the server's) lost its keys to a binding of this device, the user or the
 * workspace, and no listed binding runs them. `homeApp` is as {@link listedKeybinds} takes it. Each command once, in default order.
 */
export function unboundCommands(
  device: readonly ResolvedKeybind[],
  server: readonly ResolvedKeybind[] | undefined,
  profile: KeybindProfile,
  homeApp: readonly ResolvedKeybind[] = [],
): UnboundCommand[] {
  const serverKeybinds = server ?? [];
  const own = [...device, ...homeApp, ...serverKeybinds.filter((kb) => kb.source !== "DEFAULT")];
  const taken = new Set(own.map(slot));
  const defaults = resolveEffectiveKeybinds(
    [],
    serverKeybinds.filter((kb) => kb.source === "DEFAULT"),
    profile,
  );
  const bound = new Set(listedKeybinds(device, server, profile, homeApp).map((kb) => kb.commandId));
  const result: UnboundCommand[] = [];
  for (const kb of defaults) {
    if (!taken.has(slot(kb)) || bound.has(kb.commandId)) continue;
    if (result.some((c) => c.commandId === kb.commandId)) continue;
    result.push({ commandId: kb.commandId, context: kb.context });
  }
  return result;
}

const NO_KEYBINDS: readonly ResolvedKeybind[] = [];

/**
 * The user's bindings to this app's own commands, and to their macros when the connected server
 * keeps those, that the connected server keeps, while the open workspace is one another server
 * hosts: that workspace's keybinds come from its host, and app commands and macros run in this
 * app wherever the person is. Empty in a workspace of the connected server, whose keybinds
 * already hold them.
 *
 * @param workspaceId - The open workspace.
 */
export function useHomeAppKeybinds(workspaceId: string | null): readonly ResolvedKeybind[] {
  const remote = useRelayStore(
    (s) => workspaceId !== null && Boolean(s.spaces[workspaceId]?.hostServerId),
  );
  const { data: home } = useResolvedKeybinds(undefined, remote);
  const macrosOn = useAccountMacrosOn();
  return useMemo(
    () =>
      remote && home
        ? home.filter(
            (kb) =>
              kb.source === "USER" &&
              (isLocalCommand(kb.commandId) || (macrosOn && isMacroId(kb.commandId))),
          )
        : NO_KEYBINDS,
    [remote, home, macrosOn],
  );
}

/** The keybinds in force on this device right now, leaving out commands this app does not offer. */
export function useEffectiveKeybinds(): ResolvedKeybind[] {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: server } = useResolvedKeybinds(workspaceId ?? undefined);
  const homeApp = useHomeAppKeybinds(workspaceId);
  const device = useDeviceKeybindStore((s) => s.keybinds);
  const profile = useActiveKeybindProfile();
  return useMemo(
    () =>
      resolveEffectiveKeybinds(device, server, profile, homeApp).filter((kb) =>
        commandOfferedHere(kb.commandId),
      ),
    [device, server, profile, homeApp],
  );
}
