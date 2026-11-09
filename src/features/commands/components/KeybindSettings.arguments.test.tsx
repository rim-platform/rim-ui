import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

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

vi.mock("../api/useKeybindSettings", () => ({
  useCreateKeybindMutation: vi.fn(() => ({
    mutate: createKeybind,
    isPending: false,
    isError: false,
  })),
  useUpdateKeybindMutation: vi.fn(() => ({ mutate: updateKeybind, isPending: false })),
  useDeleteKeybindMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() })),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { useCommands } from "../api/useCommands";
import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import type { CommandDefinition, ResolvedKeybind } from "../types";
import { KeybindSettings } from "./KeybindSettings";

const DND: CommandDefinition = {
  id: "notifications.dnd",
  title: "Do Not Disturb",
  description: "Pause notification toasts and sounds",
  category: "Notifications",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
  arguments: [
    {
      name: "server_id",
      title: "Workspace",
      description: "",
      argumentType: CommandArgumentType.WORKSPACE_ID,
      required: true,
    },
    {
      name: "mode",
      title: "Mode",
      description: "on, off, or until.",
      argumentType: CommandArgumentType.ENUM,
      required: true,
      allowedValues: ["on", "off", "until"],
    },
    {
      name: "minutes",
      title: "Minutes",
      description: "",
      argumentType: CommandArgumentType.INTEGER,
      required: false,
    },
  ],
};

function keybind(overrides: Partial<ResolvedKeybind> = {}): ResolvedKeybind {
  return {
    id: "kb-dnd",
    keystroke: "Ctrl+Alt+D",
    commandId: "notifications.dnd",
    context: "GLOBAL",
    source: "USER",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
    ...overrides,
  };
}

function serve(keybinds: ResolvedKeybind[]) {
  vi.mocked(useResolvedKeybinds).mockReturnValue({
    data: keybinds,
    isLoading: false,
  } as ReturnType<typeof useResolvedKeybinds>);
}

/** Opens the add form with keys recorded and Do Not Disturb picked. */
function startAdding() {
  render(<KeybindSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));
  fireEvent.keyDown(screen.getByLabelText("Keystroke"), { key: "d", ctrlKey: true, altKey: true });
  fireEvent.change(screen.getByRole("combobox", { name: "Command" }), {
    target: { value: "notifications.dnd" },
  });
}

/** The fieldset of a keybind's saved arguments. */
function argumentsSection(): HTMLElement {
  return screen.getByRole("group", { name: "Arguments" });
}

beforeEach(() => {
  vi.clearAllMocks();
  useKeybindProfileStore.setState({
    profile: { ...BUILT_IN_PROFILES.minimal, bindings: [] },
    replacesDefaults: true,
  });
  vi.mocked(useCommands).mockReturnValue({
    data: [DND],
    isLoading: false,
  } as ReturnType<typeof useCommands>);
});

describe("KeybindSettings arguments", () => {
  it("saves the arguments filled in with a new keybind", () => {
    serve([]);
    startAdding();

    const section = argumentsSection();
    const mode = within(section).getByLabelText("Mode");
    expect(
      within(mode)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Ask when run", "Until I turn it back on", "Off", "Until a time"]);
    expect(within(section).queryByLabelText("Workspace")).toBeNull();
    fireEvent.change(mode, { target: { value: "until" } });
    fireEvent.change(within(section).getByLabelText(/Minutes/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createKeybind).toHaveBeenCalledTimes(1);
    expect(createKeybind.mock.calls[0][0]).toEqual({
      scope: "USER",
      keystroke: "Ctrl+Alt+D",
      commandId: "notifications.dnd",
      context: "GLOBAL",
      presetArgs: { mode: "until", minutes: 30 },
    });
  });

  it("saves no arguments when the fields are left empty, to be asked when pressed", () => {
    serve([]);
    startAdding();
    expect(within(argumentsSection()).getByText(/asked for when the key is pressed/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createKeybind.mock.calls[0][0]).not.toHaveProperty("presetArgs");
  });

  it("keeps the form open and names a field that cannot be saved", () => {
    serve([]);
    startAdding();
    const minutes = within(argumentsSection()).getByLabelText(/Minutes/);
    fireEvent.change(minutes, { target: { value: "soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createKeybind).not.toHaveBeenCalled();
    expect(minutes).toHaveAccessibleDescription("Enter a whole number");
  });

  it("shows a keybind's saved arguments filled in, and saves the change", () => {
    serve([keybind({ presetArgs: { mode: "until", minutes: 15 } })]);
    render(<KeybindSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit keybind" }));

    const section = argumentsSection();
    expect(within(section).getByLabelText("Mode")).toHaveValue("until");
    const minutes = within(section).getByLabelText(/Minutes/);
    expect(minutes).toHaveValue("15");
    fireEvent.change(minutes, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateKeybind.mock.calls[0][0]).toMatchObject({
      keybindId: "kb-dnd",
      commandId: "notifications.dnd",
      presetArgs: { mode: "until", minutes: 45 },
    });
  });

  it("keeps saved arguments the fields cannot show, as they are", () => {
    const saved = { mode: "later", extra: true };
    serve([keybind({ presetArgs: saved })]);
    render(<KeybindSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit keybind" }));

    expect(within(argumentsSection()).getByText(JSON.stringify(saved))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateKeybind.mock.calls[0][0].presetArgs).toEqual(saved);
  });

  it("keeps a keybind's arguments when it is turned off or given other keys", () => {
    const saved = { mode: "on" };
    serve([keybind({ presetArgs: saved })]);
    render(<KeybindSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Disable keybind" }));
    expect(updateKeybind.mock.calls[0][0]).toMatchObject({ isEnabled: false, presetArgs: saved });

    const keys = screen.getByText("Ctrl+Alt+D");
    fireEvent.click(keys);
    fireEvent.keyDown(keys, { key: "n", ctrlKey: true, altKey: true });
    expect(updateKeybind.mock.calls[1][0]).toMatchObject({
      keystroke: "Ctrl+Alt+N",
      presetArgs: saved,
    });
  });
});
