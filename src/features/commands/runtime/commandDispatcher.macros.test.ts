import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runMacro: vi.fn() }));

vi.mock("../../macros/runtime/runMacro", () => ({ runMacro: mocks.runMacro }));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { CommandDefinition } from "../types";
import { dispatchCommand, isLocalActionResult } from "./commandDispatcher";

const MACRO: CommandDefinition = {
  id: "user.standup",
  title: "Standup",
  description: "",
  category: "Macro",
  sourceKind: "USER",
  executionTarget: "DESKTOP_LOCAL",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
};

const SERVER_MACRO: CommandDefinition = { ...MACRO, executionTarget: "BACKEND" };

function keepsMacros() {
  queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
}

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("dispatching a macro", () => {
  it("runs the person's macro in this app, in the context given", async () => {
    keepsMacros();
    const executeBackend = vi.fn();
    const commandContext = { workspaceId: "ws-1", conversationId: "c-1" };

    const result = await dispatchCommand(MACRO, executeBackend, { commandContext });

    expect(mocks.runMacro).toHaveBeenCalledWith("user.standup", commandContext);
    expect(executeBackend).not.toHaveBeenCalled();
    expect(isLocalActionResult(result)).toBe(true);
  });

  it("refuses a plugin that asks to run a macro", async () => {
    keepsMacros();
    const executeBackend = vi.fn();

    const result = await dispatchCommand(MACRO, executeBackend, { callerPluginId: "dev.rim.poll" });

    expect(result).toMatchObject({ status: "ERROR", message: "A plugin can't run your macros" });
    expect(mocks.runMacro).not.toHaveBeenCalled();
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it("sends a user command to the server when the home server keeps no macros", async () => {
    const executeBackend = vi.fn().mockResolvedValue({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });

    await dispatchCommand(SERVER_MACRO, executeBackend, {
      commandContext: { workspaceId: "ws-1" },
    });

    expect(mocks.runMacro).not.toHaveBeenCalled();
    expect(executeBackend).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: "user.standup" }),
    );
  });
});
