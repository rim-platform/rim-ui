import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared mock state referenced from inside `vi.mock` factories below. `vi.mock` calls are
// hoisted above all other top-level code, so any outer variable a factory closes over must
// itself be declared via `vi.hoisted` — a plain `const`/`let` here would throw a
// TDZ ReferenceError the moment the (hoisted) factory runs.
const {
  setMainSurfaceMock,
  shellStateMock,
  invalidateQueriesMock,
  getQueryDataMock,
  toastErrorMock,
  safeInvokeMock,
} = vi.hoisted(() => ({
  setMainSurfaceMock: vi.fn(),
  shellStateMock: {
    selectedConversationId: null as string | null,
    isThreadOpen: false,
    selectedRootMessageId: null as string | null,
  },
  invalidateQueriesMock: vi.fn(),
  getQueryDataMock: vi.fn(() => null as unknown),
  toastErrorMock: vi.fn(),
  safeInvokeMock: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { error: toastErrorMock, success: vi.fn(), info: vi.fn() },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: safeInvokeMock,
}));

vi.mock("../../plugins/api/usePluginCommands", () => ({
  parsePluginCommandId: vi.fn(() => null),
}));

vi.mock("../../../core/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock stores with minimal implementations
vi.mock("../state/useCommandStore", () => ({
  useCommandStore: {
    getState: () => ({
      toggleCommandPalette: vi.fn(),
      openCommandPalette: vi.fn(),
    }),
  },
}));

vi.mock("../../../shell/state/useShellStore", () => ({
  useShellStore: {
    getState: () => ({
      setMainSurface: setMainSurfaceMock,
      get selectedConversationId() {
        return shellStateMock.selectedConversationId;
      },
      get isThreadOpen() {
        return shellStateMock.isThreadOpen;
      },
      get selectedRootMessageId() {
        return shellStateMock.selectedRootMessageId;
      },
      toggleSidebar: vi.fn(),
      closeThread: vi.fn(),
      mainSurface: { kind: "conversation" },
      lastClosedThreadId: null,
      openThreadForMessage: vi.fn(),
      setSelectedConversationId: vi.fn(),
      setShowNewChannelDialog: vi.fn(),
      setShowNewMessagePicker: vi.fn(),
    }),
  },
}));

vi.mock("../../messages/state/useSearchOverlayStore", () => ({
  useSearchOverlayStore: {
    getState: () => ({
      openWithScope: vi.fn(),
    }),
  },
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({
      workspaceId: "ws-1",
      setWorkspaceId: vi.fn(),
    }),
  },
}));

vi.mock("../../agent/state/useAgentStore", () => ({
  useAgentStore: {
    getState: () => ({
      open: vi.fn(),
    }),
  },
}));

vi.mock("../../conversations/state/useUnreadStore", () => ({
  useUnreadStore: {
    getState: () => ({
      counts: {},
      markAllRead: vi.fn(),
    }),
  },
}));

vi.mock("../../conversations/api/useMarkAsRead", () => ({
  MARK_ALL_AS_READ: "mutation MarkAllAsRead",
}));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn() },
}));

vi.mock("../../../core/query/queryClient", () => ({
  queryClient: {
    getQueryData: (key: unknown[]) => getQueryDataMock(key),
    invalidateQueries: (...args: unknown[]) => invalidateQueriesMock(...args),
  },
}));

vi.mock("../../../core/query/keys", () => ({
  queryKeys: {
    channels: () => ["channels"],
    conversations: () => ["conversations"],
    server: (serverId: string) => ["server", serverId],
    plugins: () => ["plugins"],
    threadByRoot: (...ids: unknown[]) => ["threadByRoot", ...ids],
  },
}));

import { dispatchCommand } from "./commandDispatcher";
import type { CommandDefinition } from "../types";
import { parsePluginCommandId } from "../../plugins/api/usePluginCommands";
import { isCancelledResult } from "../../plugins/runtime/pluginCommandInfo";
import { usePluginConfirmStore } from "../../plugins/state/usePluginConfirmStore";
import { webPluginHost } from "../../plugins/web/webPluginHost";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { graphqlError } from "../../conversations/__fixtures__/conversations";

