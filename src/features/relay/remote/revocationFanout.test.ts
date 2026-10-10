import { describe, expect, it, vi } from "vitest";

import vectors from "../../../../protocol/relay-vectors.json";
import { RevocationFanoutStatus } from "../../../core/graphql/generated/schema-types";
import { browserRelayCrypto } from "../crypto/relayCrypto";
import {
  accessUntil,
  DIRECT_AFTER_MS,
  directDue,
  directProblem,
  readFanout,
  sendDirectly,
  unconfirmedText,
  type AckDeps,
} from "./revocationFanout";

const HOST = vectors.host.serverId;
const OTHER = vectors.relay.serverId;
const revocation = vectors.revocation;
const ack = vectors.revocationAck;
const deps: AckDeps = {
  crypto: browserRelayCrypto,
  hostKeyAt: async (host) => (host === HOST ? vectors.host.serverKey : vectors.relay.serverKey),
};

describe("a revocation's fan-out", () => {
  it("confirms a host whose acknowledgement verifies", async () => {
    const hosts = await readFanout(
      revocation,
      [
        { hostServerId: HOST, status: RevocationFanoutStatus.ACKED, ack, attempts: 1 },
        { hostServerId: OTHER, status: RevocationFanoutStatus.PENDING, ack: null, attempts: 3 },
      ],
      deps,
    );
    expect(hosts).toEqual([
      {
        host: HOST,
        state: "confirmed",
        via: "relay",
        appliedAt: "2026-10-09T00:00:00Z",
        problem: null,
      },
      { host: OTHER, state: "waiting", via: null, appliedAt: null, problem: null },
    ]);
  });

  it("does not take an acknowledgement for another revocation or from another key", async () => {
    const [forged] = await readFanout(
      revocation,
      [{ hostServerId: OTHER, status: RevocationFanoutStatus.ACKED, ack, attempts: 1 }],
      deps,
    );
    expect(forged.state).toBe("waiting");
    expect(forged.problem).toMatch(/another host/);
    const [other] = await readFanout(
      { ...revocation, payload: revocation.payload.replace("00:00Z", "00:01Z") },
      [{ hostServerId: HOST, status: RevocationFanoutStatus.ACKED, ack, attempts: 1 }],
      deps,
    );
    expect(other.problem).toMatch(/another revocation/);
  });

  it("marks a host the relay gave up on", async () => {
    const [host] = await readFanout(
      revocation,
      [{ hostServerId: HOST, status: RevocationFanoutStatus.GAVE_UP, ack: null, attempts: 9 }],
      deps,
    );
    expect(host.state).toBe("failed");
  });

  it("sends it directly two minutes in, to the hosts still waiting", async () => {
    expect(directDue(0, DIRECT_AFTER_MS - 1)).toBe(false);
    expect(directDue(0, DIRECT_AFTER_MS)).toBe(true);
    const apply = vi.fn(async (host: string) => {
      if (host === OTHER) throw new Error("unreachable");
      return ack;
    });
    const result = await sendDirectly(
      revocation,
      [
        { host: HOST, state: "waiting", via: null, appliedAt: null, problem: null },
        { host: OTHER, state: "waiting", via: null, appliedAt: null, problem: null },
        { host: "rims1_done", state: "confirmed", via: "relay", appliedAt: "x", problem: null },
      ],
      apply,
      deps,
    );
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith(HOST, revocation);
    expect(result.map((r) => [r.host, r.state, r.via])).toEqual([
      [HOST, "confirmed", "direct"],
      [OTHER, "failed", null],
      ["rims1_done", "confirmed", "relay"],
    ]);
    expect(result[1].problem).toBe("unreachable");
  });

  it("refuses a direct answer that does not verify", async () => {
    const [result] = await sendDirectly(
      revocation,
      [{ host: OTHER, state: "waiting", via: null, appliedAt: null, problem: null }],
      async () => ack,
      deps,
    );
    expect(result.state).toBe("failed");
  });

  it("says when a host that limits direct removals takes them again", async () => {
    const limited = {
      response: {
        errors: [
          {
            message: "rate limit exceeded",
            extensions: { code: "RATE_LIMITED", retryAfterSeconds: 610 },
          },
        ],
      },
    };
    const [result] = await sendDirectly(
      revocation,
      [{ host: HOST, state: "waiting", via: null, appliedAt: null, problem: null }],
      async () => {
        throw limited;
      },
      deps,
    );
    expect(result.state).toBe("failed");
    expect(result.problem).toBe(
      "it refused more removals from this address for now; it accepts them again in 11 min",
    );
    expect(
      directProblem({
        response: {
          errors: [
            {
              message: "server rims1_h is unavailable",
              extensions: { code: "UPSTREAM_UNAVAILABLE" },
            },
          ],
        },
      }),
    ).toBe("Another server this needs could not be reached. Try again later.");
  });

  it("names how long the device keeps access: the delegation's end, a day at most", () => {
    const revokedAt = Date.UTC(2026, 9, 9, 12);
    expect(accessUntil(revokedAt, null)).toBe(Date.UTC(2026, 9, 10, 12));
    expect(accessUntil(revokedAt, "2026-10-09T18:00:00Z")).toBe(Date.UTC(2026, 9, 9, 18));
    expect(accessUntil(revokedAt, "2026-10-12T00:00:00Z")).toBe(Date.UTC(2026, 9, 10, 12));
    expect(unconfirmedText("https://host.example", "Ops", "noon")).toBe(
      "https://host.example has not confirmed; the device keeps access to Ops until noon",
    );
  });
});
