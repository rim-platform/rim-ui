import { describe, expect, it, vi } from "vitest";

import { asMessage, HOST, messageItem, processorFor, SPACE } from "../../../test/relayItems";
import type { RelayItemView } from "../api/relayApi";
import {
  newSwitch,
  runSwitch,
  SWITCH_STEPS,
  type SwitchDeps,
  type SwitchState,
} from "./relaySwitch";

const OLD = "rims1_T5LLFxkrobgyvlf3WVxuvLlfqYSZAssRFgmvCfI2R-c";
const NEW = "rims1_NEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWN";

function start(oldGoesAway = false): SwitchState {
  return newSwitch({
    principalId: "rimp1_me",
    oldOrigin: "https://old.example",
    oldServerId: OLD,
    oldDirectSpaceId: "old-direct",
    newOrigin: "https://new.example",
    username: "me",
    oldGoesAway,
  });
}

function fakeDeps(overrides: Partial<SwitchDeps> = {}) {
  const log: string[] = [];
  const saved: SwitchState[] = [];
  let cards = 0;
  const deps: SwitchDeps = {
    checkNew: vi.fn(async () => ({
      serverId: NEW,
      keyHash: "qkSWxxJEL_11l8_dTCGhHc_1Q1pAc2pMirMBGnz7388",
      endpoints: { graphql: "https://new.example/api", websocket: "wss://new.example/api/ws" },
    })),
    openNew: vi.fn(async () => undefined),
    enterNew: vi.fn(async () => "new-user"),
    signCard: vi.fn(async (relays: string[]) => ({
      payload: JSON.stringify({ version: ++cards, relays }),
      signature: "sig",
    })),
    publishOld: vi.fn(async (card) => {
      log.push(`old card ${card.payload}`);
    }),
    publishNew: vi.fn(async (_server, card) => {
      log.push(`new card ${card.payload}`);
    }),
    workspaces: vi.fn(async () => [
      { workspaceId: SPACE, host: HOST },
      { workspaceId: "0199d1a0-0000-7000-8000-0000000000aa", host: OLD },
    ]),
    signDelegation: vi.fn(async (fields) => ({ payload: JSON.stringify(fields), signature: "s" })),
    renewNew: vi.fn(async (_server, delegations) => delegations.map(() => ({ status: "active" }))),
    drainOld: vi.fn(async () => {
      log.push("drain");
    }),
    homedConversations: vi.fn(async () => ["c1", "c2"]),
    leaveOld: vi.fn(async () => {
      log.push("leave");
    }),
    finish: vi.fn(async () => {
      log.push("finish");
    }),
    save: vi.fn(async (state: SwitchState) => {
      saved.push(state);
    }),
    now: () => Date.UTC(2026, 9, 10),
    ...overrides,
  };
  return { deps, log, saved };
}

describe("switching relays", () => {
  it("runs the six steps in order, saving after each", async () => {
    const { deps, log, saved } = fakeDeps();
    const progress: number[] = [];
    const done = await runSwitch(start(true), deps, (s) => progress.push(s.step));
    expect(done.step).toBe(SWITCH_STEPS.length);
    expect(done.error).toBeNull();
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
    expect(saved.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(done).toMatchObject({ newServerId: NEW, newUserId: "new-user" });
    expect(done.successors).toEqual([
      { spaceId: "old-direct", conversationId: "c1" },
      { spaceId: "old-direct", conversationId: "c2" },
    ]);
    expect(log).toEqual([
      'old card {"version":1,"relays":["https://new.example","https://old.example"]}',
      'new card {"version":1,"relays":["https://new.example","https://old.example"]}',
      "drain",
      'new card {"version":2,"relays":["https://new.example"]}',
      'old card {"version":2,"relays":["https://new.example"]}',
      "leave",
      "finish",
    ]);
    const delegations = vi
      .mocked(deps.signDelegation)
      .mock.calls.map(([f]) => [f.relay, f.host, f.workspaceId]);
    expect(delegations).toEqual([
      [NEW, HOST, SPACE],
      [NEW, OLD, "0199d1a0-0000-7000-8000-0000000000aa"],
    ]);
  });

  it("does not list conversations to continue when the old relay stays", async () => {
    const { deps } = fakeDeps();
    const done = await runSwitch(start(false), deps);
    expect(done.successors).toEqual([]);
    expect(deps.homedConversations).not.toHaveBeenCalled();
  });

  it("refuses to switch to the same relay", async () => {
    const { deps } = fakeDeps({
      checkNew: vi.fn(async () => ({
        serverId: OLD,
        keyHash: "x",
        endpoints: { graphql: "g", websocket: "w" },
      })),
    });
    const stopped = await runSwitch(start(), deps);
    expect(stopped.step).toBe(0);
    expect(stopped.error).toMatch(/relay you use now/);
  });

  it("stops at a failed step and picks up there, signing in to the new relay again", async () => {
    let refuse = true;
    const { deps, saved } = fakeDeps({
      renewNew: vi.fn(async (_server, delegations) =>
        delegations.map(() => ({ status: refuse ? "refused" : "active" })),
      ),
    });
    const stopped = await runSwitch(start(), deps);
    expect(stopped.step).toBe(2);
    expect(stopped.error).toMatch(/refused/);
    expect(saved[saved.length - 1]).toEqual(stopped);

    // After a restart: the saved state goes on from step 2, with a fresh session.
    refuse = false;
    vi.mocked(deps.enterNew).mockClear();
    const done = await runSwitch(stopped, deps);
    expect(done.step).toBe(SWITCH_STEPS.length);
    expect(deps.enterNew).toHaveBeenCalledTimes(1);
    expect(deps.leaveOld).toHaveBeenCalledTimes(1);
  });

  it("loses no message across the switch", async () => {
    // The host's stream carries 1..10. The old relay gets 1..7 (until the app leaves it); the
    // new relay gets everything from its delegation on: 5..10.
    const items = new Map<number, RelayItemView>();
    for (let seq = 1; seq <= 10; seq++) items.set(seq, await messageItem(seq));
    const oldQueue = [1, 2, 3, 4, 5, 6, 7].map((seq) => items.get(seq)!);
    const newQueue = [5, 6, 7, 8, 9, 10].map((seq) => items.get(seq)!);

    // This device's stream positions, per account; the switch carries them over.
    const oldStore = new Map<string, number>();
    const newStore = new Map<string, number>();
    const applied: string[] = [];
    const before = processorFor(oldStore, applied);
    for (const item of oldQueue.slice(0, 3)) await before.push(asMessage(item));

    const { deps } = fakeDeps({
      drainOld: async () => {
        await before.catchUpItems(oldQueue);
      },
      finish: async () => {
        for (const [key, last] of oldStore) newStore.set(key, last);
      },
    });
    const done = await runSwitch(start(), deps);
    expect(done.step).toBe(SWITCH_STEPS.length);

    // The app restarts on the new relay and reads its queue.
    const after = processorFor(newStore, applied);
    for (const item of newQueue) await after.push(asMessage(item));

    expect(applied).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10"]);
  });
});
