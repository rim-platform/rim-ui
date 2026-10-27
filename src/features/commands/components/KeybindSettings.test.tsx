import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(),
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
const updateKeybind = vi.fn();
const deleteKeybindAsync = vi.fn();

vi.mock("../api/useKeybindSettings", () => ({
  useCreateKeybindMutation: vi.fn(() => ({
    mutate: createKeybind,
    isPending: false,
    isError: false,
  })),
  useUpdateKeybindMutation: vi.fn(() => ({ mutate: updateKeybind, isPending: false })),
  useDeleteKeybindMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: deleteKeybindAsync })),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { graphqlError } from "../../conversations/__fixtures__/conversations";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { useCommands } from "../api/useCommands";
import { useCreateKeybindMutation } from "../api/useKeybindSettings";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { usePluginSuggestedKeybinds } from "../../plugins/api/usePluginKeybinds";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
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
    // A profile with no bindings keeps each test's rows to the ones it gives.
    useKeybindProfileStore.setState({
      profile: { ...BUILT_IN_PROFILES.minimal, bindings: [] },
    });
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

  it("shows chat.create_group as New message although the server calls it Create Group", () => {
    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [makeKeybind({ keystroke: "Ctrl+Shift+G", commandId: "chat.create_group" })],
      isLoading: false,
    } as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: [makeCommand({ id: "chat.create_group", title: "Create Group" })],
      isLoading: false,
    } as ReturnType<typeof useCommands>);

    render(<KeybindSettings />);
    expect(screen.getByText("New Message")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));
    const commandSelect = screen.getAllByRole("combobox")[0];
    expect(within(commandSelect).getByText("New Message")).toBeInTheDocument();
    expect(screen.queryByText("Create Group")).not.toBeInTheDocument();
  });

  describe("default rows", () => {
    beforeEach(() => {
      useDeviceKeybindStore.setState({ keybinds: [] });
      vi.mocked(useCommands).mockReturnValue({
        data: [makeCommand()],
        isLoading: false,
      } as ReturnType<typeof useCommands>);
    });

    function rowOf(title: string): HTMLElement {
      return screen.getByText(title).closest("div") as HTMLElement;
    }

    it("shows a default row with no switch, no key editor, no edit and no delete", () => {
      vi.mocked(useResolvedKeybinds).mockReturnValue({
        data: [makeKeybind()],
        isLoading: false,
      } as ReturnType<typeof useResolvedKeybinds>);
      render(<KeybindSettings />);
      const row = rowOf("Open Command Palette");

      expect(within(row).getByText("Default")).toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: /keybind$/ })).not.toBeInTheDocument();
      expect(within(row).getByText("Ctrl+K")).not.toHaveAttribute("role");

      fireEvent.click(within(row).getByText("Ctrl+K"));
      expect(within(row).queryByText("Press a key...")).not.toBeInTheDocument();
      expect(updateKeybind).not.toHaveBeenCalled();
    });

    it("keeps the switch, the key editor, edit and delete on a binding of the user's", () => {
      vi.mocked(useResolvedKeybinds).mockReturnValue({
        data: [makeKeybind({ source: "USER" })],
        isLoading: false,
      } as ReturnType<typeof useResolvedKeybinds>);
      render(<KeybindSettings />);
      const row = rowOf("Open Command Palette");

      expect(within(row).queryByText("Default")).not.toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Edit keybind" })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Delete keybind" })).toBeInTheDocument();
      fireEvent.click(within(row).getByRole("button", { name: "Disable keybind" }));
      expect(updateKeybind).toHaveBeenCalledWith(
        expect.objectContaining({ keybindId: "kb-1", isEnabled: false }),
      );
    });

    it("overrides a default through the add form, prefilled with its keys, command and context", () => {
      vi.mocked(useResolvedKeybinds).mockReturnValue({
        data: [makeKeybind({ context: "COMPOSER" })],
        isLoading: false,
      } as ReturnType<typeof useResolvedKeybinds>);
      render(<KeybindSettings />);

      fireEvent.click(screen.getByRole("button", { name: "Override Ctrl+K Open Command Palette" }));

      expect(screen.getByLabelText("Keystroke")).toHaveValue("Ctrl+K");
      expect(screen.getAllByLabelText("Command")[0]).toHaveValue("workspace.open_command_palette");
      expect(screen.getAllByLabelText("Context")[0]).toHaveValue("COMPOSER");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(createKeybind).toHaveBeenCalledWith(
        {
          scope: "USER",
          keystroke: "Ctrl+K",
          commandId: "workspace.open_command_palette",
          context: "COMPOSER",
        },
        expect.anything(),
      );
      expect(updateKeybind).not.toHaveBeenCalled();
      expect(screen.queryByText(/Already used by/)).not.toBeInTheDocument();
    });

    it("lists the app's own defaults from the active profile", () => {
      useKeybindProfileStore.setState({ profile: BUILT_IN_PROFILES.minimal });
      vi.mocked(useResolvedKeybinds).mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useResolvedKeybinds>);
      render(<KeybindSettings />);

      for (const [keystroke, title] of [
        ["Ctrl+D", "Cycle Display Density"],
        ["?", "Show Keyboard Shortcuts"],
        ["Ctrl+/", "Show Keyboard Shortcuts"],
      ]) {
        const row = screen.getByText(keystroke).closest("div") as HTMLElement;
        expect(within(row).getByText(title)).toBeInTheDocument();
        expect(within(row).getByText("Default")).toBeInTheDocument();
      }
    });
  });

  describe("context names", () => {
    it("shows readable context names in the picker and on rows", () => {
      vi.mocked(useResolvedKeybinds).mockReturnValue({
        data: [makeKeybind({ source: "USER" })],
        isLoading: false,
      } as ReturnType<typeof useResolvedKeybinds>);
      vi.mocked(useCommands).mockReturnValue({
        data: [makeCommand()],
        isLoading: false,
      } as ReturnType<typeof useCommands>);
      render(<KeybindSettings />);

      const row = screen.getByText("Open Command Palette").closest("div") as HTMLElement;
      expect(within(row).getByText("Global")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));
      const contextSelect = screen.getByRole("combobox", { name: "Context" });
      expect(within(contextSelect).getByRole("option", { name: "Message list" })).toHaveValue(
        "MESSAGE_LIST",
      );
      expect(screen.queryByText("GLOBAL")).not.toBeInTheDocument();
    });
  });

  describe("keystroke recorder", () => {
    const openSearch = makeCommand({ id: "workspace.open_search", title: "Open Search" });

    beforeEach(() => {
      useDeviceKeybindStore.setState({ keybinds: [] });
      vi.mocked(useCommands).mockReturnValue({
        data: [makeCommand(), openSearch],
        isLoading: false,
      } as ReturnType<typeof useCommands>);
    });

    function serve(keybinds: ResolvedKeybind[]) {
      vi.mocked(useResolvedKeybinds).mockReturnValue({
        data: keybinds,
        isLoading: false,
      } as ReturnType<typeof useResolvedKeybinds>);
    }

    /** Opens the add form and records `key` with Ctrl on its keystroke field. */
    function record(key: string): HTMLElement {
      fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));
      const field = screen.getByLabelText("Keystroke");
      fireEvent.focus(field);
      fireEvent.keyDown(field, { key, ctrlKey: true });
      return field;
    }

    function pick(commandId: string) {
      fireEvent.change(screen.getByRole("combobox", { name: "Command" }), {
        target: { value: commandId },
      });
    }

    it("records a key that is already bound and names its command", () => {
      serve([makeKeybind()]);
      render(<KeybindSettings />);

      const field = record("k");
      expect(field).toHaveValue("Ctrl+K");
      expect(field).toHaveAttribute("data-keystroke-recorder");
      pick("workspace.open_search");

      expect(
        screen.getByText("Already used by Open Command Palette — saving will reassign it."),
      ).toBeInTheDocument();
    });

    it("Escape cancels the recording and keeps the earlier keys", () => {
      serve([]);
      render(<KeybindSettings />);
      const field = record("j");
      fireEvent.blur(field);

      fireEvent.focus(field);
      fireEvent.keyDown(field, { key: "x", ctrlKey: true });
      expect(field).toHaveValue("Ctrl+X");
      expect(fireEvent.keyDown(field, { key: "Escape" })).toBe(false);

      expect(field).toHaveValue("Ctrl+J");
      expect(screen.getByLabelText("Keystroke")).toBeInTheDocument();
    });

    it("saving over a binding of the user's removes it first", async () => {
      serve([makeKeybind({ id: "kb-user", keystroke: "Ctrl+J", source: "USER" })]);
      deleteKeybindAsync.mockResolvedValue({});
      render(<KeybindSettings />);

      record("j");
      pick("workspace.open_search");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(createKeybind).toHaveBeenCalled());
      expect(deleteKeybindAsync).toHaveBeenCalledWith({ keybindId: "kb-user" });
      expect(deleteKeybindAsync.mock.invocationCallOrder[0]).toBeLessThan(
        createKeybind.mock.invocationCallOrder[0],
      );
      expect(createKeybind).toHaveBeenCalledWith(
        expect.objectContaining({ keystroke: "Ctrl+J", commandId: "workspace.open_search" }),
        expect.anything(),
      );
    });

    it("saves nothing and says so when the other binding cannot be removed", async () => {
      serve([makeKeybind({ id: "kb-user", keystroke: "Ctrl+J", source: "USER" })]);
      deleteKeybindAsync.mockRejectedValue(new Error("Forbidden"));
      render(<KeybindSettings />);

      record("j");
      pick("workspace.open_search");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Forbidden")).toBeInTheDocument();
      expect(createKeybind).not.toHaveBeenCalled();
    });

    it("saving over a device binding removes it from this device", () => {
      serve([]);
      useDeviceKeybindStore.getState().add({
        keystroke: "Ctrl+J",
        commandId: "workspace.toggle_zen_mode",
        context: "GLOBAL",
      });
      render(<KeybindSettings />);

      record("j");
      pick("workspace.open_search");
      expect(
        screen.getByText("Already used by Toggle Zen Mode — saving will reassign it."),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(useDeviceKeybindStore.getState().keybinds).toEqual([]);
      expect(deleteKeybindAsync).not.toHaveBeenCalled();
      expect(createKeybind).toHaveBeenCalledWith(
        expect.objectContaining({ keystroke: "Ctrl+J", commandId: "workspace.open_search" }),
        expect.anything(),
      );
    });

    it("refuses keys a workspace keybind holds", () => {
      serve([
        makeKeybind({ id: "kb-ws", keystroke: "Ctrl+J", source: "WORKSPACE", scope: "WORKSPACE" }),
      ]);
      render(<KeybindSettings />);

      record("j");
      pick("workspace.open_search");

      expect(
        screen.getByText(
          "Already used by Open Command Palette, a workspace keybind — choose other keys.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("re-recording a binding onto used keys asks before saving", () => {
      serve([
        makeKeybind({ id: "kb-user", keystroke: "Ctrl+K", source: "USER" }),
        makeKeybind({ id: "kb-default", keystroke: "Ctrl+J", commandId: "workspace.open_search" }),
      ]);
      render(<KeybindSettings />);

      const keys = screen.getByRole("button", { name: "Ctrl+K" });
      fireEvent.click(keys);
      expect(keys).toHaveAttribute("data-keystroke-recorder");
      fireEvent.keyDown(keys, { key: "j", ctrlKey: true });

      expect(
        screen.getByText("Already used by Open Search — saving will reassign it."),
      ).toBeInTheDocument();
      expect(updateKeybind).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(updateKeybind).toHaveBeenCalledWith(
        expect.objectContaining({ keybindId: "kb-user", keystroke: "Ctrl+J" }),
      );
      expect(screen.queryByText(/Already used by/)).not.toBeInTheDocument();
    });
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

describe("KeybindSettings refusals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useResolvedKeybinds>);
    vi.mocked(useCommands).mockReturnValue({
      data: [makeCommand()],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  it("shows a refused new keybind as one sentence, without the request", () => {
    vi.mocked(useCreateKeybindMutation).mockReturnValue({
      mutate: createKeybind,
      isPending: false,
      isError: true,
      error: graphqlError("VALIDATION", "keystroke is already bound"),
    } as unknown as ReturnType<typeof useCreateKeybindMutation>);
    render(<KeybindSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));

    expect(screen.getByText("Keystroke is already bound.")).toBeInTheDocument();
    expect(screen.queryByText(/serialized response/)).not.toBeInTheDocument();
  });
});
