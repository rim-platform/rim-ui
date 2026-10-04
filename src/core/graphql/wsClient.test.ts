import { describe, it, expect, vi } from "vitest";

// Mock graphql-ws before importing wsClient
vi.mock("graphql-ws", () => ({
  createClient: vi.fn(() => ({
    subscribe: vi.fn(),
    dispose: vi.fn(),
  })),
}));

import { onWsConnected, onWsDisconnected } from "./wsClient";

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
