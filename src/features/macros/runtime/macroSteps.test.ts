import { afterEach, describe, expect, it } from "vitest";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { CommandDefinition } from "../../commands/types";
import { presetFieldValues, presetFields } from "../../commands/runtime/argumentValues";
import { LOCAL_COMMANDS } from "../../commands/runtime/localCommands";
import { newStepDraft, readStep, requiredStepFields, stepDraftOf, stepFields } from "./macroSteps";

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
    ...overrides,
  };
}

const MUTE = command({
  id: "notifications.mute_conversation",
  arguments: [
    { name: "workspace_id", argumentType: CommandArgumentType.WORKSPACE_ID, required: true },
    {
      name: "conversation_id",
      argumentType: CommandArgumentType.CONVERSATION_ID,
      required: true,
    },
    {
      name: "duration",
      title: "For how long",
      argumentType: CommandArgumentType.STRING,
      required: true,
    },
    { name: "minutes", argumentType: CommandArgumentType.INTEGER, required: false },
    { name: "message_id", argumentType: CommandArgumentType.MESSAGE_ID, required: true },
  ],
});

const GO_TO_CHANNEL = command({
  id: "workspace.navigate_to_channel",
  sourceKind: "BUILT_IN",
  executionTarget: "DESKTOP_LOCAL",
});

afterEach(() => queryClient.clear());

describe("stepFields", () => {
  it("has a field for each argument the form asks for, leaving out the workspace", () => {
    expect(stepFields(MUTE).map((f) => f.name)).toEqual(["conversation_id", "duration", "minutes"]);
  });

  it("adds the argument this app asks for with a picker", () => {
    expect(stepFields(GO_TO_CHANNEL)).toEqual([
      {
        name: "conversation_id",
        argumentType: CommandArgumentType.CONVERSATION_ID,
        required: false,
      },
    ]);
    expect(requiredStepFields(GO_TO_CHANNEL)).toEqual([]);
  });

  it("reads a plugin command's arguments from its manifest", () => {
    queryClient.setQueryData(queryKeys.plugins(), [
      {
        display_name: "Polls",
        commands: [
          {
            qualified_id: "plugin.dev.rim.poll.create",
            title: "Create Poll",
            arguments: [
              { name: "question", required: true, description: "What to ask" },
              { name: "options", type: "integer" },
            ],
          },
        ],
      },
    ]);
    const poll = command({ id: "plugin.dev.rim.poll.create", sourceKind: "PLUGIN" });

    expect(stepFields(poll)).toEqual([
      {
        name: "question",
        argumentType: CommandArgumentType.STRING,
        required: true,
        description: "What to ask",
      },
      { name: "options", argumentType: CommandArgumentType.INTEGER, required: false },
    ]);
  });
});

describe("requiredStepFields", () => {
  it("are the required ones that neither where it runs nor a picker supplies", () => {
    expect(requiredStepFields(MUTE).map((f) => f.name)).toEqual(["duration"]);
  });
});

describe("stepDraftOf and readStep", () => {
  it("shows saved arguments in their fields and saves back those their choice uses", () => {
    const draft = stepDraftOf(
      {
        commandId: MUTE.id,
        args: { duration: "1h", minutes: 5, workspace_id: "ws-1" },
        ask: ["conversation_id"],
      },
      MUTE,
    );

    expect(draft.values).toMatchObject({ duration: "1h", minutes: "5" });
    expect(draft.kept).toEqual({ workspace_id: "ws-1" });
    expect(readStep(draft, MUTE, "ws-1")).toEqual({
      ok: true,
      input: {
        commandId: MUTE.id,
        args: { workspace_id: "ws-1", duration: "1h" },
        ask: ["conversation_id"],
      },
    });
  });

  it("saves nothing a field sets when that field is asked for", () => {
    const draft = stepDraftOf(
      { commandId: MUTE.id, args: { conversation_id: "c-1", minutes: 30 }, ask: [] },
      MUTE,
    );

    expect(readStep({ ...draft, ask: ["duration"] }, MUTE, undefined)).toEqual({
      ok: true,
      input: { commandId: MUTE.id, args: { conversation_id: "c-1" }, ask: ["duration"] },
    });
  });

  it("keeps saved arguments the fields cannot show as they are", () => {
    const draft = stepDraftOf({ commandId: MUTE.id, args: { other: [1, 2] } }, MUTE);

    expect(draft.values).toBeNull();
    expect(readStep(draft, MUTE, undefined)).toEqual({
      ok: true,
      input: { commandId: MUTE.id, args: { other: [1, 2] }, ask: [] },
    });
  });

  it("refuses a required argument neither fixed nor asked for, and a value that is not one", () => {
    const draft = newStepDraft(MUTE.id, MUTE);
    expect(readStep(draft, MUTE, undefined)).toEqual({
      ok: false,
      problems: {
        duration: "How long needs a value, or ask for it when the macro runs",
      },
    });

    const values = { ...draft.values, duration: "1h", minutes: "soon" };
    expect(readStep({ ...draft, values }, MUTE, undefined)).toEqual({
      ok: false,
      problems: { minutes: "Enter a whole number" },
    });
  });

  it("does not fix an argument that is asked for", () => {
    const draft = newStepDraft(MUTE.id, MUTE);
    const asked = { ...draft, values: { ...draft.values, duration: "1h" }, ask: ["duration"] };

    expect(readStep(asked, MUTE, undefined)).toEqual({
      ok: true,
      input: { commandId: MUTE.id, ask: ["duration"] },
    });
  });
});

