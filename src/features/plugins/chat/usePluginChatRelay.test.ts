import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => ({ ok: true, value: true })));
vi.mock("../../../core/tauri/safeInvoke", () => ({ safeInvoke: invoke }));
vi.mock("./appMessageService", () => ({ appMessageService: { call: vi.fn() } }));

import { ErrorCode, RpcError } from "../web/rpc";
import { answerChatRequest, type ChatRequest } from "./usePluginChatRelay";

const request: ChatRequest = {
  requestId: 41,
  pluginId: "dev.example.reader",
  method: "rim.chat.list_messages",
  params: { conversationId: "c" },
  grantedCapabilities: ["chat.read"],
};

beforeEach(() => invoke.mockClear());

describe("answerChatRequest", () => {
  it("answers the broker with the service's result and the start-time grants", async () => {
    const call = vi.fn(async () => ({ messages: [], hasOlder: false }));
    await answerChatRequest(request, { call });
    expect(call).toHaveBeenCalledWith(
      "dev.example.reader",
      "rim.chat.list_messages",
      { conversationId: "c" },
      ["chat.read"],
    );
    expect(invoke).toHaveBeenCalledWith("plugin_chat_respond", {
      requestId: 41,
      result: { messages: [], hasOlder: false },
      error: null,
    });
  });

  it("passes a refusal on as the JSON-RPC error, and anything else as INTERNAL_ERROR", async () => {
    await answerChatRequest(request, {
      call: async () => {
        throw new RpcError(ErrorCode.CAPABILITY_DENIED, "capability denied: chat.read.encrypted");
      },
    });
    expect(invoke).toHaveBeenLastCalledWith("plugin_chat_respond", {
      requestId: 41,
      result: null,
      error: { code: -32000, message: "capability denied: chat.read.encrypted" },
    });
    await answerChatRequest(request, {
      call: async () => {
        throw new Error("boom");
      },
    });
    expect(invoke).toHaveBeenLastCalledWith("plugin_chat_respond", {
      requestId: 41,
      result: null,
      error: { code: -32603, message: "boom" },
    });
  });
});
