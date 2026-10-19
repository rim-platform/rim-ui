import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import {
  ServerMemberRoleGql,
  WorkspaceInviteState,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { serverInfoQueryClient } from "../../../test/serverInfo";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { WorkspaceInviteRow } from "../api/useWorkspaceInvites";

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
import { WorkspaceInvites, inviteExpiryLabel } from "./WorkspaceInvites";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function invite(id: string, overrides: Partial<WorkspaceInviteRow> = {}): WorkspaceInviteRow {
  return {
    id,
    role: ServerMemberRoleGql.MEMBER,
    useCount: 0,
    maxUses: 10,
    expiresAt: new Date(NOW + 7 * DAY).toISOString(),
    createdAt: new Date(NOW - DAY).toISOString(),
    createdById: "me",
    revokedAt: null,
    state: WorkspaceInviteState.ACTIVE,
    createdBy: { id: "me", username: "me", displayName: "Me Myself", avatarUrl: null },
    ...overrides,
  };
}

const active = invite("inv-active", { useCount: 2 });
const expired = invite("inv-expired", {
  expiresAt: new Date(NOW - 2 * DAY).toISOString(),
  state: WorkspaceInviteState.EXPIRED,
});
const usedUp = invite("inv-used", {
  role: ServerMemberRoleGql.GUEST,
  useCount: 1,
  maxUses: 1,
  state: WorkspaceInviteState.USED_UP,
});
const revoked = invite("inv-revoked", {
  revokedAt: new Date(NOW - 3 * DAY).toISOString(),
  state: WorkspaceInviteState.REVOKED,
  createdBy: null,
});
const older = invite("inv-older", { createdAt: new Date(NOW - 20 * DAY).toISOString() });

function page(items: WorkspaceInviteRow[], next: string | null) {
  return {
    workspaceInvites: {
      items,
      next: next ? { createdAt: "2026-10-01T00:00:00Z", inviteId: next } : null,
      prev: null,
      pageInfo: { hasNext: next !== null, hasPrev: false },
    },
  };
}

function serve(
  viewerRole: ServerMemberRoleGql = ServerMemberRoleGql.OWNER,
  extra: Record<string, (vars: Record<string, unknown>) => unknown> = {},
) {
  let revokedNow = false;
  routeRequests(requestMock, {
    "query Server(": (vars) => ({ server: { id: vars.serverId, name: "Acme", viewerRole } }),
    "query WorkspaceInvites": (vars) => {
      if (vars.cursor) return page([older], null);
      const first = revokedNow
        ? { ...active, state: WorkspaceInviteState.REVOKED, revokedAt: new Date().toISOString() }
        : active;
      return page([first, expired, usedUp, revoked], "inv-revoked");
    },
    "mutation RevokeInvite": (vars) => {
      revokedNow = true;
      return {
        revokeInvite: {
          id: vars.inviteId,
          state: WorkspaceInviteState.REVOKED,
          revokedAt: new Date().toISOString(),
        },
      };
    },
    ...extra,
  });
}

function renderInvites(serverId = "ws-1") {
  const qc = serverInfoQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <WorkspaceInvites serverId={serverId} />
    </QueryClientProvider>,
  );
  return qc;
}

const row = (id: string) => screen.getByTestId(`invite-row-${id}`);

