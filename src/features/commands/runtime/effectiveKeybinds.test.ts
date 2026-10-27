import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(() => ({ data: undefined })),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
import { PROFILE_FORMAT, type KeybindProfile } from "../profiles/keybindProfile";
import type { ResolvedKeybind } from "../types";
import {
  listedKeybinds,
  resolveEffectiveKeybinds,
  slotHolders,
  useEffectiveKeybinds,
} from "./effectiveKeybinds";
import { matchKeybind } from "./keybindEngine";

function keybind(overrides: Partial<ResolvedKeybind>): ResolvedKeybind {
  return {
    id: overrides.id ?? `kb-${overrides.keystroke}`,
    keystroke: "Ctrl+K",
    commandId: "workspace.open_command_palette",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
    ...overrides,
  };
}

function profile(bindings: KeybindProfile["bindings"]): KeybindProfile {
  return {
    format: PROFILE_FORMAT,
    version: 1,
    name: "Test",
    description: "",
    vimMode: false,
    bindings,
  };
}

function commandFor(keybinds: ResolvedKeybind[], keystroke: string): string | null {
  return matchKeybind(keystroke, "GLOBAL", keybinds)?.commandId ?? null;
}

describe("resolveEffectiveKeybinds", () => {
  it("works with no server at all: the profile's bindings are in force", () => {
    const keybinds = resolveEffectiveKeybinds([], undefined, BUILT_IN_PROFILES.minimal);
    expect(commandFor(keybinds, "Ctrl+K")).toBe("workspace.open_command_palette");
    expect(commandFor(keybinds, "Escape")).toBe("workspace.close_panel");
    expect(commandFor(keybinds, "?")).toBe("workspace.show_shortcuts");
  });

  it("ranks device bindings, then the user's, then the profile, then server defaults", () => {
    const server = [
      keybind({ keystroke: "Ctrl+J", commandId: "server.default", source: "DEFAULT" }),
      keybind({ keystroke: "Ctrl+U", commandId: "server.user", source: "USER" }),
      keybind({ keystroke: "Ctrl+P", commandId: "server.default.p", source: "DEFAULT" }),
    ];
    const device = [keybind({ id: "device:1", keystroke: "Ctrl+U", commandId: "plugin.x.y" })];
    const keybinds = resolveEffectiveKeybinds(
      device,
      server,
      profile([
        { keystroke: "Ctrl+J", commandId: "profile.j", context: "GLOBAL" },
        { keystroke: "Ctrl+U", commandId: "profile.u", context: "GLOBAL" },
      ]),
    );
    expect(commandFor(keybinds, "Ctrl+U")).toBe("plugin.x.y");
    expect(commandFor(keybinds, "Ctrl+J")).toBe("profile.j");
    expect(commandFor(keybinds, "Ctrl+P")).toBe("server.default.p");
    // One binding per keystroke and context.
    expect(keybinds.filter((kb) => kb.keystroke === "Ctrl+U")).toHaveLength(1);
  });

  it("lets a profile free a keystroke the server binds by default", () => {
    const server = [keybind({ keystroke: "Ctrl+R", commandId: "workspace.cycle_recent_activity" })];
    const keybinds = resolveEffectiveKeybinds([], server, BUILT_IN_PROFILES["mouse-friendly"]);
    expect(commandFor(keybinds, "Ctrl+R")).toBeNull();
    expect(keybinds.some((kb) => kb.commandId === "")).toBe(false);
  });

  it("keeps a binding the user turned off turned off, rather than falling back to the profile", () => {
    const server = [
      keybind({ keystroke: "Ctrl+K", source: "USER", isEnabled: false, id: "user-off" }),
    ];
    const keybinds = resolveEffectiveKeybinds([], server, BUILT_IN_PROFILES.minimal);
    expect(commandFor(keybinds, "Ctrl+K")).toBeNull();
  });

  it("treats modifier order and implied Shift as the same keystroke", () => {
    const server = [
      keybind({ keystroke: "Alt+Shift+ArrowDown", commandId: "server.default", source: "DEFAULT" }),
    ];
    const keybinds = resolveEffectiveKeybinds([], server, BUILT_IN_PROFILES.minimal);
    expect(keybinds.filter((kb) => kb.commandId === "server.default")).toEqual([]);
    expect(commandFor(keybinds, "Shift+Alt+ArrowDown")).toBe("workspace.next_unread_channel");
  });
});

