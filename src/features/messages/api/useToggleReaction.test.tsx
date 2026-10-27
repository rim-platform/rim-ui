import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { graphqlError } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { useToggleReactionMutation } from "./useToggleReaction";

function renderMutation() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useToggleReactionMutation(), { wrapper }).result;
}

describe("useToggleReactionMutation", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it("tells why the server refused a reaction in a toast", async () => {
    requestMock.mockRejectedValue(
      graphqlError("VALIDATION", "at most 10 reactions per user on one message"),
    );
    const result = renderMutation();

    act(() => {
      result.current.mutate({
        serverId: "ws-1",
        conversationId: "conv-1",
        messageId: "msg-1",
        emoji: "👍",
      });
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The reaction could not be changed", {
        description: "At most 10 reactions per user on one message.",
      }),
    );
  });
});