function makeCommand(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: "workspace.open_settings",
    title: "Open Settings",
    description: "Open the settings page",
    category: "Workspace",
    sourceKind: "BUILT_IN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

describe("dispatchCommand", () => {
  const mockExecuteBackend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a local DesktopLocal command and returns success", async () => {
    const command = makeCommand({ id: "workspace.open_settings" });
    const result = await dispatchCommand(command, mockExecuteBackend);
    expect(result).toEqual({
      status: "SUCCESS",
      message: "Executed locally",
      payload: null,
      followUpCommands: [],
    });
    expect(mockExecuteBackend).not.toHaveBeenCalled();
  });

  it("returns error for unknown local command", async () => {
    const command = makeCommand({ id: "workspace.nonexistent_command" });
    const result = await dispatchCommand(command, mockExecuteBackend);
    expect(result?.status).toBe("ERROR");
    expect(result?.message).toContain("No local handler");
  });

  it("delegates Backend commands to executeBackend", async () => {
    const command = makeCommand({
      id: "backend.some_command",
      executionTarget: "BACKEND",
    });
    mockExecuteBackend.mockResolvedValueOnce({
      executeCommand: {
        status: "SUCCESS",
        message: "Done",
        payload: null,
        followUpCommands: [],
      },
    });

    const result = await dispatchCommand(command, mockExecuteBackend, {
      args: { foo: "bar" },
      commandContext: { workspaceId: "ws-1" },
    });

    expect(mockExecuteBackend).toHaveBeenCalledWith({
      commandId: "backend.some_command",
      args: { foo: "bar" },
      commandContext: { workspaceId: "ws-1" },
    });
    expect(result?.status).toBe("SUCCESS");
  });

  it("keeps a local confirmation off the backend call", async () => {
    const command = makeCommand({
      id: "backend.dangerous_cmd",
      executionTarget: "BACKEND",
      dangerous: true,
    });
    mockExecuteBackend.mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });

    await dispatchCommand(command, mockExecuteBackend, { confirmedDangerous: true });

    expect(mockExecuteBackend).toHaveBeenCalledTimes(1);
    expect(mockExecuteBackend.mock.calls[0][0]).not.toHaveProperty("confirmedDangerous");
  });
});

