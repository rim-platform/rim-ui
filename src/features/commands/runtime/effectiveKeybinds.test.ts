import { describe, expect, it } from "vitest";

import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
import { PROFILE_FORMAT, type KeybindProfile } from "../profiles/keybindProfile";
import type { ResolvedKeybind } from "../types";
import { resolveEffectiveKeybinds } from "./effectiveKeybinds";
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
