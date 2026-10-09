// host.chat over both transports: what the SDK sends for each rim.chat.* call,
// what it hands the plugin back, and the capability gate in front of them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { definePlugin, ErrorCode } from "../src/index.ts";
import { startTestHost } from "../src/testing.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../../../protocol/plugin-chat-vectors.json", import.meta.url), "utf8"),
);
const conversationId: string = vectors.listMessages.params.conversationId;
const message = vectors.listMessages.result.messages[1];

function reader() {
  return definePlugin({
    id: "dev.example.chat",
    commands: {
      read: {
        async run({ host }) {
          const page = await host.chat.listMessages(conversationId, { limit: 50 });
          const one = await host.chat.getMessage(message.id);
          const missing = await host.chat.getMessage("gone");
          const hits = await host.chat.searchMessages("plan", { conversationId });
          const posted = await host.chat.postMessage(conversationId, "on it", {
            threadId: "t-1",
          });
          return { payload: { page, one, missing, hits, posted } };
        },
      },
    },
  });
}

describe.each(["stdio", "port"] as const)("host.chat over %s", (transport) => {
  it("sends each call's params and returns the host's answers", async () => {
    const calls: [string, unknown][] = [];
    const host = startTestHost(reader(), {
      transport,
      grantedCapabilities: ["chat.read", "chat.read.encrypted", "chat.write"],
      onRequest(method, params) {
        calls.push([method, params]);
        switch (method) {
          case "rim.chat.list_messages":
            return vectors.listMessages.result;
          case "rim.chat.get_message":
            return {
              message: (params as { messageId: string }).messageId === "gone" ? null : message,
            };
          case "rim.chat.search_messages":
            return { messages: [message] };
          default:
            return { id: "m-new" };
        }
      },
    });
    await host.handshake();
    const answer = await host.execute("read");
    expect(answer.result?.payload).toEqual({
      page: vectors.listMessages.result,
      one: message,
      missing: null,
      hits: [message],
      posted: { id: "m-new" },
    });
    expect(calls).toEqual([
      ["rim.chat.list_messages", { conversationId, limit: 50 }],
      ["rim.chat.get_message", { messageId: message.id }],
      ["rim.chat.get_message", { messageId: "gone" }],
      ["rim.chat.search_messages", { query: "plan", conversationId }],
      ["rim.chat.post_message", { conversationId, body: "on it", threadId: "t-1" }],
    ]);
    await host.shutdown();
  });

  it("rejects with CAPABILITY_DENIED without the grant", async () => {
    const host = startTestHost(reader(), { transport, onRequest: () => ({}) });
    await host.handshake();
    const answer = await host.execute("read");
    expect(answer.error?.code).toBe(ErrorCode.PLUGIN_ERROR);
    expect(answer.error?.message).toContain(`(${ErrorCode.CAPABILITY_DENIED})`);
    await host.shutdown();
  });
});
