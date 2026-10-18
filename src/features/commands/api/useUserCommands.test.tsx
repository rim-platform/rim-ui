import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryKeys } from "../../../core/query/keys";
import { createTestQueryClient } from "../../../test/utils";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  useDeleteUserCommandMutation,
  useUpdateUserCommandMutation,
  useUserCommand,
} from "./useUserCommands";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const saved = {
  id: "user.standup",
  title: "Standup",
  description: "Counts a standup",
  isEnabled: true,
  steps: [{ commandId: "state.incr", args: { key: "standups" } }],
};

describe("useUserCommand", () => {
  beforeEach(() => {
    requestMock.mockReset();
    client = createTestQueryClient();
  });

  it("fetches nothing without an id", () => {
    renderHook(() => useUserCommand(null), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("returns the saved command for its id", async () => {
    requestMock.mockResolvedValue({ userCommand: saved });
    const { result } = renderHook(() => useUserCommand("user.standup"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(saved);
    expect(requestMock).toHaveBeenCalledWith(expect.anything(), { id: "user.standup" });
  });

  it("answers null and refreshes the command lists when the command is gone", async () => {
    requestMock.mockResolvedValue({ userCommand: null });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUserCommand("user.gone"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["commands"] });
  });
});

describe("user command mutations", () => {
  beforeEach(() => {
    requestMock.mockReset();
    // Seeded entries have no observer, so they are kept instead of collected at once.
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(queryKeys.userCommand("user.standup"), saved);
    client.setQueryData(queryKeys.userCommands, [{ id: "user.standup", steps: [] }]);
  });

  it("invalidates the saved command and the list after an update", async () => {
    requestMock.mockResolvedValue({ updateUserCommand: { id: "user.standup" } });
    const { result } = renderHook(() => useUpdateUserCommandMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        commandId: "user.standup",
        title: "Standup",
        description: "Counts a standup",
        steps: [{ commandId: "state.incr" }],
        isEnabled: true,
      });
    });

    expect(client.getQueryState(queryKeys.userCommand("user.standup"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.userCommands)?.isInvalidated).toBe(true);
  });

  it("invalidates the saved command and the list after a delete", async () => {
    requestMock.mockResolvedValue({ deleteUserCommand: true });
    const { result } = renderHook(() => useDeleteUserCommandMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ commandId: "user.standup" });
    });

    expect(client.getQueryState(queryKeys.userCommand("user.standup"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.userCommands)?.isInvalidated).toBe(true);
  });
});
