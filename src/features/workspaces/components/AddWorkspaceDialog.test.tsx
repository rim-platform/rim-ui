import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import vectors from "../../../../protocol/relay-vectors.json";

const remote = vi.hoisted(() => ({ joinWithInvite: vi.fn() }));
vi.mock("../../relay/remote/remoteWorkspaces", () => remote);
const local = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../api/useJoinServer", () => ({
  useJoinServerMutation: () => ({ ...local, reset: vi.fn(), isPending: false, error: null }),
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
// The viewer's open join requests, and the withdrawal of one.
const myRequests = vi.hoisted(() => ({
  data: [] as unknown[],
  withdraw: vi.fn(),
}));
vi.mock("../api/publicJoinLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/publicJoinLink")>()),
  useMyJoinRequests: () => ({ data: myRequests.data }),
  useWithdrawJoinRequest: () => ({
    mutate: myRequests.withdraw,
    isPending: false,
    variables: undefined,
  }),
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { withLimits } from "../../../test/limits";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog";

const LINK = `rim-invite:1:${vectors.host.serverId}:${vectors.host.keyHash}:rim_inv_x:https://host.example`;

function renderDialog(onClose = vi.fn()) {
  const qc = new QueryClient();
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <AddWorkspaceDialog onClose={onClose} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  myRequests.data = [];
});

describe("AddWorkspaceDialog", () => {
  it("joins a workspace on another server from a rim-invite link", async () => {
    const user = userEvent.setup();
    remote.joinWithInvite.mockResolvedValue({
      hostServerId: vectors.host.serverId,
      workspaceId: "ws-remote",
      role: "member",
    });
    const onClose = renderDialog();
    await user.click(screen.getByText("Join Existing"));
    await user.click(screen.getByRole("textbox"));
    await user.paste(LINK);
    expect(screen.getByText(/This workspace is on another server/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Join" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(remote.joinWithInvite.mock.calls[0][0]).toBe(LINK);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-remote");
    expect(local.mutate).not.toHaveBeenCalled();
  });

  it("shows why a remote join failed", async () => {
    const user = userEvent.setup();
    remote.joinWithInvite.mockRejectedValue(
      new Error("This invite names a key the server no longer uses."),
    );
    renderDialog();
    await user.click(screen.getByText("Join Existing"));
    await user.click(screen.getByRole("textbox"));
    await user.paste(LINK);
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText(/names a key the server no longer uses/)).toBeInTheDocument();
  });

  it.each([
    ["NOT_FOUND", "not found", "Invalid invite code."],
    ["FORBIDDEN", "the invite has expired", "This invite is expired or revoked."],
    [
      "UPSTREAM_UNAVAILABLE",
      "server rims1_h is unavailable",
      "Another server this needs could not be reached. Try again later.",
    ],
  ])("reads a remote join's %s error", async (code, message, shown) => {
    const user = userEvent.setup();
    remote.joinWithInvite.mockRejectedValue(
      Object.assign(new Error(`${message}: {"response":{}}`), {
        response: { errors: [{ message, extensions: { code } }] },
      }),
    );
    renderDialog();
    await user.click(screen.getByText("Join Existing"));
    await user.click(screen.getByRole("textbox"));
    await user.paste(LINK);
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText(shown)).toBeInTheDocument();
  });

  it("opens on the join form when asked, and Back leads to the choice", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddWorkspaceDialog initialStep="join" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Join workspace" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Join Existing")).toBeInTheDocument();
    expect(screen.getByText("Create New")).toBeInTheDocument();
  });

  it("keeps plain invite codes on this server", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByText("Join Existing"));
    await user.type(screen.getByRole("textbox"), "rim_inv_local");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(local.mutate).toHaveBeenCalledWith("rim_inv_local", expect.anything());
    expect(remote.joinWithInvite).not.toHaveBeenCalled();
  });

  it("joins with the token of a pasted invite link of this server", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByText("Join Existing"));
    await user.click(screen.getByRole("textbox"));
    await user.paste("https://rim.example.org/join/rim_inv_local\n");
    expect(screen.queryByText(/This workspace is on another server/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(local.mutate).toHaveBeenCalledWith("rim_inv_local", expect.anything());
    expect(remote.joinWithInvite).not.toHaveBeenCalled();
  });

  it("opens the join page of a pasted public link instead of joining with it", async () => {
    const user = userEvent.setup();
    const onClose = renderDialog();
    await user.click(screen.getByText("Join Existing"));
    await user.click(screen.getByRole("textbox"));
    await user.paste("https://rim.example.org/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA");
    expect(screen.getByText(/This is a workspace's public link/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA");
    expect(local.mutate).not.toHaveBeenCalled();
    expect(remote.joinWithInvite).not.toHaveBeenCalled();
  });

  it("lists the person's open join requests under Waiting for approval, with Withdraw", async () => {
    myRequests.data = [
      {
        id: "jr-1",
        serverId: "ws-acme",
        workspaceName: "Acme",
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
    ];
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(screen.getByTestId("my-join-request-jr-1")).toHaveTextContent("AcmeAsked 3h ago");
    await user.click(screen.getByRole("button", { name: "Withdraw your request to join Acme" }));
    expect(myRequests.withdraw).toHaveBeenCalledWith("jr-1", expect.anything());

    myRequests.withdraw.mock.calls[0][1].onSuccess();
    expect(toast.success).toHaveBeenCalledWith("Withdrew your request to join Acme");
  });

  it("shows no Waiting for approval without open requests", () => {
    renderDialog();
    expect(screen.queryByRole("heading", { name: "Waiting for approval" })).toBeNull();
  });

  it("gives a new account on probation the reason on the create choice and holds the form", async () => {
    const user = userEvent.setup();
    render(<AddWorkspaceDialog onClose={vi.fn()} />, {
      wrapper: withLimits({}, new Date(Date.now() + 3_600_000).toISOString()),
    });
    expect(screen.getByText(/^New account: you can create workspaces after/)).toBeInTheDocument();
    await user.click(screen.getByText("Create New"));
    await user.type(screen.getByRole("textbox"), "Ops");
    expect(screen.getByTestId("workspace-creation-blocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});
