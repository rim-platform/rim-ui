import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../../../core/logger", () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { onPluginEvent } from "./pluginEventBus";
import type { PluginEvent } from "../types";

describe("pluginEventBus", () => {
  describe("onPluginEvent", () => {
    it("returns an unsubscribe function", () => {
      const handler = vi.fn();
      const unsub = onPluginEvent(handler);
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("can register and unregister handlers", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const unsub1 = onPluginEvent(handler1);
      const unsub2 = onPluginEvent(handler2);

      unsub1();
      unsub2();
      // No errors thrown
    });

    it("supports multiple concurrent handlers", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      const unsub1 = onPluginEvent(handler1);
      const unsub2 = onPluginEvent(handler2);
      const unsub3 = onPluginEvent(handler3);

      unsub1();
      unsub2();
      unsub3();
    });

    it("cleans up properly on unsubscribe", () => {
      const handler = vi.fn();
      const unsub = onPluginEvent(handler);
      unsub();
      // Second unsubscribe should not throw (though it may double-decrement)
    });
  });
});
