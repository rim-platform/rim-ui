import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../../core/logger";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { secureRandom, sha256Base64Url } from "./agentCrypto";
import { handleBridgeRequest, type BridgeDeps } from "./bridgeHandler";
import { createPairing, type Pairing } from "./pairing";

const LOCKED = { status: 423, body: { error: "locked" } };
const NOT_PAIRED = { status: 401, body: { error: "not_paired" } };
const UNKNOWN = { status: 404, body: { error: "unknown_request" } };
const INTERNAL = { status: 500, body: '{"error":"internal"}' };

let unlocked: boolean;
let agents: ConnectedAgent[];
let pairing: Pairing;

const listWorkspaces = vi.fn();
const mcp = {
  version: "1.2.3",
  reads: {
    listWorkspaces,
    listChannels: vi.fn(),
    readMessages: vi.fn(),
    searchMessages: vi.fn(),
  },
};

function deps(overrides: Partial<BridgeDeps> = {}): BridgeDeps {
  return { unlocked: () => unlocked, pairing, agents: () => agents, mcp, ...overrides };
}

async function ask(
  path: string,
  body: unknown = {},
  authorization: string | null = null,
  overrides: Partial<BridgeDeps> = {},
) {
  const answer = await handleBridgeRequest(
    { id: 1, path, authorization, body: typeof body === "string" ? body : JSON.stringify(body) },
    deps(overrides),
  );
  return { status: answer.status, body: JSON.parse(answer.body) as Record<string, string> };
}

async function requested() {
  const { body } = await ask("/pair", { name: "Claude Code" });
  return { requestId: body.requestId, pollSecret: body.pollSecret };
}

async function pairedToken(): Promise<string> {
  const ids = await requested();
  await pairing.approve(ids.requestId);
  return (await ask("/pair/poll", ids)).body.token;
}

