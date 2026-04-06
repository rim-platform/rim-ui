import { describe, it, expect, beforeEach } from "vitest";
import { useConnectionStore } from "./useConnectionStore";

describe("useConnectionStore", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      status: "connecting",
      lastDisconnectedAt: null,
    });
  });

  it("starts with connecting status", () => {
    expect(useConnectionStore.getState().status).toBe("connecting");
  });

  it("starts with null lastDisconnectedAt", () => {
    expect(useConnectionStore.getState().lastDisconnectedAt).toBeNull();
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
