import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useListAuditLog } from "../../audit/api/useListAuditLog";
import { useInstalledPlugins } from "../../plugins/api/usePluginList";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { plural, type AgentRun } from "../runtime/runs";
import type { RecordEntry } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { CHANGE_LABELS, channelLabel } from "./AgentRecordDialog";
import { AgentGrantsDialog } from "./AgentGrantsDialog";

const OUTSIDE_RIM = "What the agent did between these is outside RIM.";
const LIST_TOOLS: Record<string, string> = {
  rim_list_workspaces: "workspace names",
  rim_list_plugin_commands: "the plugin commands approved for it",
};

type Change = NonNullable<RecordEntry["change"]>;

/** One line of a run: entries folded together, or a request joined with how it ended. */
interface Step {
  at: string;
  text: string;
  /** Whether RIM handed the agent content in this step. */
  handed: boolean;
}

/** What an entry named, as the person reads it. */
function placeOf(
  entry: RecordEntry,
  qc: QueryClient,
  workspaceName: (id: string) => string,
): string {
  if (entry.channelId) {
    return `#${showInvisibleCharacters(channelLabel(qc, entry.workspaceId, entry.channelId))}`;
  }
  return entry.workspaceId ? workspaceName(entry.workspaceId) : "an unknown channel";
}

/** The steps of a run, oldest first. */
function stepsOf(
  entries: readonly RecordEntry[],
  qc: QueryClient,
  workspaceName: (id: string) => string,
  pluginName: (id: string) => string,
): Step[] {
  const steps: Step[] = [];
  const used = new Set<number>();
  let folding: { key: string; entries: RecordEntry[]; index: number } | null = null;

  const pluginText = (entry: RecordEntry) =>
    entry.plugin
      ? `${pluginName(entry.plugin.pluginId)} ${showInvisibleCharacters(entry.plugin.commandId)}`.trimEnd()
      : "";

  /** How a request ended: the next unused entry about the same target that is not another ask. */
  const outcomeOf = (from: number): number => {
    const asked = entries[from];
    for (let i = from + 1; i < entries.length; i++) {
      const next = entries[i];
      if (used.has(i) || !next.change) continue;
      const same =
        next.channelId === asked.channelId &&
        next.plugin?.pluginId === asked.plugin?.pluginId &&
        next.plugin?.commandId === asked.plugin?.commandId;
      if (!same) continue;
      return next.change === "asked" ? -1 : i;
    }
    return -1;
  };

  entries.forEach((entry, index) => {
    if (used.has(index)) return;
    const flush = () => {
      folding = null;
    };

    if (entry.change === "asked") {
      flush();
      const end = outcomeOf(index);
      if (end >= 0) used.add(end);
      const result = end >= 0 ? (entries[end].change as Change) : null;
      const verb = entry.plugin ? "Asked to run" : "Asked to send to";
      const what = entry.plugin ? pluginText(entry) : placeOf(entry, qc, workspaceName);
      const answer = result === null ? "No answer recorded" : CHANGE_LABELS[result];
      steps.push({ at: entry.at, text: `${verb} ${what} → ${answer}`, handed: false });
      return;
    }

    if (entry.change) {
      flush();
      const what = entry.plugin ? pluginText(entry) : placeOf(entry, qc, workspaceName);
      const word = entry.change === "done" && entry.plugin ? "Ran" : CHANGE_LABELS[entry.change];
      steps.push({ at: entry.at, text: `${word} ${what}`.trimEnd(), handed: false });
      return;
    }

    if (entry.refused) {
      const key = `refused:${entry.tool}:${entry.channelId ?? ""}`;
      if (folding?.key === key) {
        folding.entries.push(entry);
        steps[folding.index].text = `${folding.entries.length} refused requests`;
        return;
      }
      steps.push({ at: entry.at, text: "Refused a request", handed: false });
      folding = { key, entries: [entry], index: steps.length - 1 };
      return;
    }

    const listed = LIST_TOOLS[entry.tool];
    const place = listed ?? placeOf(entry, qc, workspaceName);
    const key = `${entry.query ? "search" : "read"}:${entry.tool}:${entry.workspaceId}:${entry.channelId ?? ""}`;
    if (folding?.key === key) {
      folding.entries.push(entry);
    } else {
      steps.push({ at: entry.at, text: "", handed: true });
      folding = { key, entries: [entry], index: steps.length - 1 };
    }
    const group = folding.entries;
    const messages = group.reduce((sum, e) => sum + e.messageIds.length, 0);
    if (entry.query) {
      steps[folding.index].text =
        group.length === 1 ? `Searched ${place}` : `${group.length} searches in ${place}`;
    } else if (listed) {
      steps[folding.index].text =
        group.length === 1 ? `Read ${place}` : `${group.length} reads of ${place}`;
    } else {
      steps[folding.index].text =
        `${plural(group.length, "read", "reads")} in ${place} (${plural(messages, "message", "messages")})`;
    }
  });
  return steps;
}