describe("WorkspaceInvites", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useRelayStore.getState().reset();
  });

  it("lists every invite newest first with its role, uses, expiry, creator and state", async () => {
    serve();
    renderInvites();

    const list = await screen.findByRole("list", { name: "Invites" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.dataset.testid),
    ).toEqual([
      "invite-row-inv-active",
      "invite-row-inv-expired",
      "invite-row-inv-used",
      "invite-row-inv-revoked",
    ]);
    expect(callsTo(requestMock, "query WorkspaceInvites")[0]).toEqual({
      serverId: "ws-1",
      dir: "AFTER",
      cursor: null,
      limit: 50,
    });

    expect(row("inv-active")).toHaveTextContent("Member invite");
    expect(row("inv-active")).toHaveTextContent("Active");
    expect(row("inv-active")).toHaveTextContent("2 of 10 uses");
    expect(row("inv-active")).toHaveTextContent(/Expires in \d+ days/);
    expect(row("inv-active")).toHaveTextContent("Created by Me Myself");
    expect(row("inv-expired")).toHaveTextContent("Expired");
    expect(row("inv-expired")).toHaveTextContent(/Expired \dd ago/);
    expect(row("inv-used")).toHaveTextContent("Guest invite");
    expect(row("inv-used")).toHaveTextContent("Used up");
    expect(row("inv-used")).toHaveTextContent("1 of 1 use");
    expect(row("inv-revoked")).toHaveTextContent(/Revoked \dd ago/);
    expect(row("inv-revoked")).toHaveTextContent("Created by a deleted account");

    expect(within(row("inv-active")).getByRole("button", { name: /^Revoke/ })).toBeInTheDocument();
    for (const id of ["inv-expired", "inv-used", "inv-revoked"]) {
      expect(within(row(id)).queryByRole("button", { name: /^Revoke/ })).not.toBeInTheDocument();
    }
  });

  it("loads older invites through the page's next cursor", async () => {
    serve();
    const user = userEvent.setup();
    renderInvites();

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByTestId("invite-row-inv-older")).toBeInTheDocument());
    expect(callsTo(requestMock, "query WorkspaceInvites")[1]).toEqual({
      serverId: "ws-1",
      dir: "AFTER",
      cursor: { createdAt: "2026-10-01T00:00:00Z", inviteId: "inv-revoked" },
      limit: 50,
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("revokes an active invite after the confirm step and refreshes the list", async () => {
    serve();
    const user = userEvent.setup();
    renderInvites();

    await user.click(
      within(await screen.findByTestId("invite-row-inv-active")).getByRole("button", {
        name: /^Revoke/,
      }),
    );
    const dialog = screen.getByTestId("moderation-dialog");
    expect(screen.getByRole("dialog", { name: "Revoke this invite?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The 2 people who already joined with it stay.");
    expect(callsTo(requestMock, "mutation RevokeInvite")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Revoke invite" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation RevokeInvite")).toEqual([{ inviteId: "inv-active" }]),
    );
    expect(toast.success).toHaveBeenCalledWith("Invite revoked");
    await waitFor(() => expect(row("inv-active")).toHaveTextContent("Revoked"));
    expect(
      within(row("inv-active")).queryByRole("button", { name: /^Revoke/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("moderation-dialog")).not.toBeInTheDocument();
  });

  it("keeps the confirm step open with the server's message when revoking fails", async () => {
    serve(ServerMemberRoleGql.OWNER, {
      "mutation RevokeInvite": () => {
        throw graphqlError("FORBIDDEN", "only the owner can revoke invites");
      },
    });
    const user = userEvent.setup();
    renderInvites();

    await user.click(
      within(await screen.findByTestId("invite-row-inv-active")).getByRole("button", {
        name: /^Revoke/,
      }),
    );
    const dialog = screen.getByTestId("moderation-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke invite" }));

    await waitFor(() => expect(dialog).toHaveTextContent("only the owner can revoke invites"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not revoke when the confirm step is cancelled", async () => {
    serve();
    const user = userEvent.setup();
    renderInvites();

    await user.click(
      within(await screen.findByTestId("invite-row-inv-active")).getByRole("button", {
        name: /^Revoke/,
      }),
    );
    await user.click(
      within(screen.getByTestId("moderation-dialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByTestId("moderation-dialog")).not.toBeInTheDocument();
    expect(callsTo(requestMock, "mutation RevokeInvite")).toHaveLength(0);
  });

  it.each([ServerMemberRoleGql.MODERATOR, ServerMemberRoleGql.MEMBER, ServerMemberRoleGql.GUEST])(
    "shows nothing to a %s and never asks for the invites",
    async (role) => {
      serve(role);
      const qc = renderInvites();

      await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
      expect(screen.queryByText("Invites")).not.toBeInTheDocument();
      expect(callsTo(requestMock, "query WorkspaceInvites")).toHaveLength(0);
    },
  );

  it("shows nothing in the direct space", async () => {
    startRelayWithDirectSpace();
    serve();
    const qc = renderInvites(DIRECT_SPACE_ID);

    await waitFor(() => expect(qc.getQueryData(queryKeys.server(DIRECT_SPACE_ID))).toBeDefined());
    expect(screen.queryByText("Invites")).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query WorkspaceInvites")).toHaveLength(0);
  });

  it("shows the server's message when the list cannot be read", async () => {
    serve(ServerMemberRoleGql.OWNER, {
      "query WorkspaceInvites": () => {
        throw graphqlError("FORBIDDEN", "only the workspace owner can list invites");
      },
    });
    renderInvites();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "only the workspace owner can list invites",
    );
  });

  it("says so when there are no invites", async () => {
    serve(ServerMemberRoleGql.OWNER, { "query WorkspaceInvites": () => page([], null) });
    renderInvites();

    expect(await screen.findByText("No invites yet.")).toBeInTheDocument();
  });

  it("opens the invite dialog for this workspace", async () => {
    serve();
    const user = userEvent.setup();
    renderInvites();

    await user.click(await screen.findByRole("button", { name: "Create invite" }));

    expect(screen.getByRole("button", { name: /generate invite link/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Expires after")).toHaveValue("7");
  });
});

describe("inviteExpiryLabel", () => {
  it.each([
    [{ expiresAt: new Date(NOW + 7 * DAY).toISOString() }, "Expires in 7 days"],
    [{ expiresAt: new Date(NOW + DAY + 60_000).toISOString() }, "Expires in 1 day"],
    [{ expiresAt: new Date(NOW + 3 * 60 * 60_000).toISOString() }, "Expires in 3 hours"],
    [{ expiresAt: new Date(NOW + 5 * 60_000).toISOString() }, "Expires in 5 minutes"],
    [{ expiresAt: new Date(NOW + 10_000).toISOString() }, "Expires in less than a minute"],
    [{ expiresAt: null }, "Never expires"],
  ])("labels %o as %s", (overrides, label) => {
    expect(inviteExpiryLabel(invite("i", overrides), NOW)).toBe(label);
  });

  it("says an invite past its expiry expired, and a revoked one was revoked", () => {
    expect(
      inviteExpiryLabel(
        invite("i", {
          expiresAt: new Date(NOW - 1000).toISOString(),
          state: WorkspaceInviteState.EXPIRED,
        }),
        NOW,
      ),
    ).toMatch(/^Expired /);
    expect(
      inviteExpiryLabel(
        invite("i", {
          revokedAt: new Date(NOW - 1000).toISOString(),
          state: WorkspaceInviteState.REVOKED,
        }),
        NOW,
      ),
    ).toMatch(/^Revoked /);
  });
});
