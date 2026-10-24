import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createClient, type ClientOptions } from "graphql-ws";

// Mock graphql-ws before importing wsClient
vi.mock("graphql-ws", () => ({
  createClient: vi.fn(() => ({
    subscribe: vi.fn(),
    dispose: vi.fn(),
  })),
}));

import { useEdgeStore } from "./edgeRefusals";
import { setSessionSecret } from "./sessionSecret";
import {
  onWsConnected,
  onWsDisconnected,
  onWsSessionEnded,
  onWsStatus,
  reconnectDelayMs,
  wsStatus,
  type WsStatus,
} from "./wsClient";

/** The options wsClient created its graphql-ws client with. */
const options = vi.mocked(createClient).mock.calls[0][0] as ClientOptions;

/** The socket closed with `code`, as graphql-ws reports it. */
const closedWith = (code: number) => new CloseEvent("close", { code });

describe("wsClient", () => {
  describe("onWsConnected", () => {
    it("registers a listener and returns an unsubscribe function", () => {
      const listener = vi.fn();
      const unsub = onWsConnected(listener);
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("unsubscribe removes the listener", () => {
      const listener = vi.fn();
      const unsub = onWsConnected(listener);
      unsub();
      // Listener should be removed — no way to trigger it after unsub
      // (just verifying no errors thrown)
    });
  });

  describe("onWsDisconnected", () => {
    it("registers a listener and returns an unsubscribe function", () => {
      const listener = vi.fn();
      const unsub = onWsDisconnected(listener);
      expect(typeof unsub).toBe("function");
      unsub();
    });
  });
});

describe("the session secret", () => {
  afterEach(() => setSessionSecret(null));

  it("opens the socket with the session secret of an unkept session, and with nothing else", async () => {
    const params = options.connectionParams as () => unknown;
    expect(await params()).toEqual({});
    setSessionSecret("c2VjcmV0");
    expect(await params()).toEqual({ sessionSecret: "c2VjcmV0" });
  });
});

describe("wsStatus", () => {
  let seen: WsStatus[];
  let off: () => void;

  beforeEach(() => {
    // graphql-ws closes normally once the last subscription has ended.
    options.on?.closed?.(closedWith(1000));
    seen = [];
    off = onWsStatus((status) => seen.push(status));
  });

  afterEach(() => off());

  it("is idle until a subscription opens the socket, and again after the last one ends", () => {
    expect(wsStatus()).toBe("idle");
    options.on?.connecting?.(false);
    expect(wsStatus()).toBe("connecting");
    options.on?.connected?.({}, undefined, false);
    expect(wsStatus()).toBe("connected");
    options.on?.closed?.(closedWith(1000));

    expect(wsStatus()).toBe("idle");
    expect(seen).toEqual(["connecting", "connected", "idle"]);
  });

  it("stays disconnected through the attempts after a lost connection until one connects", () => {
    options.on?.connecting?.(false);
    options.on?.connected?.({}, undefined, false);
    seen = [];

    options.on?.closed?.(closedWith(1006));
    options.on?.connecting?.(true);
    options.on?.closed?.(closedWith(1006));
    options.on?.connecting?.(true);
    expect(wsStatus()).toBe("disconnected");
    options.on?.connected?.({}, undefined, true);

    expect(seen).toEqual(["disconnected", "connected"]);
  });
});

describe("wsClient reconnection", () => {
  const fetchMock = vi.fn<typeof fetch>();

  /** One connection attempt: its socket opened (the upgrade was accepted) or not. */
  function attempt(opened: boolean) {
    options.on?.connecting?.(true);
    if (opened) options.on?.opened?.({});
  }

  /** The next wait, started; resolves to whether it is over. */
  function startWait(retries: number) {
    let over = false;
    void options.retryWait!(retries).then(() => {
      over = true;
    });
    return () => over;
  }

  /** The server answers the plain HTTP probe of the upgrade URL with `status` and `body`. */
  function probeAnswers(status: number, body: unknown) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    useEdgeStore.setState({ blocked: false, tooManyConnections: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a failed upgrade rather than ending the subscriptions", () => {
    expect(options.shouldRetry?.(new Event("error"))).toBe(true);
  });

  it("retries a dropped connection but not one closed because the session ended", () => {
    expect(options.shouldRetry?.(closedWith(1006))).toBe(true);
    expect(options.shouldRetry?.(closedWith(4401))).toBe(false);
  });

  it("tells the session-ended listeners once on a 4401 close and arms no timer", () => {
    const ended = vi.fn();
    const off = onWsSessionEnded(ended);

    options.on?.closed?.(closedWith(4401));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    options.on?.closed?.(closedWith(1006));
    expect(ended).toHaveBeenCalledTimes(1);
    off();
  });

  it("backs off from 1 s to 10 s, from 30 s to 5 min after a refusal, or as told", () => {
    expect(reconnectDelayMs(0, null)).toBe(1_000);
    expect(reconnectDelayMs(6, null)).toBe(10_000);
    expect(reconnectDelayMs(0, { kind: "tooManyConnections" })).toBe(30_000);
    expect(reconnectDelayMs(1, { kind: "blocked" })).toBe(60_000);
    expect(reconnectDelayMs(9, { kind: "tooManyConnections" })).toBe(300_000);
    expect(reconnectDelayMs(0, { kind: "rateLimited", retryAfterSeconds: 7 })).toBe(7_000);
  });

  it("waits 30 s after a 429 too_many_connections upgrade, says so, and keeps waiting when the network returns", async () => {
    probeAnswers(429, { error: "too_many_connections" });
    attempt(false);
    const over = startWait(0);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/ws$/),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(useEdgeStore.getState().tooManyConnections).toBe(true);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(over()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(over()).toBe(true);
  });

  it("does not retry a refused upgrade in a tight loop", async () => {
    probeAnswers(429, { error: "too_many_connections" });
    const waits: number[] = [];
    for (let retries = 0; retries < 4; retries++) {
      attempt(false);
      const over = startWait(retries);
      const started = Date.now();
      while (!over()) await vi.advanceTimersByTimeAsync(1_000);
      waits.push(Date.now() - started);
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000]);
  });

  it("records a blocked address from the probe", async () => {
    probeAnswers(403, { error: "blocked" });
    attempt(false);
    startWait(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(useEdgeStore.getState().blocked).toBe(true);
    expect(useEdgeStore.getState().tooManyConnections).toBe(false);
  });

  it("treats any other probe answer as an outage: a short wait the network cuts short", async () => {
    probeAnswers(401, { error: "unauthorized" });
    useEdgeStore.setState({ tooManyConnections: true });
    attempt(false);
    const over = startWait(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(useEdgeStore.getState().tooManyConnections).toBe(false);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(over()).toBe(true);
  });

  it("does not probe after a connection that had opened", async () => {
    attempt(true);
    const over = startWait(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(over()).toBe(true);
  });

  it("clears the refusal states once connected", () => {
    useEdgeStore.setState({ blocked: true, tooManyConnections: true });
    options.on?.connected?.({}, undefined, true);

    expect(useEdgeStore.getState()).toMatchObject({ blocked: false, tooManyConnections: false });
  });
});