describe("backend commands the server holds for confirmation", () => {
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
  const proof = { inBandToken: { token: "tok-1", argsHash: "hash-1" } };
  const command = makeCommand({
    id: "admin.purge_channel",
    title: "Purge Channel",
    description: "Delete every message in the channel.",
    executionTarget: "BACKEND",
    dangerous: true,
    sensitivity: CommandSensitivity.RESTRICTED,
  });
  const mockExecuteBackend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteBackend.mockReset();
    useConfirmationModalStore.getState().reset();
  });

  async function openedDialog() {
    await vi.waitFor(() => expect(useConfirmationModalStore.getState().request).not.toBeNull());
    return useConfirmationModalStore.getState().request!;
  }

  it("opens the dialog and re-sends the same command with the challenge on confirm", async () => {
    mockExecuteBackend.mockResolvedValueOnce(held).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "Purged", payload: null, followUpCommands: [] },
    });

    const pending = dispatchCommand(command, mockExecuteBackend, {
      args: { channel: "general" },
      commandContext: { workspaceId: "ws-1" },
    });
    const request = await openedDialog();
    expect(request).toMatchObject({
      initiator: "user",
      commandId: "admin.purge_channel",
      toolName: "Purge Channel",
      description: "Delete every message in the channel.",
      args: { channel: "general" },
      sensitivity: CommandSensitivity.RESTRICTED,
      token: "tok-1",
    });
    useConfirmationModalStore.getState().approve();

    const result = await pending;
    expect(result?.status).toBe("SUCCESS");
    expect(mockExecuteBackend).toHaveBeenCalledTimes(2);
    expect(mockExecuteBackend.mock.calls[1][0]).toEqual({
      commandId: "admin.purge_channel",
      args: { channel: "general" },
      commandContext: { workspaceId: "ws-1" },
      confirmation: proof,
    });
    expect(mockExecuteBackend.mock.calls[0][0]).not.toHaveProperty("confirmation");
  });

  it("returns a cancelled result and sends nothing more when the user cancels", async () => {
    mockExecuteBackend.mockResolvedValueOnce(held);

    const pending = dispatchCommand(command, mockExecuteBackend);
    await openedDialog();
    useConfirmationModalStore.getState().reject();

    const result = await pending;
    expect(result?.status).toBe("ERROR");
    expect(isCancelledResult(result)).toBe(true);
    expect(mockExecuteBackend).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("tells the user a stale confirmation expired and lets them run it again", async () => {
    mockExecuteBackend
      .mockResolvedValueOnce(held)
      .mockRejectedValueOnce(
        graphqlError("CONFIRMATION_STALE", "confirmation expired or was already used"),
      );

    const pending = dispatchCommand(command, mockExecuteBackend);
    await openedDialog();
    useConfirmationModalStore.getState().approve();

    const result = await pending;
    expect(isCancelledResult(result)).toBe(true);
    expect(toastErrorMock).toHaveBeenCalledWith("Confirmation expired. Run the command again.");

    // Running it again starts a fresh challenge.
    mockExecuteBackend.mockResolvedValueOnce(held).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });
    const again = dispatchCommand(command, mockExecuteBackend);
    await openedDialog();
    useConfirmationModalStore.getState().approve();
    expect((await again)?.status).toBe("SUCCESS");
  });

  it("says the confirmation expired when the dialog timed out", async () => {
    mockExecuteBackend.mockResolvedValueOnce({
      executeCommand: {
        ...held.executeCommand,
        confirmationRequired: { ...challenge, expiresAt: "2000-01-01T00:00:00Z" },
      },
    });

    const pending = dispatchCommand(command, mockExecuteBackend);
    await openedDialog();
    useConfirmationModalStore.getState().reject();

    expect(isCancelledResult(await pending)).toBe(true);
    expect(mockExecuteBackend).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("Confirmation expired. Run the command again.");
  });

  it("never reports success for a held command that carries no challenge", async () => {
    mockExecuteBackend.mockResolvedValueOnce({
      executeCommand: { ...held.executeCommand, confirmationRequired: null },
    });

    const result = await dispatchCommand(command, mockExecuteBackend);

    expect(result).toMatchObject({
      status: "ERROR",
      message: "confirmation required for dangerous command",
    });
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("never reports success when the server holds the confirmed re-send again", async () => {
    mockExecuteBackend.mockResolvedValueOnce(held).mockResolvedValueOnce(held);

    const pending = dispatchCommand(command, mockExecuteBackend);
    await openedDialog();
    useConfirmationModalStore.getState().approve();

    expect((await pending)?.status).toBe("ERROR");
    expect(mockExecuteBackend).toHaveBeenCalledTimes(2);
  });
});

