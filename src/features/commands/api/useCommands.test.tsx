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

describe("useExecuteCommandMutation — TIMED_OUT", () => {
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

describe("useExecuteCommandMutation variables", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });
  });

  it("sends no confirmedDangerous, even when a caller passes one", async () => {
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });
    const input = {
      commandId: "chat.delete_message",
      commandContext: { workspaceId: "ws-1", selectedMessageId: "msg-1" },
      confirmedDangerous: true,
    } as Parameters<typeof result.current.mutateAsync>[0];

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const variables = requestMock.mock.calls[0][1] as { input: Record<string, unknown> };
    expect(variables.input).not.toHaveProperty("confirmedDangerous");
    expect(variables.input.commandId).toBe("chat.delete_message");
  });
});
