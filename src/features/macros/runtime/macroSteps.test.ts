import { afterEach, describe, expect, it } from "vitest";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { CommandDefinition } from "../../commands/types";
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
  it("shows saved arguments in their fields and saves them back with what is asked", () => {
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
        args: { workspace_id: "ws-1", duration: "1h", minutes: 5 },
        ask: ["conversation_id"],
      },
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
        duration: "For how long needs a value, or ask for it when the macro runs",
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
