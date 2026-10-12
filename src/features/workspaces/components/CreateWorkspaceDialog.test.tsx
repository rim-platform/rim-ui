import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClientError } from "graphql-request";

import { createTestQueryClient } from "../../../test/utils";
import { LIMITS_USER_ID, limitsQueryClient } from "../../../test/limits";
import { queryKeys } from "../../../core/query/keys";
import type { ServerLimits } from "../../../core/graphql/generated/schema-types";
import type { Server } from "../api/useMyServers";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

beforeEach(() => vi.clearAllMocks());

function workspace(id: string, ownerId: string | null): Server {
  return {
    id,
    name: id,
    owner: ownerId ? { id: ownerId, username: ownerId, displayName: null } : null,
  };
}

/** Two workspaces this account owns, one someone else owns and the direct space. */
const SERVERS = [
  workspace("ws-1", LIMITS_USER_ID),
  workspace("ws-2", LIMITS_USER_ID),
  workspace("ws-3", "someone-else"),
  workspace("direct", null),
];

/** Renders the dialog against `caps`, the account's `SERVERS` and its probation, if any. */
async function renderWithCaps(caps: Partial<ServerLimits>, probationEndsAt?: string) {
  const client = limitsQueryClient(caps, probationEndsAt);
  client.setQueryData(queryKeys.myServers(), SERVERS);
  render(
    <QueryClientProvider client={client}>
      <CreateWorkspaceDialog onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  await userEvent.setup().type(screen.getByRole("textbox"), "Ops");
}

describe("CreateWorkspaceDialog", () => {
  it("shows the server's message when the workspace is refused", async () => {
    const user = userEvent.setup();
    const message = "You already own a workspace named Ops";
    requestMock.mockRejectedValue(
      new ClientError(
        {
          status: 200,
          headers: new Headers(),
          errors: [{ message, extensions: { code: "CONFLICT" } }],
        },
        { query: "" },
      ),
    );
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <CreateWorkspaceDialog onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await user.type(screen.getByRole("textbox"), "Ops");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/"response"/)).not.toBeInTheDocument();
  });

  it("counts the workspaces this account owns against the cap", async () => {
    await renderWithCaps({ workspacesPerUser: 5 });
    expect(screen.getByTestId("limit-note")).toHaveTextContent(/^2 of 5 workspaces$/);
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("refuses a new workspace at the cap, with the reason", async () => {
    await renderWithCaps({ workspacesPerUser: 2 });
    expect(screen.getByTestId("limit-note")).toHaveTextContent(
      "2 of 2 workspaces. This instance allows 2 workspaces per user.",
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("shows no count on a server without a workspace cap", async () => {
    await renderWithCaps({});
    expect(screen.queryByTestId("limit-note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("says when a new account on probation can create one, instead of failing", async () => {
    await renderWithCaps({}, new Date(Date.now() + 3_600_000).toISOString());
    expect(screen.getByTestId("workspace-creation-blocked")).toHaveTextContent(
      /^New account: you can create workspaces after .+\.$/,
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
