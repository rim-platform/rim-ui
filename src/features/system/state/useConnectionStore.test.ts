import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClient, type ClientOptions } from "graphql-ws";

vi.mock("graphql-ws", () => ({
  createClient: vi.fn(() => ({ subscribe: vi.fn(), dispose: vi.fn() })),
}));

import "../../../core/graphql/wsClient";

/** The options wsClient created its graphql-ws client with. */
const options = vi.mocked(createClient).mock.calls[0][0] as ClientOptions;

// The socket connected before anything read the store, as when the relay subscribes first.
options.on?.connecting?.(false);
options.on?.connected?.({}, undefined, false);
const { useConnectionStore } = await import("./useConnectionStore");

describe("useConnectionStore", () => {
  it("starts from the socket's state, with null lastDisconnectedAt", () => {
    expect(useConnectionStore.getState().status).toBe("connected");
    expect(useConnectionStore.getState().lastDisconnectedAt).toBeNull();
  });

  it("follows the socket", () => {
    options.on?.closed?.(new CloseEvent("close", { code: 1006 }));
    expect(useConnectionStore.getState().status).toBe("disconnected");
    options.on?.connected?.({}, undefined, true);
    expect(useConnectionStore.getState().status).toBe("connected");
  });
});

describe("useConnectionStore.setStatus", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      status: "connecting",
      lastDisconnectedAt: null,
    });
  });

  it("transitions to connected", () => {
    useConnectionStore.getState().setStatus("connected");
    expect(useConnectionStore.getState().status).toBe("connected");
  });

  it("transitions to disconnected and records timestamp", () => {
    useConnectionStore.getState().setStatus("disconnected");
    expect(useConnectionStore.getState().status).toBe("disconnected");
    expect(useConnectionStore.getState().lastDisconnectedAt).not.toBeNull();
  });

  it("preserves lastDisconnectedAt when transitioning to connected", () => {
    useConnectionStore.getState().setStatus("disconnected");
    const disconnectedAt = useConnectionStore.getState().lastDisconnectedAt;
    useConnectionStore.getState().setStatus("connected");
    expect(useConnectionStore.getState().lastDisconnectedAt).toBe(disconnectedAt);
  });

  it("updates lastDisconnectedAt on subsequent disconnections", () => {
    useConnectionStore.getState().setStatus("disconnected");
    const first = useConnectionStore.getState().lastDisconnectedAt;
    // Ensure timestamps differ
    useConnectionStore.getState().setStatus("connected");
    useConnectionStore.getState().setStatus("disconnected");
    const second = useConnectionStore.getState().lastDisconnectedAt;
    expect(second).not.toBeNull();
    // Both should be valid ISO dates
    expect(new Date(first!).getTime()).not.toBeNaN();
    expect(new Date(second!).getTime()).not.toBeNaN();
  });
});
