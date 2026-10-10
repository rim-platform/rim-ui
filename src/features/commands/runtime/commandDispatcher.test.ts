import { describe, it, expect, vi, beforeEach } from "vitest";

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
  shellStateMock: { selectedConversationId: null as string | null },
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
      isThreadOpen: false,
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
  },
}));

import { dispatchCommand } from "./commandDispatcher";
import type { CommandDefinition } from "../types";
import { parsePluginCommandId } from "../../plugins/api/usePluginCommands";
import { isCancelledResult } from "../../plugins/runtime/pluginCommandInfo";
import { usePluginConfirmStore } from "../../plugins/state/usePluginConfirmStore";

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
