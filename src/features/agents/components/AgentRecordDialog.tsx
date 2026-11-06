import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { queryKeys } from "../../../core/query/keys";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { findCachedConversation } from "../../conversations/api/useConversation";
import type { ConversationSummary } from "../../conversations/types";
import { useInstalledPlugins } from "../../plugins/api/usePluginList";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { CLEARED_TOOL, useAgentRecordStore, type RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";

const SHOWN = 200;
const LIST_PLUGIN_COMMANDS = "rim_list_plugin_commands";

/** The channel's name as this app last saw it, or its id. */
function channelLabel(qc: QueryClient, workspaceId: string, channelId: string): string {
  const known =
    qc.getQueryData<ConversationSummary>(queryKeys.conversation(workspaceId, channelId)) ??
    findCachedConversation(qc, workspaceId, channelId);
  return known?.title ?? channelId;
}

/** What the entry was about, in words. */
function target(entry: RecordEntry, qc: QueryClient, workspaceName: (id: string) => string) {
  if (entry.tool === "rim_list_workspaces") return "workspace names";
  if (entry.tool === LIST_PLUGIN_COMMANDS) return "the plugin commands approved for it";
  if (entry.tool === "rim_list_channels") {
    return `channel names in ${workspaceName(entry.workspaceId)}`;
  }
  if (entry.channelId) return channelLabel(qc, entry.workspaceId, entry.channelId);
  return entry.query ? workspaceName(entry.workspaceId) : "an unknown channel";
}

/** What a line of the record says about a change. */
const CHANGE_LABELS: Record<NonNullable<RecordEntry["change"]>, string> = {
  asked: "Asked to send",
  sent: "Sent",
  proposed: "Suggested",
  done: "Ran",
  discarded: "You discarded it",
  expired: "Expired",
  busy: "You were busy",
  refused: "Refused",
};

/** What a line of the record says about a plugin command. */
function pluginChangeLabel({ change }: RecordEntry): string {
  if (change === "asked") return "Asked to run";
  return change ? CHANGE_LABELS[change] : CHANGE_LABELS.refused;
}

/** One line of the record. */
function entryLine(
  entry: RecordEntry,
  qc: QueryClient,
  workspaceName: (id: string) => string,
  pluginName: (id: string) => string,
): string {
  const time = new Date(entry.at).toLocaleString();
  if (entry.tool === CLEARED_TOOL) return `${time} · You cleared the record`;
  if (entry.plugin) {
    const { pluginId, commandId } = entry.plugin;
    const line =
      `${time} · ${pluginChangeLabel(entry)} · ${pluginName(pluginId)} ${commandId}`.trimEnd();
    return entry.channelId
      ? `${line} · #${channelLabel(qc, entry.workspaceId, entry.channelId)}`
      : line;
  }
  if (entry.change) {
    const channel = entry.channelId
      ? `#${channelLabel(qc, entry.workspaceId, entry.channelId)}`
      : "an unknown channel";
    return `${time} · ${CHANGE_LABELS[entry.change]} · ${channel}`;
  }
  const line = `${time} · ${entry.query ? "Searched" : "Read"} · ${target(entry, qc, workspaceName)}`;
  if (entry.refused) return `${line} · refused`;
  if (
    entry.tool === "rim_list_workspaces" ||
    entry.tool === "rim_list_channels" ||
    entry.tool === LIST_PLUGIN_COMMANDS
  ) {
    return line;
  }
  const count = entry.messageIds.length;
  return `${line} · ${count} ${count === 1 ? "message" : "messages"}`;
}

/**
 * What RIM handed to one agent and what it asked to do, or the same for every agent including
 * those since disconnected, newest first, and the way to clear the whole record.
 *
 * @param agent - The agent to show, or `null` for the whole record.
 */
export function AgentRecordDialog({
  agent,
  onClose,
}: {
  agent: ConnectedAgent | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const entries = useAgentRecordStore((s) => s.entries);
  const clear = useAgentRecordStore((s) => s.clear);
  const { data: servers } = useMyServers();
  const { data: plugins } = useInstalledPlugins();
  const [confirming, setConfirming] = useState(false);

  const workspaceName = (id: string) =>
    servers?.find((server) => server.id === id)?.name ?? (id || "an unknown workspace");
  const pluginName = (id: string) => {
    const name = plugins?.find((plugin) => plugin.plugin_id === id)?.display_name;
    return name ? showInvisibleCharacters(name) : id || "an unknown plugin";
  };
  const shown = entries
    .filter((entry) => !agent || entry.agentId === agent.id || entry.tool === CLEARED_TOOL)
    .slice(-SHOWN)
    .reverse();

  if (confirming) {
    return (
      <ConfirmActionDialog
        title="Clear the whole record?"
        description="This clears the record for every agent. It leaves one line saying you did."
        confirmLabel="Clear"
        danger
        onConfirm={() => {
          clear();
          setConfirming(false);
        }}
        onClose={() => setConfirming(false)}
      />
    );
  }

  return (
    <Dialog
      open
      title={
        agent
          ? `What ${agent.name} was given and what it asked to do`
          : "What agents were given and what they asked to do"
      }
      maxWidth="max-w-2xl"
      onClose={onClose}
    >
      <p className="text-sm text-rim-text-muted">
        {agent
          ? "What RIM handed to this agent and what it asked to do. RIM can't see what it did with it."
          : "What RIM handed to agents, including those no longer connected, and what they asked to do. RIM can't see what they did with it."}
      </p>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-rim-text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto text-sm text-rim-text">
          {shown.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="break-words">
              {!agent && entry.tool !== CLEARED_TOOL && `${entry.agentName} · `}
              {entryLine(entry, qc, workspaceName, pluginName)}
            </li>
          ))}
        </ul>
      )}
      {entries.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            Clear the whole record
          </Button>
        </div>
      )}
    </Dialog>
  );
}
