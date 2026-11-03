import { describe, it, expect } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../types";
import {
  appOnlyStageError,
  pipeConfirmationSubject,
  pipeExpectsConfirmation,
  pipeStageCommandId,
  readablePipeError,
} from "./pipeStages";

type Stage = Pick<
  CommandDefinition,
  "id" | "title" | "executionTarget" | "dangerous" | "sensitivity"
>;

function stage(id: string, title: string, overrides: Partial<Stage> = {}): Stage {
  return { id, title, executionTarget: "BACKEND", dangerous: false, ...overrides };
}

const SEARCH = stage("chat.search_messages", "Search Messages", {
  sensitivity: CommandSensitivity.SAFE,
});
const BAN = stage("admin.ban", "Ban Member", {
  sensitivity: CommandSensitivity.MUTATING,
  dangerous: true,
});
const KICK = stage("admin.kick", "Kick Member", {
  sensitivity: CommandSensitivity.MUTATING,
  dangerous: true,
});
const LIST_CHANNELS = stage("chat.list_channels", "List Channels");
const TOGGLE_SIDEBAR = stage("workspace.toggle_sidebar", "Toggle Sidebar", {
  executionTarget: "DESKTOP_LOCAL",
});

describe("pipeStageCommandId", () => {
  it("reads the id before the arguments", () => {
    expect(pipeStageCommandId("chat.search_messages query=Lunch")).toBe("chat.search_messages");
  });
});

describe("pipeConfirmationSubject", () => {
  it("marks a pipe with a dangerous stage and names it", () => {
    const segments = ["chat.search_messages query=Lunch", "admin.ban"];
    expect(pipeConfirmationSubject(segments, [SEARCH, BAN])).toMatchObject({
      commandId: "chat.search_messages query=Lunch | admin.ban",
      title: "Run pipe",
      args: { pipe: "chat.search_messages query=Lunch | admin.ban" },
      dangerous: true,
      description: "Includes a dangerous command: Ban Member.",
      sensitivity: CommandSensitivity.MUTATING,
    });
  });

  it("names every dangerous stage", () => {
    const subject = pipeConfirmationSubject(["admin.ban", "admin.kick"], [BAN, KICK]);
    expect(subject.description).toBe("Includes dangerous commands: Ban Member, Kick Member.");
  });

  it("leaves a pipe without dangerous stages unmarked", () => {
    const subject = pipeConfirmationSubject(["chat.search_messages query=Lunch"], [SEARCH]);
    expect(subject.dangerous).toBe(false);
    expect(subject).not.toHaveProperty("description");
  });
});

describe("appOnlyStageError", () => {
  it("names the first stage that runs only in the app", () => {
    expect(
      appOnlyStageError(
        ["chat.list_channels", "workspace.toggle_sidebar"],
        [LIST_CHANNELS, TOGGLE_SIDEBAR],
      ),
    ).toBe("Pipe stage 2: Toggle Sidebar runs only in this app, so it cannot be part of a pipe.");
  });

  it("returns null when every stage runs on the server or is unknown", () => {
    expect(
      appOnlyStageError(["chat.list_channels", "custom.unknown"], [LIST_CHANNELS, TOGGLE_SIDEBAR]),
    ).toBeNull();
  });
});

describe("readablePipeError", () => {
  it("rewrites the server's desktop-local refusal", () => {
    const refusal = (id: string) =>
      `piped commands must all target the same execution runtime; stage 1 ('${id}') is desktop-local`;
    expect(readablePipeError(refusal("workspace.toggle_sidebar"), [TOGGLE_SIDEBAR])).toBe(
      "Pipe stage 1: Toggle Sidebar runs only in this app, so it cannot be part of a pipe.",
    );
    expect(readablePipeError(refusal("custom.local"), [TOGGLE_SIDEBAR])).toBe(
      "Pipe stage 1: custom.local runs only in this app, so it cannot be part of a pipe.",
    );
  });

  it("leaves other messages as they are", () => {
    expect(readablePipeError("Pipe execution failed", [TOGGLE_SIDEBAR])).toBe(
      "Pipe execution failed",
    );
  });
});

describe("pipeExpectsConfirmation", () => {
  const subjectOf = (...stages: Stage[]) =>
    pipeConfirmationSubject(
      stages.map((s) => s.id),
      stages,
    );

  it("expects a confirmation for a dangerous stage", () => {
    expect(pipeExpectsConfirmation(subjectOf(SEARCH, KICK))).toBe(true);
  });

  it("expects one for a Restricted stage", () => {
    const wipe = stage("admin.wipe", "Wipe", { sensitivity: CommandSensitivity.RESTRICTED });
    expect(pipeExpectsConfirmation(subjectOf(SEARCH, wipe))).toBe(true);
  });

  it("expects none for safe or mutating stages", () => {
    const rename = stage("chat.rename", "Rename", { sensitivity: CommandSensitivity.MUTATING });
    expect(pipeExpectsConfirmation(subjectOf(SEARCH))).toBe(false);
    expect(pipeExpectsConfirmation(subjectOf(SEARCH, rename))).toBe(false);
  });
});
