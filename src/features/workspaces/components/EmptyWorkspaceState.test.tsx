import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const setWorkspaceId = vi.hoisted(() => vi.fn());
vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { setWorkspaceId: (id: string) => void }) => unknown) =>
    selector({ setWorkspaceId }),
}));

const join = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../api/useJoinServer", () => ({
  useJoinServerMutation: () => ({ ...join, reset: vi.fn(), isPending: false, error: null }),
}));
vi.mock("../../relay/remote/remoteWorkspaces", () => ({ joinWithInvite: vi.fn() }));

vi.mock("./CreateWorkspaceDialog", () => ({
  CreateWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-workspace-dialog">
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

const mockCreateMutate = vi.fn();
vi.mock("../api/useCreateServer", () => ({
  useCreateServerMutation: () => ({
    mutate: mockCreateMutate,
    isPending: false,
    error: null,
  }),
}));

import { EmptyWorkspaceState } from "./EmptyWorkspaceState";
import { expectReachableByKeyboard } from "../../../test/keyboard";

describe("EmptyWorkspaceState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderComponent() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <EmptyWorkspaceState />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("renders the empty state with create workspace button", () => {
    renderComponent();
    expect(screen.getByText("Welcome to RIM")).toBeInTheDocument();
    expect(screen.getByText("You don't belong to any workspaces yet.")).toBeInTheDocument();
    expect(screen.getByText("+ Create workspace")).toBeInTheDocument();
  });

  it("opens CreateWorkspaceDialog when button is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();

    expect(screen.queryByTestId("create-workspace-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByText("+ Create workspace"));

    expect(screen.getByTestId("create-workspace-dialog")).toBeInTheDocument();
  });

  it("reaches the create button by keyboard and opens the dialog with Enter", async () => {
    const user = userEvent.setup();
    renderComponent();
    const create = screen.getByRole("button", { name: "+ Create workspace" });
    await expectReachableByKeyboard(user, [create]);
    create.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("create-workspace-dialog")).toBeInTheDocument();
  });

  it("closes the dialog when onClose is called", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByText("+ Create workspace"));
    expect(screen.getByTestId("create-workspace-dialog")).toBeInTheDocument();

    await user.click(screen.getByText("Close"));
    expect(screen.queryByTestId("create-workspace-dialog")).not.toBeInTheDocument();
  });

  it("renders the copy on how to get an invite", () => {
    renderComponent();
    expect(
      screen.getByText("No invite yet? Ask a workspace's Owner for an invite link."),
    ).toBeInTheDocument();
  });

  it("opens the add-workspace dialog on its join form", async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByRole("button", { name: "Join with an invite code" }));
    expect(screen.getByRole("dialog", { name: "Join workspace" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("rim_inv_... or rim-invite:1:...")).toBeInTheDocument();
    expect(screen.queryByText("Join Existing")).not.toBeInTheDocument();
  });

  it("opens the joined workspace after a successful join", async () => {
    const user = userEvent.setup();
    join.mutate.mockImplementation(
      (_code: string, options: { onSuccess: (data: unknown) => void }) =>
        options.onSuccess({ joinServerByInvite: { serverId: "ws-joined" } }),
    );
    renderComponent();
    await user.click(screen.getByRole("button", { name: "Join with an invite code" }));
    await user.type(screen.getByRole("textbox"), "rim_inv_abc");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(join.mutate).toHaveBeenCalledWith("rim_inv_abc", expect.anything());
    expect(setWorkspaceId).toHaveBeenCalledWith("ws-joined");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