describe("plugin commands", () => {
  const mockExecuteBackend = vi.fn();
  const command = makeCommand({
    id: "plugin.dev.example.hello-world.greet",
    sourceKind: "PLUGIN",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parsePluginCommandId).mockReturnValueOnce({
      pluginId: "dev",
      command: "example.hello-world.greet",
    });
  });

  it("sends the command to the plugin host and returns its payload", async () => {
    safeInvokeMock.mockResolvedValueOnce({
      ok: true,
      value: { status: "ok", payload: "Hello, world!" },
    });

    const result = await dispatchCommand(command, mockExecuteBackend, {
      args: { name: "world" },
      confirmedDangerous: true,
      callerPluginId: null,
    });

    expect(safeInvokeMock).toHaveBeenCalledWith("plugin_execute_command", {
      pluginId: "dev",
      command: "example.hello-world.greet",
      args: { name: "world" },
      confirmedDangerous: true,
      callerPluginId: null,
    });
    expect(result).toEqual({
      status: "SUCCESS",
      message: "Plugin command executed",
      payload: "Hello, world!",
      followUpCommands: [],
    });
    expect(mockExecuteBackend).not.toHaveBeenCalled();
  });

  it("shows the plugin's own summary when it returns one", async () => {
    safeInvokeMock.mockResolvedValueOnce({
      ok: true,
      value: { status: "ok", payload: { restarted: 1 }, message: "Restarted 1 pod" },
    });

    const result = await dispatchCommand(command, mockExecuteBackend, { args: {} });

    expect(result?.status).toBe("SUCCESS");
    expect(result?.message).toBe("Restarted 1 pod");
    expect(result?.payload).toEqual({ restarted: 1 });
  });

  const refusal = {
    ok: false,
    error: {
      kind: "backend_error",
      code: "CONFIRMATION_REQUIRED",
      message: "command `restart_pod` is marked dangerous and needs confirmation",
    },
  };

  it("asks the user before running a command the host calls dangerous", async () => {
    safeInvokeMock
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce({ ok: true, value: { status: "ok", payload: null, message: "Done" } });

    const pending = dispatchCommand(command, mockExecuteBackend, { args: { pod: "web-1" } });
    await vi.waitFor(() => expect(usePluginConfirmStore.getState().request).not.toBeNull());
    expect(usePluginConfirmStore.getState().request).toEqual({
      pluginName: "A plugin",
      commandTitle: "plugin.dev.example.hello-world.greet",
      description: "",
      args: { pod: "web-1" },
    });
    usePluginConfirmStore.getState().confirm();

    expect((await pending)?.message).toBe("Done");
    expect(safeInvokeMock.mock.calls.map((call) => call[1].confirmedDangerous)).toEqual([
      false,
      true,
    ]);
  });

  it("runs nothing when the user cancels", async () => {
    safeInvokeMock.mockResolvedValueOnce(refusal);

    const pending = dispatchCommand(command, mockExecuteBackend);
    await vi.waitFor(() => expect(usePluginConfirmStore.getState().request).not.toBeNull());
    usePluginConfirmStore.getState().cancel();

    const result = await pending;
    expect(result?.status).toBe("ERROR");
    expect(isCancelledResult(result)).toBe(true);
    expect(safeInvokeMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the host's error message without the plugin error prefix", async () => {
    safeInvokeMock.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "backend_error",
        code: "PLUGIN_ERROR",
        message: "plugin error: Cannot reach the cluster",
      },
    });

    const result = await dispatchCommand(command, mockExecuteBackend);

    expect(result?.status).toBe("ERROR");
    expect(result?.message).toBe("Cannot reach the cluster");
    expect(usePluginConfirmStore.getState().request).toBeNull();
  });
});

