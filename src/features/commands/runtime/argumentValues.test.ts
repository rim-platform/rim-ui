import { describe, expect, it } from "vitest";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo } from "../types";
import {
  defaultFieldValue,
  fieldProblem,
  humanizeValue,
  presetArgsOf,
  presetFields,
  presetFieldValues,
  presetWorkspace,
  readFields,
  requiredFirst,
} from "./argumentValues";

function argument(
  name: string,
  argumentType: CommandArgumentType,
  overrides: Partial<CommandArgumentInfo> = {},
): CommandArgumentInfo {
  return { name, title: name, description: "", argumentType, required: true, ...overrides };
}

const MODE = argument("mode", CommandArgumentType.ENUM, { allowedValues: ["on", "off", "until"] });
const MINUTES = argument("minutes", CommandArgumentType.INTEGER, { required: false });
const RATIO = argument("ratio", CommandArgumentType.FLOAT);
const NOTE = argument("note", CommandArgumentType.STRING, { required: false });
const FLAG = argument("flag", CommandArgumentType.BOOLEAN, { required: false, defaultValue: true });
const SERVER = argument("server_id", CommandArgumentType.WORKSPACE_ID);
const USER = argument("user_id", CommandArgumentType.USER_ID);
const MESSAGE = argument("message_id", CommandArgumentType.MESSAGE_ID);

describe("humanizeValue", () => {
  it("turns a server value into a readable label", () => {
    expect(humanizeValue("all")).toBe("All");
    expect(humanizeValue("mentions_only")).toBe("Mentions only");
    expect(humanizeValue("read-only")).toBe("Read only");
    expect(humanizeValue("24h")).toBe("24h");
  });
});

describe("field values", () => {
  it("starts a field from the argument's default, else empty or unchecked", () => {
    expect(defaultFieldValue(FLAG)).toBe(true);
    expect(defaultFieldValue({ ...FLAG, defaultValue: undefined })).toBe(false);
    expect(defaultFieldValue(MINUTES)).toBe("");
    expect(defaultFieldValue({ ...MINUTES, defaultValue: 15 })).toBe("15");
  });

  it("checks whole numbers, numbers, choices and required fields", () => {
    expect(fieldProblem(MINUTES, "12", false)).toBeNull();
    expect(fieldProblem(MINUTES, "1.5", false)).toBe("Enter a whole number");
    expect(fieldProblem(MINUTES, "ten", false)).toBe("Enter a whole number");
    expect(fieldProblem(RATIO, "0.25", true)).toBeNull();
    expect(fieldProblem(RATIO, "abc", true)).toBe("Enter a number");
    expect(fieldProblem(MODE, "sometimes", true)).toBe("Choose one of the options");
    expect(fieldProblem(MODE, "", true)).toBe("mode is required");
    expect(fieldProblem(MODE, "", false)).toBeNull();
  });

  it("reads fields into typed arguments and leaves empty ones out", () => {
    const read = readFields(
      [MODE, MINUTES, RATIO, NOTE, FLAG],
      { mode: "until", minutes: " 30 ", ratio: "0.5", note: "", flag: false },
      true,
    );
    expect(read).toEqual({
      ok: true,
      args: { mode: "until", minutes: 30, ratio: 0.5, flag: false },
    });
  });

  it("names each field that cannot be read", () => {
    const read = readFields([MODE, MINUTES], { mode: "", minutes: "x" }, true);
    expect(read).toEqual({
      ok: false,
      problems: { mode: "mode is required", minutes: "Enter a whole number" },
    });
  });

  it("lets a preset leave a required field empty, to be asked for later", () => {
    expect(readFields([MODE, MINUTES], { mode: "", minutes: "" }, false)).toEqual({
      ok: true,
      args: {},
    });
  });

  it("orders required arguments first", () => {
    expect(requiredFirst([MINUTES, MODE, NOTE, RATIO]).map((a) => a.name)).toEqual([
      "mode",
      "ratio",
      "minutes",
      "note",
    ]);
  });
});

describe("preset arguments", () => {
  const timeout = { arguments: [SERVER, USER, MINUTES, MESSAGE] };

  it("offers a field for every argument but the workspace and the context's own", () => {
    expect(presetFields(timeout).map((a) => a.name)).toEqual(["user_id", "minutes"]);
  });

  it("shows saved arguments that fit, and keeps a saved workspace out of the fields", () => {
    expect(presetFieldValues(timeout, { server_id: "ws-1", user_id: "u-1", minutes: 5 })).toEqual({
      user_id: "u-1",
      minutes: "5",
    });
    expect(presetFieldValues(timeout, undefined)).toEqual({ user_id: "", minutes: "" });
  });

  it("refuses saved arguments the fields cannot show", () => {
    expect(presetFieldValues(timeout, { minutes: "five" })).toBeNull();
    expect(presetFieldValues(timeout, { other: 1 })).toBeNull();
    expect(presetFieldValues({ arguments: [MODE] }, { mode: "sometimes" })).toBeNull();
    expect(presetFieldValues(timeout, [1])).toBeNull();
  });

  it("pins the workspace of a saved member, and reads it back", () => {
    const saved = presetArgsOf(timeout, { user_id: "u-1" }, "ws-1");
    expect(saved).toEqual({ user_id: "u-1", server_id: "ws-1" });
    expect(presetWorkspace(timeout, saved)).toBe("ws-1");
    expect(presetArgsOf(timeout, { minutes: 5 }, "ws-1")).toEqual({ minutes: 5 });
    expect(presetArgsOf(timeout, {}, "ws-1")).toBeUndefined();
  });
});
