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
  activeIncidentState,
  onCallStoreState,
  featuresCache,
  toastErrorMock,
  safeInvokeMock,
} = vi.hoisted(() => ({
  setMainSurfaceMock: vi.fn(),
  shellStateMock: { selectedConversationId: null as string | null },
  invalidateQueriesMock: vi.fn(),
  getQueryDataMock: vi.fn(() => null as unknown),
  activeIncidentState: { getState: vi.fn() },
  onCallStoreState: { getState: vi.fn() },
  // Cached `workspaceFeatures` entries for ws-1 (Track 0.4); `undefined` = not cached yet.
  featuresCache: { value: undefined as unknown },
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
    getQueryData: (key: unknown[]) =>
      key[0] === "workspaceFeatures" ? featuresCache.value : getQueryDataMock(key),
    invalidateQueries: (...args: unknown[]) => invalidateQueriesMock(...args),
  },
}));

vi.mock("../../../core/query/keys", () => ({
  queryKeys: {
    channels: () => ["channels"],
    conversations: () => ["conversations"],
    activeIncident: (serverId: string, conversationId: string) => [
      "activeIncident",
      serverId,
      conversationId,
    ],
    incidentTimeline: (incidentId: string) => ["incidentTimeline", incidentId],
    server: (serverId: string) => ["server", serverId],
    workspaceFeatures: (serverId: string) => ["workspaceFeatures", serverId],
  },
}));

vi.mock("../../incidents/state/useIncidentStore", () => ({
  useIncidentStore: activeIncidentState,
}));

vi.mock("../../oncall/state/useOnCallStore", () => ({
  useOnCallStore: onCallStoreState,
}));

import { dispatchCommand } from "./commandDispatcher";
import type { CommandDefinition } from "../types";
import {
  ServerMemberRoleGql,
  WorkspaceFeature,
} from "../../../core/graphql/generated/schema-types";
import { FeatureDisabledError } from "../../../core/graphql/errors";
import { parsePluginCommandId } from "../../plugins/api/usePluginCommands";

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

describe("Track C1 builtins", () => {
  const mockExecuteBackend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    shellStateMock.selectedConversationId = null;
    activeIncidentState.getState.mockReturnValue({ activeIncident: null });
    onCallStoreState.getState.mockReturnValue({ openOverrideModal: vi.fn() });
    getQueryDataMock.mockReturnValue(null);
  });

  it("oncall.who opens the Incidents surface On-call sub-tab (no args needed)", async () => {
    const command = makeCommand({ id: "oncall.who", executionTarget: "BACKEND" });
    await dispatchCommand(command, mockExecuteBackend);
    expect(setMainSurfaceMock).toHaveBeenCalledWith({ kind: "incidents", tab: "oncall" });
    expect(mockExecuteBackend).not.toHaveBeenCalled();
  });

  it("oncall.take_shift opens the override modal for a Moderator", async () => {
    getQueryDataMock.mockReturnValue({ viewerRole: ServerMemberRoleGql.MODERATOR });
    const openOverrideModal = vi.fn();
    onCallStoreState.getState.mockReturnValue({ openOverrideModal });
    const command = makeCommand({ id: "oncall.take_shift", executionTarget: "BACKEND" });

    await dispatchCommand(command, mockExecuteBackend);

    expect(openOverrideModal).toHaveBeenCalled();
    expect(mockExecuteBackend).not.toHaveBeenCalled();
  });

  it("oncall.take_shift toasts and does not open the modal for a Guest", async () => {
    getQueryDataMock.mockReturnValue({ viewerRole: ServerMemberRoleGql.GUEST });
    const openOverrideModal = vi.fn();
    onCallStoreState.getState.mockReturnValue({ openOverrideModal });
    const command = makeCommand({ id: "oncall.take_shift", executionTarget: "BACKEND" });

    await dispatchCommand(command, mockExecuteBackend);

    expect(openOverrideModal).not.toHaveBeenCalled();
  });

  it("incident.ack is a no-op with a toast when there is no active incident", async () => {
    const command = makeCommand({ id: "incident.ack", executionTarget: "BACKEND" });
    await dispatchCommand(command, mockExecuteBackend);
    expect(mockExecuteBackend).not.toHaveBeenCalled();
  });

  it("incident.ack dispatches through the unified executeBackend path — single action, no fallback mutation", async () => {
    activeIncidentState.getState.mockReturnValue({ activeIncident: { id: "inc-1" } });
    shellStateMock.selectedConversationId = "conv-1";
    mockExecuteBackend.mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });
    const command = makeCommand({ id: "incident.ack", executionTarget: "BACKEND" });

    await dispatchCommand(command, mockExecuteBackend);
    // The handler dispatches asynchronously (fire-and-forget with toast feedback) — flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockExecuteBackend).toHaveBeenCalledWith({
      commandId: "incident.ack",
      args: { incidentId: "inc-1" },
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["activeIncident", "ws-1", "conv-1"],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["incidentTimeline", "inc-1"] });
  });

  it("incident.escalate dispatches through executeBackend with the active incident id", async () => {
    activeIncidentState.getState.mockReturnValue({ activeIncident: { id: "inc-1" } });
    shellStateMock.selectedConversationId = "conv-1";
    mockExecuteBackend.mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });
    const command = makeCommand({ id: "incident.escalate", executionTarget: "BACKEND" });

    await dispatchCommand(command, mockExecuteBackend);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockExecuteBackend).toHaveBeenCalledWith({
      commandId: "incident.escalate",
      args: { incidentId: "inc-1" },
    });
  });
});

