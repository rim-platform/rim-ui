import { describe, it, expect } from "vitest";
import type { Macro, MacroStep, CreateMacroInput, UpdateMacroInput, ExecuteMacroInput } from "./useMacros";

describe("Macro types", () => {
  it("MacroStep has commandId and args", () => {
    const step: MacroStep = {
      commandId: "chat.send_message",
      args: { text: "Hello" },
    };
    expect(step.commandId).toBe("chat.send_message");
    expect(step.args).toEqual({ text: "Hello" });
  });

  it("Macro has all required fields", () => {
    const macro: Macro = {
      id: "macro-1",
      name: "Greeting",
      description: "Sends a greeting",
      steps: [
        { commandId: "chat.send_message", args: { text: "Hi!" } },
      ],
    };
    expect(macro.id).toBe("macro-1");
    expect(macro.name).toBe("Greeting");
    expect(macro.steps).toHaveLength(1);
  });

  it("CreateMacroInput includes serverId", () => {
    const input: CreateMacroInput = {
      serverId: "srv-1",
      name: "Test Macro",
      description: "A test macro",
      steps: [],
    };
    expect(input.serverId).toBe("srv-1");
  });

  it("UpdateMacroInput has macroId", () => {
    const input: UpdateMacroInput = {
      macroId: "macro-1",
      name: "Updated",
      description: "Updated desc",
      steps: [{ commandId: "cmd-1", args: {} }],
    };
    expect(input.macroId).toBe("macro-1");
  });

  it("ExecuteMacroInput has optional commandContext", () => {
    const input1: ExecuteMacroInput = {
      macroId: "macro-1",
    };
    expect(input1.commandContext).toBeUndefined();

    const input2: ExecuteMacroInput = {
      macroId: "macro-1",
      commandContext: { workspaceId: "ws-1", conversationId: "conv-1" },
    };
    expect(input2.commandContext?.workspaceId).toBe("ws-1");
  });
});
