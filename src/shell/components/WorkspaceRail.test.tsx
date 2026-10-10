import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { expectReachableByKeyboard } from "../../test/keyboard";

// Mock the hooks that WorkspaceRail uses
vi.mock("../../features/workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ workspaceId: "ws-1", setWorkspaceId: vi.fn() }),
  ),
}));

vi.mock("../../features/workspaces/api/useMyServers", () => ({
  useMyServers: () => ({
    data: [
      { id: "ws-1", name: "Alpha" },
      { id: "ws-2", name: "Beta" },
    ],
  }),
}));

vi.mock("../../features/workspaces/components/AddWorkspaceDialog", () => ({
  AddWorkspaceDialog: () => null,
}));

import { WorkspaceRail } from "./WorkspaceRail";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("WorkspaceRail", () => {
  it("renders workspace buttons for each server", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByTitle("Alpha")).toBeInTheDocument();
    expect(screen.getByTitle("Beta")).toBeInTheDocument();
  });

  it("renders first letter of workspace name", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByTitle("Alpha")).toHaveTextContent("A");
    expect(screen.getByTitle("Beta")).toHaveTextContent("B");
  });

  it("renders add workspace button", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByTitle("Add workspace")).toBeInTheDocument();
  });

  it("reaches every workspace and the add button by keyboard, and moves with the arrows", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WorkspaceRail />);
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    const add = screen.getByRole("button", { name: "Add workspace" });
    await expectReachableByKeyboard(user, [alpha, beta, add]);
    expect(alpha).toHaveAttribute("aria-pressed", "true");

    alpha.focus();
    await user.keyboard("{ArrowDown}");
    expect(beta).toHaveFocus();
    await user.keyboard("{End}");
    expect(add).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(beta).toHaveFocus();
  });
});
