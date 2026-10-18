import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import vectors from "../../../../protocol/relay-vectors.json";

const remote = vi.hoisted(() => ({ joinWithInvite: vi.fn() }));
vi.mock("../../relay/remote/remoteWorkspaces", () => remote);
const local = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../api/useJoinServer", () => ({
  useJoinServerMutation: () => ({ ...local, reset: vi.fn(), isPending: false, error: null }),
}));

import { withLimits } from "../../../test/limits";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog";

const LINK = `rim-invite:1:${vectors.host.serverId}:${vectors.host.keyHash}:rim_inv_x:https://host.example`;

function renderDialog(onClose = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <AddWorkspaceDialog onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => vi.clearAllMocks());

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
