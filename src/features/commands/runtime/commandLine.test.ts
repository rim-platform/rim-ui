import { describe, expect, it } from "vitest";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../types";
import { commandArguments, commandsMatching, namesCommand, splitCommandLine } from "./commandLine";

function command(
  id: string,
  title: string,
  args: { name: string; argumentType: CommandArgumentType }[] = [],
): CommandDefinition {
  return {
    id,
    title,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: false,
    dangerous: false,
    arguments: args.map((a) => ({ ...a, required: true })),
  };
}

const known = [
  command("chat.list_members", "List Members"),
  command("admin.timeout", "Timeout Member", [
    { name: "user_id", argumentType: CommandArgumentType.USER_ID },
    { name: "minutes", argumentType: CommandArgumentType.INTEGER },
  ]),
  command("chat.post_message", "Post Message", [
    { name: "text", argumentType: CommandArgumentType.STRING },
  ]),
  command("chat.create_channel", "Create Channel", [
    { name: "is_private", argumentType: CommandArgumentType.BOOLEAN },
  ]),
];

describe("splitCommandLine", () => {
  it("splits the words naming a command from its pairs", () => {
    expect(splitCommandLine("/ List   MEMBERS ")).toEqual({ head: "list members", pairs: [] });
    expect(splitCommandLine("/admin.timeout user_id=u-1 minutes=15")).toEqual({
      head: "admin.timeout",
      pairs: [
        { key: "user_id", value: "u-1" },
        { key: "minutes", value: "15" },
      ],
    });
  });

  it("reads a quoted value with spaces and escapes", () => {
    expect(splitCommandLine('/chat.post_message text="two words, \\"quoted\\""').pairs).toEqual([
      { key: "text", value: 'two words, "quoted"' },
    ]);
  });

  it("keeps words after the name as part of the name when no pair follows", () => {
    expect(splitCommandLine("/list members please")).toEqual({
      head: "list members please",
      pairs: [],
    });
  });

  it("says what cannot be read after the name", () => {
    expect(splitCommandLine('/chat.post_message text="open')).toMatchObject({
      head: "chat.post_message",
      error: expect.stringContaining("closing quote"),
    });
    expect(splitCommandLine("/chat.post_message text=hi stray")).toMatchObject({
      head: "chat.post_message",
      error: 'Expected key=value, found "stray".',
    });
  });
});

describe("commandArguments", () => {
  it("turns values into what the command declares", () => {
    expect(
      commandArguments(known[1], [
        { key: "user_id", value: "u-1" },
        { key: "minutes", value: "15" },
      ]),
    ).toEqual({ user_id: "u-1", minutes: 15 });
    expect(commandArguments(known[3], [{ key: "is_private", value: "true" }])).toEqual({
      is_private: true,
    });
    expect(commandArguments(known[1], [{ key: "minutes", value: "soon" }])).toEqual({
      minutes: "soon",
    });
  });
});

describe("commandsMatching", () => {
  it("matches the words typed against ids, titles and categories", () => {
    expect(commandsMatching("list members", known)).toEqual([known[0]]);
    expect(commandsMatching("chat.list_members", known)).toEqual([known[0]]);
    expect(commandsMatching("member", known)).toEqual([known[0], known[1]]);
    expect(commandsMatching("frobnicate", known)).toEqual([]);
  });

  it("puts the command whose whole name was typed first", () => {
    expect(commandsMatching("timeout member", known)[0]).toBe(known[1]);
    expect(namesCommand(known[1], "timeout member")).toBe(true);
    expect(namesCommand(known[1], "timeout")).toBe(false);
  });
});
