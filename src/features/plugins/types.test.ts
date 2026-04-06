import { describe, it, expect } from "vitest";
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

describe("Plugin types", () => {
  it("TrustLevel supports all expected values", () => {
    const levels: TrustLevel[] = ["official", "verified", "community", "unverified"];
    expect(levels).toHaveLength(4);
  });

  it("PluginCapability supports all expected values", () => {
    const caps: PluginCapability[] = [
      "filesystem",
      "network",
      "notifications",
      "clipboard",
      "shell",
      "system_info",
    ];
    expect(caps).toHaveLength(6);
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
      capabilities: ["network"],
    };
    expect(manifest.id).toBe("test");
    expect(manifest.capabilities).toContain("network");
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

  it("PluginInfo carries manifest and runtime state", () => {
    const info: PluginInfo = {
      manifest: {
        id: "test",
        name: "Test",
        version: "1.0.0",
        description: "Test",
        author: "Author",
        trust_level: "verified",
        capabilities: ["clipboard"],
      },
      enabled: true,
      approved_capabilities: ["clipboard"],
      health: "running",
    };
    expect(info.enabled).toBe(true);
    expect(info.health).toBe("running");
    expect(info.approved_capabilities).toContain("clipboard");
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
});
