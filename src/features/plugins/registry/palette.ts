// The palette's "Workspace plugins" source: the open workspace's registry entries this device
// has not installed, or has at another statement. Entries that cannot be installed here are
// listed with the reason and cannot be chosen.

import { useMemo } from "react";

import type { CommandDefinition } from "../../commands/types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { refusalOf, useRegistryItems, type RegistryItem } from "./hooks";
import { paletteLine } from "./model";

export const REGISTRY_CATEGORY = "Workspace plugins";

/** A palette entry that opens a registry entry's install dialog. */
export interface RegistryPaletteItem extends CommandDefinition {
  registry: {
    serverId: string;
    pluginId: string;
    /** Why it cannot be chosen, or null. */
    refusal: string | null;
  };
}

export function isRegistryPaletteItem(command: CommandDefinition): command is RegistryPaletteItem {
  return "registry" in command;
}

function titleOf(item: RegistryItem, workspaceName: string): string {
  const name = item.check.entry.displayName;
  switch (item.state.kind) {
    case "otherStatement":
      return `Update ${name}`;
    case "otherWorkspace":
      return `Switch ${name} to ${workspaceName}'s version`;
    case "local":
      return `Replace ${name} with ${workspaceName}'s signed version`;
    default:
      return `Install ${name}`;
  }
}

/** The palette entries of `items`, in the shape of the palette's commands. */
export function registryPaletteItems(
  items: readonly RegistryItem[],
  workspaceName: string,
): RegistryPaletteItem[] {
  return items
    .filter((item) => item.state.kind !== "installed")
    .map((item) => {
      const entry = item.check.entry;
      const refusal = refusalOf(item);
      const line = paletteLine(entry.status, workspaceName, item.publisher);
      return {
        id: `registry.${entry.serverId}.${entry.pluginId}`,
        title: titleOf(item, workspaceName),
        description: refusal === null ? line : `${refusal} · ${line}`,
        category: REGISTRY_CATEGORY,
        sourceKind: "PLUGIN",
        executionTarget: "DESKTOP_LOCAL",
        requiredContext: [],
        requiredCapabilities: [],
        visibleInPalette: true,
        visibleInContextMenus: false,
        keybindCapable: false,
        dangerous: false,
        registry: { serverId: entry.serverId, pluginId: entry.pluginId, refusal },
      };
    });
}

/** The open workspace's registry as palette entries. */
export function useRegistryPaletteItems(): RegistryPaletteItem[] {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { items, workspaceName } = useRegistryItems(workspaceId);
  return useMemo(() => registryPaletteItems(items, workspaceName), [items, workspaceName]);
}
