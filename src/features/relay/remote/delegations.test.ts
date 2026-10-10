import { describe, expect, it, vi } from "vitest";

import type { DelegationRecord } from "../state/relayDb";
import {
  DELEGATION_MS,
  delegationFields,
  needsRenewal,
  refusalText,
  RENEW_BATCH,
  RENEW_BEFORE_MS,
  renewDue,
  type RenewDeps,
} from "./delegations";

const RELAY = { serverId: "rims1_relay", keyHash: "8UGftl4tBoxZjUo1UP_-zwUlobQJPwj5kZ0NC1oaAaM" };
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 10, 12);

function record(workspaceId: string, expiresAt: number, relay = RELAY.serverId): DelegationRecord {
  return {
    account: "a",
    workspaceId,
    host: "rims1_host",
    relay,
    issuedAt: expiresAt - DELEGATION_MS,
    expiresAt,
    statement: { payload: "old", signature: "old" },
  };
}

describe("delegation timing", () => {
  it("runs a new delegation 24 hours from a whole second", () => {
    const fields = delegationFields(RELAY, "rims1_host", "w1", NOW + 999, new Uint8Array(16));
    expect(fields.issuedAt).toBe("2026-10-10T12:00:00Z");
    expect(fields.expiresAt).toBe("2026-10-11T12:00:00Z");
    expect(fields.nonce).toBe("AAAAAAAAAAAAAAAAAAAAAA");
  });

  it("renews under 6 hours left, for another relay, or with none", () => {
    expect(needsRenewal(null, RELAY.serverId, NOW)).toBe(true);
    expect(needsRenewal(record("w", NOW + RENEW_BEFORE_MS), RELAY.serverId, NOW)).toBe(false);
    expect(needsRenewal(record("w", NOW + RENEW_BEFORE_MS - 1), RELAY.serverId, NOW)).toBe(true);
    expect(needsRenewal(record("w", NOW + 20 * HOUR, "rims1_old"), RELAY.serverId, NOW)).toBe(true);
  });
});

function deps(records: Map<string, DelegationRecord>, overrides: Partial<RenewDeps> = {}) {
  const signed: string[] = [];
  const d: RenewDeps = {
    account: "a",
    relay: async () => RELAY,
    load: async (id) => records.get(id) ?? null,
    save: vi.fn(async (r: DelegationRecord) => {
      records.set(r.workspaceId, r);
    }),
    sign: vi.fn(async (fields) => {
      signed.push(fields.workspaceId);
      return { payload: JSON.stringify(fields), signature: "sig" };
    }),
    renew: vi.fn(async (statements) =>
      statements.map((s) => {
        const fields = JSON.parse(s.payload) as {
          host: string;
          workspaceId: string;
          expiresAt: string;
        };
        return {
          hostServerId: fields.host,
          workspaceId: fields.workspaceId,
          status: "active",
          expiresAt: fields.expiresAt,
        };
      }),
    ),
    now: () => NOW,
    ...overrides,
  };
  return { d, signed };
}

describe("renewing delegations", () => {
  it("signs only those that need it and keeps what the hosts accepted", async () => {
    const records = new Map([
      ["fresh", record("fresh", NOW + 20 * HOUR)],
      ["ending", record("ending", NOW + 5 * HOUR)],
    ]);
    const { d, signed } = deps(records);
    const outcome = await renewDue(
      [
        { workspaceId: "fresh", host: "rims1_host" },
        { workspaceId: "ending", host: "rims1_host" },
        { workspaceId: "new", host: "rims1_host" },
      ],
      d,
    );
    expect(signed).toEqual(["ending", "new"]);
    expect(outcome.lapsed).toEqual([]);
    expect(records.get("ending")?.expiresAt).toBe(NOW + DELEGATION_MS);
    expect(records.get("fresh")?.statement.payload).toBe("old");
  });

  it("reports workspaces whose delegation had lapsed, so they catch up", async () => {
    const records = new Map([["away", record("away", NOW - HOUR)]]);
    const { d } = deps(records);
    const outcome = await renewDue([{ workspaceId: "away", host: "rims1_host" }], d);
    expect(outcome.lapsed).toEqual(["away"]);
  });

  it("does not keep a delegation the host refused", async () => {
    const records = new Map<string, DelegationRecord>();
    const { d } = deps(records, {
      renew: vi.fn(async () => [
        {
          hostServerId: "rims1_host",
          workspaceId: "w",
          status: "refused",
          expiresAt: null,
          reason: "not_member",
        },
      ]),
    });
    await renewDue([{ workspaceId: "w", host: "rims1_host" }], d);
    expect(records.size).toBe(0);
  });

  it("sends at most 64 per call, and all of them when forced", async () => {
    const records = new Map<string, DelegationRecord>();
    const spaces = Array.from({ length: RENEW_BATCH + 3 }, (_, i) => ({
      workspaceId: `w${i}`,
      host: "rims1_host",
    }));
    for (const s of spaces) records.set(s.workspaceId, record(s.workspaceId, NOW + 20 * HOUR));
    const { d } = deps(records);
    await renewDue(spaces, d);
    expect(d.renew).not.toHaveBeenCalled();
    await renewDue(spaces, d, true);
    expect(vi.mocked(d.renew).mock.calls.map((c) => c[0].length)).toEqual([RENEW_BATCH, 3]);
  });
});

describe("refusalText", () => {
  it("names a host's reason in words, and an unknown one as it is", () => {
    expect(refusalText("not_member")).toBe(
      "The last renewal was refused: this account is no longer a member there.",
    );
    expect(refusalText("upstream_unavailable")).toBe(
      "The last renewal was refused: the server could not be reached; it is tried again later.",
    );
    expect(refusalText("peer_forked")).toBe("The last renewal was refused: peer_forked.");
    expect(refusalText(null)).toBe("The last renewal was refused: no reason given.");
  });
});
