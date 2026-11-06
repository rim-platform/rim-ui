import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { queryKeys } from "../../../core/query/keys";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { findCachedConversation } from "../../conversations/api/useConversation";
import type { ConversationSummary } from "../../conversations/types";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { CLEARED_TOOL, useAgentRecordStore, type RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";

const SHOWN = 200;

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
  if (entry.tool === "rim_list_channels") {
    return `channel names in ${workspaceName(entry.workspaceId)}`;
  }
  if (entry.channelId) return channelLabel(qc, entry.workspaceId, entry.channelId);
  return entry.query ? workspaceName(entry.workspaceId) : "an unknown channel";
}

/** One line of the record. */
function entryLine(
  entry: RecordEntry,
  qc: QueryClient,
  workspaceName: (id: string) => string,
): string {
  const time = new Date(entry.at).toLocaleString();
  if (entry.tool === CLEARED_TOOL) return `${time} · You cleared the record`;
  const line = `${time} · ${entry.query ? "Searched" : "Read"} · ${target(entry, qc, workspaceName)}`;
  if (entry.refused) return `${line} · refused`;
  if (entry.tool === "rim_list_workspaces" || entry.tool === "rim_list_channels") return line;
  const count = entry.messageIds.length;
  return `${line} · ${count} ${count === 1 ? "message" : "messages"}`;
}

/** What RIM handed to one agent, newest first, and the way to clear the whole record. */
export function AgentRecordDialog({
  agent,
  onClose,
}: {
  agent: ConnectedAgent;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const entries = useAgentRecordStore((s) => s.entries);
  const clear = useAgentRecordStore((s) => s.clear);
  const { data: servers } = useMyServers();
  const [confirming, setConfirming] = useState(false);

  const workspaceName = (id: string) =>
    servers?.find((server) => server.id === id)?.name ?? (id || "an unknown workspace");
  const shown = entries
    .filter((entry) => entry.agentId === agent.id || entry.tool === CLEARED_TOOL)
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
    <Dialog open title={`What ${agent.name} was given`} maxWidth="max-w-2xl" onClose={onClose}>
      <p className="text-sm text-rim-text-muted">
        What RIM handed to this agent. RIM can&apos;t see what it did with it.
      </p>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-rim-text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto text-sm text-rim-text">
          {shown.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="break-words">
              {entryLine(entry, qc, workspaceName)}
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
