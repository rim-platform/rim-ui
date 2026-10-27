import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import {
  ServerMemberRoleGql,
  WorkspaceStateScopeGql,
} from "../../../core/graphql/generated/schema-types";

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

describe("WorkspaceStateSettings for a guest", () => {
  const entry = (scope: WorkspaceStateScopeGql) => ({
    id: `e-${scope}`,
    key: scope === WorkspaceStateScopeGql.SERVER ? "release.channel" : "my.layout",
    scope,
    serverId: "ws-1",
    userId: scope === WorkspaceStateScopeGql.USER ? "me" : null,
    value: { on: true },
    version: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
  });

  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((doc: unknown, vars: { scope?: WorkspaceStateScopeGql }) => {
      if (String(doc).includes("query Server(")) {
        return Promise.resolve({
          server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.GUEST },
        });
      }
      if (String(doc).includes("query WorkspaceStateList")) {
        return Promise.resolve({ workspaceStateList: [entry(vars.scope!)] });
      }
      return new Promise(() => {});
    });
  });

  it("offers a guest no New entry, Edit or Delete in the workspace scope, and all of them in the user scope", async () => {
    render(<WorkspaceStateSettings serverId="ws-1" />);

    expect(
      await screen.findByText("Guests read workspace entries; members change them."),
    ).toBeInTheDocument();
    expect(screen.getByText("release.channel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New entry" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "User" }));
    expect(await screen.findByText("my.layout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New entry" })).toBeInTheDocument();
    expect(screen.getByTitle("Edit")).toBeInTheDocument();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
    expect(
      screen.queryByText("Guests read workspace entries; members change them."),
    ).not.toBeInTheDocument();
  });
});
