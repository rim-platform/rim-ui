import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { MUTE_DURATIONS } from "../../notifications/hooks/useConversationNotificationItems";
import { tomorrowMorning } from "../../notifications/rules";
import { useCommandArgumentsStore } from "../state/useCommandArgumentsStore";
import type { CommandDefinition, CommandResult } from "../types";
import { dispatchCommand } from "./commandDispatcher";

const MUTE: CommandDefinition = {
  id: "notifications.mute_conversation",
  title: "Mute Conversation",
  description: "",
  category: "Notifications",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
  arguments: [
    {
      name: "conversation_id",
      title: "c",
      description: "",
      argumentType: CommandArgumentType.CONVERSATION_ID,
      required: true,
    },
    {
      name: "duration",
      title: "d",
      description: "",
      argumentType: CommandArgumentType.ENUM,
      required: true,
      allowedValues: ["1h", "8h", "until_tomorrow", "forever", "until"],
    },
    {
      name: "until",
      title: "u",
      description: "",
      argumentType: CommandArgumentType.STRING,
      required: false,
    },
  ],
};

const SUCCESS: CommandResult = {
  status: "SUCCESS",
  message: "",
  payload: null,
  followUpCommands: [],
};
const executeBackend = vi.fn(async (_input: { args?: Record<string, unknown> }) => ({
  executeCommand: SUCCESS,
}));

// 2026-11-09 15:00 local time; tomorrow's 09:00 follows on the same device clock.
const NOW = new Date(2026, 10, 9, 15, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  executeBackend.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  useCommandArgumentsStore.getState().cancel();
  useConfirmationModalStore.getState().reset();
});

function sentArgs(): Record<string, unknown> | undefined {
  return executeBackend.mock.calls[0][0].args;
}

describe("mute until tomorrow from a person's surface", () => {
  const args = { conversation_id: "c-1", duration: "until_tomorrow" };
  const expected = new Date(2026, 10, 10, 9, 0, 0, 0).toISOString();

  it("sends the local 09:00 as an explicit end", async () => {
    await dispatchCommand(MUTE, executeBackend, { args, askForArguments: true });
    expect(sentArgs()).toEqual({ conversation_id: "c-1", duration: "until", until: expected });
    expect(expected).toBe(tomorrowMorning(NOW).toISOString());
  });

  it("does the same for a duration chosen in the argument form", async () => {
    const running = dispatchCommand(MUTE, executeBackend, {
      args: { conversation_id: "c-1" },
      askForArguments: true,
    });
    await vi.waitFor(() => expect(useCommandArgumentsStore.getState().request).toBeTruthy());
    useCommandArgumentsStore.getState().submit({ duration: "until_tomorrow" });
    await running;
    expect(sentArgs()).toEqual({ conversation_id: "c-1", duration: "until", until: expected });
  });

  it("leaves 1h unchanged", async () => {
    const oneHour = { conversation_id: "c-1", duration: "1h" };
    await dispatchCommand(MUTE, executeBackend, { args: oneHour, askForArguments: true });
    expect(sentArgs()).toEqual(oneHour);
  });

  it("leaves a pipe unchanged", async () => {
    await dispatchCommand(MUTE, executeBackend, { args, isPipe: true });
    expect(sentArgs()).toEqual(args);
  });

  it("leaves a plugin caller unchanged", async () => {
    await dispatchCommand(MUTE, executeBackend, {
      args,
      askForArguments: true,
      callerPluginId: "some-plugin",
    });
    expect(sentArgs()).toEqual(args);
  });

  it("ends at the same time as the conversation menu's mute until tomorrow", async () => {
    const menu = MUTE_DURATIONS.find((d) => d.id === "mute-tomorrow")!;
    await dispatchCommand(MUTE, executeBackend, { args, askForArguments: true });
    expect(sentArgs()?.until).toBe(menu.until().toISOString());
  });
});
