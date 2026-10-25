import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { BUS_EVENTS, type MessagesDecryptedEvent } from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";

const storeAccountMock = vi.fn((): unknown => null);
const readCachedMessageMock = vi.fn();

vi.mock("../../messages/api/messageCache", () => ({
  encryptedStoreAccount: () => storeAccountMock(),
  readCachedMessage: (...args: unknown[]) => readCachedMessageMock(...args),
}));

import { DECRYPT_WAIT_MS, storedTextSoon } from "./storedText";

const account = { endpoint: "http://localhost:8080/api", userId: "me" };

function decrypted(messageIds: string[]) {
  eventBus.emit<MessagesDecryptedEvent>(BUS_EVENTS.MESSAGES_DECRYPTED, {
    workspaceId: "ws-1",
    conversationId: "c1",
    messageIds,
  });
}

describe("storedTextSoon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storeAccountMock.mockReset().mockReturnValue(account);
    readCachedMessageMock.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers at once when the store already holds the message decrypted", async () => {
    readCachedMessageMock.mockResolvedValue({
      id: "m1",
      text: "hi",
      e2ee: { status: "decrypted" },
    });
    await expect(storedTextSoon("m1")).resolves.toBe("hi");
  });

  it("waits for the message to be decrypted, ignoring other messages", async () => {
    const text = storedTextSoon("m1");
    await vi.advanceTimersByTimeAsync(0);

    readCachedMessageMock.mockImplementation(async (_account: unknown, id: string) =>
      id === "m1" ? { id, text: "the plan", e2ee: { status: "decrypted" } } : null,
    );
    decrypted(["m0"]);
    decrypted(["m1"]);

    await expect(text).resolves.toBe("the plan");
  });

  it("gives up once the sync that carried it could not decrypt it", async () => {
    const text = storedTextSoon("m1");
    await vi.advanceTimersByTimeAsync(0);
    readCachedMessageMock.mockResolvedValue({
      id: "m1",
      text: "",
      e2ee: { status: "undecryptable" },
    });
    decrypted(["m1"]);
    await expect(text).resolves.toBeNull();
  });

  it("gives up after the wait", async () => {
    const text = storedTextSoon("m1");
    await vi.advanceTimersByTimeAsync(DECRYPT_WAIT_MS);
    await expect(text).resolves.toBeNull();
  });

  it("does not wait on a device without a store", async () => {
    storeAccountMock.mockReturnValue(null);
    await expect(storedTextSoon("m1")).resolves.toBeNull();
    expect(readCachedMessageMock).not.toHaveBeenCalled();
  });
});
