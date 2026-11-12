/**
 * Runs: an agent's calls grouped by time. RIM does not see where an agent's task starts or ends, so
 * a run is only a stretch of calls with no long gap between them.
 */

import { CLEARED_TOOL, type RecordEntry } from "../state/useAgentRecordStore";
import { randomToken, secureRandom, type RandomFill } from "./agentCrypto";

/** How long a gap between an agent's calls ends a run. */
export const RUN_GAP_MS = 15 * 60 * 1000;

/** A new run identifier: `r_` and 16 random characters, which the server accepts. */
export function newRunId(random: RandomFill = secureRandom): string {
  return `r_${randomToken(12, random)}`;
}

/**
 * The run a call at `now` belongs to.
 *
 * @param scopeChangedAt - When the agent's grants or approvals last changed, ISO 8601: a run does
 *   not span that moment.
 * @returns The id of the agent's last entry when that entry is recent enough and not older than
 *   the change, else a new id.
 */
export function runIdFor(
  entries: readonly RecordEntry[],
  agentId: string,
  now: number,
  newId: () => string,
  scopeChangedAt?: string,
): string {
  for (let index = entries.length - 1; index >= 0; index--) {
    const last = entries[index];
    if (last.agentId !== agentId) continue;
    const at = Date.parse(last.at);
    const changed = scopeChangedAt ? Date.parse(scopeChangedAt) : -Infinity;
    if (last.runId && now - at <= RUN_GAP_MS && at >= changed) return last.runId;
    break;
  }
  return newId();
}

/** One stretch of an agent's calls. */
export interface AgentRun {
  /** `null` for entries kept before runs existed, grouped by the same gap. */
  id: string | null;
  agentId: string;
  agentName: string;
  /** When its first entry was kept, ISO 8601. */
  startedAt: string;
  /** When its last entry was kept, ISO 8601. */
  lastAt: string;
  /** Oldest first. */
  entries: RecordEntry[];
  /** The workspaces its entries name. */
  workspaceIds: string[];
}

/** @returns The runs in a record, newest first. The note clearing the record is in none. */
export function groupRuns(entries: readonly RecordEntry[]): AgentRun[] {
  const runs: AgentRun[] = [];
  const byId = new Map<string, AgentRun>();
  const openLegacy = new Map<string, AgentRun>();

  for (const entry of entries) {
    if (entry.tool === CLEARED_TOOL) continue;
    const at = Date.parse(entry.at);
    let run = entry.runId ? byId.get(entry.runId) : openLegacy.get(entry.agentId);
    if (!entry.runId && run && at - Date.parse(run.lastAt) > RUN_GAP_MS) run = undefined;
    if (!run) {
      run = {
        id: entry.runId ?? null,
        agentId: entry.agentId,
        agentName: entry.agentName,
        startedAt: entry.at,
        lastAt: entry.at,
        entries: [],
        workspaceIds: [],
      };
      runs.push(run);
      if (entry.runId) byId.set(entry.runId, run);
      else openLegacy.set(entry.agentId, run);
    }
    run.entries.push(entry);
    run.lastAt = entry.at;
    if (entry.workspaceId && !run.workspaceIds.includes(entry.workspaceId)) {
      run.workspaceIds.push(entry.workspaceId);
    }
  }

  return runs.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** `count` and the word that fits it. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The counts of a run, in words. */
export function runCounts(entries: readonly RecordEntry[]): string {
  const count = (test: (entry: RecordEntry) => boolean) => entries.filter(test).length;
  const parts: [number, string, string][] = [
    [count((e) => !e.refused && !e.change && !e.query), "read", "reads"],
    [count((e) => !e.refused && !e.change && e.query), "search", "searches"],
    [count((e) => e.change === "sent"), "message sent", "messages sent"],
    [count((e) => e.change === "done"), "command run", "commands run"],
    [count((e) => e.change === "proposed"), "suggestion", "suggestions"],
    [count((e) => e.change === "discarded"), "discarded", "discarded"],
    [count((e) => e.change === "expired"), "expired", "expired"],
    [count((e) => e.change === "busy"), "while you were busy", "while you were busy"],
    [count((e) => e.refused), "refused", "refused"],
  ];
  const words = parts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
  return words.length > 0 ? words.join(", ") : "nothing";
}

/** How long a run lasted, in words. */
export function durationOf(run: AgentRun): string {
  const minutes = Math.round((Date.parse(run.lastAt) - Date.parse(run.startedAt)) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return plural(minutes, "minute", "minutes");
  const rest = minutes % 60;
  const hours = plural(Math.floor(minutes / 60), "hour", "hours");
  return rest === 0 ? hours : `${hours} ${rest} min`;
}
