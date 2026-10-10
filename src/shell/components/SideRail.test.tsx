import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/utils";
import { expectReachableByKeyboard } from "../../test/keyboard";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";

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
vi.mock("../../features/plugins/api/usePluginList", () => ({
  usePluginList: () => ({ data: [] }),
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
