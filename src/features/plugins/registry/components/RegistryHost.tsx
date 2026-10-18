import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { WorkspacePluginStatus } from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { toast } from "../../../../shared/toast";
import { reloadCommands } from "../../../commands/api/useCommands";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { usePluginList } from "../../api/usePluginList";
import { PluginCapabilityPrompt } from "../../components/PluginCapabilityPrompt";
import { usePluginPlatform, useRegistryItems, type RegistryItem } from "../hooks";
import {
  installEntry,
  keepAsLocal,
  messageOf,
  registryEndpoint,
  stopPlugin,
  uninstallPlugin,
} from "../installer";
import { isNotNow, notNowKey, registrySession, rememberNotNow, useRegistryStore } from "../state";
import { syncRegistryInstalls } from "../sync";
import { isInstallable } from "../verify";
import { RegistryInstallDialog } from "./RegistryInstallDialog";
import { RemovedPluginDialog } from "./RemovedPluginDialog";
import { RequiredPluginsDialog } from "./RequiredPluginsDialog";
import { UpdatePromptDialog } from "./UpdatePromptDialog";

const { handled, listed } = registrySession;

function keyOf(item: RegistryItem): string {
  return notNowKey(
    item.check.entry.serverId,
    item.check.entry.pluginId,
    item.check.statementSha256,
  );
}

/** A required entry this device has not installed from its statement. */
function wanted(item: RegistryItem): boolean {
  return (
    item.check.entry.status === WorkspacePluginStatus.REQUIRED && item.state.kind !== "installed"
  );
}

/**
 * The open workspace's plugin registry on this device: updates and removals of its installs,
 * the required plugins offered once, and the install, update and removal dialogs.
 */
export function RegistryHost() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { platform, enabled, desktop } = usePluginPlatform();
  const qc = useQueryClient();
  const { items, loaded, installed, workspaceName } = useRegistryItems(
    enabled ? workspaceId : null,
  );
  const { data: plugins } = usePluginList();
  const installing = useRegistryStore((s) => s.installing);
  const updates = useRegistryStore((s) => s.updates);
  const removals = useRegistryStore((s) => s.removals);
  const store = useRegistryStore.getState;
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [requiredClosed, setRequiredClosed] = useState(0);
  const syncing = useRef(false);

  useEffect(() => {
    if (!enabled || !loaded || !workspaceId || syncing.current) return;
    syncing.current = true;
    const checks = items.map((i) => i.check);
    void syncRegistryInstalls(
      { checks, installed, endpoint: registryEndpoint(), serverId: workspaceId, workspaceName },
      handled,
      {
        install: (check, options) => installEntry(platform, check, options),
        stop: (plugin) => stopPlugin(platform, plugin),
        updated: (plugin, version) => toast.success(`Updated ${plugin.display_name} to ${version}`),
        updateFailed: (plugin, reason) =>
          toast.error(`${plugin.display_name} was not updated`, { description: reason }),
        promptUpdate: (prompt) => store().promptUpdate(prompt),
        promptRemoval: (prompt) => store().promptRemoval(prompt),
      },
    )
      .then(async (changed) => {
        if (!changed) return;
        await qc.invalidateQueries({ queryKey: queryKeys.plugins() });
        reloadCommands();
      })
      .finally(() => {
        syncing.current = false;
      });
  }, [enabled, loaded, workspaceId, items, installed, workspaceName, platform, qc, store]);

  const required = useMemo(() => {
    if (!loaded) return { installable: [], needDesktop: [] };
    const fresh = items.filter(wanted).filter((i) => !isNotNow(keyOf(i)) && !listed.has(keyOf(i)));
    return {
      installable: fresh.filter((i) => i.runsHere && isInstallable(i.check)),
      needDesktop: desktop ? [] : fresh.filter((i) => !i.runsHere),
    };
    // `requiredClosed` re-reads what "Not now" remembered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loaded, desktop, requiredClosed]);
  const showRequired =
    installing === null &&
    updates.length === 0 &&
    removals.length === 0 &&
    required.installable.length + required.needDesktop.length > 0;

  const target = installing
    ? items.find(
        (i) =>
          i.check.entry.serverId === installing.serverId &&
          i.check.entry.pluginId === installing.pluginId,
      )
    : undefined;
  const approving = approvingId ? plugins?.find((p) => p.plugin_id === approvingId) : undefined;
  const update = updates[0];
  const removal = removals[0];

  async function settleRemoval(remove: boolean) {
    if (!removal) return;
    setRemoving(true);
    try {
      if (remove) await uninstallPlugin(platform, removal.plugin.plugin_id);
      else await keepAsLocal(platform, removal.plugin.plugin_id);
      await qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    } catch (err) {
      toast.error(`${removal.plugin.display_name}: ${messageOf(err)}`);
    } finally {
      setRemoving(false);
      store().dropRemoval(removal.plugin.plugin_id);
    }
  }

  return (
    <>
      {removal && (
        <RemovedPluginDialog
          prompt={removal}
          isPending={removing}
          onRemove={() => void settleRemoval(true)}
          onKeep={() => void settleRemoval(false)}
        />
      )}
      {!removal && update && installing === null && (
        <UpdatePromptDialog
          prompt={update}
          onLater={() => store().dropUpdate(update.plugin.plugin_id)}
          onReview={() => {
            store().dropUpdate(update.plugin.plugin_id);
            store().openInstall(update.check.entry.serverId, update.check.entry.pluginId);
          }}
        />
      )}
      {showRequired && (
        <RequiredPluginsDialog
          workspaceName={workspaceName}
          installable={required.installable}
          needDesktop={required.needDesktop}
          onReview={(item) => {
            listed.add(keyOf(item));
            store().openInstall(item.check.entry.serverId, item.check.entry.pluginId);
          }}
          onNotNow={() => {
            const keys = [...required.installable, ...required.needDesktop].map(keyOf);
            rememberNotNow(keys);
            for (const key of keys) listed.add(key);
            setRequiredClosed((n) => n + 1);
          }}
        />
      )}
      {target && (
        <RegistryInstallDialog
          item={target}
          workspaceName={workspaceName}
          onClose={() => store().closeInstall()}
          onInstalled={(pluginId) => {
            store().closeInstall();
            setApprovingId(pluginId);
          }}
        />
      )}
      {approving && (
        <PluginCapabilityPrompt
          open
          onClose={() => setApprovingId(null)}
          plugin={approving}
          startOnApprove
        />
      )}
    </>
  );
}
