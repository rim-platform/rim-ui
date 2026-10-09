import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useWorkspace } from "../../workspaces/api/useWorkspace";
import { useInstalledPlugins } from "../api/usePluginList";
import { useWorkspacePlugins } from "./api";
import { registryEndpoint } from "./installer";
import { installState, publisherOf, runsHere, type InstallState, type Publisher } from "./model";
import { checkEntry, PUBLISHER_RECOVERED_TEXT, type EntryCheck } from "./verify";

/** Whether this device runs plugins at all, and of which kinds. */
export function usePluginPlatform() {
  const { platform, capabilities } = useRuntime();
  return {
    platform,
    enabled: capabilities.pluginHost || capabilities.webPlugins,
    desktop: capabilities.pluginHost,
  };
}

/** Every entry of a workspace's registry, verified on this device (steps 1 to 4). */
export function useRegistryChecks(serverId: string | null | undefined) {
  const { enabled } = usePluginPlatform();
  const entries = useWorkspacePlugins(serverId, enabled);
  const versions = entries.data?.map((e) => `${e.id}:${e.updatedAt}`) ?? [];
  const checks = useQuery({
    queryKey: queryKeys.workspacePluginChecks(serverId, versions),
    enabled: entries.data !== undefined,
    staleTime: 60_000,
    queryFn: () => Promise.all((entries.data ?? []).map(checkEntry)),
  });
  return {
    checks: checks.data,
    /** The registry loaded, so an entry missing from it was removed. */
    loaded: entries.isSuccess && checks.isSuccess,
  };
}

/** One registry entry as the palette, the dialogs and Settings show it. */
export interface RegistryItem {
  check: EntryCheck;
  publisher: Publisher;
  state: InstallState;
  /** This device can run it: the web app runs only sandboxed plugins. */
  runsHere: boolean;
}

/** The registry of `serverId` with each entry's badge and where this device stands with it. */
export function useRegistryItems(serverId: string | null | undefined) {
  const { desktop } = usePluginPlatform();
  const { checks, loaded } = useRegistryChecks(serverId);
  const { data: installed } = useInstalledPlugins();
  const { data: workspace } = useWorkspace(serverId ?? undefined);
  const { data: members } = useServerMembers(serverId ?? undefined);
  const items = useMemo<RegistryItem[]>(() => {
    if (!checks || !serverId) return [];
    const endpoint = registryEndpoint();
    return checks.map((check) => ({
      check,
      publisher: publisherOf(
        check.entry.publisherPrincipalId,
        check.ok ? check.statement.publisherName : check.entry.publisherName,
        members ?? [],
      ),
      state: installState(check, installed ?? [], endpoint, serverId),
      runsHere: runsHere(check, desktop),
    }));
  }, [checks, installed, members, serverId, desktop]);
  return {
    items,
    members: members ?? [],
    loaded: loaded && installed !== undefined,
    installed: installed ?? [],
    workspaceName: workspace?.name ?? "this workspace",
  };
}

/** Why an entry cannot be installed here, or null when it can. */
export function refusalOf(item: RegistryItem): string | null {
  const check = item.check;
  if (!check.ok) return `Signature does not verify: ${check.reason}`;
  if (check.validity.status !== "valid") return PUBLISHER_RECOVERED_TEXT;
  if (!item.runsHere) return "Needs the desktop app";
  return null;
}
