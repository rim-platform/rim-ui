import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";

const request = vi.hoisted(() => vi.fn());
const capability = vi.hoisted(() => ({ listed: false }));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request },
}));

vi.mock("../../updater/api/serverCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../updater/api/serverCapabilities")>()),
  spaceHasCapability: vi.fn(async () => capability.listed),
  serverHasCapability: vi.fn(async () => capability.listed),
}));

vi.mock("../../conversations/api/useMarkAsRead", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../conversations/api/useMarkAsRead")>()),
  markWorkspaceRead: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import {
  CommandInitiator,
  CommandSensitivity,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { markWorkspaceRead } from "../../conversations/api/useMarkAsRead";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import type { MessagesPage } from "../../../core/types/messages";
import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useSelectedMessageStore } from "../../messages/state/useSelectedMessageStore";
import { spaceHasCapability } from "../../updater/api/serverCapabilities";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { CommandDefinition, CommandResult } from "../types";
import { dispatchCommand } from "./commandDispatcher";
import { resolveClickCommand, runCommandFromClick } from "./runFromClick";

const OK: CommandResult = {
  status: "SUCCESS",
  message: "done",
  payload: null,
  followUpCommands: [],
};

function command(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    sensitivity: CommandSensitivity.MUTATING,
    ...overrides,
  };
}

/** The `input` of each `executeCommand` request sent. */
function sentInputs(): Record<string, unknown>[] {
  return request.mock.calls.map(
    ([, variables]) => (variables as { input: Record<string, unknown> }).input,
  );
}

function servePalette(workspaceId: string, commands: CommandDefinition[]) {
  queryClient.setQueryData(queryKeys.commands("PALETTE", workspaceId), commands);
}

const SET_TOPIC = command("chat.set_topic");

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ executeCommand: OK });
  capability.listed = false;
  useWorkspaceStore.getState().setWorkspaceId("ws-1");
  servePalette("ws-1", [SET_TOPIC]);
});

afterEach(() => {
  queryClient.clear();
  useShellStore.getState().reset();
  useSelectedMessageStore.getState().clear();
  useWorkspaceStore.getState().clearWorkspaceId();
  useConfirmationModalStore.getState().reset();
  vi.clearAllMocks();
});

