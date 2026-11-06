import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const digests = vi.hoisted(() => ({ held: null as Promise<void> | null, waiting: 0 }));
vi.mock("./agentCrypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("./agentCrypto")>();
  return {
    ...real,
    sha256Base64Url: async (text: string) => {
      const hash = await real.sha256Base64Url(text);
      if (digests.held) {
        digests.waiting += 1;
        await digests.held;
      }
      return hash;
    },
  };
});

import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { randomToken, sha256Base64Url, sixDigitCode, type RandomFill } from "./agentCrypto";
import { createPairing, type PendingView } from "./pairing";

const LIFETIME_MS = 120_000;
const WAIT_MS = 10_000;

const IN_PROGRESS = { status: 409, body: { error: "pairing_in_progress" } };
const TRY_LATER = { status: 429, body: { error: "try_later" } };
const UNKNOWN = { status: 404, body: { error: "unknown_request" } };

function setup() {
  let draws = 0;
  const random: RandomFill = (target) => {
    draws += 1;
    target.fill(draws);
  };
  const agents: ConnectedAgent[] = [];
  const onPendingChanged = vi.fn<(view: PendingView | null) => void>();
  const pairing = createPairing({
    now: () => Date.now(),
    random,
    connect: (agent) => agents.push(agent),
    onPendingChanged,
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer),
  });
  return { pairing, agents, onPendingChanged };
}

/** Starts a request, and gives what the program would poll with. */
async function started(
  pairing: ReturnType<typeof setup>["pairing"],
  name: unknown = "Claude Code",
) {
  const answer = await pairing.request(name);
  expect(answer.status).toBe(200);
  const { requestId, pollSecret } = answer.body as { requestId: string; pollSecret: string };
  return { requestId, pollSecret };
}