describe("listedKeybinds", () => {
  /** The listed rows as `source keystroke command`, for comparing. */
  function rows(keybinds: ResolvedKeybind[]): string[] {
    return keybinds.map((kb) => `${kb.source} ${kb.keystroke} ${kb.commandId}`);
  }

  it("lists the profile's defaults with the server's, once each", () => {
    const server = [
      keybind({ keystroke: "Ctrl+K", commandId: "workspace.open_command_palette" }),
      keybind({ keystroke: "Ctrl+Alt+Q", commandId: "server.only" }),
      keybind({ id: "user-u", keystroke: "Ctrl+U", commandId: "server.user", source: "USER" }),
    ];
    const device = [keybind({ id: "device:1", keystroke: "Ctrl+U", commandId: "plugin.x.y" })];
    const listed = rows(listedKeybinds(device, server, BUILT_IN_PROFILES.minimal));

    expect(listed.filter((row) => row.includes(" Ctrl+K "))).toEqual([
      "DEFAULT Ctrl+K workspace.open_command_palette",
    ]);
    expect(listed).toContain("DEFAULT Ctrl+D workspace.cycle_display_density");
    expect(listed).toContain("DEFAULT Ctrl+/ workspace.show_shortcuts");
    expect(listed).toContain("DEFAULT Ctrl+Alt+Q server.only");
    // The device's and the user's own bindings are each listed, even on the same keys.
    expect(listed.slice(0, 2)).toEqual(["DEFAULT Ctrl+U plugin.x.y", "USER Ctrl+U server.user"]);
  });

  it("hides a default whose keys a binding of the user's holds", () => {
    const server = [
      keybind({ id: "user-k", keystroke: "Ctrl+K", commandId: "server.user", source: "USER" }),
    ];
    const listed = rows(listedKeybinds([], server, BUILT_IN_PROFILES.minimal));

    expect(listed.filter((row) => row.includes(" Ctrl+K "))).toEqual(["USER Ctrl+K server.user"]);
  });

  it("lists nothing for a keystroke the profile frees", () => {
    const server = [keybind({ keystroke: "Ctrl+R", commandId: "workspace.cycle_recent_activity" })];
    const listed = listedKeybinds([], server, BUILT_IN_PROFILES["mouse-friendly"]);

    expect(listed.filter((kb) => kb.keystroke === "Ctrl+R")).toEqual([]);
    expect(listed.some((kb) => kb.commandId === "")).toBe(false);
  });

  it("keeps a turned-off binding of the user's", () => {
    const server = [
      keybind({ id: "user-off", keystroke: "Ctrl+K", source: "USER", isEnabled: false }),
    ];
    const listed = listedKeybinds([], server, BUILT_IN_PROFILES.minimal);

    expect(listed.filter((kb) => kb.keystroke === "Ctrl+K")).toEqual([server[0]]);
  });
});

describe("slotHolders", () => {
  it("finds the bindings on the same keys and context, however the keys are written", () => {
    const keybinds = [
      keybind({ id: "a", keystroke: "Shift+Alt+ArrowUp" }),
      keybind({ id: "b", keystroke: "Shift+Alt+ArrowUp", context: "COMPOSER" }),
      keybind({ id: "c", keystroke: "Ctrl+J" }),
    ];

    expect(slotHolders(keybinds, "GLOBAL", "Alt+Shift+ArrowUp").map((kb) => kb.id)).toEqual(["a"]);
    expect(slotHolders(keybinds, "GLOBAL", "Shift+Alt+ArrowUp", "a")).toEqual([]);
  });
});

describe("useEffectiveKeybinds", () => {
  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("leaves the agent's keybind out on the web", () => {
    const { result } = renderHook(() => useEffectiveKeybinds());
    expect(result.current.some((kb) => kb.commandId === "workspace.open_agent")).toBe(false);
    expect(commandFor(result.current, "Ctrl+K")).toBe("workspace.open_command_palette");

    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { result: desktop } = renderHook(() => useEffectiveKeybinds());
    expect(commandFor(desktop.current, "Ctrl+Shift+A")).toBe("workspace.open_agent");
  });
});