describe("runCommandFromClick", () => {
  it("sends a button's run as UI when the workspace's server lists it", async () => {
    capability.listed = true;
    useShellStore.getState().setSelectedConversationId("c-1");

    const outcome = await runCommandFromClick("chat.set_topic", { topic: "news" });

    expect(outcome).toEqual({ ok: true, result: OK });
    expect(spaceHasCapability).toHaveBeenCalledWith("ws-1", "command_initiator_ui");
    expect(sentInputs()).toEqual([
      {
        commandId: "chat.set_topic",
        args: { topic: "news" },
        commandContext: { workspaceId: "ws-1", conversationId: "c-1" },
        isPipe: undefined,
        initiator: CommandInitiator.UI,
      },
    ]);
  });

  it("names no initiator for a server that does not list it", async () => {
    await runCommandFromClick("chat.set_topic", { topic: "news" });

    expect(sentInputs()[0]).not.toHaveProperty("initiator");
  });

  it("sends a menu item's run as CONTEXT_MENU and a key's as KEYBIND", async () => {
    capability.listed = true;
    await runCommandFromClick("chat.set_topic", { topic: "a" }, { source: "menu" });
    await runCommandFromClick("chat.set_topic", { topic: "b" }, { source: "key" });

    expect(sentInputs().map((input) => input.initiator)).toEqual([
      CommandInitiator.CONTEXT_MENU,
      CommandInitiator.KEYBIND,
    ]);
    expect(spaceHasCapability).not.toHaveBeenCalled();
  });

  it("acts on its target, not on the open conversation or selected message", async () => {
    useShellStore.getState().setSelectedConversationId("c-1");
    useSelectedMessageStore
      .getState()
      .select({ workspaceId: "ws-1", conversationId: "c-1", messageId: "m-1" });
    servePalette("ws-2", [SET_TOPIC]);

    await runCommandFromClick(
      "chat.set_topic",
      { topic: "news" },
      { target: { workspaceId: "ws-2", conversationId: "c-9" } },
    );

    expect(sentInputs()[0].commandContext).toEqual({ workspaceId: "ws-2", conversationId: "c-9" });
  });

  it("runs the fallback when the server's loaded list lacks the command", async () => {
    const fallback = vi.fn(async () => {});

    const outcome = await runCommandFromClick(
      "chat.unpin_message",
      { message_id: "m-1" },
      { fallback, successToast: "Unpinned" },
    );

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Unpinned");
  });

  it("runs the command, not the fallback, when the server lists it", async () => {
    const fallback = vi.fn(async () => {});
    await runCommandFromClick("chat.set_topic", { topic: "news" }, { fallback });

    expect(fallback).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shows its own success text in place of the command's outcome", async () => {
    await runCommandFromClick("chat.set_topic", { topic: "news" }, { successToast: () => null });

    expect(toast.success).not.toHaveBeenCalled();
  });

  it("throws the server's refusal for a dialog that shows it", async () => {
    request.mockRejectedValue(new Error("Topic too long"));

    await expect(
      runCommandFromClick("chat.set_topic", { topic: "x" }, { throwOnError: true }),
    ).rejects.toThrow("Topic too long");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows a refusal with its error title and reports the failure", async () => {
    request.mockRejectedValue(new Error("Topic too long"));

    const outcome = await runCommandFromClick(
      "chat.set_topic",
      { topic: "x" },
      { errorTitle: "Edit topic" },
    );

    expect(outcome).toEqual({ ok: false, cancelled: false, message: "Topic too long" });
    expect(toast.error).toHaveBeenCalledWith("Edit topic: Topic too long");
  });
});