describe("workspace feature gate (Track 0.4)", () => {
  const mockExecuteBackend = vi.fn();
  const incidentsOff = [{ feature: WorkspaceFeature.INCIDENTS, enabled: false, updatedAt: null }];
  const incidentsOn = [{ feature: WorkspaceFeature.INCIDENTS, enabled: true, updatedAt: null }];

  beforeEach(() => {
    vi.clearAllMocks();
    shellStateMock.selectedConversationId = "conv-1";
    activeIncidentState.getState.mockReturnValue({ activeIncident: { id: "inc-1" } });
    onCallStoreState.getState.mockReturnValue({ openOverrideModal: vi.fn() });
    getQueryDataMock.mockReturnValue(null);
    featuresCache.value = undefined;
  });

  it("refuses a desktop-local incident command when the cached flag is off", async () => {
    featuresCache.value = incidentsOff;
    const command = makeCommand({ id: "oncall.who", executionTarget: "BACKEND" });

    await expect(dispatchCommand(command, mockExecuteBackend)).rejects.toBeInstanceOf(
      FeatureDisabledError,
    );
    expect(setMainSurfaceMock).not.toHaveBeenCalled();
    expect(mockExecuteBackend).not.toHaveBeenCalled();
  });

  it("refuses a backend command tagged with a disabled feature before calling the server", async () => {
    featuresCache.value = incidentsOff;
    const command = makeCommand({
      id: "custom.page_oncall",
      executionTarget: "BACKEND",
      feature: WorkspaceFeature.INCIDENTS,
    });

    await expect(dispatchCommand(command, mockExecuteBackend)).rejects.toThrow(
      "Incidents and on-call are turned off for this workspace.",
    );
    expect(mockExecuteBackend).not.toHaveBeenCalled();
  });

  it("runs the command when the flag is on", async () => {
    featuresCache.value = incidentsOn;
    const command = makeCommand({ id: "oncall.who", executionTarget: "BACKEND" });
    await dispatchCommand(command, mockExecuteBackend);
    expect(setMainSurfaceMock).toHaveBeenCalledWith({ kind: "incidents", tab: "oncall" });
  });

  it("defers to the server when the flags are not cached yet", async () => {
    const command = makeCommand({ id: "oncall.who", executionTarget: "BACKEND" });
    await dispatchCommand(command, mockExecuteBackend);
    expect(setMainSurfaceMock).toHaveBeenCalledWith({ kind: "incidents", tab: "oncall" });
  });

  it("never gates commands outside a feature", async () => {
    featuresCache.value = incidentsOff;
    const command = makeCommand({
      id: "workspace.open_settings",
      executionTarget: "DESKTOP_LOCAL",
    });
    const result = await dispatchCommand(command, mockExecuteBackend);
    expect(result?.status).toBe("SUCCESS");
  });

  it("shows the server's FEATURE_DISABLED message when incident.ack is rejected", async () => {
    mockExecuteBackend.mockRejectedValueOnce({
      response: {
        errors: [
          {
            message: "The incidents feature is disabled for this workspace",
            extensions: { code: "FEATURE_DISABLED", feature: "incidents" },
          },
        ],
      },
    });
    const command = makeCommand({ id: "incident.ack", executionTarget: "BACKEND" });

    await dispatchCommand(command, mockExecuteBackend);
    await Promise.resolve();
    await Promise.resolve();

    expect(toastErrorMock).toHaveBeenCalledWith(
      "The incidents feature is disabled for this workspace",
    );
  });

  it("keeps the generic message for other incident.ack failures", async () => {
    mockExecuteBackend.mockRejectedValueOnce(new Error("network down"));
    const command = makeCommand({ id: "incident.ack", executionTarget: "BACKEND" });

    await dispatchCommand(command, mockExecuteBackend);
    await Promise.resolve();
    await Promise.resolve();

    expect(toastErrorMock).toHaveBeenCalledWith("Failed to acknowledge incident");
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

  it("surfaces the host's error message", async () => {
    safeInvokeMock.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "backend_error",
        code: "CONFIRMATION_REQUIRED",
        message: "command `restart_pod` is marked dangerous and needs confirmation",
      },
    });

    const result = await dispatchCommand(command, mockExecuteBackend);

    expect(safeInvokeMock).toHaveBeenCalledWith(
      "plugin_execute_command",
      expect.objectContaining({ confirmedDangerous: false }),
    );
    expect(result?.status).toBe("ERROR");
    expect(result?.message).toContain("needs confirmation");
  });
});
