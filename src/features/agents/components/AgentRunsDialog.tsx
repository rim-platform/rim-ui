import { useEffect, useRef, useState } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { durationOf, groupRuns, RUN_GAP_MS, runCounts, type AgentRun } from "../runtime/runs";
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { AgentRunDialog } from "./AgentRunDialog";

const SHOWN = 100;

/** A key for a run, which has no id when it was kept before runs existed. */
function keyOf(run: AgentRun): string {
  return run.id ?? `${run.agentId}:${run.startedAt}`;
}

/**
 * An agent's runs, or every agent's, newest first, and the way into one. A run is a grouping of
 * calls by time, not a task.
 *
 * @param agent - The agent to show, or `null` for every agent in the record.
 */
export function AgentRunsDialog({
  agent,
  onClose,
}: {
  agent: ConnectedAgent | null;
  onClose: () => void;
}) {
  const entries = useAgentRecordStore((s) => s.entries);
  const { data: servers } = useMyServers();
  const [selected, setSelected] = useState<string | null>(null);
  const returnTo = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [now] = useState(() => Date.now());

  // Back from a run puts focus on the row it opened.
  useEffect(() => {
    if (selected !== null) return;
    const row = returnTo.current;
    if (row === null) return;
    listRef.current?.querySelector<HTMLElement>(`[data-run="${CSS.escape(row)}"]`)?.focus();
    returnTo.current = null;
  }, [selected]);

  const runs = groupRuns(entries)
    .filter((run) => !agent || run.agentId === agent.id)
    .slice(0, SHOWN);
  const open = runs.find((run) => keyOf(run) === selected);
  if (open) {
    return <AgentRunDialog run={open} onBack={() => setSelected(null)} onClose={onClose} />;
  }

  const workspaceName = (id: string) => servers?.find((server) => server.id === id)?.name ?? id;

  return (
    <Dialog
      open
      title={agent ? `Runs of ${agent.name}` : "All runs"}
      maxWidth="max-w-2xl"
      onClose={onClose}
    >
      <p className="text-sm text-rim-text-muted">
        A run is one stretch of an agent&apos;s calls, grouped by time. RIM doesn&apos;t see where
        an agent&apos;s task starts or ends. A change to what it may do starts a new run.
      </p>
      {runs.length === 0 ? (
        <p className="mt-3 text-sm text-rim-text-muted">No runs yet.</p>
      ) : (
        <ul ref={listRef} className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {runs.map((run) => {
            const going = now - Date.parse(run.lastAt) < RUN_GAP_MS;
            return (
              <li key={keyOf(run)}>
                <button
                  type="button"
                  data-run={keyOf(run)}
                  onClick={() => {
                    returnTo.current = keyOf(run);
                    setSelected(keyOf(run));
                  }}
                  className="w-full break-words rounded-lg border border-rim-line bg-rim-panel px-3 py-2 text-left text-sm text-rim-text hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
                >
                  <span className="font-medium">{new Date(run.startedAt).toLocaleString()}</span>
                  <span className="text-rim-text-muted">
                    {" · "}
                    {going ? "Still going" : durationOf(run)}
                    {!agent && ` · ${showInvisibleCharacters(run.agentName)}`}
                    {run.workspaceIds.length > 0 &&
                      ` · ${run.workspaceIds.map(workspaceName).join(", ")}`}
                  </span>
                  <span className="block text-xs text-rim-text-muted">
                    {runCounts(run.entries)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
