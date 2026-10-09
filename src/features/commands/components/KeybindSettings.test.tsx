import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(),
}));

vi.mock("../../workspaces/hooks/useFeatureEnabled", () => ({
  useIsCommandAvailable: () => (commandId: string) => !commandId.startsWith("incident."),
}));

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(),
}));

vi.mock("../../plugins/api/usePluginCommands", () => ({
  usePluginCommands: vi.fn(() => []),
}));

vi.mock("../../plugins/api/usePluginKeybinds", () => ({
  usePluginSuggestedKeybinds: vi.fn(() => []),
}));

const createKeybind = vi.fn();

vi.mock("../api/useKeybindSettings", () => ({
  useCreateKeybindMutation: vi.fn(() => ({
    mutate: createKeybind,
    isPending: false,
    isError: false,
  })),
  useUpdateKeybindMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteKeybindMutation: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { useResolvedKeybinds } from "../api/useKeybinds";
import { useCommands } from "../api/useCommands";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { usePluginSuggestedKeybinds } from "../../plugins/api/usePluginKeybinds";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { KeybindSettings } from "./KeybindSettings";
import type { ResolvedKeybind } from "../types";
import type { CommandDefinition } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKeybind(overrides: Partial<ResolvedKeybind> = {}): ResolvedKeybind {
  return {
    id: "kb-1",
    keystroke: "Ctrl+K",
    commandId: "workspace.open_command_palette",
    context: "GLOBAL",
    source: "DEFAULT",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
    ...overrides,
  };
}

function makeCommand(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: "workspace.open_command_palette",
    title: "Open Command Palette",
    description: "Opens the command palette",
    category: "workspace",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: false, // intentionally excluded from PALETTE surface
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KeybindSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a loading state when keybinds are loading", () => {
    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useCommands>);

    render(<KeybindSettings />);
    expect(screen.getByText(/loading keybinds/i)).toBeInTheDocument();
  });

  /**
   * Regression guard: the title map must be built from the KEYBIND_PICKER
   * surface so that commands excluded from PALETTE (like
   * `workspace.open_command_palette`) still resolve to a human-readable title.
   *
   * Before the fix: useCommands() defaulted to "PALETTE" which filters out
   * commands with `visible_in_palette: false`, causing the title to fall back
   * to the raw command ID.
   */
  it("calls useCommands with the KEYBIND_PICKER surface", () => {
    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useCommands>);

    render(<KeybindSettings />);

    expect(useCommands).toHaveBeenCalledWith("KEYBIND_PICKER");
  });

  it("displays the human-readable title for a command that is not in the PALETTE surface", () => {
    const keybind = makeKeybind();
    const command = makeCommand(); // visibleInPalette: false

    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [keybind],
      isLoading: false,
    } as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: [command],
      isLoading: false,
    } as ReturnType<typeof useCommands>);

    render(<KeybindSettings />);

    // Title from the command definition must appear, not the raw ID
    expect(screen.getByText("Open Command Palette")).toBeInTheDocument();
    expect(screen.queryByText("workspace.open_command_palette")).not.toBeInTheDocument();
  });

  it("falls back to the raw command ID when a command is absent from the title map", () => {
    const keybind = makeKeybind({ commandId: "unknown.command" });

    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [keybind],
      isLoading: false,
    } as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: [], // no entry for "unknown.command"
      isLoading: false,
    } as ReturnType<typeof useCommands>);

    render(<KeybindSettings />);

    // Fallback: raw ID shown when command is truly missing
    expect(screen.getByText("unknown.command")).toBeInTheDocument();
  });

  it("renders the keybind list with keystroke and title", () => {
    const keybind = makeKeybind({ keystroke: "Ctrl+K" });
    const command = makeCommand({ title: "Open Command Palette" });

    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [keybind],
      isLoading: false,
    } as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: [command],
      isLoading: false,
    } as ReturnType<typeof useCommands>);

    render(<KeybindSettings />);

    expect(screen.getByText("Ctrl+K")).toBeInTheDocument();
    expect(screen.getByText("Open Command Palette")).toBeInTheDocument();
  });

  it("hides bindings to commands of a workspace feature that is off", () => {
    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [
        makeKeybind(),
        makeKeybind({ id: "kb-2", keystroke: "Ctrl+Shift+A", commandId: "incident.ack" }),
      ],
      isLoading: false,
    } as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: [makeCommand()],
      isLoading: false,
    } as ReturnType<typeof useCommands>);

    render(<KeybindSettings />);

    expect(screen.getByText("Open Command Palette")).toBeInTheDocument();
    expect(screen.queryByText("incident.ack")).not.toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Shift+A")).not.toBeInTheDocument();
  });

  describe("plugin commands", () => {
    const REFRESH = "plugin.chat.rim.k8s-pods.refresh";

    beforeEach(() => {
      useDeviceKeybindStore.setState({ keybinds: [] });
      vi.mocked(useResolvedKeybinds).mockReturnValue({
        data: [makeKeybind()],
        isLoading: false,
      } as ReturnType<typeof useResolvedKeybinds>);
      vi.mocked(useCommands).mockReturnValue({
        data: [makeCommand()],
        isLoading: false,
      } as ReturnType<typeof useCommands>);
      vi.mocked(usePluginCommands).mockReturnValue([
        {
          ...makeCommand({
            id: REFRESH,
            title: "Refresh pods",
            category: "Kubernetes Pods",
            sourceKind: "PLUGIN",
            executionTarget: "DESKTOP_LOCAL",
            visibleInPalette: true,
          }),
          contextTypes: [],
        },
      ]);
    });

    it("binds a key to a plugin command on this device, not on the server", () => {
      render(<KeybindSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));
      fireEvent.keyDown(screen.getByPlaceholderText("Press a key combination..."), {
        key: "p",
        ctrlKey: true,
        altKey: true,
      });
      const commandSelect = screen.getAllByRole("combobox")[0];
      expect(within(commandSelect).getByText("Refresh pods")).toBeInTheDocument();
      fireEvent.change(commandSelect, { target: { value: REFRESH } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(createKeybind).not.toHaveBeenCalled();
      expect(useDeviceKeybindStore.getState().keybinds).toMatchObject([
        { keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL", isEnabled: true },
      ]);
      expect(screen.getByText("Refresh pods")).toBeInTheDocument();
      expect(screen.getByText("This device")).toBeInTheDocument();
    });

    it("still saves a built-in command's keybind on the server", () => {
      render(<KeybindSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));
      fireEvent.keyDown(screen.getByPlaceholderText("Press a key combination..."), {
        key: "j",
        ctrlKey: true,
      });
      fireEvent.change(screen.getAllByRole("combobox")[0], {
        target: { value: "workspace.open_command_palette" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(createKeybind).toHaveBeenCalledWith(
        expect.objectContaining({
          keystroke: "Ctrl+J",
          commandId: "workspace.open_command_palette",
        }),
        expect.anything(),
      );
      expect(useDeviceKeybindStore.getState().keybinds).toEqual([]);
    });

    it("assigns a plugin's suggested keybind on this device", () => {
      vi.mocked(usePluginSuggestedKeybinds).mockReturnValue([
        {
          pluginId: "chat.rim.k8s-pods",
          pluginName: "Kubernetes Pods",
          commandId: REFRESH,
          commandTitle: "Refresh pods",
          keystroke: "Ctrl+Alt+P",
          context: "GLOBAL",
        },
      ]);
      render(<KeybindSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Assign Ctrl+Alt+P to Refresh pods" }));

      expect(createKeybind).not.toHaveBeenCalled();
      expect(useDeviceKeybindStore.getState().keybinds).toMatchObject([
        { keystroke: "Ctrl+Alt+P", commandId: REFRESH },
      ]);
      // Once bound, the suggestion is gone.
      expect(screen.queryByRole("button", { name: /^Assign/ })).not.toBeInTheDocument();
    });

    it("turns off and deletes a device keybind on this device", () => {
      useDeviceKeybindStore
        .getState()
        .add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL" });
      render(<KeybindSettings />);
      const row = screen.getByText("Refresh pods").closest("div") as HTMLElement;

      fireEvent.click(within(row).getByRole("button", { name: "Disable keybind" }));
      expect(useDeviceKeybindStore.getState().keybinds[0].isEnabled).toBe(false);

      fireEvent.click(within(row).getByRole("button", { name: "Delete keybind" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(useDeviceKeybindStore.getState().keybinds).toEqual([]);
    });
  });
});
