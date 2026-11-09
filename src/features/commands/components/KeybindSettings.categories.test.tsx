import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PluginInfo } from "../../plugins/types";
import type { CommandDefinition, ResolvedKeybind } from "../types";

const state = vi.hoisted(() => ({
  plugins: [] as PluginInfo[],
  keybinds: [] as ResolvedKeybind[],
  home: [] as ResolvedKeybind[],
  commands: [] as CommandDefinition[],
}));
vi.mock("../../plugins/api/usePluginList", () => ({
  usePluginList: () => ({ data: state.plugins }),
}));
vi.mock("../../plugins/api/usePluginKeybinds", () => ({
  usePluginSuggestedKeybinds: () => [],
}));
vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: (spaceId?: string, enabled = true) => ({
    data: !enabled ? undefined : spaceId === undefined ? state.home : state.keybinds,
    isLoading: false,
  }),
}));
vi.mock("../api/useCommands", () => ({
  useCommands: () => ({ data: state.commands }),
}));
const createKeybind = vi.fn();
const updateKeybind = vi.fn();
const deleteKeybind = vi.fn();
vi.mock("../api/useKeybindSettings", () => ({
  useCreateKeybindMutation: () => ({ mutate: createKeybind, isPending: false, isError: false }),
  useUpdateKeybindMutation: () => ({ mutate: updateKeybind, isPending: false }),
  useDeleteKeybindMutation: () => ({ mutate: deleteKeybind }),
}));
vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import type { SpaceRecord } from "../../relay/state/relayDb";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { APP_COMMAND_KEYBINDS } from "../../updater/api/serverCapabilities";
import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { KeybindSettings } from "./KeybindSettings";

function serverCommand(id: string, title: string, category: string): CommandDefinition {
  return {
    id,
    title,
    description: "",
    category,
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
  };
}

function serverKeybind(id: string, keystroke: string, commandId: string): ResolvedKeybind {
  return {
    id,
    keystroke,
    commandId,
    context: "GLOBAL",
    source: "USER",
    scope: "USER",
    isEnabled: true,
    presetArgs: null,
  };
}

const K8S: PluginInfo = {
  plugin_id: "k8s",
  manifest_id: "k8s",
  display_name: "Kubernetes Pods",
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
  commands: [
    {
      id: "refresh",
      qualified_id: "plugin.k8s.refresh",
      title: "Refresh pods",
      description: "",
      keybind_capable: true,
      dangerous: false,
      ai_callable: false,
      arguments: [],
    },
  ],
};

/** The section headers of the keybind list, top to bottom, without their counts. */
function sectionHeaders(): string[] {
  return Array.from(document.querySelectorAll("button[type=button] > span:first-of-type")).map(
    (span) => span.textContent ?? "",
  );
}

describe("KeybindSettings categories", () => {
  beforeEach(() => {
    createKeybind.mockReset();
    updateKeybind.mockReset();
    useKeybindProfileStore.setState({
      profile: { ...BUILT_IN_PROFILES.minimal, bindings: [] },
      replacesDefaults: true,
    });
    state.plugins = [K8S];
    state.commands = [
      serverCommand("workspace.open_search", "Open Search", "Search"),
      serverCommand("chat.mark_all_as_read", "Mark All as Read", "Messages"),
      serverCommand("workspace.open_settings", "Open Settings", "Admin"),
    ];
    state.keybinds = [
      serverKeybind("kb-1", "Ctrl+Shift+F", "workspace.open_search"),
      serverKeybind("kb-2", "Ctrl+Shift+A", "chat.mark_all_as_read"),
      serverKeybind("kb-3", "Ctrl+,", "workspace.open_settings"),
      serverKeybind("kb-4", "Ctrl+Shift+U", "workspace.gone"),
    ];
    useDeviceKeybindStore.setState({ keybinds: [] });
    const { add } = useDeviceKeybindStore.getState();
    add({ keystroke: "Ctrl+Alt+R", commandId: "plugin.k8s.refresh", context: "GLOBAL" });
    add({ keystroke: "Ctrl+Alt+Z", commandId: "workspace.toggle_zen_mode", context: "GLOBAL" });
    add({ keystroke: "Ctrl+Alt+B", commandId: "workspace.go_back", context: "GLOBAL" });
  });

  afterEach(() => {
    queryClient.clear();
    useDeviceKeybindStore.setState({ keybinds: [] });
  });

  it("groups keybinds by their command's category, in the palette's order", () => {
    render(<KeybindSettings />);

    expect(sectionHeaders()).toEqual([
      "Navigation",
      "Messages",
      "Search",
      "View",
      "Admin",
      "Kubernetes Pods",
      "Other",
    ]);
    const navigation = screen.getByText("Navigation").closest("div") as HTMLElement;
    expect(within(navigation).getByText("Go Back")).toBeInTheDocument();
    const plugin = screen.getByText("Kubernetes Pods").closest("div") as HTMLElement;
    expect(within(plugin).getByText("Refresh pods")).toBeInTheDocument();
    const other = screen.getByText("Other").closest("div") as HTMLElement;
    expect(within(other).getByText("workspace.gone")).toBeInTheDocument();
  });

  it("filters within the groups and drops the groups left empty", async () => {
    const user = userEvent.setup();
    render(<KeybindSettings />);
    await user.type(screen.getByPlaceholderText("Search keybinds..."), "zen");

    expect(sectionHeaders()).toEqual(["View"]);
  });

  it("collapses one group by its header", async () => {
    const user = userEvent.setup();
    render(<KeybindSettings />);
    await user.click(screen.getByText("View"));

    expect(screen.queryByText("Toggle Zen Mode")).not.toBeInTheDocument();
    expect(screen.getByText("Go Back")).toBeInTheDocument();
  });
});

