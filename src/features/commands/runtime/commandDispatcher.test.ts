import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
      setMainSurface: vi.fn(),
      selectedConversationId: null,
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
  queryClient: { getQueryData: vi.fn(() => null) },
}));

vi.mock("../../../core/query/keys", () => ({
  queryKeys: {
    channels: () => ["channels"],
    conversations: () => ["conversations"],
  },
}));

import { dispatchCommand } from "./commandDispatcher";
import type { CommandDefinition } from "../types";

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
      confirmedDangerous: undefined,
    });
    expect(result?.status).toBe("SUCCESS");
  });

  it("passes confirmedDangerous flag to backend", async () => {
    const command = makeCommand({
      id: "backend.dangerous_cmd",
      executionTarget: "BACKEND",
      dangerous: true,
    });
    mockExecuteBackend.mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });

    await dispatchCommand(command, mockExecuteBackend, { confirmedDangerous: true });

    expect(mockExecuteBackend).toHaveBeenCalledWith(
      expect.objectContaining({ confirmedDangerous: true }),
    );
  });
});
