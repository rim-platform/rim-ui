import { describe, expect, it } from "vitest";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../types";
import { parseCommandLine } from "./commandLine";

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

describe("parseCommandLine", () => {
  it("matches an id or a title, ignoring case and spacing", () => {
    expect(parseCommandLine("/chat.list_members", known)).toEqual({
      command: known[0],
      args: {},
    });
    expect(parseCommandLine("/ List   MEMBERS ", known)).toEqual({ command: known[0], args: {} });
  });

  it("reads key=value pairs, quoted values and declared types", () => {
    expect(parseCommandLine("/Timeout Member user_id=u-1 minutes=15", known)).toEqual({
      command: known[1],
      args: { user_id: "u-1", minutes: 15 },
    });
    expect(parseCommandLine('/chat.post_message text="two words, \\"quoted\\""', known)).toEqual({
      command: known[2],
      args: { text: 'two words, "quoted"' },
    });
    expect(parseCommandLine("/chat.create_channel is_private=true", known)).toEqual({
      command: known[3],
      args: { is_private: true },
    });
  });

  it("keeps a value that is not a number as typed", () => {
    expect(parseCommandLine("/admin.timeout minutes=soon", known)).toEqual({
      command: known[1],
      args: { minutes: "soon" },
    });
  });

  it("is not a command when the line names none or has words after the name", () => {
    expect(parseCommandLine("/list members please", known)).toBeNull();
    expect(parseCommandLine("/list", known)).toBeNull();
    expect(parseCommandLine("list members", known)).toBeNull();
    expect(parseCommandLine("/", known)).toBeNull();
    expect(parseCommandLine("/nope text=hi", known)).toBeNull();
    expect(parseCommandLine("/list members", undefined)).toBeNull();
  });

  it("says what cannot be read after a command's name", () => {
    expect(parseCommandLine('/chat.post_message text="open', known)).toMatchObject({
      command: known[2],
      error: expect.stringContaining("closing quote"),
    });
    expect(parseCommandLine("/chat.post_message text=hi stray", known)).toMatchObject({
      command: known[2],
      error: 'Expected key=value, found "stray".',
    });
  });
});
