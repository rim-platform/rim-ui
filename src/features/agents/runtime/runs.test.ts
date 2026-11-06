import { describe, expect, it } from "vitest";

import { CLEARED_TOOL, type RecordEntry } from "../state/useAgentRecordStore";
import { groupRuns, newRunId, RUN_GAP_MS, runCounts, runIdFor, durationOf } from "./runs";

const T0 = Date.parse("2026-11-06T10:00:00.000Z");

function entry(fields: Partial<RecordEntry> & { offset?: number } = {}): RecordEntry {
  const { offset = 0, ...rest } = fields;
  return {
    at: new Date(T0 + offset).toISOString(),
    agentId: "a1",
    agentName: "Claude Code",
    tool: "rim_read_messages",
    workspaceId: "w1",
    channelId: "c1",
    query: false,
    messageIds: ["m1"],
    refused: false,
    ...rest,
  };
}

describe("newRunId", () => {
  it("is r_ and 16 characters the server accepts", () => {
    const id = newRunId();
    expect(id).toMatch(/^r_[A-Za-z0-9_-]{16}$/);
    expect(id).not.toBe(newRunId());
  });
});

describe("runIdFor", () => {
  const newId = () => "r_new";

  it("starts a run when the agent has no entry", () => {
    expect(runIdFor([], "a1", T0, newId)).toBe("r_new");
  });

  it("continues at exactly fifteen minutes and starts a new run just past it", () => {
    const entries = [entry({ runId: "r_old" })];
    expect(runIdFor(entries, "a1", T0 + RUN_GAP_MS, newId)).toBe("r_old");
    expect(runIdFor(entries, "a1", T0 + RUN_GAP_MS + 1, newId)).toBe("r_new");
  });

  it("looks only at that agent's last entry", () => {
    const entries = [
      entry({ runId: "r_one" }),
      entry({ agentId: "a2", runId: "r_two", offset: 60_000 }),
    ];
    expect(runIdFor(entries, "a1", T0 + 120_000, newId)).toBe("r_one");
    expect(runIdFor(entries, "a3", T0 + 120_000, newId)).toBe("r_new");
  });

  it("counts a refused entry, and starts anew after one with no id", () => {
    expect(runIdFor([entry({ runId: "r_x", refused: true })], "a1", T0, newId)).toBe("r_x");
    expect(runIdFor([entry()], "a1", T0, newId)).toBe("r_new");
  });
});

describe("groupRuns", () => {
  it("groups interleaved agents by their ids, newest first", () => {
    const runs = groupRuns([
      entry({ runId: "r_1" }),
      entry({ agentId: "a2", agentName: "Other", runId: "r_2", offset: 1000 }),
      entry({ runId: "r_1", offset: 2000, workspaceId: "w2" }),
      entry({ runId: "r_3", offset: 3_600_000 }),
    ]);
    expect(runs.map((run) => run.id)).toEqual(["r_3", "r_1", "r_2"]);
    const first = runs[1];
    expect(first.entries).toHaveLength(2);
    expect(first.workspaceIds).toEqual(["w1", "w2"]);
    expect(first.startedAt).toBe(new Date(T0).toISOString());
    expect(first.lastAt).toBe(new Date(T0 + 2000).toISOString());
  });

  it("groups entries with no id by the gap and gives them a null id", () => {
    const runs = groupRuns([
      entry(),
      entry({ offset: RUN_GAP_MS }),
      entry({ offset: RUN_GAP_MS * 2 + 1 }),
    ]);
    expect(runs.map((run) => [run.id, run.entries.length])).toEqual([
      [null, 1],
      [null, 2],
    ]);
  });

  it("leaves out the note that the record was cleared", () => {
    expect(groupRuns([entry({ agentId: "", tool: CLEARED_TOOL, runId: undefined })])).toEqual([]);
  });
});

describe("runCounts and durationOf", () => {
  it("counts in words", () => {
    const words = runCounts([
      entry(),
      entry(),
      entry({ change: "sent" }),
      entry({ change: "discarded" }),
      entry({ refused: true }),
      entry({ refused: true }),
    ]);
    expect(words).toBe("2 reads, 1 message sent, 1 discarded, 2 refused");
  });

  it("says how long a run lasted", () => {
    const [run] = groupRuns([entry({ runId: "r" }), entry({ runId: "r", offset: 90 * 60_000 })]);
    expect(durationOf(run)).toBe("1 hour 30 min");
    const [short] = groupRuns([entry({ runId: "s" })]);
    expect(durationOf(short)).toBe("under a minute");
  });
});