describe("plugin commands that require a context", () => {
  const mockExecuteBackend = vi.fn();
  const pollId = "plugin.dev.example.polls.ask";
  const ok = { ok: true, value: { status: "ok", payload: null, message: "Posted" } };

  /** The cached plugin list, with the poll command requiring `requiredContext`. */
  function pluginList(requiredContext: string[]) {
    return [
      {
        display_name: "Polls",
        commands: [
          { id: "ask", qualified_id: pollId, title: "Ask", required_context: requiredContext },
        ],
      },
    ];
  }

  function serveCache(requiredContext: string[], thread: { id: string } | null = null) {
    getQueryDataMock.mockImplementation(((key: unknown[]) => {
      if (key[0] === "plugins") return pluginList(requiredContext);
      if (key[0] === "threadByRoot") return thread;
      return null;
    }) as () => unknown);
  }

  /** What the plugin host was sent as `args`. */
  function sentArgs(): unknown {
    return safeInvokeMock.mock.calls[0][1].args;
  }

  // The keybind and panel stubs carry no required context: the plugin list supplies it.
  const stub = makeCommand({ id: pollId, sourceKind: "PLUGIN" });

  beforeEach(() => {
    vi.clearAllMocks();
    getQueryDataMock.mockReset();
    getQueryDataMock.mockReturnValue(null);
    Object.assign(shellStateMock, {
      selectedConversationId: null,
      isThreadOpen: false,
      selectedRootMessageId: null,
    });
    vi.mocked(parsePluginCommandId).mockReturnValue({
      pluginId: "dev",
      command: "example.polls.ask",
    });
    safeInvokeMock.mockResolvedValue(ok);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds the open conversation, and no thread when none is open", async () => {
    serveCache(["conversation"]);
    shellStateMock.selectedConversationId = "conv-1";

    const result = await dispatchCommand(stub, mockExecuteBackend, {
      args: { question: "Lunch?" },
    });

    expect(result?.status).toBe("SUCCESS");
    expect(sentArgs()).toEqual({ question: "Lunch?", conversation_id: "conv-1" });
  });

  it("adds the id of the thread open beside the conversation", async () => {
    serveCache(["conversation"], { id: "thread-9" });
    Object.assign(shellStateMock, {
      selectedConversationId: "conv-1",
      isThreadOpen: true,
      selectedRootMessageId: "root-1",
    });

    await dispatchCommand(stub, mockExecuteBackend);

    expect(sentArgs()).toEqual({ conversation_id: "conv-1", thread_id: "thread-9" });
    expect(getQueryDataMock).toHaveBeenCalledWith(["threadByRoot", "ws-1", "conv-1", "root-1"]);
  });

  it("adds the message a context menu names, with its own thread rather than the open one", async () => {
    serveCache(["message"], { id: "thread-open" });
    Object.assign(shellStateMock, {
      selectedConversationId: "conv-1",
      isThreadOpen: true,
      selectedRootMessageId: "root-1",
    });

    await dispatchCommand(
      makeCommand({ id: pollId, requiredContext: ["message"] }),
      mockExecuteBackend,
      {
        commandContext: {
          workspaceId: "ws-1",
          conversationId: "conv-2",
          selectedMessageId: "msg-1",
          threadId: "thread-2",
        },
      },
    );

    expect(sentArgs()).toEqual({
      message_id: "msg-1",
      conversation_id: "conv-2",
      thread_id: "thread-2",
    });
  });

  it("adds the workspace", async () => {
    serveCache(["workspace"]);

    await dispatchCommand(stub, mockExecuteBackend, { commandContext: { workspaceId: "ws-1" } });

    expect(sentArgs()).toEqual({ workspace_id: "ws-1" });
  });

  it("replaces a caller's argument of the same name with the context's", async () => {
    serveCache(["conversation"]);
    shellStateMock.selectedConversationId = "conv-1";

    await dispatchCommand(stub, mockExecuteBackend, { args: { conversation_id: "conv-other" } });

    expect(sentArgs()).toEqual({ conversation_id: "conv-1" });
  });

  it("does not call the plugin without an open conversation", async () => {
    serveCache(["conversation"]);

    const result = await dispatchCommand(stub, mockExecuteBackend);

    expect(result).toMatchObject({ status: "ERROR", message: "Open a conversation first" });
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });

  it("does not call the plugin without a selected message", async () => {
    serveCache(["message"]);
    shellStateMock.selectedConversationId = "conv-1";

    const result = await dispatchCommand(stub, mockExecuteBackend);

    expect(result).toMatchObject({ status: "ERROR", message: "Select a message first" });
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });

  it("adds nothing for a command that requires no context", async () => {
    serveCache([]);
    shellStateMock.selectedConversationId = "conv-1";

    await dispatchCommand(stub, mockExecuteBackend, { args: { name: "world" } });

    expect(sentArgs()).toEqual({ name: "world" });
  });

  it("sends a web plugin the same arguments", async () => {
    serveCache(["conversation"]);
    shellStateMock.selectedConversationId = "conv-1";
    vi.spyOn(webPluginHost, "knows").mockReturnValue(true);
    const execute = vi
      .spyOn(webPluginHost, "execute")
      .mockResolvedValue({ payload: null, message: "Posted" });

    const result = await dispatchCommand(stub, mockExecuteBackend);

    expect(result?.message).toBe("Posted");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: { conversation_id: "conv-1" }, initiator: "user" }),
    );
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });
});