describe("a run its control already confirmed", () => {
  const HELD: CommandResult = {
    status: "CONFIRMATION_REQUIRED",
    message: "Confirm",
    payload: null,
    followUpCommands: [],
    confirmationRequired: {
      token: "tok",
      argsHash: "hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };

  beforeEach(() => {
    request
      .mockResolvedValueOnce({ executeCommand: HELD })
      .mockResolvedValueOnce({ executeCommand: OK });
  });

  it("is sent again with the challenge without the confirmation dialog", async () => {
    const open = vi.spyOn(useConfirmationModalStore.getState(), "open");

    const outcome = await runCommandFromClick(
      "chat.set_topic",
      { topic: "news" },
      { confirmed: true },
    );

    expect(open).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    expect(sentInputs()[1].confirmation).toEqual({
      inBandToken: { token: "tok", argsHash: "hash" },
    });
  });

  it("still asks for a RESTRICTED command", async () => {
    servePalette("ws-1", [command("admin.ban", { sensitivity: CommandSensitivity.RESTRICTED })]);

    const pending = runCommandFromClick("admin.ban", { user_id: "u-1" }, { confirmed: true });
    await vi.waitFor(() => expect(useConfirmationModalStore.getState().request).not.toBeNull());
    useConfirmationModalStore.getState().approve();

    expect((await pending).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("still asks when the command's sensitivity is unknown", async () => {
    queryClient.clear();
    servePalette("ws-1", []);
    queryClient.setQueryData(queryKeys.commands("KEYBIND_PICKER", "ws-1"), [
      command("chat.set_topic", { sensitivity: undefined }),
    ]);

    const pending = runCommandFromClick("chat.set_topic", { topic: "x" }, { confirmed: true });
    await vi.waitFor(() => expect(useConfirmationModalStore.getState().request).not.toBeNull());
    useConfirmationModalStore.getState().reject();

    expect(await pending).toEqual({ ok: false, cancelled: true, message: "" });
  });
});

describe("an app command a control of another workspace runs", () => {
  it("marks that workspace read, not the open one", async () => {
    await runCommandFromClick("chat.mark_all_as_read", undefined, {
      source: "menu",
      target: { workspaceId: "ws-2" },
    });

    expect(markWorkspaceRead).toHaveBeenCalledWith("ws-2");
  });

  it("opens that workspace's settings for its moderator", async () => {
    queryClient.setQueryData(queryKeys.server("ws-2"), {
      viewerRole: ServerMemberRoleGql.MODERATOR,
    });

    const outcome = await runCommandFromClick("workspace.open_workspace_settings", undefined, {
      source: "menu",
      target: { workspaceId: "ws-2" },
    });

    expect(outcome.ok).toBe(true);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "workspace" });
  });

  it("keeps the open workspace when the viewer does not moderate the other one", async () => {
    await runCommandFromClick("workspace.open_workspace_settings", undefined, {
      target: { workspaceId: "ws-2" },
    });

    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(toast.info).toHaveBeenCalledWith(
      "This is for the owners and moderators of this workspace.",
    );
  });
});

describe("resolveClickCommand", () => {
  it("finds the server's keybind list before its palette list", () => {
    const keybind = command("chat.set_topic", { title: "From keybinds" });
    queryClient.setQueryData(queryKeys.commands("KEYBIND_PICKER", "ws-1"), [keybind]);

    expect(resolveClickCommand("chat.set_topic", "ws-1").command.title).toBe("From keybinds");
  });

  it("sends a command it does not know to the server, chat.report_message included", () => {
    queryClient.clear();
    const resolved = resolveClickCommand("chat.report_message", "ws-1");

    expect(resolved.command.executionTarget).toBe("BACKEND");
    expect(resolved).toMatchObject({ hostLacks: false, unknown: true });
  });

  it("finds this app's own command without the server's lists", () => {
    const resolved = resolveClickCommand("workspace.toggle_zen_mode", "ws-1");

    expect(resolved.command.executionTarget).toBe("DESKTOP_LOCAL");
    expect(resolved.hostLacks).toBe(false);
  });
});

describe("the effects of a command, from the palette as from a click", () => {
  const PIN = command("chat.pin_message", { requiredContext: ["selected_message"] });

  function serveMessage(isPinned: boolean) {
    queryClient.setQueryData<InfiniteData<MessagesPage>>(queryKeys.messages("ws-1", "c-1"), {
      pages: [
        { items: [{ id: "m-1", isPinned } as MessagesPage["items"][number]] } as MessagesPage,
      ],
      pageParams: [null],
    });
  }

  function cachedPinned(): boolean | undefined {
    return queryClient.getQueryData<InfiniteData<MessagesPage>>(queryKeys.messages("ws-1", "c-1"))
      ?.pages[0].items[0].isPinned;
  }

  const context = {
    commandContext: { workspaceId: "ws-1", conversationId: "c-1", selectedMessageId: "m-1" },
  };

  it("shows a palette pin at once", async () => {
    serveMessage(false);
    let answer: (value: { executeCommand: CommandResult }) => void = () => {};
    const execute = vi.fn(
      () => new Promise<{ executeCommand: CommandResult }>((resolve) => (answer = resolve)),
    );

    const pending = dispatchCommand(PIN, execute, context);
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    expect(cachedPinned()).toBe(true);
    answer({ executeCommand: OK });

    expect((await pending)?.status).toBe("SUCCESS");
    expect(cachedPinned()).toBe(true);
  });

  it("puts the message back when the pin fails", async () => {
    serveMessage(false);
    const execute = vi.fn(async () => {
      throw new Error("not allowed");
    });

    await expect(dispatchCommand(PIN, execute, context)).rejects.toThrow("not allowed");
    expect(cachedPinned()).toBe(false);
  });

  it("puts the message back when the server refuses the pin", async () => {
    serveMessage(false);
    const execute = vi.fn(async () => ({
      executeCommand: { ...OK, status: "ERROR" as const, message: "no" },
    }));

    expect((await dispatchCommand(PIN, execute, context))?.status).toBe("ERROR");
    expect(cachedPinned()).toBe(false);
  });
});
