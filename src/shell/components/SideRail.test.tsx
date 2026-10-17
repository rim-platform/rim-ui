import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/utils";
import { expectReachableByKeyboard } from "../../test/keyboard";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { useShellStore } from "../state/useShellStore";
import type { PluginInfo } from "../../features/plugins/types";

const requestMock = vi.fn();

vi.mock("../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

// Unrelated SideRail dependencies — stubbed so only the rail itself is exercised.
vi.mock("../../features/workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: undefined }),
}));
const pluginList = vi.hoisted(() => ({ data: [] as PluginInfo[] }));
vi.mock("../../features/plugins/api/usePluginList", () => ({
  usePluginList: () => pluginList,
}));
vi.mock("../../features/auth/api/useAuthMutations", () => ({
  useLogoutMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("../../features/commands/hooks/useKeybindLabel", () => ({
  useKeybindLabel: () => null,
}));
vi.mock("../../features/settings/components/StatusDropdown", () => ({
  StatusDropdown: () => null,
}));

import { SideRail } from "./SideRail";

describe("SideRail — keyboard", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("reaches every destination with Tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await expectReachableByKeyboard(
      user,
      ["Inbox", "Plugins", "Search workspace", "Audit log", "Settings"].map((name) =>
        screen.getByRole("button", { name }),
      ),
    );
  });

  it("moves along the rail with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    const inbox = screen.getByRole("button", { name: "Inbox" });
    inbox.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Plugins" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(inbox).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "User menu" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(inbox).toHaveFocus();
  });

  it("opens settings with Enter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    screen.getByRole("button", { name: "Settings" }).focus();
    await user.keyboard("{Enter}");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
  });

  it("leaves the arrow keys to the user menu and gives focus back when it closes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    const avatar = screen.getByRole("button", { name: "User menu" });
    avatar.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu");
    expect(menu).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(menu).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();
  });
});

describe("SideRail — unread", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("badges Inbox with the open workspace's unread and drops the badge once all are read", () => {
    useUnreadStore.getState().setCounts("srv-1", { c1: 2, c2: 1 });
    useUnreadStore.getState().setCounts("srv-2", { c3: 5 });
    renderWithProviders(<SideRail />);
    expect(screen.getByRole("button", { name: "Inbox (3 unread)" })).toHaveTextContent("3");

    act(() => {
      useUnreadStore.getState().markRead("c1");
      useUnreadStore.getState().markRead("c2");
    });
    expect(screen.getByRole("button", { name: "Inbox" })).toHaveTextContent("");
  });
});

describe("SideRail — plugin panels", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    pluginList.data = [
      {
        plugin_id: "chat.rim.k8s-pods",
        manifest_id: "chat.rim.k8s-pods",
        display_name: "Kubernetes Pods",
        version: "1.0.0",
        description: "",
        enabled: true,
        health: "running",
        capabilities: [],
        approved_capabilities: [],
        approved_ai_commands: [],
        ai_callable_commands: [],
        ai_consent_required: false,
        fingerprint_changed: false,
        panels: [
          { id: "pods", title: "Pods", slot: "main_area" },
          { id: "notes", title: "Notes" },
        ],
      },
    ];
  });

  afterEach(() => {
    pluginList.data = [];
    useWorkspaceStore.setState({ workspaceId: null });
  });

  const inbox = () => screen.getByRole("button", { name: "Inbox" });
  const pods = () => screen.getByRole("button", { name: "Kubernetes Pods: Pods" });
  const notes = () => screen.getByRole("button", { name: "Kubernetes Pods: Notes" });

  it("marks a main-area panel instead of Inbox while it covers the conversation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    expect(inbox()).toHaveAttribute("aria-current", "page");

    await user.click(pods());
    expect(pods()).toHaveAttribute("aria-current", "page");
    expect(inbox()).not.toHaveAttribute("aria-current");

    act(() => useShellStore.getState().setSelectedConversationId("c1"));
    expect(inbox()).toHaveAttribute("aria-current", "page");
    expect(pods()).not.toHaveAttribute("aria-current");
  });

  it("closes a main-area panel when Inbox is chosen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await user.click(pods());
    await user.click(inbox());
    expect(useShellStore.getState().activePluginPanel).toBeNull();
    expect(inbox()).toHaveAttribute("aria-current", "page");
  });

  it("marks a tool-panel panel beside Inbox, and neither while settings cover them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await user.click(notes());
    expect(notes()).toHaveAttribute("aria-current", "page");
    expect(inbox()).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(notes()).not.toHaveAttribute("aria-current");
    expect(inbox()).not.toHaveAttribute("aria-current");
  });
});
