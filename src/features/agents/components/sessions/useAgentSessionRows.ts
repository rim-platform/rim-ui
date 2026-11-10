import { useMemo } from "react";

import { agentAvailable } from "../../../agent/agentAvailability";
import type { AgentSessionStatus } from "../../acp/agentSession";
import {
  isLiveStatus,
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
} from "../../state/useAgentSessionsStore";
import { useStatuses } from "./useSessionStatuses";

/** The most sessions a short list shows. */
export const AGENT_SESSION_ROWS = 6;

/** One agent session as a short list shows it. */
export interface AgentSessionRow {
  key: string;
  agentName: string;
  /** The session's title, or `null` before it has one. */
  title: string | null;
  /** Its status while its program runs, or `null` for a recent one that is not running. */
  status: AgentSessionStatus | null;
  /** When it last started or ended a turn, waited, or ended, ISO 8601, when known. */
  lastActivityAt: string | null;
  /** Whether it finished a turn or started waiting since the person last had its page open. */
  unseen: boolean;
}

/** A short list of agent sessions, and how many wait for the person. */
export interface AgentSessionRows {
  rows: readonly AgentSessionRow[];
  /** How many sessions wait for the person's answer, the ones past the limit too. */
  waiting: number;
  /** How many sessions are working on a turn, the ones past the limit too. */
  working: number;
}

/**
 * The agent sessions of this device, the running ones first, then the recent ones, the latest
 * activity first in each; none off the desktop app.
 *
 * @param limit - The most rows.
 */
export function useAgentSessionRows(limit: number = AGENT_SESSION_ROWS): AgentSessionRows {
  const sessions = useRunningAgentSessionsStore((s) => s.sessions);
  const unseen = useRunningAgentSessionsStore((s) => s.unseen);
  const recent = useAgentSessionsStore((s) => s.recent);
  const statuses = useStatuses(sessions);
  const available = agentAvailable();

  return useMemo(() => {
    if (!available) return { rows: [], waiting: 0, working: 0 };
    const order = new Map(recent.map((entry, index) => [entry.key, index]));
    const running = Object.keys(sessions)
      .filter((key) => {
        const status = statuses[key];
        return status !== undefined && isLiveStatus(status);
      })
      .sort((a, b) => (order.get(a) ?? -1) - (order.get(b) ?? -1));
    const runningKeys = new Set(running);
    const rows: AgentSessionRow[] = running.map((key) => {
      const entry = recent.find((item) => item.key === key);
      return {
        key,
        agentName: sessions[key].getSnapshot().name,
        title: entry?.title ?? null,
        status: statuses[key],
        lastActivityAt: entry?.lastActivityAt ?? null,
        unseen: unseen[key] === true,
      };
    });
    for (const entry of recent) {
      if (runningKeys.has(entry.key)) continue;
      rows.push({
        key: entry.key,
        agentName: entry.agentName,
        title: entry.title,
        status: null,
        lastActivityAt: entry.lastActivityAt,
        unseen: unseen[entry.key] === true,
      });
    }
    const waiting = running.filter((key) => statuses[key] === "waiting").length;
    const working = running.filter((key) => statuses[key] === "working").length;
    return { rows: rows.slice(0, limit), waiting, working };
  }, [available, sessions, statuses, recent, unseen, limit]);
}
