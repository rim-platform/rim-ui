import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { expectReachableByKeyboard } from "../../../test/keyboard";

const setWorkspaceId = vi.fn();
const servers = vi.hoisted(() => ({
  data: [
    { id: "ws-1", name: "Alpha" },
    { id: "ws-2", name: "Beta" },
  ],
}));
const workspace = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("../state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: workspace.id, setWorkspaceId }),
}));

vi.mock("../api/useMyServers", () => ({
  useMyServers: () => ({
    data: servers.data,
    isPending: false,
    isError: false,
  }),
}));

import { useRelayStore } from "../../relay/state/useRelayStore";
import { WorkspaceSelector } from "./WorkspaceSelector";

describe("WorkspaceSelector", () => {
  beforeEach(() => {
    setWorkspaceId.mockClear();
    useRelayStore.getState().reset();
    servers.data = [
      { id: "ws-1", name: "Alpha" },
      { id: "ws-2", name: "Beta" },
    ];
    // A workspace is already chosen, so the selector does not pick the first one itself.
    workspace.id = "ws-1";
  });

  it("opens direct messages when there are no workspaces", () => {
    servers.data = [];
    workspace.id = null;
    useRelayStore.setState({
      status: "ready",
      info: { serverId: "relay", roles: [], directSpaceId: "direct" },
    });
    render(<WorkspaceSelector />);
    expect(setWorkspaceId).toHaveBeenCalledWith("direct");
  });

  it("waits for relay startup before offering the welcome board", () => {
    servers.data = [];
    workspace.id = null;
    render(<WorkspaceSelector />);
    expect(screen.getByText("Loading workspaces...")).toBeInTheDocument();
    expect(setWorkspaceId).not.toHaveBeenCalled();
  });

  it("reaches every workspace by keyboard and picks one with Enter", async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector />);
    const beta = screen.getByRole("button", { name: /Beta/ });
    await expectReachableByKeyboard(user, [screen.getByRole("button", { name: /Alpha/ }), beta]);
    beta.focus();
    await user.keyboard("{Enter}");
    expect(setWorkspaceId).toHaveBeenCalledWith("ws-2");
  });
});
