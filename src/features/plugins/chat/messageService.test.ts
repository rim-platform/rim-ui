import { describe, expect, it, vi } from "vitest";

import vectors from "../../../../protocol/plugin-chat-vectors.json";
import { ErrorCode, RpcError } from "../web/rpc";
import type { PluginChatMessage, PluginMessagePage } from "./chatTypes";
import { createMessageService, type ChatCache, type ChatDeps } from "./messageService";

const WS = vectors.workspaceId;
const ENCRYPTED = vectors.conversationId;
const PLAIN = "0192f000-0000-7000-8000-00000000c0b2";
const PAGE = vectors.listMessages.result as PluginMessagePage;
const READ = ["chat.read"];
const READ_ALL = ["chat.read", "chat.read.encrypted"];
const WRITE = ["chat.write"];
const WRITE_ALL = ["chat.write", "chat.write.encrypted"];

function plainMessage(): PluginChatMessage {
  return { ...PAGE.messages[0], conversationId: PLAIN, encrypted: false };
}

function setup(overrides: Partial<ChatDeps> = {}, cache: Partial<ChatCache> = {}) {
  const store: ChatCache = {
    list: vi.fn(async () => PAGE),
    get: vi.fn(async () => PAGE.messages[1]),
    search: vi.fn(async () => PAGE.messages),
    follow: vi.fn(async () => {}),
    ...cache,
  };
  const deps: ChatDeps = {
    workspaceId: () => WS,
    encrypted: vi.fn(async (_ws: string, id: string) =>
      id === ENCRYPTED ? true : id === PLAIN ? false : null,
    ),
    cache: () => store,
    post: vi.fn(async () => "new-id"),
    recordEncryptedReads: vi.fn(async () => {}),
    ...overrides,
  };
  return { service: createMessageService(deps), deps, store };
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("the client message service: reads", () => {
  it("lists an encrypted conversation with both read grants and audits the encrypted messages", async () => {
    const { service, deps, store } = setup();
    const page = await service.call(
      "dev.example.reader",
      "rim.chat.list_messages",
      vectors.listMessages.params,
      READ_ALL,
    );
    expect(page).toEqual(vectors.listMessages.result);
    expect(store.list).toHaveBeenCalledWith(WS, ENCRYPTED, null, 50, {
      encryptedAllowed: true,
      knownEncrypted: [ENCRYPTED],
    });
    // Two of the three messages were encrypted.
    expect(deps.recordEncryptedReads).toHaveBeenCalledWith("dev.example.reader", 2);
  });

  it("refuses an encrypted conversation with chat.read alone, before reading the cache", async () => {
    const { service, store } = setup();
    for (const [method, params] of [
      ["rim.chat.list_messages", { conversationId: ENCRYPTED }],
      ["rim.chat.search_messages", { query: "plan", conversationId: ENCRYPTED }],
    ] as const) {
      const error = await rejection(service.call("p", method, params, READ));
      expect(error.code).toBe(ErrorCode.CAPABILITY_DENIED);
      expect(error.message).toBe("capability denied: chat.read.encrypted");
    }
    expect(store.list).not.toHaveBeenCalled();
    expect(store.search).not.toHaveBeenCalled();
  });

  it("reads a plaintext conversation with chat.read and counts nothing", async () => {
    const page = { messages: [plainMessage()], hasOlder: false };
    const { service, deps, store } = setup({}, { list: vi.fn(async () => page) });
    expect(
      await service.call("p", "rim.chat.list_messages", { conversationId: PLAIN }, READ),
    ).toEqual(page);
    expect(store.list).toHaveBeenCalledWith(WS, PLAIN, null, null, {
      encryptedAllowed: false,
      knownEncrypted: [],
    });
    expect(deps.recordEncryptedReads).not.toHaveBeenCalled();
  });

  it("answers get_message, refusing one of an encrypted conversation without the grant", async () => {
    const { service, deps } = setup();
    expect(await service.call("p", "rim.chat.get_message", { messageId: "m" }, READ_ALL)).toEqual({
      message: PAGE.messages[1],
    });
    expect(deps.recordEncryptedReads).toHaveBeenCalledWith("p", 1);

    // The cache did not know the conversation is encrypted; the server does.
    const plainCopy = { ...PAGE.messages[0] };
    const { service: other } = setup({}, { get: vi.fn(async () => plainCopy) });
    const error = await rejection(
      other.call("p", "rim.chat.get_message", { messageId: "m" }, READ),
    );
    expect(error.code).toBe(ErrorCode.CAPABILITY_DENIED);

    const { service: missing } = setup({}, { get: vi.fn(async () => null) });
    expect(await missing.call("p", "rim.chat.get_message", { messageId: "m" }, READ)).toEqual({
      message: null,
    });
  });

  it("searches on this device, dropping encrypted conversations' hits without the grant", async () => {
    const hits = [PAGE.messages[0], plainMessage(), PAGE.messages[1]];
    const { service, store } = setup({}, { search: vi.fn(async () => hits) });
    expect(await service.call("p", "rim.chat.search_messages", { query: "plan" }, READ)).toEqual({
      messages: [plainMessage()],
    });
    expect(store.search).toHaveBeenCalledWith(WS, "plan", null, null, {
      encryptedAllowed: false,
      knownEncrypted: [],
    });
    expect(
      await service.call("p", "rim.chat.search_messages", { query: "plan" }, READ_ALL),
    ).toEqual({ messages: hits });
  });

  it("maps the cache's refusals and asks for an uncached conversation to be followed", async () => {
    const denied = { kind: "backend_error", code: "CAPABILITY_DENIED", message: "no" };
    const { service } = setup(
      {},
      {
        list: vi.fn(async () => {
          throw { kind: "invalid_args", message: "before names no message" };
        }),
        get: vi.fn(async () => {
          throw denied;
        }),
      },
    );
    expect(
      (
        await rejection(
          service.call("p", "rim.chat.list_messages", { conversationId: PLAIN, before: "x" }, READ),
        )
      ).code,
    ).toBe(ErrorCode.INVALID_PARAMS);
    expect(
      (await rejection(service.call("p", "rim.chat.get_message", { messageId: "m" }, READ))).code,
    ).toBe(ErrorCode.CAPABILITY_DENIED);

    const { service: uncached, store } = setup({}, { list: vi.fn(async () => null) });
    const error = await rejection(
      uncached.call("p", "rim.chat.list_messages", { conversationId: PLAIN }, READ),
    );
    expect(error.data).toEqual({ reason: "notCached" });
    expect(store.follow).toHaveBeenCalledWith(WS, PLAIN);
  });

  it("answers reads with noCache where the app keeps no cache", async () => {
    const { service } = setup({ cache: () => null });
    const error = await rejection(
      service.call("p", "rim.chat.list_messages", { conversationId: PLAIN }, READ),
    );
    expect(error.data).toEqual({ reason: "noCache" });
  });

  it("checks params and the plain grants itself", async () => {
    const { service } = setup();
    for (const [method, params] of [
      ["rim.chat.list_messages", {}],
      ["rim.chat.list_messages", { conversationId: PLAIN, limit: 0 }],
      ["rim.chat.list_messages", { conversationId: PLAIN, limit: 101 }],
      ["rim.chat.get_message", {}],
      ["rim.chat.search_messages", { query: "" }],
      ["rim.chat.search_messages", { query: "x".repeat(501) }],
      ["rim.chat.list_messages", { conversationId: "unknown" }],
    ] as const) {
      expect((await rejection(service.call("p", method, params, READ_ALL))).code).toBe(
        ErrorCode.INVALID_PARAMS,
      );
    }
    expect(
      (await rejection(service.call("p", "rim.chat.list_messages", { conversationId: PLAIN }, [])))
        .code,
    ).toBe(ErrorCode.CAPABILITY_DENIED);
    expect((await rejection(service.call("p", "rim.chat.nope", {}, READ_ALL))).code).toBe(
      ErrorCode.METHOD_NOT_FOUND,
    );
  });
});

describe("the client message service: posting", () => {
  it("posts through the person's send path, encrypted where the conversation is", async () => {
    const { service, deps } = setup();
    expect(
      await service.call(
        "p",
        "rim.chat.post_message",
        { conversationId: ENCRYPTED, body: "hello", threadId: "t-1" },
        WRITE_ALL,
      ),
    ).toEqual({ id: "new-id" });
    expect(deps.post).toHaveBeenCalledWith({
      workspaceId: WS,
      conversationId: ENCRYPTED,
      body: "hello",
      threadId: "t-1",
      encrypted: true,
    });
    await service.call("p", "rim.chat.post_message", { conversationId: PLAIN, body: "hi" }, WRITE);
    expect(deps.post).toHaveBeenLastCalledWith({
      workspaceId: WS,
      conversationId: PLAIN,
      body: "hi",
      threadId: null,
      encrypted: false,
    });
  });

  it("refuses an encrypted conversation without chat.write.encrypted, and bad bodies", async () => {
    const { service, deps } = setup();
    const error = await rejection(
      service.call("p", "rim.chat.post_message", { conversationId: ENCRYPTED, body: "x" }, WRITE),
    );
    expect(error.message).toBe("capability denied: chat.write.encrypted");
    for (const body of ["", "   ", 7, "x".repeat(10_001)]) {
      expect(
        (
          await rejection(
            service.call("p", "rim.chat.post_message", { conversationId: PLAIN, body }, WRITE),
          )
        ).code,
      ).toBe(ErrorCode.INVALID_PARAMS);
    }
    expect(
      (
        await rejection(
          service.call("p", "rim.chat.post_message", { conversationId: PLAIN, body: "x" }, READ),
        )
      ).message,
    ).toBe("capability denied: chat.write");
    expect(deps.post).not.toHaveBeenCalled();
  });
});
