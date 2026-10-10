import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(() => ({ data: undefined })),
}));
vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: [] })),
}));
vi.mock("../../plugins/api/usePluginCommands", () => ({
  usePluginCommands: vi.fn(() => []),
}));

import { useResolvedKeybinds } from "../api/useKeybinds";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
import { DEFAULT_BINDINGS } from "../profiles/builtInProfiles";
import { useCommandStore } from "../state/useCommandStore";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { ShortcutsPanel } from "./ShortcutsPanel";

const REFRESH = "plugin.chat.rim.k8s-pods.refresh";

function rowFor(title: string): HTMLElement {
  return screen.getByText(title).closest("div") as HTMLElement;
}

describe("ShortcutsPanel", () => {
  beforeEach(() => {
    useKeybindProfileStore.getState().selectBuiltIn("minimal");
    useDeviceKeybindStore.setState({ keybinds: [] });
    useCommandStore.setState({ isShortcutsPanelOpen: true });
  });

  afterEach(() => {
    useCommandStore.setState({ isShortcutsPanelOpen: false });
    vi.mocked(useResolvedKeybinds).mockReturnValue({ data: undefined } as ReturnType<
      typeof useResolvedKeybinds
    >);
  });

  it("renders nothing while closed", () => {
    useCommandStore.setState({ isShortcutsPanelOpen: false });
    render(<ShortcutsPanel />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every binding the profile puts in force, with its keys", () => {
    render(<ShortcutsPanel />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const rows = within(dialog).getAllByRole("definition");
    expect(rows).toHaveLength(DEFAULT_BINDINGS.length);
    expect(within(rowFor("Open command palette")).getByText("Ctrl+K")).toBeInTheDocument();
    expect(within(rowFor("Close the open panel")).getByText("Escape")).toBeInTheDocument();
  });

  it("follows the bindings as they change: a plugin binding, the server's, a freed key", () => {
    vi.mocked(usePluginCommands).mockReturnValue([
      {
        id: REFRESH,
        title: "Refresh pods",
        description: "",
        category: "Kubernetes Pods",
        sourceKind: "PLUGIN",
        executionTarget: "DESKTOP_LOCAL",
        requiredContext: [],
        requiredCapabilities: [],
        visibleInPalette: true,
        visibleInContextMenus: false,
        keybindCapable: true,
        dangerous: false,
        contextTypes: [],
      },
    ]);
    vi.mocked(useResolvedKeybinds).mockReturnValue({
      data: [
        {
          id: "srv-2",
          keystroke: "Ctrl+Shift+U",
          commandId: "workspace.open_settings",
          context: "MESSAGE_LIST",
          source: "USER",
          scope: "USER",
          isEnabled: true,
          presetArgs: null,
        },
      ],
    } as ReturnType<typeof useResolvedKeybinds>);
    useDeviceKeybindStore
      .getState()
      .add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL" });
    render(<ShortcutsPanel />);

    expect(within(rowFor("Refresh pods")).getByText("Ctrl+Alt+P")).toBeInTheDocument();
    const messageList = screen.getByRole("region", { name: "Message list" });
    expect(within(messageList).getByText("Ctrl+Shift+U")).toBeInTheDocument();

    act(() => useKeybindProfileStore.getState().selectBuiltIn("mouse-friendly"));
    expect(screen.queryByText("Ctrl+D")).not.toBeInTheDocument();
    expect(screen.getByText("Ctrl+K")).toBeInTheDocument();
  });

  it("shows the Vim keys only while Vim mode is on", () => {
    render(<ShortcutsPanel />);
    expect(screen.queryByRole("region", { name: "Vim normal mode" })).not.toBeInTheDocument();
    act(() => useKeybindProfileStore.getState().selectBuiltIn("vim"));
    const vim = screen.getByRole("region", { name: "Vim normal mode" });
    expect(within(vim).getByText("gg")).toBeInTheDocument();
    expect(within(vim).getByText("Open the command palette")).toBeInTheDocument();
    expect(BUILT_IN_PROFILES.vim.vimMode).toBe(true);
  });

  it("filters by title or keys and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<ShortcutsPanel />);
    await user.type(screen.getByRole("searchbox", { name: "Filter shortcuts" }), "palette");
    expect(screen.getAllByRole("definition")).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Filter shortcuts" }));
    await user.type(screen.getByRole("searchbox", { name: "Filter shortcuts" }), "zzz");
    expect(screen.getByText("No shortcut matches.")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(useCommandStore.getState().isShortcutsPanelOpen).toBe(false);
  });
});