describe("KeybindSettings where the server keeps app command keybinds", () => {
  beforeEach(() => {
    createKeybind.mockReset();
    state.plugins = [K8S];
    state.commands = [serverCommand("workspace.open_search", "Open Search", "Search")];
    state.keybinds = [serverKeybind("kb-1", "Ctrl+Shift+F", "workspace.open_search")];
    useDeviceKeybindStore.setState({ keybinds: [] });
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [APP_COMMAND_KEYBINDS] }),
    );
  });

  afterEach(() => {
    queryClient.clear();
    useDeviceKeybindStore.setState({ keybinds: [] });
  });

  async function addKeybind(keys: string, commandId: string) {
    const user = userEvent.setup();
    render(<KeybindSettings />);
    await user.click(screen.getByRole("button", { name: "Add keybind" }));
    screen.getByRole("textbox", { name: "Keystroke" }).focus();
    await user.keyboard(keys);
    await user.selectOptions(screen.getByRole("combobox", { name: "Command" }), commandId);
    await user.click(screen.getByRole("button", { name: "Save" }));
  }

  it("saves a keybind to an app command on the server", async () => {
    await addKeybind("{Control>}{Alt>}z{/Alt}{/Control}", "workspace.toggle_zen_mode");

    expect(createKeybind).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "USER",
        keystroke: "Ctrl+Alt+Z",
        commandId: "workspace.toggle_zen_mode",
      }),
      expect.anything(),
    );
    expect(useDeviceKeybindStore.getState().keybinds).toEqual([]);
  });

  it("still keeps a keybind to a plugin command on this device", async () => {
    await addKeybind("{Control>}{Alt>}r{/Alt}{/Control}", "plugin.k8s.refresh");

    expect(createKeybind).not.toHaveBeenCalled();
    expect(useDeviceKeybindStore.getState().keybinds).toMatchObject([
      { keystroke: "Ctrl+Alt+R", commandId: "plugin.k8s.refresh" },
    ]);
  });

  it("lets a server keybind be pointed at an app command", async () => {
    const user = userEvent.setup();
    render(<KeybindSettings />);
    await user.click(screen.getByRole("button", { name: "Edit keybind" }));
    const picker = screen.getByRole("combobox", { name: "Command" });

    expect(within(picker).getByRole("option", { name: "Toggle Zen Mode" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Refresh pods" })).not.toBeInTheDocument();
  });
});

describe("KeybindSettings in a workspace another server hosts", () => {
  beforeEach(() => {
    createKeybind.mockReset();
    updateKeybind.mockReset();
    deleteKeybind.mockReset();
    useKeybindProfileStore.setState({
      profile: { ...BUILT_IN_PROFILES.minimal, bindings: [] },
      replacesDefaults: true,
    });
    state.plugins = [];
    state.commands = [serverCommand("workspace.open_search", "Open Search", "Search")];
    state.keybinds = [serverKeybind("host-1", "Ctrl+Shift+F", "workspace.open_search")];
    state.home = [
      serverKeybind("home-zen", "Ctrl+Alt+Z", "workspace.toggle_zen_mode"),
      serverKeybind("home-search", "Ctrl+Alt+S", "workspace.open_search"),
    ];
    useDeviceKeybindStore.setState({ keybinds: [] });
    useRelayStore.setState({
      spaces: { "ws-1": { spaceId: "ws-1", hostServerId: "srv-2" } as SpaceRecord },
    });
  });

  afterEach(() => {
    useRelayStore.setState({ spaces: {} });
    state.home = [];
  });

  it("lists the connected server's app command keybinds and none of its others", () => {
    render(<KeybindSettings />);

    expect(screen.getByText("Toggle Zen Mode")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Alt+Z")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Alt+S")).not.toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+F")).toBeInTheDocument();
  });

  it("turns off and deletes one through the keybind mutations, which go to the connected server", async () => {
    const user = userEvent.setup();
    render(<KeybindSettings />);
    const view = screen.getByText("View").closest("div") as HTMLElement;

    await user.click(within(view).getByRole("button", { name: "Disable keybind" }));
    expect(updateKeybind).toHaveBeenCalledWith(
      expect.objectContaining({ keybindId: "home-zen", isEnabled: false }),
    );
    expect(updateKeybind.mock.calls[0][0]).not.toHaveProperty("workspaceId");

    await user.click(within(view).getByRole("button", { name: "Delete keybind" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteKeybind).toHaveBeenCalledWith({ keybindId: "home-zen" });
  });

  it("lists nothing twice in a workspace of the connected server", () => {
    useRelayStore.setState({ spaces: {} });
    state.keybinds = [serverKeybind("home-zen", "Ctrl+Alt+Z", "workspace.toggle_zen_mode")];
    state.home = [serverKeybind("home-zen", "Ctrl+Alt+Z", "workspace.toggle_zen_mode")];
    render(<KeybindSettings />);

    expect(screen.getAllByText("Ctrl+Alt+Z")).toHaveLength(1);
  });
});
