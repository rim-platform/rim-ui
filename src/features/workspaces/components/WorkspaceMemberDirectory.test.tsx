import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { routeRequests, workspaceMembers } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { WorkspaceMemberDirectory } from "./WorkspaceMemberDirectory";

const members = [
  { ...workspaceMembers[0], memberRole: ServerMemberRoleGql.MODERATOR },
  {
    ...workspaceMembers[1],
    memberRole: ServerMemberRoleGql.GUEST,
    timeoutUntil: "2999-01-01T00:00:00Z",
  },
  { ...workspaceMembers[2], memberRole: ServerMemberRoleGql.MEMBER },
  {
    ...workspaceMembers[2],
    userId: "u-olga",
    username: "olga",
    displayName: "Olga",
    memberRole: ServerMemberRoleGql.OWNER,
  },
];

async function renderDirectory(viewerRole: ServerMemberRoleGql) {
  routeRequests(requestMock, {
    "query ServerMembers": () => ({ serverMembers: members }),
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole } }),
  });
  const qc = createTestQueryClient();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <WorkspaceMemberDirectory workspaceId="ws-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  await screen.findByTestId("directory-row-u-olga");
  await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
  return { onClose };
}

function rowIds() {
  return screen.getAllByTestId(/^directory-row-/).map((r) => r.dataset.testid);
}

describe("WorkspaceMemberDirectory", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("lists members by role, with badges for everyone but members and a timeout marker", async () => {
    await renderDirectory(ServerMemberRoleGql.MODERATOR);
    expect(rowIds()).toEqual([
      "directory-row-u-olga",
      "directory-row-me",
      "directory-row-u-bob",
      "directory-row-u-alice",
    ]);
    expect(
      within(screen.getByTestId("directory-row-u-olga")).getByTestId("role-badge"),
    ).toHaveTextContent("Owner");
    expect(
      within(screen.getByTestId("directory-row-me")).getByTestId("role-badge"),
    ).toHaveTextContent("Moderator");
    expect(
      within(screen.getByTestId("directory-row-u-bob")).queryByTestId("role-badge"),
    ).toBeNull();
    const alice = screen.getByTestId("directory-row-u-alice");
    expect(within(alice).getByTestId("role-badge")).toHaveTextContent("Guest");
    expect(within(alice).getByTestId("timeout-marker")).toHaveTextContent("Timed out until");
  });

  it("offers a moderator the menu on members and guests only", async () => {
    await renderDirectory(ServerMemberRoleGql.MODERATOR);
    expect(screen.getByRole("button", { name: "Moderate Alice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Moderate Bob" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Moderate Olga" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Moderate Me Myself" })).not.toBeInTheDocument();
  });

  it("offers an ordinary member no moderation menu", async () => {
    await renderDirectory(ServerMemberRoleGql.MEMBER);
    expect(screen.queryByRole("button", { name: /^Moderate / })).not.toBeInTheDocument();
  });

  it("filters by name and closes", async () => {
    const { onClose } = await renderDirectory(ServerMemberRoleGql.MEMBER);
    fireEvent.change(screen.getByLabelText("Find members"), { target: { value: "ali" } });
    expect(rowIds()).toEqual(["directory-row-u-alice"]);
    fireEvent.click(screen.getByRole("button", { name: "Close workspace members" }));
    expect(onClose).toHaveBeenCalled();
  });
});