/** What one workspace's host recorded for the run, from the person's own audit entries. */
function HostLines({
  workspaceId,
  workspaceName,
  runId,
}: {
  workspaceId: string;
  workspaceName: string;
  runId: string;
}) {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const { data, isError, isPending } = useListAuditLog({
    scope: userId === null ? null : { serverId: workspaceId, actorUserId: userId },
    runId,
    limit: 100,
  });
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-rim-text">{workspaceName}</div>
      {userId === null || isError ? (
        <p className="text-sm text-rim-text-muted">RIM couldn&apos;t get these from the host.</p>
      ) : isPending ? (
        <Loader2 role="status" aria-label="Loading" className="mt-1 h-4 w-4 animate-spin" />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-rim-text-muted">The host recorded nothing for this run.</p>
      ) : (
        <ul className="space-y-1 text-sm text-rim-text">
          {data.items.map((item) => (
            <li key={item.id} className="break-words">
              {new Date(item.createdAt).toLocaleTimeString()} · {item.commandId} · {item.outcome}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Words for what a grant covers. */
function grantWords(
  grants: NonNullable<
    ReturnType<typeof useConnectedAgentsStore.getState>["agents"][number]
  >["grants"],
  workspaceName: (id: string) => string,
): string[] {
  return Object.entries(grants).map(([workspaceId, grant]) =>
    grant.all
      ? `${workspaceName(workspaceId)}: every channel you can see`
      : `${workspaceName(workspaceId)}: ${plural(grant.channelIds.length, "channel", "channels")}`,
  );
}

/**
 * One run: what the agent was handed and asked to do, what the workspace host recorded, where the
 * content goes and what the agent may read now.
 */
export function AgentRunDialog({
  run,
  onBack,
  onClose,
}: {
  run: AgentRun;
  onBack: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: servers } = useMyServers();
  const { data: plugins } = useInstalledPlugins();
  const agent = useConnectedAgentsStore((s) => s.agents.find((a) => a.id === run.agentId));
  const [choosing, setChoosing] = useState(false);

  const workspaceName = (id: string) =>
    servers?.find((server) => server.id === id)?.name ?? (id || "an unknown workspace");
  const pluginName = (id: string) => {
    const name = plugins?.find((plugin) => plugin.plugin_id === id)?.display_name;
    return name ? showInvisibleCharacters(name) : id || "an unknown plugin";
  };

  if (choosing && agent) {
    return <AgentGrantsDialog agent={agent} onClose={() => setChoosing(false)} />;
  }

  const steps = stepsOf(run.entries, qc, workspaceName, pluginName);
  const gapAfter = steps.findIndex((step, index) => step.handed && index < steps.length - 1);
  const changed = run.workspaceIds.filter((id) =>
    run.entries.some((entry) => entry.workspaceId === id && entry.change),
  );
  const name = showInvisibleCharacters(run.agentName);
  const grants = agent ? grantWords(agent.grants, workspaceName) : [];

  return (
    <Dialog
      open
      title={`Run at ${new Date(run.startedAt).toLocaleString()}`}
      maxWidth="max-w-2xl"
      onClose={onClose}
    >
      <Button type="button" variant="ghost" size="sm" autoFocus onClick={onBack}>
        Back
      </Button>
      <p className="mt-2 text-sm text-rim-text-muted">
        {name}, acting as you · visible only on this device
      </p>

      <div className="mt-3 max-h-[60vh] space-y-5 overflow-y-auto">
        <section>
          <h3 className="text-sm font-semibold text-rim-text">Steps</h3>
          <ol className="mt-1 space-y-1 text-sm text-rim-text">
            {steps.map((step, index) => (
              <li key={`${step.at}-${index}`} className="break-words">
                <span className="text-rim-text-muted">
                  {new Date(step.at).toLocaleTimeString()} ·{" "}
                </span>
                {step.text}
                {index === gapAfter && (
                  <p className="mt-1 text-xs text-rim-text-faint">
                    {OUTSIDE_RIM} RIM can&apos;t see it, which model it used, or where the content
                    went.
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>

        {run.id !== null && (
          <section>
            <h3 className="text-sm font-semibold text-rim-text">Recorded by the workspace host</h3>
            {changed.length === 0 ? (
              <p className="mt-1 text-sm text-rim-text-muted">
                Nothing here reached the host: reads come from this device.
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs text-rim-text-muted">
                  Arguments are redacted. Your desktop app tells the host that an agent made the
                  call: this holds your agent to you, not a modified client to the server. Those who
                  can read this workspace&apos;s log can see these lines.
                </p>
                {changed.map((id) => (
                  <HostLines
                    key={id}
                    workspaceId={id}
                    workspaceName={workspaceName(id)}
                    runId={run.id as string}
                  />
                ))}
              </>
            )}
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold text-rim-text">Where this content goes</h3>
          <ol className="mt-1 list-decimal pl-5 text-sm text-rim-text">
            <li>Your desktop app (in RIM)</li>
            <li>{name} (outside RIM)</li>
            <li>Its model provider (outside RIM)</li>
          </ol>
          <p className="mt-1 text-xs text-rim-text-muted">
            No prompt or model traffic passes through a RIM server for this agent.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-rim-text">Its grants now</h3>
          {agent ? (
            <>
              {grants.length === 0 ? (
                <p className="mt-1 text-sm text-rim-text-muted">It can&apos;t read any channel.</p>
              ) : (
                <ul className="mt-1 text-sm text-rim-text">
                  {grants.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => setChoosing(true)}
              >
                Choose what it can read
              </Button>
            </>
          ) : (
            <p className="mt-1 text-sm text-rim-text-muted">Disconnected.</p>
          )}
        </section>
      </div>
    </Dialog>
  );
}
