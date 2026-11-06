/** The agent plugin commands wired to the app: its plugin hosts, its dialog and its record. */

import { invoke } from "@tauri-apps/api/core";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { fetchPluginList } from "../../plugins/api/usePluginList";
import { runtimeKind, type PluginCommandInfo, type PluginInfo } from "../../plugins/types";
import { webPluginHost } from "../../plugins/web/webPluginHost";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { approvalFor, createAgentPlugins, type AgentPluginConfirmation } from "./agentPlugins";
import { agentCooldown, askPerson, confirmationOpen } from "./appAgentChanges";
import { connected, lookup, record } from "./appAgentReads";

/**
 * Runs a command through the Rust host's checks: a local process there, or a web plugin in this
 * page once they pass.
 *
 * @returns The plugin's result payload.
 */
async function run(
  plugin: PluginInfo,
  command: PluginCommandInfo,
  input: Record<string, unknown>,
  approvedHash: string,
): Promise<unknown> {
  const ids = {
    pluginId: plugin.plugin_id,
    commandId: command.id,
    approvedManifestHash: approvedHash,
  };
  if (runtimeKind(plugin) !== "WebSandboxed") {
    return invoke<unknown>("plugin_run_outside_agent_command", { ...ids, input });
  }
  await invoke<null>("plugin_check_outside_agent_command", ids);
  const output = await webPluginHost.execute({
    pluginId: plugin.plugin_id,
    commandId: command.id,
    args: input,
    initiator: "agent",
  });
  return output.payload;
}

function confirm(request: AgentPluginConfirmation): Promise<"approved" | "discarded" | "busy"> {
  return askPerson({
    initiator: "agent",
    commandId: request.commandId,
    toolName: "run a plugin command",
    args: {},
    sensitivity: CommandSensitivity.MUTATING,
    verb: null,
    token: request.token,
    argsHash: "",
    expiresAt: request.expiresAt,
    outsideAgent: {
      name: request.agentName,
      target: [
        { label: "Plugin", value: request.pluginName },
        { label: "Command", value: request.commandId },
      ],
      pluginWords: { title: request.title, description: request.description },
      args: request.args,
    },
  });
}

/** What the agent may run from the plugin as the store holds it now. */
function approval(agentId: string, pluginId: string) {
  const agent = useConnectedAgentsStore.getState().agents.find(({ id }) => id === agentId);
  return agent ? approvalFor(agent, pluginId) : null;
}

/** The plugin commands this app answers agents with. */
export const appAgentPlugins = createAgentPlugins({
  plugins: () => fetchPluginList(),
  run,
  lookup,
  connected,
  approval,
  record,
  busy: confirmationOpen,
  confirm,
  cooldown: agentCooldown,
  now: () => Date.now(),
});
