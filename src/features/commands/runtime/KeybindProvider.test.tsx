import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// ─── Lean mocks: the provider only needs its keybinds and the dispatcher ──────

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceLocalKeybinds: true } }),
}));

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(() => ({ data: [] })),
}));

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: [] })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("./commandDispatcher", () => ({
  dispatchCommand: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../shell/state/useShellStore", () => {
  const state = {
    focusedSurface: null,
    isThreadOpen: false,
    mainSurface: { kind: "conversation" },
  };
  const useShellStore = (selector: (s: typeof state) => unknown) => selector(state);
  useShellStore.getState = () => state;
  return { useShellStore };
});

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

vi.mock("../state/useCommandStore", () => ({
  useCommandStore: { getState: () => ({ isCommandPaletteOpen: false }) },
}));

vi.mock("../../messages/state/useSearchOverlayStore", () => ({
  useSearchOverlayStore: { getState: () => ({ isOpen: false }) },
}));

vi.mock("../../agent/state/useAgentStore", () => ({
  useAgentStore: { getState: () => ({ isOpen: false }) },
}));

vi.mock("../../plugins/runtime/pluginCommandInfo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/runtime/pluginCommandInfo")>()),
  findPluginCommand: vi.fn((id: string) =>
    id === REFRESH
      ? {
          id: "refresh",
          qualified_id: REFRESH,
          title: "Refresh pods",
          description: "",
          keybind_capable: true,
          dangerous: false,
          ai_callable: true,
          arguments: [],
          pluginName: "Kubernetes Pods",
        }
      : null,
  ),
}));

import { KeybindProvider } from "./KeybindProvider";
import { dispatchCommand } from "./commandDispatcher";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { toast } from "../../../shared/toast";

const REFRESH = "plugin.chat.rim.k8s-pods.refresh";

function pressCtrlAltP() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "p", ctrlKey: true, altKey: true, bubbles: true }),
  );
}

describe("KeybindProvider with a plugin command bound on this device", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDeviceKeybindStore.setState({ keybinds: [] });
    useDeviceKeybindStore
      .getState()
      .add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL" });
  });

  it("runs the plugin command from the key and shows its answer", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue({
      status: "SUCCESS",
      message: "3 pods in shop (kind-dev)",
      payload: { pods: [] },
      followUpCommands: [],
    });
    render(
      <KeybindProvider>
        <div />
      </KeybindProvider>,
    );
    pressCtrlAltP();

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    const [command] = vi.mocked(dispatchCommand).mock.calls[0];
    expect(command).toMatchObject({
      id: REFRESH,
      title: "Refresh pods",
      sourceKind: "PLUGIN",
      executionTarget: "DESKTOP_LOCAL",
    });
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Refresh pods: 3 pods in shop (kind-dev)"),
    );
  });

  it("does nothing for a binding the user turned off", () => {
    const [kb] = useDeviceKeybindStore.getState().keybinds;
    useDeviceKeybindStore.getState().update(kb.id, { isEnabled: false });
    render(
      <KeybindProvider>
        <div />
      </KeybindProvider>,
    );
    pressCtrlAltP();
    expect(dispatchCommand).not.toHaveBeenCalled();
  });
});
