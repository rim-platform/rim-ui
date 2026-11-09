import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({ graphqlClient: { request } }));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { CommandInitiator } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import type { MessagesPage } from "../../../core/types/messages";
import { toast } from "../../../shared/toast";
import { graphqlError } from "../../conversations/__fixtures__/conversations";
import { backendCommand, COMMAND_OK, serveHostCommands } from "../../../test/clickCommands";
import { runPinCommand, runReactionCommand, type MessageTarget } from "./messageCommands";

const TARGET: MessageTarget = {
  workspaceId: "ws-1",
  conversationId: "c-1",
  selectedMessageId: "m-1",
};

/** Caches the conversation's timeline with message `m-1`, pinned or not. */
function serveMessage(isPinned: boolean) {
  queryClient.setQueryData<InfiniteData<MessagesPage>>(queryKeys.messages("ws-1", "c-1"), {
    pages: [{ items: [{ id: "m-1", isPinned } as MessagesPage["items"][number]] } as MessagesPage],
    pageParams: [null],
  });
}

function cachedPinned(): boolean | undefined {
  return queryClient.getQueryData<InfiniteData<MessagesPage>>(queryKeys.messages("ws-1", "c-1"))
    ?.pages[0].items[0].isPinned;
}

/** The input of the first `executeCommand` request sent. */
function firstRun(): Record<string, unknown> {
  const call = request.mock.calls.find(([document]) =>
    String(document).includes("mutation ExecuteCommand"),
  ) as [unknown, { input: Record<string, unknown> }] | undefined;
  if (!call) throw new Error("no command was sent");
  return call[1].input;
}

/** The documents of the requests sent, by their first line. */
function sentDocuments(): string[] {
  return request.mock.calls.map(([document]) => String(document).trim().split("\n")[0]);
}

beforeEach(() => {
  request.mockReset();
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("runReactionCommand", () => {
  it("toggles the reaction on that message without a toast", async () => {
    serveHostCommands("ws-1", [backendCommand("chat.toggle_reaction")]);
    request.mockImplementation(async (document: unknown) =>
      String(document).includes("query ServerInfo")
        ? { serverInfo: { version: "0.0.0", apiVersion: 1, features: [], capabilities: [] } }
        : { executeCommand: COMMAND_OK },
    );

    const outcome = await runReactionCommand(TARGET, "🎉", "button");

    expect(outcome.ok).toBe(true);
    expect(firstRun()).toMatchObject({
      commandId: "chat.toggle_reaction",
      args: { emoji: "🎉" },
      commandContext: { workspaceId: "ws-1", conversationId: "c-1", selectedMessageId: "m-1" },
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says why the server refused the reaction", async () => {
    serveHostCommands("ws-1", [
      backendCommand("chat.toggle_reaction", { title: "Toggle Reaction" }),
    ]);
    request.mockRejectedValue(
      graphqlError("VALIDATION", "at most 10 reactions per user on one message"),
    );

    const outcome = await runReactionCommand(TARGET, "👍", "menu");

    expect(outcome).toMatchObject({ ok: false, cancelled: false });
    expect(toast.error).toHaveBeenCalledWith(
      "Toggle Reaction: at most 10 reactions per user on one message",
    );
  });
});

describe("runPinCommand", () => {
  it("pins with the pin command as a keybind run, with its own toast", async () => {
    serveHostCommands("ws-1", [backendCommand("chat.pin_message")]);
    serveMessage(false);
    request.mockResolvedValue({ executeCommand: COMMAND_OK });

    await runPinCommand(TARGET, true, { source: "key", successToast: "Message pinned" });

    expect(firstRun()).toMatchObject({
      commandId: "chat.pin_message",
      initiator: CommandInitiator.KEYBIND,
    });
    expect(cachedPinned()).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Message pinned");
  });

  it("unpins with the mutation on a server without the unpin command, and puts it back on a failure", async () => {
    serveHostCommands("ws-1", [backendCommand("chat.pin_message")]);
    serveMessage(true);
    request.mockRejectedValue(graphqlError("FORBIDDEN", "not allowed"));

    const outcome = await runPinCommand(TARGET, false, { source: "menu" });

    expect(sentDocuments()).toEqual(["mutation UnpinMessage($input: UnpinMessageInput!) {"]);
    expect(outcome).toMatchObject({ ok: false });
    expect(cachedPinned()).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });
});
