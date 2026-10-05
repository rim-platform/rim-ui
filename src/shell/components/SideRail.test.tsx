import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient, renderWithProviders } from "../../test/utils";
import { queryKeys } from "../../core/query/keys";
import { WorkspaceFeature } from "../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";

const requestMock = vi.fn();

vi.mock("../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

// Unrelated SideRail dependencies — stubbed so only the feature gate is exercised.
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

/** Answers the workspaceFeatures query; any other request never resolves. */
function serveFeatures(response: Promise<unknown>) {
  requestMock.mockImplementation((document: string) =>
    document.includes("workspaceFeatures") ? response : new Promise(() => {}),
  );
}

function incidents(enabled: boolean) {
  return Promise.resolve({
    workspaceFeatures: [{ feature: WorkspaceFeature.INCIDENTS, enabled, updatedAt: null }],
  });
}

describe("SideRail — incidents module gate", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("shows the incident history button when the feature is on", async () => {
    serveFeatures(incidents(true));
    renderWithProviders(<SideRail />);
    expect(await screen.findByRole("button", { name: "Incident history" })).toBeInTheDocument();
  });

  it("hides the incident history button when the feature is off", async () => {
    serveFeatures(incidents(false));
    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <SideRail />
      </QueryClientProvider>,
    );
    // Wait for the flag to actually resolve before asserting absence.
    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.workspaceFeatures("srv-1"))).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Incident history" })).not.toBeInTheDocument();
  });

  it("hides the incident history button while the flag is loading", () => {
    serveFeatures(new Promise(() => {}));
    renderWithProviders(<SideRail />);
    expect(screen.getByRole("button", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Incident history" })).not.toBeInTheDocument();
  });
});
