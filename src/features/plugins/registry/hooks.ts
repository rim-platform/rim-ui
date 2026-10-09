import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useWorkspace } from "../../workspaces/api/useWorkspace";
import { useInstalledPlugins } from "../api/usePluginList";
import { useWorkspacePlugins, type RegistryEntry } from "./api";
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

/**
 * The workspace's names of members whose principal ids this client knows: the signed-in
 * account, and the entries' approvers who are still members.
 */
export function useMemberPrincipalNames(
  serverId: string | null | undefined,
  entries: readonly RegistryEntry[],
): Map<string, string> {
  const { data: members } = useServerMembers(serverId ?? undefined);
  const { data: me } = useCurrentUser();
  return useMemo(() => {
    const names = new Map<string, string>();
    const known = [me, ...entries.map((e) => e.approvedBy)];
    for (const user of known) {
      if (!user?.principalId) continue;
      const member = members?.find((m) => m.userId === user.id);
      if (member) names.set(user.principalId, member.displayName || member.username);
    }
    return names;
  }, [members, me, entries]);
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
  const entries = useMemo(() => (checks ?? []).map((c) => c.entry), [checks]);
  const names = useMemberPrincipalNames(serverId, entries);
  const items = useMemo<RegistryItem[]>(() => {
    if (!checks || !serverId) return [];
    const endpoint = registryEndpoint();
    return checks.map((check) => ({
      check,
      publisher: publisherOf(
        check.entry.publisherPrincipalId,
        check.ok ? check.statement.publisherName : check.entry.publisherName,
        names,
      ),
      state: installState(check, installed ?? [], endpoint, serverId),
      runsHere: runsHere(check, desktop),
    }));
  }, [checks, installed, names, serverId, desktop]);
  return {
    items,
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
