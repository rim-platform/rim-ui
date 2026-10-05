import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { useTimeoutStore } from "../../workspaces/state/useTimeoutStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useExecuteCommandMutation } from "./useCommands";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function timedOutError(until: string) {
  return Object.assign(new Error("timed out (serialized)"), {
    response: {
      errors: [{ message: `timed out until ${until}`, extensions: { code: "TIMED_OUT", until } }],
    },
  });
}

describe("useExecuteCommandMutation — TIMED_OUT (Track 1.2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useTimeoutStore.setState({ byWorkspace: {} });
    useWorkspaceStore.setState({ workspaceId: "ws-active" });
  });

  it("records the timeout for the command's workspace so the composer shows the banner", async () => {
    const until = "2999-01-01T00:00:00Z";
    requestMock.mockRejectedValue(timedOutError(until));
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ commandId: "admin.kick", commandContext: { workspaceId: "ws-1" } })
        .catch(() => {});
    });
    expect(useTimeoutStore.getState().byWorkspace["ws-1"]?.until).toBe(until);
  });

  it("falls back to the active workspace when the command carries no context", async () => {
    const until = "2999-01-01T00:00:00Z";
    requestMock.mockRejectedValue(timedOutError(until));
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ commandId: "chat.pin" }).catch(() => {});
    });
    expect(useTimeoutStore.getState().byWorkspace["ws-active"]?.until).toBe(until);
  });

  it("records nothing for other failures", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ commandId: "chat.pin" }).catch(() => {});
    });
    expect(useTimeoutStore.getState().byWorkspace).toEqual({});
  });
});
