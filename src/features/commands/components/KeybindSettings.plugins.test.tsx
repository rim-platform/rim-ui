import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PluginCommandInfo, PluginInfo } from "../../plugins/types";

// The plugin list is the only stub: the commands come through the real `usePluginCommands`.
const plugins = vi.hoisted(() => ({ list: [] as PluginInfo[] }));
vi.mock("../../plugins/api/usePluginList", () => ({
  usePluginList: () => ({ data: plugins.list }),
}));
vi.mock("../../plugins/api/usePluginKeybinds", () => ({
  usePluginSuggestedKeybinds: () => [],
}));
vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: () => ({ data: [], isLoading: false }),
}));
vi.mock("../api/useCommands", () => ({
  useCommands: () => ({ data: [] }),
}));
const createKeybind = vi.fn();
vi.mock("../api/useKeybindSettings", () => ({
  useCreateKeybindMutation: () => ({ mutate: createKeybind, isPending: false, isError: false }),
  useUpdateKeybindMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteKeybindMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../workspaces/hooks/useFeatureEnabled", () => ({
  useIsCommandAvailable: () => () => true,
}));
vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { LOCAL_COMMANDS } from "../runtime/localCommands";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { KeybindSettings } from "./KeybindSettings";

function command(
  pluginId: string,
  id: string,
  title: string,
  overrides: Partial<PluginCommandInfo> = {},
): PluginCommandInfo {
  return {
    id,
    qualified_id: `plugin.${pluginId}.${id}`,
    title,
    description: "",
    keybind_capable: true,
    dangerous: false,
    ai_callable: false,
    arguments: [],
    ...overrides,
  };
}

function plugin(
  pluginId: string,
  commands: PluginCommandInfo[],
  overrides: Partial<PluginInfo> = {},
): PluginInfo {
  return {
    plugin_id: pluginId,
    manifest_id: pluginId,
    display_name: pluginId,
    version: "1.0.0",
    description: "",
    author: "",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    health: "running",
    commands,
    ...overrides,
  };
}

const BINDABLE = [
  command("k8s", "refresh", "Refresh pods"),
  command("k8s", "restart_pod", "Restart pod", { dangerous: true }),
  command("prs", "open_review", "Open next review"),
];

describe("KeybindSettings and plugin commands", () => {
  beforeEach(() => {
    createKeybind.mockReset();
    useDeviceKeybindStore.setState({ keybinds: [] });
    plugins.list = [
      plugin("k8s", [
        BINDABLE[0],
        BINDABLE[1],
        command("k8s", "scale", "Scale deployment", {
          arguments: [{ name: "replicas", type: "number", required: true }],
        }),
      ]),
      plugin(
        "prs",
        [BINDABLE[2], command("prs", "internal", "Internal", { keybind_capable: false })],
        {
          runtime_kind: "WebSandboxed",
          health: "stopped",
        },
      ),
      plugin("off", [command("off", "noop", "Disabled plugin command")], { enabled: false }),
    ];
  });

  async function openPicker() {
    const user = userEvent.setup();
    render(<KeybindSettings />);
    await user.click(screen.getByRole("button", { name: "Add keybind" }));
    return { user, picker: screen.getByRole("combobox", { name: "Command" }) };
  }

  it("offers every keybind-capable command of every enabled plugin, local or web, running or not", async () => {
    const { picker } = await openPicker();
    for (const { title } of BINDABLE) {
      expect(within(picker).getByRole("option", { name: title })).toBeInTheDocument();
    }
    // A command that needs arguments runs from its panel; one the manifest marks unbindable,
    // and commands of a disabled plugin, are not offered.
    for (const title of ["Scale deployment", "Internal", "Disabled plugin command"]) {
      expect(within(picker).queryByRole("option", { name: title })).not.toBeInTheDocument();
    }
  });

  it("offers this app's own commands too and keeps their bindings on this device", async () => {
    const { user, picker } = await openPicker();
    for (const { title } of LOCAL_COMMANDS) {
      expect(within(picker).getByRole("option", { name: title })).toBeInTheDocument();
    }
    screen.getByRole("textbox", { name: "Keystroke" }).focus();
    await user.keyboard("{Control>}{Alt>}v{/Alt}{/Control}");
    await user.selectOptions(picker, "workspace.toggle_vim_mode");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(createKeybind).not.toHaveBeenCalled();
    expect(useDeviceKeybindStore.getState().keybinds).toMatchObject([
      { keystroke: "Ctrl+Alt+V", commandId: "workspace.toggle_vim_mode" },
    ]);
  });

  it("binds a plugin command with the keyboard alone, and Tab leaves the keystroke field", async () => {
    const { user } = await openPicker();
    screen.getByRole("textbox", { name: "Keystroke" }).focus();
    await user.keyboard("{Control>}{Alt>}r{/Alt}{/Control}");
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Command" })).toHaveFocus();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Command" }),
      "plugin.k8s.refresh",
    );
    screen.getByRole("button", { name: "Save" }).focus();
    await user.keyboard("{Enter}");
    expect(useDeviceKeybindStore.getState().keybinds).toMatchObject([
      { keystroke: "Ctrl+Alt+R", commandId: "plugin.k8s.refresh", context: "GLOBAL" },
    ]);
  });

  it("lets a device binding be pointed at any other plugin command", async () => {
    useDeviceKeybindStore
      .getState()
      .add({ keystroke: "Ctrl+Alt+R", commandId: "plugin.k8s.refresh", context: "GLOBAL" });
    const user = userEvent.setup();
    render(<KeybindSettings />);
    await user.click(screen.getByRole("button", { name: "Edit keybind" }));
    const picker = screen.getByRole("combobox", { name: "Command" });
    for (const { title } of BINDABLE) {
      expect(within(picker).getByRole("option", { name: title })).toBeInTheDocument();
    }
  });
});
