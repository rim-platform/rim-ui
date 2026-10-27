import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { fakeServerInfo } from "../../../test/serverInfo";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { WORKSPACE_RENAME } from "../../updater/api/serverCapabilities";
import { useWorkspaceActionStore } from "../../workspaces/state/useWorkspaceActionStore";
import { WorkspaceNameSettings } from "./WorkspaceNameSettings";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: () => new Promise(() => {}) },
}));

function renderSettings(role: ServerMemberRoleGql, capabilities: string[] = [WORKSPACE_RENAME]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.server("ws-1"), { id: "ws-1", name: "Acme", viewerRole: role });
  qc.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
  render(
    <QueryClientProvider client={qc}>
      <WorkspaceNameSettings serverId="ws-1" />
    </QueryClientProvider>,
  );
}

describe("WorkspaceNameSettings", () => {
  beforeEach(() => useWorkspaceActionStore.setState({ action: null }));
  afterEach(() => useRelayStore.getState().reset());

  it("shows the owner the name and opens the rename dialog", async () => {
    renderSettings(ServerMemberRoleGql.OWNER);
    expect(screen.getByRole("heading", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rename…" }));

    expect(useWorkspaceActionStore.getState().action).toEqual({
      kind: "rename",
      workspaceId: "ws-1",
    });
  });

  it("is not shown to a moderator", () => {
    renderSettings(ServerMemberRoleGql.MODERATOR);
    expect(screen.queryByRole("heading", { name: "Name" })).not.toBeInTheDocument();
  });

  it("is not shown on a server without the capability", () => {
    renderSettings(ServerMemberRoleGql.OWNER, []);
    expect(screen.queryByRole("heading", { name: "Name" })).not.toBeInTheDocument();
  });

  it("is not shown in the direct space", () => {
    useRelayStore.setState({
      info: { serverId: "rims1_here", roles: ["host"], directSpaceId: "ws-1" },
    });
    renderSettings(ServerMemberRoleGql.OWNER);
    expect(screen.queryByRole("heading", { name: "Name" })).not.toBeInTheDocument();
  });
});
