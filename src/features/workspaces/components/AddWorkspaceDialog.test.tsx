import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import vectors from "../../../../protocol/relay-vectors.json";

const remote = vi.hoisted(() => ({
  joinWithInvite: vi.fn(),
  previewPublicLink: vi.fn(),
  joinWithPublicLink: vi.fn(),
}));
vi.mock("../../relay/remote/remoteWorkspaces", () => remote);
// The account's requests filed at other servers.
const pendingRemote = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock("../../relay/remote/pendingRemoteJoins", () => ({
  usePendingRemoteJoins: () => pendingRemote.entries,
}));
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

import {
  JoinByPublicLinkOutcome,
  PublicJoinLinkMode,
} from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { withLimits } from "../../../test/limits";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog";

const REMOTE_LINK = "https://host.example/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";
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
  pendingRemote.entries = [];
});

/** Opens the join form and pastes `text` into it. */
async function paste(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByText("Join Existing"));
  await user.click(screen.getByRole("textbox"));
  await user.paste(text);
}

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
    await user.paste(`${window.location.origin}/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA`);
    expect(screen.getByText(/This is a workspace's public link/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA");
    expect(local.mutate).not.toHaveBeenCalled();
    expect(remote.joinWithInvite).not.toHaveBeenCalled();
  });

  describe("a public link of another server", () => {
    it("looks it up on Continue, then joins directly and opens the workspace", async () => {
      remote.previewPublicLink.mockResolvedValue({
        workspaceName: "Acme",
        mode: PublicJoinLinkMode.DIRECT,
        hostServerId: "rims1_host",
        hostOrigin: "https://host.example",
      });
      remote.joinWithPublicLink.mockResolvedValue({
        outcome: JoinByPublicLinkOutcome.JOINED,
        hostServerId: "rims1_host",
        workspaceId: "ws-acme",
        role: "member",
      });
      const user = userEvent.setup();
      const onClose = renderDialog();
      await paste(user, REMOTE_LINK);
      expect(screen.getByText(/public link of a workspace on host.example/)).toBeInTheDocument();
      expect(remote.previewPublicLink).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(remote.previewPublicLink).toHaveBeenCalledWith(REMOTE_LINK, expect.anything());
      expect(await screen.findByText(/Anyone with the link can join/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Message/)).toBeNull();

      await user.click(screen.getByRole("button", { name: "Join Acme" }));
      await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(remote.joinWithPublicLink).toHaveBeenCalledWith(REMOTE_LINK, undefined);
      expect(useWorkspaceStore.getState().workspaceId).toBe("ws-acme");
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(local.mutate).not.toHaveBeenCalled();
    });

    it("asks to join with a message and says the moderators decide", async () => {
      remote.previewPublicLink.mockResolvedValue({
        workspaceName: "Acme",
        mode: PublicJoinLinkMode.REQUESTS,
        hostServerId: "rims1_host",
        hostOrigin: "https://host.example",
      });
      remote.joinWithPublicLink.mockResolvedValue({
        outcome: JoinByPublicLinkOutcome.REQUESTED,
        hostServerId: "rims1_host",
        workspaceId: "ws-acme",
        workspaceName: "Acme",
        joinRequestId: "jr-1",
        expiresAt: Date.now() + 1000,
      });
      const user = userEvent.setup();
      const onClose = renderDialog();
      await paste(user, REMOTE_LINK);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.type(await screen.findByLabelText("Message (optional)"), "  Hi there  ");
      await user.click(screen.getByRole("button", { name: "Ask to join" }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Waiting for the moderators of Acme. You'll be told when they decide.",
      );
      expect(remote.joinWithPublicLink).toHaveBeenCalledWith(REMOTE_LINK, "Hi there");
      expect(onClose).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(onClose).toHaveBeenCalled();
    });

    it("holds a message longer than 500 characters", async () => {
      remote.previewPublicLink.mockResolvedValue({
        workspaceName: "Acme",
        mode: PublicJoinLinkMode.REQUESTS,
        hostServerId: "rims1_host",
        hostOrigin: "https://host.example",
      });
      const user = userEvent.setup();
      renderDialog();
      await paste(user, REMOTE_LINK);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(await screen.findByLabelText("Message (optional)"));
      await user.paste("x".repeat(501));
      expect(screen.getByRole("button", { name: "Ask to join" })).toBeDisabled();
      expect(screen.getByText("501 / 500")).toBeInTheDocument();
    });

    it.each([
      ["NOT_FOUND", "not found", "This link isn't valid."],
      [
        "FORBIDDEN",
        "this workspace's public link does not admit accounts from other servers",
        "This workspace's public link does not admit accounts from other servers.",
      ],
    ])("reads a lookup's %s error", async (code, message, shown) => {
      remote.previewPublicLink.mockRejectedValue(
        Object.assign(new Error(message), {
          response: { errors: [{ message, extensions: { code } }] },
        }),
      );
      const user = userEvent.setup();
      renderDialog();
      await paste(user, REMOTE_LINK);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(shown);
      expect(remote.joinWithPublicLink).not.toHaveBeenCalled();
    });
  });

  it("lists requests filed at other servers with their server and without Withdraw", () => {
    pendingRemote.entries = [
      {
        hostServerId: "rims1_host",
        hostOrigin: "https://host.example",
        workspaceId: "ws-acme",
        workspaceName: "Acme",
        joinRequestId: "jr-9",
        expiresAt: Date.now() + 1000,
      },
    ];
    renderDialog();
    expect(screen.getByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(screen.getByTestId("remote-join-request-jr-9")).toHaveTextContent("AcmeOn host.example");
    expect(screen.queryByRole("button", { name: /Withdraw/ })).toBeNull();
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
