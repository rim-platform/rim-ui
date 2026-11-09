import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

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
import { runMacro } from "./runMacro";

const macro = {
  id: "macro-1",
  name: "Triage",
  steps: [{ commandId: "chat.mark_as_read", args: null }],
};

const challenge = { token: "tok-1", argsHash: "hash-1", expiresAt: "2999-01-01T00:00:00Z" };

/** Opens `conversationId` with the thread rooted at `rootId` loaded as `threadId`. */
function openLoadedThread(conversationId: string, rootId: string, threadId: string): void {
  useShellStore.getState().setSelectedConversationId(conversationId);
  useShellStore.getState().openThreadForMessage(rootId);
  queryClient.setQueryData(queryKeys.threadByRoot("ws-1", conversationId, rootId), {
    id: threadId,
  });
}

/** The `commandContext` of each `executeMacro` call, in order. */
function sentContexts(): unknown[] {
  return requestMock.mock.calls.map(
    ([, variables]) => (variables as { input: { commandContext: unknown } }).input.commandContext,
  );
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  useWorkspaceStore.getState().setWorkspaceId("ws-1");
});

afterEach(() => {
  useWorkspaceStore.getState().clearWorkspaceId();
  useShellStore.getState().reset();
  useConfirmationModalStore.getState().reset();
  queryClient.clear();
});

describe("runMacro context", () => {
  it("sends the open conversation, its open thread and the focused surface", async () => {
    requestMock.mockResolvedValue({ executeMacro: { status: "SUCCESS", message: "Done" } });
    openLoadedThread("conv-9", "msg-root-1", "thread-1");
    useShellStore.getState().setFocusedSurface("mainSurface");

    await runMacro(macro, "ws-1", undefined);

    expect(sentContexts()).toEqual([
      {
        workspaceId: "ws-1",
        conversationId: "conv-9",
        threadId: "thread-1",
        focusedSurface: "mainSurface",
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith('Macro "Triage" executed');
  });

  it("sends only the workspace when no conversation is open", async () => {
    requestMock.mockResolvedValue({ executeMacro: { status: "SUCCESS", message: "Done" } });

    await runMacro(macro, "ws-1", undefined);

    expect(sentContexts()).toEqual([{ workspaceId: "ws-1" }]);
  });

  it("sends only the workspace it runs in when another workspace is selected", async () => {
    requestMock.mockResolvedValue({ executeMacro: { status: "SUCCESS", message: "Done" } });
    openLoadedThread("conv-9", "msg-root-1", "thread-1");

    await runMacro(macro, "ws-2", undefined);

    expect(sentContexts()).toEqual([{ workspaceId: "ws-2" }]);
  });

  it("resends the first call's context with the proof, even after the user navigates", async () => {
    requestMock
      .mockResolvedValueOnce({
        executeMacro: {
          status: "CONFIRMATION_REQUIRED",
          message: "macro requires confirmation due to sensitivity tier",
          confirmationRequired: challenge,
        },
      })
      .mockResolvedValueOnce({ executeMacro: { status: "SUCCESS", message: "Done" } });
    openLoadedThread("conv-9", "msg-root-1", "thread-1");
    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (!state.request) return;
      useShellStore.getState().setSelectedConversationId("conv-other");
      state.approve();
    });

    try {
      await runMacro(macro, "ws-1", undefined);
    } finally {
      unsubscribe();
    }

    const expected = { workspaceId: "ws-1", conversationId: "conv-9", threadId: "thread-1" };
    expect(sentContexts()).toEqual([expected, expected]);
    expect(requestMock.mock.calls[1][1]).toEqual({
      input: {
        macroId: "macro-1",
        commandContext: expected,
        confirmation: { inBandToken: { token: "tok-1", argsHash: "hash-1" } },
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Macro "Triage" executed');
  });
});

describe("runMacro failure", () => {
  it("names the macro and shows the server's reason under it", async () => {
    requestMock.mockResolvedValue({
      executeMacro: { status: "ERROR", message: "macro `Triage` failed on a step" },
    });

    await runMacro(macro, "ws-1", undefined);

    expect(toast.error).toHaveBeenCalledWith('Macro "Triage" failed', {
      description: "macro `Triage` failed on a step",
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
