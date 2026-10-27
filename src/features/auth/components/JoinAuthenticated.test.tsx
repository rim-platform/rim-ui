/**
 * Tests for `JoinAuthenticated` — the already-logged-in branch of the
 * `/join/:token` route.
 *
 * Coverage targets the exhaustive `switch` over `tokenType`:
 *   - `WORKSPACE` arm: renders the workspace join CTA (with and without a
 *     workspace name in the header) and wires the join button to the
 *     mutation + navigation.
 *     An account already in the workspace is told so and offered **Open**; a revoked invite
 *     shows the dead-link page; a ban and other refusals read as one sentence.
 *   - `INSTANCE` arm: renders the existing-user error copy and **Go to RIM**.
 *
 * The mocking style mirrors `JoinPage.test.tsx` — `vi.mock` for the
 * `useJoinServerByInviteMutation` hook, `useWorkspaceStore`, and
 * `useNavigate`. The `default` arm is not covered: it is
 * unreachable under correct typing, and adding a runtime test for it would
 * require casting through `never`, defeating the compile-time guarantee
 * that is the whole point of the switch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();
const mockJoinServerMutate = vi.fn();
const mockSetWorkspaceId = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mutable mutation state so individual tests can flip `isPending` / `error`.
let mockJoinServerState: {
  mutate: typeof mockJoinServerMutate;
  isPending: boolean;
  error: Error | null;
} = {
  mutate: mockJoinServerMutate,
  isPending: false,
  error: null,
};

vi.mock("../../settings/api/useInviteMutations", () => ({
  useJoinServerByInviteMutation: () => mockJoinServerState,
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (
    selector: (s: { workspaceId: string | null; setWorkspaceId: (id: string) => void }) => unknown,
  ) => selector({ workspaceId: null, setWorkspaceId: mockSetWorkspaceId }),
}));

const myServers = vi.hoisted(() => ({
  data: [] as { id: string; name: string; owner: null }[],
}));

vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => myServers,
}));

import { graphqlError } from "../../conversations/__fixtures__/conversations";
import { JoinAuthenticated } from "./JoinAuthenticated";
import { DEAD_INVITE_MESSAGE } from "./InvalidTokenState";
import { InviteTokenType } from "../types";

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("JoinAuthenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinServerState = {
      mutate: mockJoinServerMutate,
      isPending: false,
      error: null,
    };
    myServers.data = [];
  });

  /** Renders the Acme Corp invite with the join mutation failed with `error`. */
  function renderRefused(error: Error) {
    mockJoinServerState = { mutate: mockJoinServerMutate, isPending: false, error };
    renderInRouter(
      <JoinAuthenticated
        token="rim_inv_secret"
        tokenType={InviteTokenType.WORKSPACE}
        workspaceName="Acme Corp"
        workspaceId="server-1"
      />,
    );
  }

  describe("WORKSPACE token", () => {
    it("renders the join CTA with the workspace name in the header", () => {
      renderInRouter(
        <JoinAuthenticated
          token="ws-token-abc"
          tokenType={InviteTokenType.WORKSPACE}
          workspaceName="Acme Corp"
        />,
      );

      expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join workspace" })).toBeInTheDocument();
    });

    it("falls back to a generic header when no workspace name is provided", () => {
      renderInRouter(
        <JoinAuthenticated token="ws-token-abc" tokenType={InviteTokenType.WORKSPACE} />,
      );

      expect(screen.getByText("You have been invited to join a workspace")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join workspace" })).toBeInTheDocument();
    });

    it("clicking Join workspace fires the mutation, sets workspace id, and navigates home", async () => {
      mockJoinServerMutate.mockImplementation(
        (
          _token: string,
          opts: { onSuccess: (d: { joinServerByInvite: { serverId: string } }) => void },
        ) => {
          opts.onSuccess({ joinServerByInvite: { serverId: "server-xyz" } });
        },
      );

      const user = userEvent.setup();
      renderInRouter(
        <JoinAuthenticated
          token="ws-token-abc"
          tokenType={InviteTokenType.WORKSPACE}
          workspaceName="Acme Corp"
        />,
      );

      await user.click(screen.getByRole("button", { name: "Join workspace" }));

      expect(mockJoinServerMutate).toHaveBeenCalledWith("ws-token-abc", expect.any(Object));
      expect(mockSetWorkspaceId).toHaveBeenCalledWith("server-xyz");
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });

    it("shows the pending label and disables the button while the mutation is in flight", () => {
      mockJoinServerState = {
        mutate: mockJoinServerMutate,
        isPending: true,
        error: null,
      };

      renderInRouter(
        <JoinAuthenticated
          token="ws-token-abc"
          tokenType={InviteTokenType.WORKSPACE}
          workspaceName="Acme Corp"
        />,
      );

      const button = screen.getByRole("button", { name: "Joining..." });
      expect(button).toBeDisabled();
    });

    it("surfaces the mutation error as a sentence", () => {
      mockJoinServerState = {
        mutate: mockJoinServerMutate,
        isPending: false,
        error: new Error("Invite already used"),
      };

      renderInRouter(
        <JoinAuthenticated
          token="ws-token-abc"
          tokenType={InviteTokenType.WORKSPACE}
          workspaceName="Acme Corp"
        />,
      );

      expect(screen.getByText("Invite already used.")).toBeInTheDocument();
    });

    it("says the account is already a member and opens the workspace", async () => {
      myServers.data = [{ id: "server-1", name: "Acme Corp", owner: null }];
      const user = userEvent.setup();
      renderInRouter(
        <JoinAuthenticated
          token="ws-token-abc"
          tokenType={InviteTokenType.WORKSPACE}
          workspaceName="Acme Corp"
          workspaceId="server-1"
        />,
      );

      expect(screen.getByText("You're already a member of Acme Corp.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Join workspace" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Open Acme Corp" }));
      expect(mockSetWorkspaceId).toHaveBeenCalledWith("server-1");
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });

    it("turns a CONFLICT refusal into the member state", () => {
      renderRefused(graphqlError("CONFLICT", "already a member of this server"));

      expect(screen.getByText("You're already a member of Acme Corp.")).toBeInTheDocument();
      expect(screen.queryByText(/rim_inv_|serialized/)).not.toBeInTheDocument();
    });

    it("shows the dead-link page when the invite was revoked", async () => {
      renderRefused(graphqlError("FORBIDDEN", "permission denied"));

      expect(screen.getByText(DEAD_INVITE_MESSAGE)).toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Go to RIM" }));
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });

    it("says a banned account is banned", () => {
      renderRefused(graphqlError("FORBIDDEN", "you are banned from this workspace"));

      expect(screen.getByText("You are banned from this workspace.")).toBeInTheDocument();
      expect(screen.queryByText(DEAD_INVITE_MESSAGE)).not.toBeInTheDocument();
    });
  });

  describe("INSTANCE token", () => {
    it("renders the existing-user error copy and no join button", () => {
      renderInRouter(
        <JoinAuthenticated token="inst-token-abc" tokenType={InviteTokenType.INSTANCE} />,
      );

      expect(
        screen.getByText(
          "You already have a RIM account; instance invites are only for new users.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Join workspace" })).not.toBeInTheDocument();
    });

    it("offers Go to RIM", async () => {
      const user = userEvent.setup();
      renderInRouter(
        <JoinAuthenticated token="inst-token-abc" tokenType={InviteTokenType.INSTANCE} />,
      );

      await user.click(screen.getByRole("button", { name: "Go to RIM" }));
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });
});
