import { describe, expect, it } from "vitest";

import type { CommandResult } from "../types";
import { commandSuccessText } from "./commandResultText";

function result(message: string, payload: unknown): CommandResult {
  return { status: "SUCCESS", message, payload, followUpCommands: [] };
}

describe("commandSuccessText", () => {
  it("shows the result's message, never the payload", () => {
    const text = commandSuccessText("List Channels", result("3 channels found", { channels: [] }));
    expect(text).toBe("List Channels: 3 channels found.");
    expect(text).not.toContain("[object Object]");
  });

  it("is the title alone when the result has no message", () => {
    expect(commandSuccessText("Open Settings", result("  ", { opened: true }))).toBe(
      "Open Settings",
    );
  });
});
