import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { SearchMessageItem, SearchResultPage } from "./useSearchMessages";

const fetchPage = vi.hoisted(() => vi.fn());
vi.mock("./useSearchMessages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useSearchMessages")>()),
  fetchMessageSearchPage: (...args: unknown[]) => fetchPage(...args),
}));

import {
  ACROSS_MAX_WORKSPACES,
  searchOrder,
  searchWorkspace,
  useMessagesAcrossWorkspaces,
} from "./searchAcrossWorkspaces";

function item(id: string, serverId: string, sentAt: string): SearchMessageItem {
  return {
    id,
    serverId,
    conversationId: `conv-${id}`,
    conversationTitle: "general",
    conversationType: "CHANNEL",
    threadId: null,
    rootMessageId: null,
    authorId: "u-1",
    author: null,
    text: id,
    sentAt,
    rank: 1,
    headline: null,
  };
}

function page(items: SearchMessageItem[]): SearchResultPage {
  return { items, next: null, prev: null, pageInfo: { hasNext: false, hasPrev: false } };
}

/** A fetch that answers only when aborted, recording the signal it got. */
function hanging(signals: AbortSignal[]) {
  return (_id: string, _q: string, _limit: number, signal: AbortSignal) =>
    new Promise<SearchResultPage>((_, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Lets the 300 ms debounce pass. */
async function pause() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchPage.mockReset();
  fetchPage.mockResolvedValue(page([]));
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

describe("searchOrder", () => {
  it("puts the open workspace first, then the rest in rail order", () => {
    expect(searchOrder(["dm", "a", "b", "c"], "b")).toEqual(["b", "dm", "a", "c"]);
    expect(searchOrder(["dm", "a", "a"], null)).toEqual(["dm", "a"]);
  });
});

describe("useMessagesAcrossWorkspaces", () => {
  it("searches nothing below two characters, and asks for them", async () => {
    const { result, rerender } = renderHook(
      ({ q }) => useMessagesAcrossWorkspaces(q, ["a", "b"], true),
      { wrapper, initialProps: { q: "r" } },
    );
    await pause();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current.tooShort).toBe(true);

    rerender({ q: "re" });
    await pause();
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(result.current.tooShort).toBe(false);
  });

  it("waits for the pause in typing, skipping the texts typed on the way", async () => {
    const { rerender } = renderHook(({ q }) => useMessagesAcrossWorkspaces(q, ["a"], true), {
      wrapper,
      initialProps: { q: "" },
    });
    for (const q of ["re", "rel", "rele", "relea"]) {
      rerender({ q });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await pause();
    await waitFor(() => expect(fetchPage).toHaveBeenCalled());
    expect(fetchPage.mock.calls.map((call) => call[1])).toEqual(["relea"]);
  });

  it("aborts the requests still running when the text changes", async () => {
    const signals: AbortSignal[] = [];
    fetchPage.mockImplementation(hanging(signals));
    const { rerender } = renderHook(({ q }) => useMessagesAcrossWorkspaces(q, ["a", "b"], true), {
      wrapper,
      initialProps: { q: "re" },
    });
    await pause();
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals.every((s) => !s.aborted)).toBe(true);

    rerender({ q: "release" });
    await pause();
    await waitFor(() => expect(signals).toHaveLength(4));
    expect(signals.slice(0, 2).every((s) => s.aborted)).toBe(true);
    expect(signals.slice(2).every((s) => !s.aborted)).toBe(true);
  });

  it(`searches at most ${ACROSS_MAX_WORKSPACES} workspaces, starting with the first in order`, async () => {
    const ordered = Array.from({ length: 14 }, (_, i) => `ws-${i}`);
    const { result } = renderHook(() => useMessagesAcrossWorkspaces("release", ordered, true), {
      wrapper,
    });
    await pause();
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(ACROSS_MAX_WORKSPACES));
    expect(fetchPage.mock.calls.map((call) => call[0])).toEqual(ordered.slice(0, 10));
    expect(result.current).toMatchObject({ searchedCount: 10, total: 14 });
  });

  it("keeps the others' matches, newest first, when one workspace fails", async () => {
    fetchPage.mockImplementation(async (id: string) => {
      if (id === "b") throw new Error("Search is turned off");
      return page(
        id === "a"
          ? [item("a1", "a", "2026-11-07T09:00:00Z")]
          : [item("c1", "c", "2026-11-07T10:00:00Z")],
      );
    });
    const { result } = renderHook(
      () => useMessagesAcrossWorkspaces("release", ["a", "b", "c"], true),
      {
        wrapper,
      },
    );
    await pause();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.items.map((m) => m.id)).toEqual(["c1", "a1"]);
    expect(result.current.failed).toEqual(["b"]);
    // The failure is an answer, not an error the query cache reports.
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((q) => q.state.status === "success"),
    ).toBe(true);
  });

  it("searches nothing while the scope is one workspace", async () => {
    renderHook(() => useMessagesAcrossWorkspaces("release", ["a"], false), { wrapper });
    await pause();
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe("searchWorkspace", () => {
  it("counts a workspace that does not answer in time as failed", async () => {
    const signals: AbortSignal[] = [];
    fetchPage.mockImplementation(hanging(signals));
    const answer = searchWorkspace("slow", "release", undefined, 1_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    await expect(answer).resolves.toEqual({ failed: true });
    expect(signals[0].aborted).toBe(true);
  });

  it("times out a workspace whose transport ignores the abort, as another server's does", async () => {
    fetchPage.mockImplementation(() => new Promise<SearchResultPage>(() => {}));
    const answer = searchWorkspace("remote", "release", undefined, 1_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    await expect(answer).resolves.toEqual({ failed: true });
  });

  it("throws, rather than failing, when the caller aborts", async () => {
    const signals: AbortSignal[] = [];
    fetchPage.mockImplementation(hanging(signals));
    const controller = new AbortController();
    const answer = searchWorkspace("a", "release", controller.signal);
    controller.abort();
    await expect(answer).rejects.toThrow();
  });
});
