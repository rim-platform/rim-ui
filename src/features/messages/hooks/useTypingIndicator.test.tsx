import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useTypingIndicator } from "./useTypingIndicator";

function renderIndicator() {
  const qc = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTypingIndicator("ws-1", "conv-1"), { wrapper }).result;
}

const starts = () => callsTo(requestMock, "mutation StartTyping");

describe("useTypingIndicator", () => {
  beforeEach(() => {
    requestMock.mockReset();
    routeRequests(requestMock, { "mutation StartTyping": () => ({ startTyping: true }) });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces typing at most once per three seconds", async () => {
    const result = renderIndicator();

    act(() => result.current.handleKeystroke("h"));
    act(() => result.current.handleKeystroke("he"));
    await waitFor(() => expect(starts()).toEqual([{ serverId: "ws-1", conversationId: "conv-1" }]));

    vi.setSystemTime(new Date("2026-10-13T10:00:03Z"));
    act(() => result.current.handleKeystroke("hel"));
    await waitFor(() => expect(starts()).toHaveLength(2));
  });

  it("announces the first keystroke after a sent message at once", async () => {
    const result = renderIndicator();
    act(() => result.current.handleKeystroke("hello"));
    await waitFor(() => expect(starts()).toHaveLength(1));

    act(() => result.current.markSent());
    act(() => result.current.handleKeystroke("n"));

    await waitFor(() => expect(starts()).toHaveLength(2));
  });

  it("announces nothing while the text is blank", async () => {
    const result = renderIndicator();

    act(() => result.current.handleKeystroke(""));
    act(() => result.current.handleKeystroke("   "));
    act(() => result.current.handleKeystroke("a"));

    await waitFor(() => expect(starts()).toHaveLength(1));
  });
});
