import { describe, it, expect } from "vitest";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo } from "../types";
import {
  contextSuppliesArgument,
  serverRunsWithContext,
  unfilledRequiredArguments,
} from "./commandArguments";

function argument(
  name: string,
  argumentType: CommandArgumentType,
  required = true,
): CommandArgumentInfo {
  return { name, argumentType, required };
}

const SERVER_ID = argument("server_id", CommandArgumentType.WORKSPACE_ID);
const CONVERSATION_ID = argument("conversation_id", CommandArgumentType.CONVERSATION_ID);
const USER_ID = argument("user_id", CommandArgumentType.USER_ID);
const FULL_CONTEXT = { workspaceId: "ws-1", conversationId: "c-1" };

describe("contextSuppliesArgument", () => {
  it("fills a workspace argument from the context's workspace", () => {
    expect(contextSuppliesArgument(SERVER_ID, { workspaceId: "ws-1" })).toBe(true);
    expect(contextSuppliesArgument(SERVER_ID, {})).toBe(false);
  });

  it("fills a conversation argument only while a conversation is open", () => {
    expect(contextSuppliesArgument(CONVERSATION_ID, FULL_CONTEXT)).toBe(true);
    expect(contextSuppliesArgument(CONVERSATION_ID, { workspaceId: "ws-1" })).toBe(false);
  });

  it("fills no member, message, text or choice argument", () => {
    for (const type of [
      CommandArgumentType.USER_ID,
      CommandArgumentType.MESSAGE_ID,
      CommandArgumentType.STRING,
      CommandArgumentType.ENUM,
    ]) {
      expect(contextSuppliesArgument(argument("value", type), FULL_CONTEXT)).toBe(false);
    }
  });
});

describe("unfilledRequiredArguments", () => {
  it("returns the required arguments the context leaves out", () => {
    const kick = {
      arguments: [SERVER_ID, USER_ID, argument("reason", CommandArgumentType.STRING, false)],
    };
    expect(unfilledRequiredArguments(kick, FULL_CONTEXT)).toEqual([USER_ID]);
  });

  it("ignores optional arguments and a command without declared arguments", () => {
    const optional = { arguments: [argument("reason", CommandArgumentType.STRING, false)] };
    expect(unfilledRequiredArguments(optional, FULL_CONTEXT)).toEqual([]);
    expect(unfilledRequiredArguments({}, FULL_CONTEXT)).toEqual([]);
  });
});

describe("serverRunsWithContext", () => {
  it("refuses a desktop-local command", () => {
    expect(serverRunsWithContext({ executionTarget: "DESKTOP_LOCAL" }, FULL_CONTEXT)).toBe(false);
  });

  it("refuses a server command missing an argument", () => {
    const kick = { executionTarget: "BACKEND" as const, arguments: [SERVER_ID, USER_ID] };
    expect(serverRunsWithContext(kick, FULL_CONTEXT)).toBe(false);
  });

  it("accepts a server command the context fills", () => {
    const markAsRead = {
      executionTarget: "BACKEND" as const,
      arguments: [SERVER_ID, CONVERSATION_ID],
    };
    expect(serverRunsWithContext(markAsRead, FULL_CONTEXT)).toBe(true);
  });
});
