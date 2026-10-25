import { describe, it, expect, vi, beforeEach } from "vitest";

import { BUS_EVENTS, type MessagesDecryptedEvent } from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";
import type { MlsSyncNote } from "../api/messageCache";

const applyCacheChangesMock = vi.fn();

vi.mock("../api/messageCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/messageCache")>()),
  applyCacheChanges: (...args: unknown[]) => applyCacheChangesMock(...args),
}));
vi.mock("../../e2ee/runtime/feedInputs", () => ({
  mlsInputsFor: vi.fn(async () => ({})),
}));

import { setE2eeNoteHandler, storeBackend } from "./messageCacheSync";

const account = { endpoint: "http://localhost:8080/api", userId: "u1" };

function note(conversationId: string, messageIds: string[]): MlsSyncNote {
  return {
    conversationId,
    stopped: null,
    verify: false,
    removed: false,
    misbehaved: false,
    decrypted: messageIds.map((messageId) => ({
      messageId,
      authorId: "u2",
      threadId: null,
      sentAt: "2026-10-25T18:00:00Z",
      body: "hi",
    })),
  };
}

describe("storeBackend", () => {
  beforeEach(() => {
    applyCacheChangesMock.mockReset();
    setE2eeNoteHandler(null);
  });

  it("announces the messages a page decrypted, once they are stored", async () => {
    applyCacheChangesMock.mockResolvedValue({
      next: null,
      e2ee: [note("c1", ["m1", "m2"]), note("c2", [])],
    });
    const seen: MessagesDecryptedEvent[] = [];
    const off = eventBus.on<MessagesDecryptedEvent>(BUS_EVENTS.MESSAGES_DECRYPTED, (e) =>
      seen.push(e),
    );

    await storeBackend(account).apply("ws-1", []);
    off();

    expect(seen).toEqual([{ workspaceId: "ws-1", conversationId: "c1", messageIds: ["m1", "m2"] }]);
  });

  it("announces nothing when there is no store", async () => {
    applyCacheChangesMock.mockResolvedValue(null);
    const listener = vi.fn();
    const off = eventBus.on(BUS_EVENTS.MESSAGES_DECRYPTED, listener);

    await storeBackend(account).apply("ws-1", []);
    off();

    expect(listener).not.toHaveBeenCalled();
  });
});
