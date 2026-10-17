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
import { useShellStore } from "../../../shell/state/useShellStore";

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

describe("KeybindProvider with a plugin panel bound on this device", () => {
  const POD_PANEL = "workspace.open_plugin_panel.chat.rim.k8s-pods/pods";

  beforeEach(() => {
    vi.clearAllMocks();
    useDeviceKeybindStore.setState({ keybinds: [] });
    useDeviceKeybindStore
      .getState()
      .add({ keystroke: "Ctrl+Alt+P", commandId: POD_PANEL, context: "GLOBAL" });
  });

  it("opens the panel quietly", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue({
      status: "SUCCESS",
      message: "",
      payload: null,
      followUpCommands: [],
    });
    render(
      <KeybindProvider>
        <div />
      </KeybindProvider>,
    );
    pressCtrlAltP();

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dispatchCommand).mock.calls[0][0]).toMatchObject({
      id: POD_PANEL,
      executionTarget: "DESKTOP_LOCAL",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says why a panel could not open", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue({
      status: "ERROR",
      message: "The plugin with this panel is not running",
      payload: null,
      followUpCommands: [],
    });
    render(
      <KeybindProvider>
        <div />
      </KeybindProvider>,
    );
    pressCtrlAltP();

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The plugin with this panel is not running"),
    );
  });
});

describe("KeybindProvider with the default profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDeviceKeybindStore.setState({ keybinds: [] });
    vi.mocked(dispatchCommand).mockResolvedValue(null);
  });

  function renderWith(children: React.ReactNode) {
    return render(<KeybindProvider>{children}</KeybindProvider>);
  }

  function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  function dispatched(): string[] {
    return vi.mocked(dispatchCommand).mock.calls.map(([command]) => command.id);
  }

  it("opens the shortcuts panel on ? and Ctrl+/ outside a text field", () => {
    renderWith(<button>x</button>);
    press(document.body, "?", { shiftKey: true });
    press(document.body, "/", { ctrlKey: true });
    expect(dispatched()).toEqual(["workspace.show_shortcuts", "workspace.show_shortcuts"]);
  });

  it("lets a text field keep the characters typed into it, ? included", () => {
    const { getByRole } = renderWith(<textarea aria-label="composer" />);
    const field = getByRole("textbox");
    field.focus();
    const event = press(field, "?", { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("leaves word jumps and redo to a text field", () => {
    const { getByRole } = renderWith(<input aria-label="field" />);
    const field = getByRole("textbox");
    field.focus();
    expect(press(field, "ArrowLeft", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(field, "z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("still runs a modifier shortcut from inside a text field", () => {
    const { getByRole } = renderWith(<input aria-label="field" />);
    const field = getByRole("textbox");
    field.focus();
    expect(press(field, "k", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatched()).toEqual(["workspace.open_command_palette"]);
  });

  it("runs the pane commands on Ctrl+arrows outside a text field", () => {
    renderWith(<div />);
    press(document.body, "ArrowLeft", { ctrlKey: true });
    press(document.body, "ArrowRight", { ctrlKey: true });
    expect(dispatched()).toEqual([
      "workspace.navigate_panel_left",
      "workspace.navigate_panel_right",
    ]);
  });

  it("matches a two-modifier default however the modifiers were written", () => {
    renderWith(<div />);
    press(document.body, "ArrowDown", { altKey: true, shiftKey: true });
    expect(dispatched()).toEqual(["workspace.next_unread_channel"]);
  });

  it("leaves Escape to an open dialog instead of closing the surface behind it", () => {
    const shell = useShellStore.getState() as unknown as { mainSurface: { kind: string } };
    shell.mainSurface = { kind: "settings" };
    try {
      const { rerender } = renderWith(<div role="dialog" aria-label="Delete keybind?" />);
      press(document.body, "Escape");
      expect(dispatchCommand).not.toHaveBeenCalled();

      rerender(
        <KeybindProvider>
          <div />
        </KeybindProvider>,
      );
      press(document.body, "Escape");
      expect(dispatched()).toEqual(["workspace.close_panel"]);
    } finally {
      shell.mainSurface = { kind: "conversation" };
    }
  });
});