describe("handleBridgeRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    unlocked = true;
    agents = [];
    pairing = createPairing({
      now: () => Date.now(),
      random: secureRandom,
      connect: (agent) => agents.push(agent),
      disconnect: (id) => {
        agents = agents.filter((agent) => agent.id !== id);
      },
      onPendingChanged: () => undefined,
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("/pair", () => {
    it("says locked with no account unlocked, before looking at the body", async () => {
      unlocked = false;
      expect(await ask("/pair", { name: "Claude Code" })).toEqual(LOCKED);
      expect(await ask("/pair", "not json")).toEqual(LOCKED);
      expect(pairing.pending()).toBeNull();
    });

    it.each([
      ["missing", {}],
      ["not a string", { name: 7 }],
      ["empty after cleaning", { name: " \u0000‎ " }],
    ])("says bad_name for a name that is %s", async (_what, body) => {
      expect(await ask("/pair", body)).toEqual({ status: 400, body: { error: "bad_name" } });
    });

    it("says pairing_in_progress while another request is pending", async () => {
      await requested();
      expect(await ask("/pair", { name: "Other" })).toEqual({
        status: 409,
        body: { error: "pairing_in_progress" },
      });
    });

    it("says try_later straight after a refusal", async () => {
      const ids = await requested();
      pairing.refuse(ids.requestId);
      await ask("/pair/poll", ids);
      expect(await ask("/pair", { name: "Claude Code" })).toEqual({
        status: 429,
        body: { error: "try_later" },
      });
    });

    it("answers with the request", async () => {
      const { status, body } = await ask("/pair", { name: "Claude Code" });
      expect(status).toBe(200);
      expect(Object.keys(body).sort()).toEqual(["code", "expiresIn", "pollSecret", "requestId"]);
      expect(body.expiresIn).toBe(120);
    });
  });

  describe("/pair/poll", () => {
    it("says locked with no account unlocked", async () => {
      const ids = await requested();
      unlocked = false;
      expect(await ask("/pair/poll", ids)).toEqual(LOCKED);
    });

    it("answers an unknown request and a wrong secret identically", async () => {
      const ids = await requested();
      const unknown = await ask("/pair/poll", { ...ids, requestId: "other" });
      const wrong = await ask("/pair/poll", { ...ids, pollSecret: "other" });
      expect(unknown).toEqual(UNKNOWN);
      expect(wrong).toEqual(UNKNOWN);
    });

    it("says pending", async () => {
      expect(await ask("/pair/poll", await requested())).toEqual({
        status: 200,
        body: { status: "pending" },
      });
    });

    it("says refused, and forgets", async () => {
      const ids = await requested();
      pairing.refuse(ids.requestId);
      expect(await ask("/pair/poll", ids)).toEqual({ status: 200, body: { status: "refused" } });
      expect(await ask("/pair/poll", ids)).toEqual(UNKNOWN);
    });

    it("says expired, and forgets", async () => {
      const ids = await requested();
      vi.advanceTimersByTime(120_000);
      expect(await ask("/pair/poll", ids)).toEqual({ status: 200, body: { status: "expired" } });
      expect(await ask("/pair/poll", ids)).toEqual(UNKNOWN);
    });

    it("hands over the token at the first poll after approval, and forgets", async () => {
      const ids = await requested();
      await pairing.approve(ids.requestId);
      const { status, body } = await ask("/pair/poll", ids);
      expect(status).toBe(200);
      expect(body.status).toBe("approved");
      expect(body.token).toMatch(/^rimagent_[A-Za-z0-9_-]{43}$/);
      expect(await ask("/pair/poll", ids)).toEqual(UNKNOWN);
    });
  });

  describe("/mcp", () => {
    it("says locked with no account unlocked", async () => {
      const token = await pairedToken();
      unlocked = false;
      expect(await ask("/mcp", {}, null)).toEqual(LOCKED);
      expect(await ask("/mcp", {}, `Bearer ${token}`)).toEqual(LOCKED);
    });

    it.each([
      ["no header", null],
      ["another scheme", "Basic x"],
      ["no token", "Bearer "],
      ["a token of the wrong shape", "Bearer rimagent_short"],
      ["a token without its prefix", `Bearer ${"a".repeat(43)}`],
      ["an unknown token", `Bearer rimagent_${"a".repeat(43)}`],
    ])("says not_paired for %s", async (_what, authorization) => {
      await pairedToken();
      expect(await ask("/mcp", {}, authorization)).toEqual(NOT_PAIRED);
    });

    it("answers the protocol for a paired token", async () => {
      const token = await pairedToken();
      const { status, body } = await ask(
        "/mcp",
        { jsonrpc: "2.0", id: 1, method: "ping" },
        `Bearer ${token}`,
      );
      expect(status).toBe(200);
      expect(body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    });

    it("answers a notification with an empty body", async () => {
      const token = await pairedToken();
      const answer = await handleBridgeRequest(
        {
          id: 1,
          path: "/mcp",
          authorization: `Bearer ${token}`,
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        },
        deps(),
      );
      expect(answer).toEqual({ status: 202, body: "" });
    });

    it("hands the tools the agent the token belongs to, as the store holds it now", async () => {
      const token = await pairedToken();
      listWorkspaces.mockResolvedValue({ isError: false, payload: {} });
      agents[0] = { ...agents[0], grants: { w1: { all: true, channelIds: [] } } };
      await ask(
        "/mcp",
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "rim_list_workspaces" } },
        `Bearer ${token}`,
      );
      expect(listWorkspaces).toHaveBeenCalledWith(agents[0]);
    });

    it("looks at no body without a paired token", async () => {
      const token = await pairedToken();
      expect((await ask("/mcp", "not json", `Bearer ${token}`)).status).toBe(400);
      expect(await ask("/mcp", "not json", null)).toEqual(NOT_PAIRED);
    });

    it("says not_paired for a revoked token", async () => {
      const token = await pairedToken();
      agents = [];
      expect(await ask("/mcp", {}, `Bearer ${token}`)).toEqual(NOT_PAIRED);
    });

    it("says not_paired when another account's agents are in the store", async () => {
      const token = await pairedToken();
      agents = [
        {
          id: "other",
          name: "Other",
          tokenHash: await sha256Base64Url("rimagent_other"),
          pairedAt: "2026-11-06T10:00:00.000Z",
        },
      ];
      expect(await ask("/mcp", {}, `Bearer ${token}`)).toEqual(NOT_PAIRED);
    });
  });

  describe("bodies", () => {
    it.each([
      ["bad JSON", "{"],
      ["empty", ""],
      ["an array", "[]"],
      ["a string", '"name"'],
      ["a number", "7"],
      ["null", "null"],
    ])("says bad_body for a body that is %s", async (_what, body) => {
      for (const path of ["/pair", "/pair/poll"]) {
        expect(await ask(path, body)).toEqual({ status: 400, body: { error: "bad_body" } });
      }
    });
  });

  it("says not_found for another path", async () => {
    expect(await ask("/other")).toEqual({ status: 404, body: { error: "not_found" } });
  });

  describe("failures", () => {
    const AUTHORIZATION = `Bearer rimagent_${"s".repeat(43)}`;
    const REQUEST_BODY = '{"name":"sensitive-name","pollSecret":"sensitive-secret"}';

    function throwing(): never {
      throw new Error(`${AUTHORIZATION} ${REQUEST_BODY}`);
    }

    it.each<[string, Partial<BridgeDeps>, string]>([
      ["unlocked", { unlocked: throwing }, "/mcp"],
      ["agents", { agents: throwing }, "/mcp"],
    ])("answers 500 when %s throws, with no request data", async (_what, overrides, path) => {
      const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      const answer = await handleBridgeRequest(
        { id: 1, path, authorization: AUTHORIZATION, body: REQUEST_BODY },
        deps(overrides),
      );
      expect(answer).toEqual(INTERNAL);
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).not.toContain("rimagent_");
      expect(logged).not.toContain("sensitive");
    });

    it.each(["/pair", "/pair/poll"])("answers 500 when pairing throws on %s", async (path) => {
      const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      const broken: Pairing = { ...pairing, request: throwing, poll: throwing };
      const answer = await handleBridgeRequest(
        { id: 1, path, authorization: null, body: REQUEST_BODY },
        deps({ pairing: broken }),
      );
      expect(answer).toEqual(INTERNAL);
      expect(JSON.stringify(log.mock.calls)).not.toContain("sensitive");
    });

    it("logs nothing about a request that is only refused", async () => {
      const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      await ask("/pair", "{", null);
      await ask("/mcp", {}, AUTHORIZATION);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
