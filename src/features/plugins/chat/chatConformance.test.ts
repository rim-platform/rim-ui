// @vitest-environment node
// A plugin written with the SDK calls rim.chat.list_messages over a real
// MessageChannel, as a web plugin's frame does, against the web host's session
// and the message service. It must get exactly the shared vector's answer, the
// same the Rust broker hands a local process over stdio (plugin_view.rs), in the
// schema's not-frozen shape.
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";

import vectors from "../../../../protocol/plugin-chat-vectors.json";
import {
  definePlugin,
  portTransport,
  type PortLike,
} from "../../../../sdk/plugin-sdk/src/index.browser.ts";
import { PluginSession, type SessionPort } from "../web/pluginSession";
import { notFrozenProblems } from "../web/testing/protocolSchema";
import type { PluginMessagePage } from "./chatTypes";
import { createMessageService } from "./messageService";

const PLUGIN = "dev.example.chat-reader";

function hostPort(port: MessageChannel["port1"], sent: Record<string, unknown>[]): SessionPort {
  return {
    postMessage(text: string) {
      sent.push(JSON.parse(text) as Record<string, unknown>);
      port.postMessage(text);
    },
    get onmessage() {
      return port.onmessage as SessionPort["onmessage"];
    },
    set onmessage(listener) {
      port.onmessage = listener as typeof port.onmessage;
    },
    close: () => port.close(),
  };
}

describe("rim.chat.list_messages over a port", () => {
  it("gives a web plugin the shared vector's answer", async () => {
    const service = createMessageService({
      workspaceId: () => vectors.workspaceId,
      encrypted: async (_ws, id) => id === vectors.conversationId,
      cache: () => ({
        // What the cache's plugin command answers for the vector's rows.
        list: async () => vectors.listMessages.result as PluginMessagePage,
        get: async () => null,
        search: async () => [],
        follow: async () => {},
      }),
      post: async () => "unused",
      recordEncryptedReads: async () => {},
    });
    const granted = vectors.listMessages.grantedCapabilities;

    const channel = new MessageChannel();
    const sent: Record<string, unknown>[] = [];
    const session = new PluginSession(
      hostPort(channel.port1, sent),
      {
        pluginId: PLUGIN,
        hostVersion: "0.0.0-test",
        grantedCapabilities: granted,
        principal: null,
        mappings: [],
        isHidden: () => false,
      },
      {
        log: () => {},
        updatePanel: () => ({}),
        storageGet: async () => null,
        storageSet: async () => {},
        settingsGet: async () => ({}),
        chat: (method, params) => service.call(PLUGIN, method, params, granted),
        stopped: () => {},
      },
    );

    const running = definePlugin({
      id: PLUGIN,
      commands: {
        read: {
          async run({ host }) {
            const params = vectors.listMessages.params;
            return {
              payload: await host.chat.listMessages(params.conversationId, { limit: params.limit }),
            };
          },
        },
      },
    }).run({
      transport: portTransport(channel.port2 as unknown as PortLike),
      manifestPath: false,
      exit: () => {},
    });

    await session.handshake();
    const output = await session.execute({
      commandId: "read",
      args: {},
      invoker: null,
      initiator: "user",
      confirmed: false,
    });
    expect(output.payload).toEqual(vectors.listMessages.result);

    // The host's answer to the plugin's call, as it went over the port.
    const answer = sent.find(
      (m) => typeof m.result === "object" && m.result !== null && "messages" in m.result,
    );
    expect(answer?.result).toEqual(vectors.listMessages.result);
    expect(notFrozenProblems("ChatListMessagesResult", answer?.result)).toEqual([]);
    expect(JSON.stringify(answer)).not.toMatch(/frankingKey|secret|blobSha256|ciphertext/);

    await session.shutdown(10);
    await running;
    channel.port1.close();
  });

  it("the vector itself is a valid answer", () => {
    expect(notFrozenProblems("ChatListMessagesResult", vectors.listMessages.result)).toEqual([]);
    expect(notFrozenProblems("ChatListMessagesParams", vectors.listMessages.params)).toEqual([]);
  });
});
