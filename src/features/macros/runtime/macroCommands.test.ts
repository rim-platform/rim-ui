import { describe, expect, it } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../../commands/types";
import type { AccountMacro } from "../api/useAccountMacros";
import {
  AGENT_OPTION_BLOCKER,
  agentOptionBlocker,
  isMacroId,
  macroDefinition,
  macroKeyFromTitle,
  macroRegistry,
  stepTitle,
  withMacroCommands,
} from "./macroCommands";

function command(overrides: Partial<CommandDefinition> & { id: string }): CommandDefinition {
  return {
    title: overrides.id,
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
    sensitivity: CommandSensitivity.SAFE,
    ...overrides,
  };
}

function macro(overrides: Partial<AccountMacro> & { id: string }): AccountMacro {
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

const step = (commandId: string, args: Record<string, unknown> = {}, ask: string[] = []) => ({
  commandId,
  args,
  ask,
});

const POST = command({
  id: "chat.post_message",
  title: "Post Message",
  requiredContext: ["conversation"],
  sensitivity: CommandSensitivity.MUTATING,
});
const ARCHIVE = command({
  id: "chat.archive_channel",
  title: "Archive Channel",
  dangerous: true,
  keybindCapable: false,
  requiredCapabilities: ["channel.manage"],
  sensitivity: CommandSensitivity.RESTRICTED,
});

describe("isMacroId", () => {
  it("names the person's macros by their user. prefix", () => {
    expect(isMacroId("user.standup")).toBe(true);
    expect(isMacroId("chat.post_message")).toBe(false);
    expect(isMacroId("plugin.dev.rim.poll.open")).toBe(false);
  });
});

describe("macroDefinition", () => {
  it("is a Macro of the person's own that adds up its steps", () => {
    const saved = macro({
      id: "user.wrap-up",
      title: "Wrap up",
      description: "End the day",
      steps: [step("chat.post_message", { text: "bye" }), step("chat.archive_channel")],
    });
    const definition = macroDefinition(saved, macroRegistry([POST, ARCHIVE], [saved]));

    expect(definition).toMatchObject({
      id: "user.wrap-up",
      title: "Wrap up",
      description: "End the day",
      category: "Macro",
      sourceKind: "USER",
      executionTarget: "DESKTOP_LOCAL",
      visibleInPalette: true,
      keybindCapable: false,
      dangerous: true,
      sensitivity: CommandSensitivity.RESTRICTED,
    });
    expect(definition.requiredContext).toEqual(["conversation"]);
    expect(definition.requiredCapabilities).toEqual(["channel.manage"]);
    expect(definition.arguments).toBeUndefined();
  });

  it("counts a plugin step as keybind-capable and safe, and adds up a nested macro's steps", () => {
    const inner = macro({ id: "user.inner", steps: [step("chat.post_message")] });
    const outer = macro({
      id: "user.outer",
      steps: [step("plugin.dev.rim.poll.open"), step("user.inner")],
    });
    const definition = macroDefinition(outer, macroRegistry([POST], [inner, outer]));

    expect(definition.keybindCapable).toBe(true);
    expect(definition.dangerous).toBe(false);
    expect(definition.sensitivity).toBe(CommandSensitivity.MUTATING);
  });

  it("stops at a macro that names itself", () => {
    const loop = macro({ id: "user.loop", steps: [step("user.loop"), step("chat.post_message")] });
    const definition = macroDefinition(loop, macroRegistry([POST], [loop]));

    expect(definition.sensitivity).toBe(CommandSensitivity.MUTATING);
  });
});

describe("stepTitle", () => {
  it("names a step by its command's title, its macro's title, or its id", () => {
    const inner = macro({ id: "user.inner", title: "Inner" });
    const registry = macroRegistry([POST], [inner]);

    expect(stepTitle("chat.post_message", registry)).toBe("Post Message");
    expect(stepTitle("user.inner", registry)).toBe("Inner");
    expect(stepTitle("chat.unknown", registry)).toBe("chat.unknown");
  });
});

describe("withMacroCommands", () => {
  const macroCommand = command({ id: "user.standup", category: "Macro", sourceKind: "USER" });

  it("replaces the server's macros with the person's", () => {
    const server = [POST, command({ id: "user.old", sourceKind: "USER" })];

    expect(withMacroCommands(server, [macroCommand])?.map((c) => c.id)).toEqual([
      "chat.post_message",
      "user.standup",
    ]);
  });

  it("keeps the server's list when the home server keeps no macros, and waits for it", () => {
    const server = [POST, command({ id: "user.old", sourceKind: "USER" })];

    expect(withMacroCommands(server, null)).toEqual(server);
    expect(withMacroCommands(undefined, [macroCommand])).toBeUndefined();
  });
});

describe("macroKeyFromTitle", () => {
  it("makes a lowercase key of the title's words", () => {
    expect(macroKeyFromTitle("Morning Stand-up!", [])).toBe("morning-stand-up");
    expect(macroKeyFromTitle("Résumé  2.0", [])).toBe("resume-2-0");
  });

  it("falls back to macro and keeps keys unique", () => {
    expect(macroKeyFromTitle("???", [])).toBe("macro");
    expect(macroKeyFromTitle("Standup", ["user.standup"])).toBe("standup-2");
    expect(macroKeyFromTitle("Standup", ["user.standup", "user.standup-2"])).toBe("standup-3");
  });

  it("keeps the key to 64 characters", () => {
    const key = macroKeyFromTitle("word ".repeat(40), []);
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key.endsWith("-")).toBe(false);
  });
});

describe("agentOptionBlocker", () => {
  const agentPost = { ...POST, aiCallable: true };
  const lookup = (id: string) =>
    ({
      "chat.post_message": agentPost,
      "chat.search_messages": { ...command({ id: "chat.search_messages" }), aiCallable: false },
      "workspace.open_settings": {
        ...command({ id: "workspace.open_settings", executionTarget: "DESKTOP_LOCAL" }),
        aiCallable: true,
      },
    })[id];

  it("allows only commands the agent may run, on the server, with every argument fixed", () => {
    expect(agentOptionBlocker([step("chat.post_message", { text: "hi" })], lookup)).toBeNull();
    for (const steps of [
      [step("chat.post_message", {}, ["text"])],
      [step("chat.search_messages")],
      [step("workspace.open_settings")],
      [step("plugin.dev.rim.poll.open")],
      [step("user.other")],
      [],
    ]) {
      expect(agentOptionBlocker(steps, lookup)).toBe(AGENT_OPTION_BLOCKER);
    }
  });
});
