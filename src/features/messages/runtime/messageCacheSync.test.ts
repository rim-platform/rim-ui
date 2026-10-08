import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { MessageChangesInput } from "../../../core/graphql/generated/schema-types";
import { ConversationChangesStatus } from "../../../core/graphql/generated/schema-types";
import type { FeedConversationChanges } from "../api/messageCache";
import {
  MAX_ROUNDS_PER_RUN,
  createCacheSyncScheduler,
  runCacheSync,
  type CacheSyncBackend,
} from "./messageCacheSync";

function input(...ids: string[]): MessageChangesInput {
  return {
    serverId: "ws-1",
    conversations: ids.map((conversationId) => ({ conversationId, after: null })),
    limit: 200,
  };
}

function answer(id: string, hasMore: boolean): FeedConversationChanges {
  return {
    conversationId: id,
    status: ConversationChangesStatus.OK,
    cursor: "1",
    hasMore,
    changes: [],
  };
}

/** A backend that asks for `pages` rounds, then reports nothing left. */
function pagingBackend(pages: number) {
  let left = pages;
  const backend: CacheSyncBackend = {
    begin: vi.fn(async () => (left > 0 ? input("c1") : null)),
    apply: vi.fn(async () => {
      left -= 1;
      return left > 0 ? input("c1") : null;
    }),
  };
  return backend;
}

describe("runCacheSync", () => {
  it("carries feed answers to the cache until it has nothing left to ask", async () => {
    const backend = pagingBackend(3);
    const feed = vi.fn(async (req: MessageChangesInput) => [
      answer(req.conversations[0].conversationId, true),
    ]);

    const result = await runCacheSync(backend, feed, "ws-1", ["c1"]);

    expect(result).toEqual({ rounds: 3, finished: true });
    expect(backend.begin).toHaveBeenCalledWith("ws-1", ["c1"]);
    expect(feed).toHaveBeenCalledTimes(3);
    expect(backend.apply).toHaveBeenLastCalledWith("ws-1", [answer("c1", true)]);
  });

  it("makes no request when the cache has nothing to sync", async () => {
    const backend = pagingBackend(0);
    const feed = vi.fn();

    expect(await runCacheSync(backend, feed, "ws-1")).toEqual({ rounds: 0, finished: true });
    expect(feed).not.toHaveBeenCalled();
  });

  it("stops at the round cap and reports the sync unfinished", async () => {
    const backend = pagingBackend(MAX_ROUNDS_PER_RUN + 5);
    const feed = vi.fn(async () => [answer("c1", true)]);

    const result = await runCacheSync(backend, feed, "ws-1");

    expect(result).toEqual({ rounds: MAX_ROUNDS_PER_RUN, finished: false });
  });

  it("propagates a feed failure without applying anything", async () => {
    const backend = pagingBackend(2);
    const feed = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(runCacheSync(backend, feed, "ws-1")).rejects.toThrow("Failed to fetch");
    expect(backend.apply).not.toHaveBeenCalled();
  });
});

describe("createCacheSyncScheduler", () => {
  const account = { endpoint: "http://localhost:8080/api", userId: "u1" };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(backend: CacheSyncBackend, feed = vi.fn(async () => [answer("c1", false)])) {
    const scheduler = createCacheSyncScheduler({
      getAccount: () => account,
      backendFor: () => backend,
      feed,
      debounceMs: 100,
      resumeDelayMs: 1_000,
    });
    return { scheduler, feed };
  }

  it("coalesces a burst of signals into one sync", async () => {
    const backend = pagingBackend(1);
    const { scheduler } = setup(backend);

    scheduler.request("ws-1", ["c1"]);
    scheduler.request("ws-1", ["c2"]);
    scheduler.request("ws-1", ["c1"]);
    await vi.advanceTimersByTimeAsync(100);

    expect(backend.begin).toHaveBeenCalledTimes(1);
    expect(backend.begin).toHaveBeenCalledWith("ws-1", ["c1", "c2"]);
  });

  it("a full sync request wins over single conversations", async () => {
    const backend = pagingBackend(1);
    const { scheduler } = setup(backend);

    scheduler.request("ws-1", ["c1"]);
    scheduler.request("ws-1");
    await vi.advanceTimersByTimeAsync(100);

    expect(backend.begin).toHaveBeenCalledWith("ws-1", undefined);
  });

  it("runs signals that arrive mid-sync right after it", async () => {
    let release: () => void = () => {};
    const backend: CacheSyncBackend = {
      begin: vi.fn(async () => input("c1")),
      apply: vi.fn(async () => null),
    };
    const feed = vi.fn(
      () =>
        new Promise<FeedConversationChanges[]>((resolve) => {
          release = () => resolve([answer("c1", false)]);
        }),
    );
    const { scheduler } = setup(backend, feed);

    scheduler.request("ws-1", ["c1"]);
    await vi.advanceTimersByTimeAsync(100);
    scheduler.request("ws-1", ["c2"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.begin).toHaveBeenNthCalledWith(1, "ws-1", ["c1"]);
    expect(backend.begin).toHaveBeenNthCalledWith(2, "ws-1", ["c2"]);
  });

  it("resumes a run that hit the round cap after a pause", async () => {
    const backend = pagingBackend(MAX_ROUNDS_PER_RUN + 1);
    const { scheduler } = setup(backend);

    scheduler.request("ws-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.begin).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000 + 100);
    expect(backend.begin).toHaveBeenCalledTimes(2);
    expect(backend.begin).toHaveBeenLastCalledWith("ws-1", []);
  });

  it("drops the queue when the feed fails and accepts new requests after", async () => {
    const backend = pagingBackend(5);
    const feed = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { scheduler } = setup(backend, feed);

    scheduler.request("ws-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(feed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(backend.begin).toHaveBeenCalledTimes(1);

    scheduler.request("ws-1", ["c1"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.begin).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a cache account (web app, signed out)", async () => {
    const backend = pagingBackend(1);
    const scheduler = createCacheSyncScheduler({
      getAccount: () => null,
      backendFor: () => backend,
      feed: vi.fn(),
      debounceMs: 0,
      resumeDelayMs: 0,
    });

    scheduler.request("ws-1");
    await vi.advanceTimersByTimeAsync(10);

    expect(backend.begin).not.toHaveBeenCalled();
  });
});
