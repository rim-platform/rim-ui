import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../../shared/toast", () => ({ toast: mocks.toast }));

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { graphqlError } from "../../conversations/__fixtures__/conversations";
import type { AccountMacro, MacroStepCommand } from "../api/useAccountMacros";
import type { MacroToMove } from "../api/useMacros";
import { moveWorkspaceMacros, type MacroMoveDeps } from "./macroMove";
import { movedWorkspaces, readMacroMoves } from "./macroMoves";

const POST: MacroStepCommand = {
  id: "chat.post_message",
  title: "Post Message",
  description: "",
  category: "Chat",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
  sensitivity: CommandSensitivity.MUTATING,
  aiCallable: true,
};

function workspaceMacro(overrides: Partial<MacroToMove> & { id: string }): MacroToMove {
  return {
    name: overrides.id,
    description: null,
    aiCallable: false,
    nlDescription: "",
    intentSamples: [],
    steps: [{ commandId: "chat.post_message", args: { text: "hi" } }],
    ...overrides,
  };
}

function accountMacro(overrides: Partial<AccountMacro> & { id: string }): AccountMacro {
  return {
    title: overrides.id,
    description: "",
    isEnabled: true,
    aiCallable: false,
    nlDescription: "",
    intentSamples: [],
    steps: [],
    ...overrides,
  };
}

function deps(
  existing: AccountMacro[],
  byWorkspace: Record<string, MacroToMove[]>,
  overrides: Partial<MacroMoveDeps> = {},
) {
  return {
    accountMacros: vi.fn(async () => existing),
    stepCommands: vi.fn(async () => [
      POST,
      { ...POST, id: "chat.search_messages", aiCallable: false },
    ]),
    workspaceMacros: vi.fn(async (id: string) => byWorkspace[id] ?? []),
    create: vi.fn(async () => {}),
    deleteWorkspaceMacro: vi.fn(async () => {}),
    ...overrides,
  } satisfies MacroMoveDeps;
}

const HOME = { id: "ws-home", name: "Home team" };
const AWAY = { id: "ws-away", name: "Away team" };

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("moveWorkspaceMacros", () => {
  it("makes each workspace macro a macro, deletes it where it was and records where it went", async () => {
    const d = deps([], {
      [HOME.id]: [workspaceMacro({ id: "m-1", name: "Say hi", description: "Greets" })],
      [AWAY.id]: [workspaceMacro({ id: "m-2", name: "Wave", steps: [] })],
    });

    const summary = await moveWorkspaceMacros("u-1", [HOME, AWAY], d);

    expect(summary).toEqual({ moved: 2, refused: 0, left: 0 });
    expect(d.create).toHaveBeenCalledWith({
      commandId: "user.say-hi",
      title: "Say hi",
      description: "Greets",
      steps: [{ commandId: "chat.post_message", args: { text: "hi" } }],
      aiCallable: false,
      nlDescription: "",
      intentSamples: [],
    });
    expect(d.deleteWorkspaceMacro).toHaveBeenCalledWith("m-1", HOME.id);
    expect(d.deleteWorkspaceMacro).toHaveBeenCalledWith("m-2", AWAY.id);
    expect(readMacroMoves("u-1")).toEqual({ "m-1": "user.say-hi", "m-2": "user.wave" });
    expect(movedWorkspaces("u-1")).toEqual(new Set([HOME.id, AWAY.id]));
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "2 workspace macros moved into your macros",
      expect.anything(),
    );
  });

  it("only deletes one that a macro with its title and steps already is, and renames a clash", async () => {
    const existing = [
      accountMacro({
        id: "user.say-hi",
        title: "Say hi",
        steps: [{ commandId: "chat.post_message", args: { text: "hi" }, ask: [] }],
      }),
      accountMacro({ id: "user.wave", title: "Wave" }),
    ];
    const d = deps(existing, {
      [HOME.id]: [
        workspaceMacro({ id: "m-1", name: "Say hi" }),
        workspaceMacro({ id: "m-2", name: "Wave" }),
      ],
    });

    await moveWorkspaceMacros("u-1", [HOME], d);

    expect(d.create).toHaveBeenCalledTimes(1);
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: "user.wave-2", title: "Wave (2)" }),
    );
    expect(d.deleteWorkspaceMacro).toHaveBeenCalledTimes(2);
    expect(readMacroMoves("u-1")).toEqual({ "m-1": "user.say-hi", "m-2": "user.wave-2" });
  });

  it("keeps the agent option only when the agent may run every step", async () => {
    const d = deps([], {
      [HOME.id]: [
        workspaceMacro({ id: "m-1", name: "Agent post", aiCallable: true }),
        workspaceMacro({
          id: "m-2",
          name: "Agent search",
          aiCallable: true,
          steps: [{ commandId: "chat.search_messages", args: { query: "x" } }],
        }),
      ],
    });

    await moveWorkspaceMacros("u-1", [HOME], d);

    expect(d.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ aiCallable: true }));
    expect(d.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ aiCallable: false }));
  });

  it("leaves the rest in their workspace at 100 macros and says so", async () => {
    const existing = Array.from({ length: 100 }, (_, i) => accountMacro({ id: `user.m${i}` }));
    const d = deps(existing, { [HOME.id]: [workspaceMacro({ id: "m-1", name: "One more" })] });

    const summary = await moveWorkspaceMacros("u-1", [HOME], d);

    expect(summary.left).toBe(1);
    expect(d.create).not.toHaveBeenCalled();
    expect(d.deleteWorkspaceMacro).not.toHaveBeenCalled();
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      "1 macro stayed in Home team: you can keep 100 macros",
    );
    expect(movedWorkspaces("u-1")).toEqual(new Set([HOME.id]));
  });

  it("keeps a refused macro where it was, and reads a workspace again after a failure", async () => {
    const d = deps(
      [],
      {
        [HOME.id]: [workspaceMacro({ id: "m-1", name: "Refused" })],
        [AWAY.id]: [workspaceMacro({ id: "m-2", name: "Unreached" })],
      },
      {
        create: vi.fn(async (input: { title: string }) => {
          if (input.title === "Refused") throw graphqlError("VALIDATION", "unknown command step");
          throw new Error("Failed to fetch");
        }),
      },
    );

    const summary = await moveWorkspaceMacros("u-1", [HOME, AWAY], d);

    expect(summary).toEqual({ moved: 0, refused: 1, left: 0 });
    expect(d.deleteWorkspaceMacro).not.toHaveBeenCalled();
    expect(movedWorkspaces("u-1")).toEqual(new Set([HOME.id]));
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "1 workspace macro could not be moved and stays where it was",
    );
  });

  it("reads no workspace it has already moved", async () => {
    const d = deps([], { [HOME.id]: [workspaceMacro({ id: "m-1", name: "Once" })] });

    await moveWorkspaceMacros("u-1", [HOME], d);
    await moveWorkspaceMacros("u-1", [HOME], d);

    expect(d.workspaceMacros).toHaveBeenCalledTimes(1);
    expect(d.create).toHaveBeenCalledTimes(1);
  });
});
