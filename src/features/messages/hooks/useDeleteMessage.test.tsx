import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { InfiniteData } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { CommandInitiator, CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { backendCommand, paletteInput, serveHostCommands } from "../../../test/clickCommands";
import type { MessagesPage } from "../../../core/types/messages";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";

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
import { useDeleteMessage } from "./useDeleteMessage";

const challenge = { token: "tok-1", argsHash: "hash-1", expiresAt: "2999-01-01T00:00:00Z" };
const held = {
  executeCommand: {
    status: "CONFIRMATION_REQUIRED",
    message: "confirmation required for dangerous command",
    payload: null,
    followUpCommands: [],
    confirmationRequired: challenge,
  },
};
const done = {
  executeCommand: { status: "SUCCESS", message: "deleted", payload: null, followUpCommands: [] },
};
const context = { workspaceId: "ws-1", conversationId: "conv-1", selectedMessageId: "msg-1" };
const DELETE = backendCommand("chat.delete_message", {
  title: "Delete Message",
  requiredContext: ["workspace", "conversation", "selected_message"],
  dangerous: true,
  sensitivity: CommandSensitivity.RESTRICTED,
});

/** Seeds the app's query client with the conversation's timeline and the server's commands. */
function seededClient() {
  const qc = queryClient;
  serveHostCommands("ws-1", [DELETE]);
  const page = {
    items: [{ id: "msg-1", text: "hello", isDeleted: false }],
    next: null,
    prev: null,
  } as unknown as MessagesPage;
  qc.setQueryData<InfiniteData<MessagesPage>>(queryKeys.messages("ws-1", "conv-1"), {
    pages: [page],
    pageParams: [null],
  });
  return qc;
}

function cachedMessage(qc: typeof queryClient) {
  return qc.getQueryData<InfiniteData<MessagesPage>>(queryKeys.messages("ws-1", "conv-1"))?.pages[0]
    ?.items[0];
}

function renderDelete() {
  return renderHook(() => useDeleteMessage("ws-1", "conv-1")).result;
}

function serveDelete(...answers: (() => unknown)[]) {
  let call = 0;
  routeRequests(requestMock, {
    "mutation ExecuteCommand": () => {
      const answer = answers[Math.min(call, answers.length - 1)]!;
      call += 1;
      return answer();
    },
  });
}

async function openedDialog() {
  await waitFor(() => expect(useConfirmationModalStore.getState().request).not.toBeNull());
  return useConfirmationModalStore.getState().request!;
}

describe("useDeleteMessage", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useConfirmationModalStore.getState().reset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("asks for confirmation, then removes the message only once the server deletes it", async () => {
    serveDelete(
      () => held,
      () => done,
    );
    const qc = seededClient();
    const result = renderDelete();

    let deleted: Promise<boolean> | undefined;
    act(() => {
      deleted = result.current("msg-1");
    });

    const request = await openedDialog();
    expect(request).toMatchObject({
      initiator: "user",
      commandId: "chat.delete_message",
      toolName: "Delete Message",
      sensitivity: CommandSensitivity.RESTRICTED,
      verb: null,
      token: "tok-1",
    });
    expect(cachedMessage(qc)?.isDeleted).toBe(false);

    act(() => useConfirmationModalStore.getState().approve());

    await expect(deleted).resolves.toBe(true);
    expect(cachedMessage(qc)?.isDeleted).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    // The palette sends the same command on the same message, apart from the initiator.
    const sent = callsTo(requestMock, "mutation ExecuteCommand");
    const palette = await paletteInput(DELETE, context);
    expect(sent).toEqual([
      { input: { ...palette, initiator: CommandInitiator.CONTEXT_MENU } },
      {
        input: {
          ...palette,
          initiator: CommandInitiator.CONTEXT_MENU,
          confirmation: { inBandToken: { token: "tok-1", argsHash: "hash-1" } },
        },
      },
    ]);
  });

  it("asks a moderator to type the verb and names the moderator consequence", async () => {
    serveDelete(
      () => held,
      () => done,
    );
    const qc = seededClient();
    const result = renderDelete();

    let deleted: Promise<boolean> | undefined;
    act(() => {
      deleted = result.current("msg-1", { asModerator: true });
    });

    const request = await openedDialog();
    expect(request.verb).toBeUndefined();
    expect(request.sensitivity).toBe(CommandSensitivity.RESTRICTED);
    expect(request.description).toMatch(/as a moderator/);
    act(() => useConfirmationModalStore.getState().approve());

    await expect(deleted).resolves.toBe(true);
    expect(cachedMessage(qc)?.isDeleted).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Message deleted");
  });

  it("records the message list's delete key as a keybind run", async () => {
    serveDelete(
      () => held,
      () => done,
    );
    seededClient();
    const result = renderDelete();

    let deleted: Promise<boolean> | undefined;
    act(() => {
      deleted = result.current("msg-1", { source: "key" });
    });
    await openedDialog();
    act(() => useConfirmationModalStore.getState().approve());

    await expect(deleted).resolves.toBe(true);
    expect(
      callsTo(requestMock, "mutation ExecuteCommand").map(
        (variables) => (variables.input as { initiator?: string }).initiator,
      ),
    ).toEqual([CommandInitiator.KEYBIND, CommandInitiator.KEYBIND]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the message and sends nothing more when the user cancels", async () => {
    serveDelete(() => held);
    const qc = seededClient();
    const result = renderDelete();

    let deleted: Promise<boolean> | undefined;
    act(() => {
      deleted = result.current("msg-1");
    });
    await openedDialog();
    act(() => useConfirmationModalStore.getState().reject());

    await expect(deleted).resolves.toBe(false);
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1);
    expect(cachedMessage(qc)?.isDeleted).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the message and shows the server's message when the delete fails", async () => {
    serveDelete(
      () => held,
      () => ({
        executeCommand: { status: "ERROR", message: "not yours", payload: null },
      }),
    );
    const qc = seededClient();
    const result = renderDelete();

    let deleted: Promise<boolean> | undefined;
    act(() => {
      deleted = result.current("msg-1");
    });
    await openedDialog();
    act(() => useConfirmationModalStore.getState().approve());

    await expect(deleted).resolves.toBe(false);
    expect(cachedMessage(qc)?.isDeleted).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Delete Message: not yours");
  });

  it("says the confirmation expired when the server calls the token stale", async () => {
    serveDelete(
      () => held,
      () => {
        throw graphqlError("CONFIRMATION_STALE", "confirmation expired or was already used");
      },
    );
    const qc = seededClient();
    const result = renderDelete();

    let deleted: Promise<boolean> | undefined;
    act(() => {
      deleted = result.current("msg-1");
    });
    await openedDialog();
    act(() => useConfirmationModalStore.getState().approve());

    await expect(deleted).resolves.toBe(false);
    expect(cachedMessage(qc)?.isDeleted).toBe(false);
    expect(toast.info).toHaveBeenCalledWith("Confirmation expired. Run the command again.");
  });
});