describe("agentCrypto", () => {
  it("draws tokens as unpadded base64url", () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(32)).not.toBe(token);
  });

  it("hashes to the SHA-256 of the text, as unpadded base64url", async () => {
    expect(await sha256Base64Url("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  /** A random source giving these 32-bit values in turn. */
  function values(...list: number[]): RandomFill {
    return (target) => {
      new DataView(target.buffer).setUint32(0, list.shift() ?? 0);
    };
  }

  it("keeps a code's leading zeros", () => {
    expect(sixDigitCode(values(42))).toBe("000042");
    expect(sixDigitCode(values(0))).toBe("000000");
    expect(sixDigitCode(values(999_999))).toBe("999999");
  });

  it("draws again for the biased values at the top of the range", () => {
    const limit = 2 ** 32 - (2 ** 32 % 1_000_000);
    expect(sixDigitCode(values(0xffffffff, limit, limit - 1))).toBe(
      String((limit - 1) % 1_000_000).padStart(6, "0"),
    );
  });

  it("always gives six digits from the real source", () => {
    expect(sixDigitCode()).toMatch(/^\d{6}$/);
  });
});

describe("createPairing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers a request with its code and secret, and a poll says pending", async () => {
    const { pairing, onPendingChanged } = setup();
    const answer = await pairing.request("Claude Code");
    expect(answer.status).toBe(200);
    const { requestId, pollSecret, code, expiresIn } = answer.body;
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pollSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pollSecret).not.toBe(requestId);
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresIn).toBe(120);
    expect(await pairing.poll({ requestId, pollSecret })).toEqual({
      status: 200,
      body: { status: "pending" },
    });
    const view = {
      requestId,
      name: "Claude Code",
      code,
      expiresAt: Date.now() + LIFETIME_MS,
    };
    expect(onPendingChanged).toHaveBeenLastCalledWith(view);
    expect(pairing.pending()).toEqual(view);
  });

  it("hands over the token once, after approval", async () => {
    const { pairing, onPendingChanged } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    expect(onPendingChanged).toHaveBeenLastCalledWith(null);
    expect(pairing.pending()).toBeNull();
    const answer = await pairing.poll({ requestId, pollSecret });
    expect(answer.status).toBe(200);
    expect(answer.body.status).toBe("approved");
    expect(answer.body.token).toMatch(/^rimagent_[A-Za-z0-9_-]{43}$/);
    expect(await pairing.poll({ requestId, pollSecret })).toEqual(UNKNOWN);
  });

  it("hands the token to only one of two concurrent polls", async () => {
    const { pairing } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    const answers = await Promise.all([
      pairing.poll({ requestId, pollSecret }),
      pairing.poll({ requestId, pollSecret }),
    ]);
    expect(answers.filter((answer) => answer.body.status === "approved")).toHaveLength(1);
    expect(answers.filter((answer) => answer.status === 404)).toHaveLength(1);
  });

  it("hands the token to only one of two polls whose digests finish together", async () => {
    const { pairing } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    let release = () => {};
    digests.held = new Promise((resolve) => {
      release = resolve;
    });
    digests.waiting = 0;
    try {
      const polls = [
        pairing.poll({ requestId, pollSecret }),
        pairing.poll({ requestId, pollSecret }),
      ];
      while (digests.waiting < 2) await new Promise((resolve) => setImmediate(resolve));
      release();
      const answers = await Promise.all(polls);
      expect(answers.filter((answer) => answer.body.status === "approved")).toHaveLength(1);
      expect(answers.filter((answer) => answer.status === 404)).toHaveLength(1);
    } finally {
      digests.held = null;
    }
  });

  it("connects the agent with the hash of its token, and never the token", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    const { token } = (await pairing.poll({ requestId, pollSecret })).body as { token: string };
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      id: expect.any(String),
      name: "Claude Code",
      tokenHash: await sha256Base64Url(token),
      pairedAt: "2026-11-06T10:00:00.000Z",
      grants: {},
      pluginApprovals: {},
    });
    expect(JSON.stringify(agents)).not.toContain(token);
    expect(JSON.stringify(agents)).not.toContain(token.slice("rimagent_".length));
  });

  it("answers a wrong secret exactly as an unknown request", async () => {
    const { pairing } = setup();
    const { requestId, pollSecret } = await started(pairing);
    const wrong = await pairing.poll({ requestId, pollSecret: "wrong" });
    const unknown = await pairing.poll({ requestId: "unknown", pollSecret });
    expect(wrong).toEqual(UNKNOWN);
    expect(unknown).toEqual(wrong);
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(wrong));
  });

  it("does not let a wrong secret collect a token, and keeps it for the right one", async () => {
    const { pairing } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    expect(await pairing.poll({ requestId, pollSecret: "wrong" })).toEqual(UNKNOWN);
    expect((await pairing.poll({ requestId, pollSecret })).body.status).toBe("approved");
  });

  it.each([
    ["no fields", {}],
    ["a number as the secret", { requestId: "x", pollSecret: 1 }],
    ["null", null],
  ])("answers a poll with %s as an unknown request", async (_what, body) => {
    const { pairing } = setup();
    await started(pairing);
    expect(await pairing.poll(body)).toEqual(UNKNOWN);
  });

  it("says refused once, and forgets the request", async () => {
    const { pairing, onPendingChanged, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    pairing.refuse(requestId);
    expect(onPendingChanged).toHaveBeenLastCalledWith(null);
    expect(await pairing.poll({ requestId, pollSecret })).toEqual({
      status: 200,
      body: { status: "refused" },
    });
    expect(await pairing.poll({ requestId, pollSecret })).toEqual(UNKNOWN);
    expect(agents).toEqual([]);
  });

  it("expires a request at its time, tells the UI by the timer, and says expired once", async () => {
    const { pairing, onPendingChanged } = setup();
    const { requestId, pollSecret } = await started(pairing);
    vi.advanceTimersByTime(LIFETIME_MS - 1);
    expect(onPendingChanged).not.toHaveBeenCalledWith(null);
    vi.advanceTimersByTime(1);
    expect(onPendingChanged).toHaveBeenLastCalledWith(null);
    expect(pairing.pending()).toBeNull();
    expect(await pairing.poll({ requestId, pollSecret })).toEqual({
      status: 200,
      body: { status: "expired" },
    });
    expect(await pairing.poll({ requestId, pollSecret })).toEqual(UNKNOWN);
  });

  it("checks expiry on a call, should the timer be late", async () => {
    const { pairing, onPendingChanged } = setup();
    const { requestId, pollSecret } = await started(pairing);
    vi.setSystemTime(Date.now() + LIFETIME_MS);
    expect(await pairing.poll({ requestId, pollSecret })).toEqual({
      status: 200,
      body: { status: "expired" },
    });
    expect(onPendingChanged).toHaveBeenLastCalledWith(null);
  });

  it("does not approve or refuse what expired", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    vi.setSystemTime(Date.now() + LIFETIME_MS);
    await pairing.approve(requestId);
    pairing.refuse(requestId);
    expect(agents).toEqual([]);
    expect((await pairing.poll({ requestId, pollSecret })).body.status).toBe("expired");
  });

  it("ignores approving or refusing another request's id", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve("other");
    pairing.refuse("other");
    expect(agents).toEqual([]);
    expect((await pairing.poll({ requestId, pollSecret })).body.status).toBe("pending");
  });

  it("does not let a refused request be approved, or an approved one refused", async () => {
    const first = setup();
    const refused = await started(first.pairing);
    first.pairing.refuse(refused.requestId);
    await first.pairing.approve(refused.requestId);
    expect(first.agents).toEqual([]);

    const second = setup();
    const approved = await started(second.pairing);
    await second.pairing.approve(approved.requestId);
    second.pairing.refuse(approved.requestId);
    expect((await second.pairing.poll(approved)).body.status).toBe("approved");
  });

  it("approves once for a double click", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await Promise.all([pairing.approve(requestId), pairing.approve(requestId)]);
    await pairing.poll({ requestId, pollSecret });
    expect(agents).toHaveLength(1);
  });

  it("keeps a second request out while one is pending", async () => {
    const { pairing, onPendingChanged } = setup();
    await started(pairing);
    onPendingChanged.mockClear();
    expect(await pairing.request("Other")).toEqual(IN_PROGRESS);
    expect(onPendingChanged).not.toHaveBeenCalled();
  });

  it("starts only one of two concurrent requests", async () => {
    const { pairing } = setup();
    const answers = await Promise.all([pairing.request("One"), pairing.request("Two")]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 409]);
  });

  it("keeps a second request out while one is approved and uncollected", async () => {
    const { pairing } = setup();
    const { requestId } = await started(pairing);
    await pairing.approve(requestId);
    expect(await pairing.request("Other")).toEqual(IN_PROGRESS);
  });

  it("lets a new request replace a refused one nobody collects, once the wait is over", async () => {
    const { pairing } = setup();
    const { requestId, pollSecret } = await started(pairing);
    pairing.refuse(requestId);
    expect(await pairing.request("Other")).toEqual(TRY_LATER);
    vi.advanceTimersByTime(WAIT_MS + 1);
    expect((await pairing.request("Other")).status).toBe(200);
    expect(await pairing.poll({ requestId, pollSecret })).toEqual(UNKNOWN);
  });

  it("lets a refused request that nobody collects expire", async () => {
    const { pairing } = setup();
    const { requestId, pollSecret } = await started(pairing);
    pairing.refuse(requestId);
    vi.advanceTimersByTime(LIFETIME_MS);
    expect((await pairing.poll({ requestId, pollSecret })).body.status).toBe("expired");
    expect((await pairing.request("Other")).status).toBe(200);
  });

  it("gives a token 120 s from approval, not from the request", async () => {
    const { pairing } = setup();
    const { requestId, pollSecret } = await started(pairing);
    vi.advanceTimersByTime(LIFETIME_MS - 1000);
    await pairing.approve(requestId);
    vi.advanceTimersByTime(LIFETIME_MS - 1);
    expect((await pairing.poll({ requestId, pollSecret })).body.status).toBe("approved");
  });

  it("connects nothing until the token is collected", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    expect(agents).toEqual([]);
    expect((await pairing.poll({ requestId, pollSecret })).body.status).toBe("approved");
    expect(agents).toHaveLength(1);
  });

  it("keeps the token for another poll if connecting fails", async () => {
    const connect = vi.fn<(agent: ConnectedAgent) => void>().mockImplementationOnce(() => {
      throw new Error("store failed");
    });
    const pairing = createPairing({
      now: () => Date.now(),
      random: (target) => void crypto.getRandomValues(target),
      connect,
      onPendingChanged: vi.fn(),
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    });
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    await expect(pairing.poll({ requestId, pollSecret })).rejects.toThrow("store failed");
    expect((await pairing.poll({ requestId, pollSecret })).body.status).toBe("approved");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("connects nothing when a token expires uncollected, and forgets the token", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    vi.advanceTimersByTime(LIFETIME_MS);
    expect(agents).toEqual([]);
    expect(await pairing.poll({ requestId, pollSecret })).toEqual({
      status: 200,
      body: { status: "expired" },
    });
  });

  it("keeps an agent whose token was collected, past the time", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    await pairing.poll({ requestId, pollSecret });
    vi.advanceTimersByTime(LIFETIME_MS * 2);
    expect(agents).toHaveLength(1);
  });

  it("clears a pending request at reset and tells the UI", async () => {
    const { pairing, onPendingChanged } = setup();
    const { requestId, pollSecret } = await started(pairing);
    pairing.reset();
    expect(onPendingChanged).toHaveBeenLastCalledWith(null);
    expect(pairing.pending()).toBeNull();
    expect(await pairing.poll({ requestId, pollSecret })).toEqual(UNKNOWN);
    expect((await pairing.request("Other")).status).toBe(200);
  });

  it("tells the UI at reset even with nothing to forget", () => {
    const { pairing, onPendingChanged } = setup();
    pairing.reset();
    expect(onPendingChanged).toHaveBeenCalledWith(null);
  });

  it("forgets an uncollected token at reset, and connects nothing", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    pairing.reset();
    expect(agents).toEqual([]);
    expect(await pairing.poll({ requestId, pollSecret })).toEqual(UNKNOWN);
  });

  it("keeps a collected agent at reset", async () => {
    const { pairing, agents } = setup();
    const { requestId, pollSecret } = await started(pairing);
    await pairing.approve(requestId);
    await pairing.poll({ requestId, pollSecret });
    pairing.reset();
    expect(agents).toHaveLength(1);
  });

  it("does not connect an agent when reset overtakes approving", async () => {
    const { pairing, agents } = setup();
    const { requestId } = await started(pairing);
    const approving = pairing.approve(requestId);
    pairing.reset();
    await approving;
    expect(agents).toEqual([]);
  });

  it("stops the timer at reset", async () => {
    const { pairing, onPendingChanged } = setup();
    await started(pairing);
    pairing.reset();
    onPendingChanged.mockClear();
    vi.advanceTimersByTime(LIFETIME_MS * 2);
    expect(onPendingChanged).not.toHaveBeenCalled();
  });

  describe("asking again", () => {
    it("waits 10 s after a refusal that was collected", async () => {
      const { pairing } = setup();
      const { requestId, pollSecret } = await started(pairing);
      pairing.refuse(requestId);
      await pairing.poll({ requestId, pollSecret });
      expect(await pairing.request("Other")).toEqual(TRY_LATER);
      vi.advanceTimersByTime(WAIT_MS - 1);
      expect(await pairing.request("Other")).toEqual(TRY_LATER);
      vi.advanceTimersByTime(1);
      expect((await pairing.request("Other")).status).toBe(200);
    });

    it("counts the wait from the refusal, not from the poll", async () => {
      const { pairing } = setup();
      const { requestId, pollSecret } = await started(pairing);
      pairing.refuse(requestId);
      vi.advanceTimersByTime(WAIT_MS - 1);
      await pairing.poll({ requestId, pollSecret });
      expect(await pairing.request("Other")).toEqual(TRY_LATER);
      vi.advanceTimersByTime(1);
      expect((await pairing.request("Other")).status).toBe(200);
    });

    it("waits 10 s after an expiry, collected or not", async () => {
      const { pairing } = setup();
      const { requestId, pollSecret } = await started(pairing);
      vi.advanceTimersByTime(LIFETIME_MS);
      expect(await pairing.request("Other")).toEqual(TRY_LATER);
      await pairing.poll({ requestId, pollSecret });
      expect(await pairing.request("Other")).toEqual(TRY_LATER);
      vi.advanceTimersByTime(WAIT_MS - 1);
      expect(await pairing.request("Other")).toEqual(TRY_LATER);
      vi.advanceTimersByTime(1);
      expect((await pairing.request("Other")).status).toBe(200);
    });

    it("counts the wait from the expiry when the timer was late", async () => {
      const { pairing } = setup();
      await started(pairing);
      vi.setSystemTime(Date.now() + LIFETIME_MS + WAIT_MS);
      expect((await pairing.request("Other")).status).toBe(200);
    });

    it("waits after an approved request whose token expired uncollected", async () => {
      const { pairing } = setup();
      const { requestId } = await started(pairing);
      await pairing.approve(requestId);
      vi.advanceTimersByTime(LIFETIME_MS);
      expect(await pairing.request("Other")).toEqual(TRY_LATER);
      vi.advanceTimersByTime(WAIT_MS);
      expect((await pairing.request("Other")).status).toBe(200);
    });

    it("starts no wait after an approved request was collected", async () => {
      const { pairing } = setup();
      const { requestId, pollSecret } = await started(pairing);
      await pairing.approve(requestId);
      await pairing.poll({ requestId, pollSecret });
      expect((await pairing.request("Other")).status).toBe(200);
    });

    it("is cleared by reset", async () => {
      const refused = setup();
      const one = await started(refused.pairing);
      refused.pairing.refuse(one.requestId);
      await refused.pairing.poll(one);
      refused.pairing.reset();
      expect((await refused.pairing.request("Other")).status).toBe(200);

      const expired = setup();
      await started(expired.pairing);
      vi.advanceTimersByTime(LIFETIME_MS);
      expired.pairing.reset();
      expect((await expired.pairing.request("Other")).status).toBe(200);
    });

    it("says bad_name first during the wait", async () => {
      const { pairing } = setup();
      const { requestId, pollSecret } = await started(pairing);
      pairing.refuse(requestId);
      await pairing.poll({ requestId, pollSecret });
      expect((await pairing.request("")).status).toBe(400);
    });

    it("does not bring the dialog up during the wait", async () => {
      const { pairing, onPendingChanged } = setup();
      const { requestId, pollSecret } = await started(pairing);
      pairing.refuse(requestId);
      await pairing.poll({ requestId, pollSecret });
      onPendingChanged.mockClear();
      await pairing.request("Other");
      expect(onPendingChanged).not.toHaveBeenCalled();
    });

    it("forgets an expired request when a new one starts", async () => {
      const { pairing } = setup();
      const old = await started(pairing);
      vi.advanceTimersByTime(LIFETIME_MS + WAIT_MS);
      await started(pairing, "Other");
      expect(await pairing.poll(old)).toEqual(UNKNOWN);
    });
  });

  describe("cleaning the name", () => {
    async function cleaned(name: unknown) {
      const { pairing } = setup();
      const answer = await pairing.request(name);
      return answer.status === 200 ? pairing.pending()?.name : answer;
    }

    it.each([
      ["control characters", "Cla\u0000ude\u0007 Co\u007Fde", "Claude Code"],
      ["line breaks and tabs, which separate words", "Claude\n\tCode", "Claude Code"],
      ["whitespace between words", "  Claude     Code ", "Claude Code"],
      ["a newline between words", "Claude\nCode", "Claude Code"],
      ["a tab and a mark between words", "Claude\t\u200e Code", "Claude Code"],
      ["left-to-right and right-to-left marks", "‎Claude‏ Code؜", "Claude Code"],
      ["bidirectional embeddings and overrides", "‪Claude‫ ‭‮Code‬", "Claude Code"],
      ["bidirectional isolates", "⁦Claude⁧ ⁨Code⁩", "Claude Code"],
      ["zero-width characters", "Clau​de‍ Code﻿", "Claude Code"],
      ["markup, which stays literal", "<b>Claude</b>", "<b>Claude</b>"],
      ["letters of other scripts", "クロード Código", "クロード Código"],
    ])("removes or keeps %s", async (_what, name, expected) => {
      expect(await cleaned(name)).toBe(expected);
    });

    it("cuts to 64 characters", async () => {
      expect(await cleaned("a".repeat(100))).toBe("a".repeat(64));
    });

    it("trims what the cut leaves", async () => {
      expect(await cleaned(`${"a".repeat(63)} b`)).toBe("a".repeat(63));
    });

    it("counts characters, so a cut does not split one", async () => {
      expect(await cleaned("😀".repeat(70))).toBe("😀".repeat(64));
    });

    it.each([
      ["missing", undefined],
      ["a number", 7],
      ["null", null],
      ["an object", { name: "x" }],
      ["empty", ""],
      ["only whitespace", "   "],
      ["only control characters", "\u0000\u0007"],
      ["only bidirectional marks", "‎‮⁦"],
    ])("says bad_name for a name that is %s", async (_what, name) => {
      expect(await cleaned(name)).toEqual({ status: 400, body: { error: "bad_name" } });
    });
  });
});
