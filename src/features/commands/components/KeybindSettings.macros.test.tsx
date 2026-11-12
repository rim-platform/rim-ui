import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api/useKeybinds", () => ({ useResolvedKeybinds: vi.fn() }));
vi.mock("../api/useCommands", () => ({ useCommands: vi.fn() }));
vi.mock("../../plugins/api/usePluginCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/api/usePluginCommands")>()),
  usePluginCommands: vi.fn(() => []),
}));
vi.mock("../../plugins/api/usePluginKeybinds", () => ({
  usePluginSuggestedKeybinds: vi.fn(() => []),
}));

const createKeybind = vi.fn();

vi.mock("../api/useKeybindSettings", () => ({
  useCreateKeybindMutation: vi.fn(() => ({ mutate: createKeybind, isPending: false })),
  useUpdateKeybindMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteKeybindMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() })),
}));
vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useCommands } from "../api/useCommands";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import type { CommandDefinition, ResolvedKeybind } from "../types";
import { KeybindSettings } from "./KeybindSettings";

const OPEN_SEARCH: CommandDefinition = {
  id: "workspace.open_search",
  title: "Open Search",
  description: "",
  category: "Workspace",
  sourceKind: "BUILT_IN",
  executionTarget: "DESKTOP_LOCAL",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
};

function serveKeybinds(keybinds: ResolvedKeybind[]) {
  vi.mocked(useResolvedKeybinds).mockReturnValue({
    data: keybinds,
    isLoading: false,
  } as ReturnType<typeof useResolvedKeybinds>);
}

beforeEach(() => {
  useDeviceKeybindStore.setState({ keybinds: [] });
  useKeybindProfileStore.setState({
    profile: { ...BUILT_IN_PROFILES.minimal, bindings: [] },
    replacesDefaults: true,
  });
  vi.mocked(useCommands).mockReturnValue({
    data: [OPEN_SEARCH, { ...OPEN_SEARCH, id: "user.old", title: "Old user command" }],
    isLoading: false,
  } as ReturnType<typeof useCommands>);
  queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
  queryClient.setQueryData(queryKeys.macroStepCommands, [OPEN_SEARCH]);
  queryClient.setQueryData(queryKeys.accountMacros, [
    {
      id: "user.standup",
      title: "Standup",
      description: "",
      isEnabled: true,
      aiCallable: false,
      nlDescription: "",
      intentSamples: [],
      steps: [{ commandId: "workspace.open_search", args: {}, ask: [] }],
    },
  ]);
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("KeybindSettings with the person's macros", () => {
  it("offers the person's macros, not the server's user commands, and saves a key to one as theirs", () => {
    serveKeybinds([]);
    render(<KeybindSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Add keybind" }));
    const picker = screen.getByRole("combobox", { name: "Command" });
    expect(picker.querySelector('option[value="user.standup"]')).not.toBeNull();
    expect(picker.querySelector('option[value="user.old"]')).toBeNull();

    const field = screen.getByLabelText("Keystroke");
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: "j", ctrlKey: true });
    fireEvent.change(picker, { target: { value: "user.standup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createKeybind).toHaveBeenCalledWith(
      { scope: "USER", keystroke: "Ctrl+J", commandId: "user.standup", context: "GLOBAL" },
      expect.anything(),
    );
    expect(useDeviceKeybindStore.getState().keybinds).toEqual([]);
  });

  it("names a key to a macro by the macro's title", () => {
    serveKeybinds([
      {
        id: "kb-macro",
        keystroke: "Ctrl+J",
        commandId: "user.standup",
        context: "GLOBAL",
        source: "USER",
        scope: "USER",
        isEnabled: true,
        presetArgs: null,
      },
    ]);
    render(<KeybindSettings />);

    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
});
