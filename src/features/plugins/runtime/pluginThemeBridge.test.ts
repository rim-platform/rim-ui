import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getThemeVariables, createThemeChangeMessage, onThemeChange } from "./pluginThemeBridge";

describe("pluginThemeBridge", () => {
  beforeEach(() => {
    // Set up CSS custom properties on the document root
    const root = document.documentElement;
    root.style.setProperty("--color-rim-void", "#000000");
    root.style.setProperty("--color-rim-panel", "#111111");
    root.style.setProperty("--color-rim-panel-soft", "#222222");
    root.style.setProperty("--color-rim-line", "#333333");
    root.style.setProperty("--color-rim-accent", "#4488ff");
    root.style.setProperty("--color-rim-accent-strong", "#5599ff");
    root.style.setProperty("--color-rim-warm", "#ffaa00");
    root.style.setProperty("--color-rim-danger", "#ff4444");
    root.style.setProperty("--color-rim-text", "#ffffff");
    root.style.setProperty("--color-rim-text-muted", "#aaaaaa");
    root.style.setProperty("--color-rim-text-faint", "#666666");
  });

  describe("getThemeVariables", () => {
    it("returns all theme variables from computed style", () => {
      const vars = getThemeVariables();
      expect(vars).toHaveProperty("--color-rim-void");
      expect(vars).toHaveProperty("--color-rim-panel");
      expect(vars).toHaveProperty("--color-rim-accent");
      expect(vars).toHaveProperty("--color-rim-text");
      expect(vars).toHaveProperty("--color-rim-text-muted");
      expect(vars).toHaveProperty("--color-rim-text-faint");
      expect(vars).toHaveProperty("--color-rim-danger");
      expect(vars).toHaveProperty("--color-rim-warm");
      expect(vars).toHaveProperty("--color-rim-line");
      expect(vars).toHaveProperty("--color-rim-panel-soft");
      expect(vars).toHaveProperty("--color-rim-accent-strong");
    });

    it("returns 11 theme variables", () => {
      const vars = getThemeVariables();
      expect(Object.keys(vars)).toHaveLength(11);
    });

    it("trims whitespace from values", () => {
      document.documentElement.style.setProperty("--color-rim-void", "  #000  ");
      const vars = getThemeVariables();
      expect(vars["--color-rim-void"]).not.toMatch(/^\s/);
      expect(vars["--color-rim-void"]).not.toMatch(/\s$/);
    });
  });

  describe("createThemeChangeMessage", () => {
    it("returns a message with type 'theme.changed'", () => {
      const msg = createThemeChangeMessage();
      expect(msg.type).toBe("theme.changed");
    });

    it("includes variables in the message", () => {
      const msg = createThemeChangeMessage();
      expect(msg).toHaveProperty("variables");
      if (msg.type === "theme.changed") {
        expect(msg.variables).toHaveProperty("--color-rim-accent");
      }
    });
  });

  describe("onThemeChange", () => {
    it("returns an unsubscribe function", () => {
      const unsub = onThemeChange(vi.fn());
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("calls listener when document element attributes change", async () => {
      const listener = vi.fn();
      const unsub = onThemeChange(listener);

      // Trigger a mutation that the observer watches for
      document.documentElement.setAttribute("class", "dark-theme");

      // MutationObserver is async, wait for it
      await new Promise((r) => setTimeout(r, 50));

      expect(listener).toHaveBeenCalled();
      const call = listener.mock.calls[0][0];
      expect(call.type).toBe("theme.changed");

      unsub();
    });

    it("stops observing after all listeners unsubscribe", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = onThemeChange(listener1);
      const unsub2 = onThemeChange(listener2);

      unsub1();
      unsub2();

      // After unsubscribing all, mutations should not trigger listeners
      document.documentElement.setAttribute("class", "new-class");
      // No errors should occur
    });

    it("notifies multiple listeners", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = onThemeChange(listener1);
      const unsub2 = onThemeChange(listener2);

      document.documentElement.setAttribute("style", "--color-rim-void: #111");

      await new Promise((r) => setTimeout(r, 50));

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();

      unsub1();
      unsub2();
    });
  });
});
