import { describe, it, expect, vi, afterEach } from "vitest";
import type {
  TrustLevel,
  PluginCapability,
  PluginHealth,
  PluginInfo,
  PluginManifest,
  PluginEvent,
  PluginEventKind,
  PluginCommandResult,
  PluginCommandDef,
  PluginPanelDef,
  PluginPanelSlot,
  PluginContextType,
} from "./types";
import { isPluginCapability, parsePluginCapabilities, PLUGIN_CAPABILITIES } from "./types";

describe("Plugin types", () => {
  it("TrustLevel supports all expected values", () => {
    const levels: TrustLevel[] = ["official", "verified", "community", "unverified"];
    expect(levels).toHaveLength(4);
  });

  it("PluginCapability supports all expected values", () => {
    const caps: PluginCapability[] = [
      "chat.read",
      "chat.write",
      "events.read",
      "local.process",
      "network",
      "fs.read",
      "fs.write",
      "ui.notify",
      "ui.panel",
    ];
    expect(caps).toHaveLength(9);
  });

  it("PluginHealth supports all expected values", () => {
    const healths: PluginHealth[] = ["running", "stopped", "crashed", "timeout"];
    expect(healths).toHaveLength(4);
  });

  it("PluginManifest has required fields", () => {
    const manifest: PluginManifest = {
      id: "test",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test Author",
      trust_level: "community",
      capabilities: ["chat.read"],
    };
    expect(manifest.id).toBe("test");
    expect(manifest.capabilities).toContain("chat.read");
  });

  it("PluginManifest supports optional commands and panels", () => {
    const manifest: PluginManifest = {
      id: "test",
      name: "Test",
      version: "1.0.0",
      description: "Test",
      author: "Author",
      trust_level: "official",
      capabilities: [],
      commands: [
        {
          id: "cmd1",
          title: "Command 1",
          description: "A command",
          context_menu_action: true,
          context_types: ["message"],
          suggested_keybind: "Ctrl+Shift+T",
        },
      ],
      panels: [
        {
          id: "panel1",
          title: "Panel 1",
          slot: "tool_panel",
          icon: "wrench",
        },
      ],
    };
    expect(manifest.commands).toHaveLength(1);
    expect(manifest.panels).toHaveLength(1);
  });

  it("PluginInfo carries flat Rust shape fields", () => {
    const info: PluginInfo = {
      plugin_id: "dev.example.test",
      manifest_id: "dev.example.test",
      display_name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Author",
      enabled: true,
      capabilities: ["chat.read"],
      approved_capabilities: ["chat.read"],
      approved_ai_commands: ["search"],
      ai_callable_commands: ["search"],
      ai_consent_required: false,
      health: "running",
    };
    expect(info.enabled).toBe(true);
    expect(info.health).toBe("running");
    expect(info.approved_capabilities).toContain("chat.read");
    expect(info.ai_callable_commands).toContain("search");
    expect(info.manifest_id).toBe(info.plugin_id);
  });

  it("PluginEvent has required fields", () => {
    const event: PluginEvent = {
      plugin_id: "test",
      kind: "plugin_started",
      timestamp: "2025-01-01T00:00:00Z",
    };
    expect(event.plugin_id).toBe("test");
    expect(event.kind).toBe("plugin_started");
  });

  it("PluginEvent supports optional message", () => {
    const event: PluginEvent = {
      plugin_id: "test",
      kind: "plugin_crashed",
      message: "Segfault",
      timestamp: "2025-01-01T00:00:00Z",
    };
    expect(event.message).toBe("Segfault");
  });

  it("PluginEventKind supports all values", () => {
    const kinds: PluginEventKind[] = [
      "plugin_started",
      "plugin_stopped",
      "plugin_crashed",
      "plugin_timeout",
      "plugin_log",
    ];
    expect(kinds).toHaveLength(5);
  });

  it("PluginCommandResult has status and payload", () => {
    const ok: PluginCommandResult = { status: "ok", payload: { result: 42 } };
    const err: PluginCommandResult = { status: "error", payload: "Something went wrong" };
    expect(ok.status).toBe("ok");
    expect(err.status).toBe("error");
  });

  it("PluginPanelSlot supports expected values", () => {
    const slots: PluginPanelSlot[] = ["tool_panel", "main_area"];
    expect(slots).toHaveLength(2);
  });

  it("PluginContextType supports expected values", () => {
    const types: PluginContextType[] = ["message", "conversation"];
    expect(types).toHaveLength(2);
  });

  describe("isPluginCapability", () => {
    it("returns true for all known capability strings", () => {
      for (const cap of PLUGIN_CAPABILITIES) {
        expect(isPluginCapability(cap)).toBe(true);
      }
    });

    it("returns false for unknown strings", () => {
      expect(isPluginCapability("read_contacts")).toBe(false);
      expect(isPluginCapability("filesystem")).toBe(false);
      expect(isPluginCapability("NETWORK")).toBe(false);
      expect(isPluginCapability("")).toBe(false);
    });

    it("returns false for non-string values", () => {
      expect(isPluginCapability(null)).toBe(false);
      expect(isPluginCapability(undefined)).toBe(false);
      expect(isPluginCapability(42)).toBe(false);
      expect(isPluginCapability({})).toBe(false);
      expect(isPluginCapability([])).toBe(false);
    });
  });

  describe("parsePluginCapabilities", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns all items when every element is a valid capability", () => {
      const result = parsePluginCapabilities(["chat.read", "network"]);
      expect(result).toEqual(["chat.read", "network"]);
    });

    it("drops bogus capabilities and keeps valid ones", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const result = parsePluginCapabilities(["network", "read_contacts", "fs.read"]);
      expect(result).toEqual(["network", "fs.read"]);
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("emits a console.warn per dropped value", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      parsePluginCapabilities(["chat.write", "BOGUS"]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[PluginCapability]"), "BOGUS");
    });

    it("returns [] for null input without throwing", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(parsePluginCapabilities(null)).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("returns [] for undefined input without throwing", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(parsePluginCapabilities(undefined)).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("returns [] for non-array input without throwing", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(parsePluginCapabilities("filesystem")).toEqual([]);
      expect(parsePluginCapabilities(42)).toEqual([]);
      expect(parsePluginCapabilities({})).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(3);
    });

    it("returns [] for an empty array", () => {
      expect(parsePluginCapabilities([])).toEqual([]);
    });

    it("does not emit a warning when all capabilities are valid", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      parsePluginCapabilities(["ui.notify", "fs.read"]);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
