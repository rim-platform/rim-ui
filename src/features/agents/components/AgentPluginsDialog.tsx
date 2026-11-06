import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { useInstalledPlugins } from "../../plugins/api/usePluginList";
import { CHAT_READ, CHAT_READ_ENCRYPTED } from "../../plugins/chat/chatTypes";
import type { PluginCommandInfo, PluginInfo } from "../../plugins/types";
import { approvalFor } from "../runtime/agentPlugins";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import {
  useConnectedAgentsStore,
  type ConnectedAgent,
  type PluginApproval,
} from "../state/useConnectedAgentsStore";
import { Check, Spinner } from "./AgentGrantsDialog";

/** The commands of `plugin` a person can tick. */
function offered(plugin: PluginInfo): PluginCommandInfo[] {
  return (plugin.commands ?? []).filter((command) => command.ai_callable);
}

/** What a person is told about how a command runs for an agent. */
function modeLine(command: PluginCommandInfo): string {
  if (command.dangerous) return "Dangerous. It can only suggest this, and you run it yourself.";
  if (command.read_only) {
    return "The plugin says this only reads. RIM can't check that, so it runs without asking.";
  }
  return "Asks you each time.";
}

function CommandCheck({
  command,
  checked,
  onChange,
}: {
  command: PluginCommandInfo;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const capabilities = command.required_capabilities ?? [];
  const context = command.required_context ?? [];
  return (
    <Check checked={checked} onChange={onChange}>
      {showInvisibleCharacters(command.title)}{" "}
      <span className="font-mono text-xs text-rim-text-muted">
        {showInvisibleCharacters(command.id)}
      </span>
      <span className="block text-xs text-rim-text-muted">
        {showInvisibleCharacters(command.description)}
      </span>
      <span className="block text-xs text-rim-text-muted">{modeLine(command)}</span>
      {capabilities.length > 0 && (
        <span className="block text-xs text-rim-text-muted">Uses: {capabilities.join(", ")}</span>
      )}
      {(context.includes("conversation") || context.includes("message")) && (
        <span className="block text-xs text-rim-text-muted">
          Only works on channels it has a grant for.
        </span>
      )}
    </Check>
  );
}

function PluginGroup({
  plugin,
  changed,
  ticked,
  onToggle,
}: {
  plugin: PluginInfo;
  changed: boolean;
  ticked: string[];
  onToggle: (commandId: string, on: boolean) => void;
}) {
  const headingId = `agent-plugins-${plugin.plugin_id}`;
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="break-words text-sm font-medium text-rim-text">
        {showInvisibleCharacters(plugin.display_name)} {showInvisibleCharacters(plugin.version)}
      </h3>
      {plugin.approved_capabilities.length > 0 && (
        <p className="px-2 pt-1 text-xs text-rim-text-muted">
          This plugin can use: {plugin.approved_capabilities.join(", ")}
        </p>
      )}
      {plugin.approved_capabilities.includes(CHAT_READ) && (
        <p className="px-2 pt-1 text-xs text-rim-warm">
          This plugin can read every conversation you can, and a command could hand what it reads to
          this program, whatever you chose it can read. A grant can&apos;t limit that.
        </p>
      )}
      {plugin.approved_capabilities.includes(CHAT_READ_ENCRYPTED) && (
        <p className="px-2 pt-1 text-xs text-rim-warm">
          This plugin can read encrypted conversations, and a command could hand what it reads to
          this program. A grant can&apos;t limit that.
        </p>
      )}
      {changed && (
        <p className="px-2 py-1.5 text-xs text-rim-warm">
          This plugin changed since you approved it. Choose again.
        </p>
      )}
      {offered(plugin).map((command) => (
        <CommandCheck
          key={command.id}
          command={command}
          checked={ticked.includes(command.id)}
          onChange={(on) => onToggle(command.id, on)}
        />
      ))}
    </section>
  );
}

/** Chooses which plugin commands one agent may run. Nothing is applied until it is saved. */
export function AgentPluginsDialog({
  agent,
  onClose,
}: {
  agent: ConnectedAgent;
  onClose: () => void;
}) {
  const setPluginApprovals = useConnectedAgentsStore((s) => s.setPluginApprovals);
  const [draft, setDraft] = useState<Map<string, PluginApproval>>(() => new Map());
  const list = useInstalledPlugins();
  const plugins = (list.data ?? []).filter(
    (plugin) => plugin.enabled && offered(plugin).length > 0,
  );

  /** What is ticked: nothing that was chosen under a manifest other than the one shown. */
  const tickedIn = (plugin: PluginInfo): string[] => {
    const chosen = draft.get(plugin.plugin_id) ?? approvalFor(agent, plugin.plugin_id);
    return chosen?.manifestHash === plugin.manifest_hash ? chosen.commandIds : [];
  };

  const toggle = (plugin: PluginInfo, commandId: string, on: boolean) => {
    const others = tickedIn(plugin).filter((id) => id !== commandId);
    const commandIds = on ? [...others, commandId] : others;
    setDraft(
      new Map(draft).set(plugin.plugin_id, { manifestHash: plugin.manifest_hash, commandIds }),
    );
  };

  const save = () => {
    for (const plugin of plugins) {
      const there = new Set(offered(plugin).map((command) => command.id));
      const commandIds = tickedIn(plugin).filter((id) => there.has(id));
      setPluginApprovals(
        agent.id,
        plugin.plugin_id,
        commandIds.length > 0 ? { manifestHash: plugin.manifest_hash, commandIds } : null,
      );
    }
    onClose();
  };

  return (
    <Dialog open title={`What ${agent.name} can run`} maxWidth="max-w-lg" onClose={onClose}>
      <p className="text-sm text-rim-text-muted">
        A plugin command can do anything the plugin can. Approve only what you want this program to
        use. Approvals for RIM&apos;s own agent don&apos;t carry over.
      </p>
      <div className="mt-3 max-h-[50vh] space-y-4 overflow-y-auto">
        {list.isPending && <Spinner />}
        {list.isError && (
          <p role="alert" className="text-sm text-rim-danger">
            Could not load your plugins
          </p>
        )}
        {list.isSuccess && plugins.length === 0 && (
          <p className="text-sm text-rim-text-muted">No plugin here offers commands to agents.</p>
        )}
        {plugins.map((plugin) => {
          const stored = approvalFor(agent, plugin.plugin_id);
          return (
            <PluginGroup
              key={plugin.plugin_id}
              plugin={plugin}
              changed={stored !== null && stored.manifestHash !== plugin.manifest_hash}
              ticked={tickedIn(plugin)}
              onToggle={(commandId, on) => toggle(plugin, commandId, on)}
            />
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!list.isSuccess} onClick={save}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}
