import { describe, expect, it } from "vitest";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo } from "../types";
import {
  argumentPicker,
  argumentPickerKind,
  CLEARED_FIELD,
  sendsEmptyText,
} from "./argumentPickers";
import { argumentValueOf, fieldProblem, readFields, toFieldValue } from "./argumentValues";

const TOPIC: CommandArgumentInfo = {
  name: "topic",
  title: "Topic",
  argumentType: CommandArgumentType.STRING,
  required: true,
};
const KEY: CommandArgumentInfo = {
  name: "key",
  title: "Key",
  argumentType: CommandArgumentType.STRING,
  required: true,
};
const VALUE: CommandArgumentInfo = {
  name: "value",
  title: "Value",
  argumentType: CommandArgumentType.STRING,
  required: true,
};

describe("argumentPicker", () => {
  it("names a picker by command and argument, and nothing for others", () => {
    expect(argumentPickerKind("state.set", "key")).toBe("stateKey");
    expect(argumentPickerKind("state.set", "value")).toBe("stateValue");
    expect(argumentPickerKind("state.list", "prefix")).toBe("statePrefix");
    expect(argumentPickerKind("app.run_macro", "macro_id")).toBe("macro");
    expect(argumentPickerKind("app.toggle_pipeline", "pipeline_id")).toBe("pipeline");
    expect(argumentPickerKind("workspace.switch_workspace", "workspace_id")).toBe(
      "targetWorkspace",
    );
    expect(argumentPickerKind("chat.set_topic", "topic")).toBe("clearableText");
    expect(argumentPicker("chat.post_message", "text")).toBeUndefined();
    expect(argumentPicker(undefined, "key")).toBeUndefined();
    expect(argumentPicker("state.set", "constructor")).toBeUndefined();
  });

  it("refuses system. keys only to the commands that write or delete them", () => {
    expect(argumentPicker("state.get", "key")?.keyAccess).toBe("read");
    expect(argumentPicker("state.set", "key")?.keyAccess).toBe("write");
    expect(argumentPicker("state.incr", "key")?.keyAccess).toBe("write");
    expect(argumentPicker("state.delete", "key")?.keyAccess).toBe("delete");
  });

  it("labels the values of each argument in the app's own words", () => {
    const labels = (id: string) => {
      const dot = id.lastIndexOf(".");
      return argumentPicker(id.slice(0, dot), id.slice(dot + 1))?.valueLabels;
    };
    for (const command of ["state.get", "state.set", "state.delete", "state.list", "state.incr"]) {
      expect(labels(`${command}.scope`)).toEqual({
        server: "Workspace (everyone)",
        user: "Only me",
      });
    }
    expect(labels("notifications.set_level.level")).toEqual({
      all: "All messages",
      mentions: "Mentions only",
      none: "Nothing",
      default: "Workspace default",
    });
    expect(labels("notifications.mute_conversation.duration")).toEqual({
      "1h": "Mute for 1 hour",
      "8h": "Mute for 8 hours",
      until_tomorrow: "Mute until tomorrow",
      forever: "Until I unmute it",
      until: "Until a time",
    });
    expect(labels("notifications.dnd.mode")).toEqual({
      on: "Until I turn it back on",
      off: "Off",
      until: "Until a time",
    });
    expect(labels("admin.delete_member_messages.window")).toEqual({
      "1h": "Last hour",
      "24h": "Last 24 hours",
      "7d": "Last 7 days",
      all: "Everything",
    });
    expect(labels("chat.set_channel_posting.policy")).toEqual({
      everyone: "Everyone",
      moderators: "Owner and moderators",
    });
  });
});

describe("a topic that can be cleared", () => {
  it("sends an empty topic when cleared, and nothing while it is not typed", () => {
    expect(sendsEmptyText("chat.set_topic", "topic")).toBe(true);
    expect(argumentValueOf(TOPIC, CLEARED_FIELD, "chat.set_topic")).toBe("");
    expect(argumentValueOf(TOPIC, "", "chat.set_topic")).toBeUndefined();
    expect(argumentValueOf(TOPIC, "Release week", "chat.set_topic")).toBe("Release week");
    expect(readFields([TOPIC], { topic: CLEARED_FIELD }, true, "chat.set_topic")).toEqual({
      ok: true,
      args: { topic: "" },
    });
    expect(readFields([TOPIC], { topic: "" }, true, "chat.set_topic")).toEqual({
      ok: false,
      problems: { topic: "Topic is required" },
    });
  });

  it("shows a saved empty topic as cleared", () => {
    expect(toFieldValue(TOPIC, "", "chat.set_topic")).toBe(CLEARED_FIELD);
    expect(toFieldValue(TOPIC, "", "chat.other")).toBe("");
  });

  it("drops an empty string for other text arguments, as before", () => {
    expect(argumentValueOf(TOPIC, "", "chat.create_group")).toBeUndefined();
  });
});

describe("state key and value checks", () => {
  it("refuses a key that breaks the key rules, and a system key to a write", () => {
    expect(fieldProblem(KEY, "Deploy", true, "state.get")).toBe(
      "A key starts with a lowercase letter",
    );
    expect(fieldProblem(KEY, "system.config", true, "state.get")).toBeNull();
    expect(fieldProblem(KEY, "system.config", true, "state.set")).toBe(
      "Keys starting with system. are kept for the workspace itself",
    );
    expect(fieldProblem(KEY, "system.config", true, "state.delete")).not.toBeNull();
    expect(fieldProblem(KEY, "system.config", true, "state.incr")).not.toBeNull();
    expect(fieldProblem(KEY, "deploy.count", true, "state.set")).toBeNull();
    expect(fieldProblem(KEY, "Deploy", true, "other.command")).toBeNull();
    expect(argumentValueOf(KEY, " deploy.count ", "state.set")).toBe("deploy.count");
  });

  it("refuses a value that is not JSON and sends the others as typed", () => {
    expect(fieldProblem(VALUE, "twelve", true, "state.set")).toBe(
      "Enter a valid number or JSON value",
    );
    expect(readFields([VALUE], { value: '"true"' }, true, "state.set")).toEqual({
      ok: true,
      args: { value: '"true"' },
    });
  });

  it("shows a saved plain text value as the JSON string the server stored", () => {
    expect(toFieldValue(VALUE, "hello", "state.set")).toBe('"hello"');
    expect(toFieldValue(VALUE, "42", "state.set")).toBe("42");
  });
});