describe("steps with argument pickers", () => {
  const SWITCH = command({
    id: "workspace.switch_workspace",
    category: "Navigation",
    executionTarget: "DESKTOP_LOCAL",
    arguments: [
      {
        name: "workspace_id",
        title: "Workspace",
        argumentType: CommandArgumentType.WORKSPACE_ID,
        required: true,
      },
    ],
  });
  const SET_TOPIC = command({
    id: "chat.set_topic",
    arguments: [
      { name: "server_id", argumentType: CommandArgumentType.WORKSPACE_ID, required: true },
      {
        name: "conversation_id",
        argumentType: CommandArgumentType.CONVERSATION_ID,
        required: true,
      },
      { name: "topic", title: "Topic", argumentType: CommandArgumentType.STRING, required: true },
    ],
  });
  const SET_STATE = command({
    id: "state.set",
    arguments: [
      { name: "server_id", argumentType: CommandArgumentType.WORKSPACE_ID, required: true },
      { name: "key", title: "Key", argumentType: CommandArgumentType.STRING, required: true },
      { name: "value", title: "Value", argumentType: CommandArgumentType.STRING, required: true },
    ],
  });

  it("gives switching workspace a field for the workspace to go to, and saves it", () => {
    expect(stepFields(SWITCH).map((f) => f.name)).toEqual(["workspace_id"]);
    expect(requiredStepFields(SWITCH)).toEqual([]);

    const draft = newStepDraft(SWITCH.id, SWITCH);
    const filled = { ...draft, values: { workspace_id: "ws-2" } };
    expect(readStep(filled, SWITCH, "ws-1")).toEqual({
      ok: true,
      input: { commandId: SWITCH.id, args: { workspace_id: "ws-2" }, ask: [] },
    });

    const reopened = stepDraftOf({ commandId: SWITCH.id, args: { workspace_id: "ws-2" } }, SWITCH);
    expect(reopened.values).toEqual({ workspace_id: "ws-2" });
    expect(reopened.kept).toEqual({});
  });

  it("still leaves the workspace a step runs in out of its fields", () => {
    expect(stepFields(SET_TOPIC).map((f) => f.name)).toEqual(["conversation_id", "topic"]);
  });

  it("saves a cleared topic as an empty topic and shows it cleared again", () => {
    const draft = newStepDraft(SET_TOPIC.id, SET_TOPIC);
    const cleared = { ...draft, values: { conversation_id: "conv-1", topic: true } };
    const read = readStep(cleared, SET_TOPIC, "ws-1");
    expect(read).toEqual({
      ok: true,
      input: {
        commandId: SET_TOPIC.id,
        args: { conversation_id: "conv-1", topic: "", server_id: "ws-1" },
        ask: [],
      },
    });
    const reopened = stepDraftOf(
      { commandId: SET_TOPIC.id, args: { conversation_id: "conv-1", topic: "" } },
      SET_TOPIC,
    );
    expect(reopened.values).toEqual({ conversation_id: "conv-1", topic: true });
  });

  it("keeps a stored value's kind when the step is saved and opened again", () => {
    for (const value of ["true", "42", '"42"', '"hello"', '{"a":1}']) {
      const draft = stepDraftOf(
        { commandId: SET_STATE.id, args: { key: "a.b", value } },
        SET_STATE,
      );
      expect(draft.values).toEqual({ key: "a.b", value });
      expect(readStep(draft, SET_STATE, "ws-1")).toEqual({
        ok: true,
        input: { commandId: SET_STATE.id, args: { key: "a.b", value }, ask: [] },
      });
    }
  });

  it("refuses to save a key under system. or a value that is not JSON", () => {
    const draft = newStepDraft(SET_STATE.id, SET_STATE);
    expect(
      readStep({ ...draft, values: { key: "system.x", value: "1" } }, SET_STATE, "ws-1"),
    ).toEqual({
      ok: false,
      problems: { key: "Keys starting with system. are kept for the workspace itself" },
    });
    expect(
      readStep({ ...draft, values: { key: "a.b", value: "twelve" } }, SET_STATE, "ws-1"),
    ).toEqual({ ok: false, problems: { value: "Enter a valid number or JSON value" } });
  });
});

describe("the fields of a command this app asks a target for", () => {
  const prompted = [
    ["people.view_profile", "user_id", CommandArgumentType.USER_ID],
    ["people.message", "user_id", CommandArgumentType.USER_ID],
    ["app.run_macro", "macro_id", CommandArgumentType.STRING],
    ["app.toggle_pipeline", "pipeline_id", CommandArgumentType.STRING],
  ] as const;

  it.each(prompted)("are the same for a keybind as for a macro step: %s", (id, name, type) => {
    const definition = LOCAL_COMMANDS.find((candidate) => candidate.id === id);
    expect(definition).toBeDefined();
    expect(presetFields(definition!)).toEqual(stepFields(definition));
    expect(presetFields(definition!)).toEqual([{ name, argumentType: type, required: false }]);
  });

  it("show a saved target in a keybind's fields", () => {
    const viewProfile = LOCAL_COMMANDS.find((candidate) => candidate.id === "people.view_profile")!;
    expect(presetFieldValues(viewProfile, { user_id: "u-1" })).toEqual({ user_id: "u-1" });
  });
});
