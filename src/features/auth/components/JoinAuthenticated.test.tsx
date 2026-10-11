/**
 * Tests for `JoinAuthenticated` — the already-logged-in branch of the
 * `/join/:token` route.
 *
 * Coverage targets the exhaustive `switch` over `tokenType`:
 *   - `WORKSPACE` arm: renders the workspace join CTA (with and without a
 *     workspace name in the header) and wires the join button to the
 *     mutation + navigation.
 *   - `INSTANCE` arm: renders the existing-user error copy.
 *
 * The mocking style mirrors `JoinPage.test.tsx` — `vi.mock` for the
 * `useJoinServerByInviteMutation` hook, `useWorkspaceStore`, and
 * `useNavigate`. We intentionally do NOT cover the `default` arm: it is
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

vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({ data: [] }),
}));

import { JoinAuthenticated } from "./JoinAuthenticated";
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
  });

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

    it("surfaces the mutation error message", () => {
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

      expect(screen.getByText("Invite already used")).toBeInTheDocument();
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
  });
});
