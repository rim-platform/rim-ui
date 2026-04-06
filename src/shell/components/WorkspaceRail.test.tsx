import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
});
