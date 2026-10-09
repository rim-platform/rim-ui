// Keeping this device's registry installs in line with their workspace's registry: an entry at
// a new statement is verified, then installed at once or offered behind a prompt; an entry that
// disappeared stops its plugin and asks whether to remove it.

import type { PluginInfo, PluginInstallResult } from "../types";
import { parsePostInstallConsent } from "../types";
import type { InstallOptions } from "./installer";
import { messageOf } from "./installer";
import { fromWorkspace, planUpdate, registrySource } from "./model";
import type { RemovalPrompt, UpdatePrompt } from "./state";
import { isInstallable, type EntryCheck, type VerifiedEntry } from "./verify";

/** What syncing needs to act on: the platform's install and stop, and the person's prompts. */
export interface SyncActions {
  install: (check: VerifiedEntry, options: InstallOptions) => Promise<PluginInstallResult>;
  stop: (plugin: PluginInfo) => Promise<void>;
  updated: (plugin: PluginInfo, version: string) => void;
  updateFailed: (plugin: PluginInfo, reason: string) => void;
  promptUpdate: (prompt: UpdatePrompt) => void;
  promptRemoval: (prompt: RemovalPrompt) => void;
}

export interface SyncContext {
  checks: readonly EntryCheck[];
  installed: readonly PluginInfo[];
  endpoint: string;
  serverId: string;
  workspaceName: string;
}

/**
 * Act once on each change of the registry since this page last saw it. `handled` remembers
 * what was acted on, so a refetch does not ask twice. Returns whether anything was installed
 * or stopped.
 */
export async function syncRegistryInstalls(
  context: SyncContext,
  handled: Set<string>,
  actions: SyncActions,
): Promise<boolean> {
  const { checks, endpoint, serverId, workspaceName } = context;
  let changed = false;
  for (const plugin of context.installed) {
    if (!fromWorkspace(plugin, endpoint, serverId)) continue;
    const check = checks.find((c) => c.entry.pluginId === plugin.plugin_id);
    if (!check) {
      const key = `removed/${serverId}/${plugin.plugin_id}`;
      if (handled.has(key)) continue;
      handled.add(key);
      // Stopped first: an entry may be removed because the plugin is harmful.
      await actions.stop(plugin).catch(() => {});
      changed = true;
      actions.promptRemoval({ plugin, workspaceName });
      continue;
    }
    if (registrySource(plugin)?.statementSha256 === check.statementSha256) continue;
    const key = `update/${serverId}/${plugin.plugin_id}/${check.statementSha256}`;
    if (handled.has(key)) continue;
    handled.add(key);
    // An entry that does not verify, or whose publisher recovered, keeps the old copy.
    if (!isInstallable(check)) continue;
    const plan = planUpdate(plugin, check);
    if (!plan.automatic) {
      actions.promptUpdate({ plugin, check, plan, workspaceName });
      continue;
    }
    try {
      await actions.install(check, { replace: true, keepApprovals: true });
      changed = true;
      actions.updated(plugin, check.statement.version);
    } catch (err) {
      if (parsePostInstallConsent(err)) {
        actions.promptUpdate({ plugin, check, plan, workspaceName });
      } else {
        actions.updateFailed(plugin, messageOf(err));
      }
    }
  }
  return changed;
}
