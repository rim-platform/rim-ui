import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import { WorkspaceStateScopeGql } from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { WorkspaceStateSettings } from "./WorkspaceStateSettings";

/** The scope of every list request sent so far, in order. */
function listedScopes(): unknown[] {
  return requestMock.mock.calls
    .filter(([doc]) => String(doc).includes("query WorkspaceStateList"))
    .map(([, vars]) => (vars as { scope: unknown }).scope);
}

describe("WorkspaceStateSettings scopes", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ workspaceStateList: [] });
  });

  it("names the scopes Workspace and User, never Server", async () => {
    render(<WorkspaceStateSettings serverId="ws-1" />);

    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User" })).toBeInTheDocument();
    expect(screen.queryByText(/server/i)).not.toBeInTheDocument();
    expect(await screen.findByText("No workspace-scoped entries yet.")).toBeInTheDocument();
  });

  it("keeps the GraphQL scope values behind the labels", async () => {
    render(<WorkspaceStateSettings serverId="ws-1" />);
    await waitFor(() => expect(listedScopes()).toEqual([WorkspaceStateScopeGql.SERVER]));

    fireEvent.click(screen.getByRole("button", { name: "User" }));
    await waitFor(() =>
      expect(listedScopes()).toEqual([WorkspaceStateScopeGql.SERVER, WorkspaceStateScopeGql.USER]),
    );
    expect(await screen.findByText("No user-scoped entries yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(await screen.findByText("No workspace-scoped entries yet.")).toBeInTheDocument();
  });
});
