import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { CommandDefinition } from "../../commands/types";

const lists = vi.hoisted(() => ({
  bySurface: {} as Record<string, CommandDefinition[] | undefined>,
}));

vi.mock("../../commands/api/useCommands", () => ({
  useCommands: vi.fn((surface: string) => ({
    data: lists.bySurface[surface],
    isPending: lists.bySurface[surface] === undefined,
  })),
}));

vi.mock("../../plugins/api/usePluginCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/api/usePluginCommands")>()),
  usePluginCommands: () => [],
}));

vi.mock("../../agent/agentAvailability", () => ({
  commandOfferedHere: (id: string) => id !== "workspace.open_agent",
}));

import { actionTitle, useResolvedActions } from "./quickActions";

function definition(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: false,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

const SCROLL_TO_TOP = definition("chat.scroll_to_top", { title: "Scroll to Top" });
const SET_SLOW_MODE = definition("chat.set_slow_mode", {
  title: "Set Slow Mode",
  executionTarget: "BACKEND",
  arguments: [{ name: "seconds", argumentType: "INTEGER" as never, required: true }],
});

function resolve(commandIds: string[], presetArgs?: Record<string, unknown>) {
  const { result } = renderHook(() =>
    useResolvedActions(commandIds.map((commandId) => ({ commandId, presetArgs }))),
  );
  return result.current;
}

describe("useResolvedActions", () => {
  beforeEach(() => {
    lists.bySurface = { KEYBIND_PICKER: [SCROLL_TO_TOP, SET_SLOW_MODE], PALETTE: [] };
  });

  it("runs a command the picker offers though the palette does not list it", () => {
    const [resolved] = resolve(["chat.scroll_to_top"]);

    expect(resolved).toMatchObject({ command: SCROLL_TO_TOP, reason: null });
    expect(actionTitle(resolved)).toBe("Scroll to Top");
  });

  it("runs this app's own command", () => {
    expect(resolve(["workspace.open_home"])[0].command?.title).toBe("Open Home");
  });

  it("says a command needs arguments nothing supplies, under its title", () => {
    const [resolved] = resolve(["chat.set_slow_mode"]);

    expect(resolved).toMatchObject({
      command: null,
      reason: "Needs arguments this can't supply yet",
    });
    expect(actionTitle(resolved)).toBe("Set Slow Mode");
  });

  it("runs a command whose saved arguments supply what it needs", () => {
    expect(resolve(["chat.set_slow_mode"], { seconds: 30 })[0].command).toBe(SET_SLOW_MODE);
  });

  it("keeps its reasons in order: Edit Home, desktop only, plugin, loading", () => {
    lists.bySurface = {};
    const reasons = resolve([
      "workspace.edit_home",
      "workspace.open_agent",
      "plugin.chat.rim.poll.create",
      "chat.scroll_to_top",
    ]).map((entry) => entry.reason);

    expect(reasons).toEqual([
      "Editing Home can't be a quick action",
      "This command needs the desktop app",
      "Its plugin isn't installed on this device",
      "Loading commands…",
    ]);
  });

  it("says a command it does not know isn't available", () => {
    expect(resolve(["chat.gone"])[0].reason).toBe("This command isn't available here");
  });
});
