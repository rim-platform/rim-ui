import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { setWorkspaceId: (id: string) => void }) => unknown) =>
    selector({ setWorkspaceId: vi.fn() }),
}));

vi.mock("./CreateWorkspaceDialog", () => ({
  CreateWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-workspace-dialog">
      <button type="button" onClick={onClose}>Close</button>
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

describe("EmptyWorkspaceState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderComponent() {
    return render(
      <MemoryRouter>
        <EmptyWorkspaceState />
      </MemoryRouter>,
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

  it("closes the dialog when onClose is called", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByText("+ Create workspace"));
    expect(screen.getByTestId("create-workspace-dialog")).toBeInTheDocument();

    await user.click(screen.getByText("Close"));
    expect(screen.queryByTestId("create-workspace-dialog")).not.toBeInTheDocument();
  });

  it("renders the teammate invite copy", () => {
    renderComponent();
    expect(screen.getByText("Or ask a teammate to invite you.")).toBeInTheDocument();
  });
});
