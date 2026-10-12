import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { DELETION_UNSUPPORTED, deletionQueryClient } from "../../../test/accountDeletion";
import {
  callsTo,
  routeRequests,
  workspaceMembers,
} from "../../conversations/__fixtures__/conversations";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { handleMemberLeft } from "../../workspaces/state/memberEvents";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { WorkspaceOwnerSettings } from "./WorkspaceOwnerSettings";

/** The fixture members with `me` as owner, Bob a moderator, and a guest. */
const members = [
  { ...workspaceMembers[0], memberRole: ServerMemberRoleGql.OWNER },
  workspaceMembers[1],
  { ...workspaceMembers[2], memberRole: ServerMemberRoleGql.MODERATOR },
  {
    ...workspaceMembers[1],
    userId: "u-gina",
    username: "gina",
    displayName: "Gina",
    memberRole: ServerMemberRoleGql.GUEST,
  },
];

function serve(
  viewerRole: ServerMemberRoleGql = ServerMemberRoleGql.OWNER,
  extra: Record<string, (vars: Record<string, unknown>) => unknown> = {},
) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole } }),
    "query ServerMembers": () => ({ serverMembers: members }),
    "mutation TransferWorkspaceOwnership": () => ({
      transferWorkspaceOwnership: {
        id: "ws-1",
        name: "Acme",
        viewerRole: ServerMemberRoleGql.MODERATOR,
      },
    }),
    "mutation DeleteWorkspace": () => ({ deleteWorkspace: { deleted: true } }),
    ...extra,
  });
}

function renderOwner(qc: QueryClient = deletionQueryClient()) {
  qc.setQueryData(queryKeys.myServers(), [{ id: "ws-1" }, { id: "ws-2" }]);
  render(
    <QueryClientProvider client={qc}>
      <WorkspaceOwnerSettings serverId="ws-1" />
    </QueryClientProvider>,
  );
  return qc;
}

const railIds = (qc: QueryClient) =>
  qc.getQueryData<{ id: string }[]>(queryKeys.myServers())?.map((s) => s.id);

async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Delete workspace" }));
  const dialog = screen.getByTestId("moderation-dialog");
  // The dialog focuses Cancel a couple of frames after it opens; type after that.
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
  return dialog;
}

describe("WorkspaceOwnerSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.info).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.getState().reset();
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("shows nothing to a moderator, or to the owner on a server without these actions", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    renderOwner();
    await waitFor(() => expect(callsTo(requestMock, "query Server(")).toHaveLength(1));
    expect(screen.queryByText("Ownership")).not.toBeInTheDocument();

    serve();
    renderOwner(deletionQueryClient(DELETION_UNSUPPORTED));
    await waitFor(() => expect(callsTo(requestMock, "query Server(")).toHaveLength(2));
    expect(screen.queryByText("Ownership")).not.toBeInTheDocument();
  });

  it("hands the workspace to a member who is not a guest, and the owner becomes a moderator", async () => {
    serve();
    const user = userEvent.setup();
    renderOwner();

    const picker = await screen.findByLabelText("New owner");
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(3));
    const offered = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(offered).toEqual(["Pick a member", "Alice (@alice)", "Bob (@bob)"]);
    expect(screen.getByRole("button", { name: "Transfer ownership" })).toBeDisabled();

    await user.selectOptions(picker, "u-bob");
    await user.click(screen.getByRole("button", { name: "Transfer ownership" }));
    const dialog = screen.getByTestId("moderation-dialog");
    expect(dialog).toHaveTextContent("Bob becomes the owner of Acme and you become a moderator");
    await user.click(within(dialog).getByRole("button", { name: "Transfer" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation TransferWorkspaceOwnership")).toEqual([
        { input: { serverId: "ws-1", userId: "u-bob" } },
      ]),
    );
    await waitFor(() => expect(screen.queryByText("Ownership")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Bob now owns Acme");
  });

  it("deletes the workspace only with its name typed back, and leaves it", async () => {
    serve();
    const user = userEvent.setup();
    const qc = renderOwner();

    const dialog = await openDeleteDialog(user);
    const confirm = within(dialog).getByRole("button", { name: "Delete workspace" });
    await user.type(within(dialog).getByLabelText(/Type the workspace name/), "Acm");
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(callsTo(requestMock, "mutation DeleteWorkspace")).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Type the workspace name/), "e");
    await user.click(confirm);

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation DeleteWorkspace")).toEqual([
        { input: { serverId: "ws-1", confirmName: "Acme" } },
      ]),
    );
    await waitFor(() => expect(railIds(qc)).toEqual(["ws-2"]));
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Deleted Acme");
  });

  it("drops the workspace from the rail on the MemberLeft the deletion sends, without a removal toast", async () => {
    let answer: (value: unknown) => void = () => {};
    serve(ServerMemberRoleGql.OWNER, {
      "mutation DeleteWorkspace": () => new Promise((resolve) => (answer = resolve)),
    });
    const user = userEvent.setup();
    const qc = renderOwner();

    const dialog = await openDeleteDialog(user);
    await user.type(within(dialog).getByLabelText(/Type the workspace name/), "Acme");
    await user.click(within(dialog).getByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(callsTo(requestMock, "mutation DeleteWorkspace")).toHaveLength(1));

    handleMemberLeft(qc, "ws-1", "me");
    expect(railIds(qc)).toEqual(["ws-2"]);
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();

    answer({ deleteWorkspace: { deleted: true } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deleted Acme"));
    expect(railIds(qc)).toEqual(["ws-2"]);
  });
});
