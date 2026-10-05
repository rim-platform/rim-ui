import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

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
import { MemberActionsMenu, type ModeratedMember } from "./MemberActionsMenu";

const { OWNER, MODERATOR, MEMBER, GUEST } = ServerMemberRoleGql;

function serve(viewerRole: ServerMemberRoleGql, extra: Record<string, () => unknown> = {}) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole } }),
    "mutation SetMemberRole": () => ({ setMemberRole: { userId: "u-alice", memberRole: GUEST } }),
    "mutation TimeoutMember": () => ({
      timeoutMember: { userId: "u-alice", until: "2026-10-05T11:00:00.000Z" },
    }),
    "mutation ClearTimeout": () => ({ clearTimeout: true }),
    "mutation KickMember": () => ({ kickMember: true }),
    "mutation BanMember": () => ({ banMember: { userId: "u-alice", expiresAt: null } }),
    ...extra,
  });
}

async function renderMenu(viewerRole: ServerMemberRoleGql, member: Partial<ModeratedMember> = {}) {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemberActionsMenu
        workspaceId="ws-1"
        member={{ userId: "u-alice", displayName: "Alice", role: MEMBER, ...member }}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      viewerRole,
    ),
  );
  return qc;
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Moderate Alice" }));
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

function confirmButton(label: string) {
  return within(screen.getByTestId("moderation-dialog")).getByRole("button", { name: label });
}

describe("MemberActionsMenu — visibility", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  const matrix: [ServerMemberRoleGql, ServerMemberRoleGql, boolean][] = [
    [OWNER, OWNER, false],
    [OWNER, MODERATOR, true],
    [OWNER, MEMBER, true],
    [OWNER, GUEST, true],
    [MODERATOR, OWNER, false],
    [MODERATOR, MODERATOR, false],
    [MODERATOR, MEMBER, true],
    [MODERATOR, GUEST, true],
    [MEMBER, MODERATOR, false],
    [MEMBER, MEMBER, false],
    [MEMBER, GUEST, false],
    [GUEST, MEMBER, false],
    [GUEST, GUEST, false],
  ];

  it.each(matrix)("viewer %s on target %s: menu %s", async (viewer, target, shown) => {
    serve(viewer);
    await renderMenu(viewer, { role: target });
    if (shown) {
      expect(screen.getByRole("button", { name: "Moderate Alice" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "Moderate Alice" })).not.toBeInTheDocument();
    }
  });

  it("is never offered on the viewer's own row", async () => {
    serve(OWNER);
    await renderMenu(OWNER, { userId: "me", role: MEMBER });
    expect(screen.queryByRole("button", { name: "Moderate Alice" })).not.toBeInTheDocument();
  });

  it("is hidden while the target's role is unknown", async () => {
    serve(OWNER);
    await renderMenu(OWNER, { role: undefined });
    expect(screen.queryByRole("button", { name: "Moderate Alice" })).not.toBeInTheDocument();
  });

  it("offers an owner every action, and Clear timeout while one is active", async () => {
    serve(OWNER);
    await renderMenu(OWNER, { timeoutUntil: "2999-01-01T00:00:00Z" });
    expect(openMenu()).toEqual([
      "Change role...",
      "Time out...",
      "Clear timeout",
      "Kick...",
      "Ban...",
    ]);
  });

  it("omits Clear timeout when the timeout has run out", async () => {
    serve(MODERATOR);
    await renderMenu(MODERATOR, { timeoutUntil: "2000-01-01T00:00:00Z" });
    expect(openMenu()).toEqual(["Change role...", "Time out...", "Kick...", "Ban..."]);
  });
});

describe("MemberActionsMenu — actions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    vi.useRealTimers();
  });

  it("an owner is offered Moderator and Guest for a member and changes the role", async () => {
    serve(OWNER);
    await renderMenu(OWNER);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Change role..." }));
    const radios = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(radios).toEqual([MODERATOR, GUEST]);
    fireEvent.click(screen.getByRole("radio", { name: "Guest" }));
    fireEvent.click(confirmButton("Change role"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetMemberRole")).toEqual([
        { serverId: "ws-1", userId: "u-alice", role: GUEST },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Alice is now Guest"));
  });

  it("a moderator can only move a member to Guest", async () => {
    serve(MODERATOR);
    await renderMenu(MODERATOR);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Change role..." }));
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual([GUEST]);
  });

  it("times a member out for a preset duration with a reason", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
    serve(MODERATOR);
    await renderMenu(MODERATOR);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Time out..." }));
    fireEvent.click(screen.getByRole("button", { name: "1 hour" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: " spam " } });
    fireEvent.click(confirmButton("Time out"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation TimeoutMember")).toEqual([
        {
          serverId: "ws-1",
          userId: "u-alice",
          until: "2026-10-05T11:00:00.000Z",
          reason: "spam",
        },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("times a member out until a custom time and requires it to be in the future", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
    serve(OWNER);
    await renderMenu(OWNER);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Time out..." }));
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(confirmButton("Time out")).toBeDisabled();

    const input = screen.getByLabelText("Duration: custom date and time");
    fireEvent.change(input, { target: { value: "2026-10-01T09:30" } });
    expect(confirmButton("Time out")).toBeDisabled();
    fireEvent.change(input, { target: { value: "2026-10-07T09:30" } });
    fireEvent.click(confirmButton("Time out"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation TimeoutMember")).toEqual([
        {
          serverId: "ws-1",
          userId: "u-alice",
          until: new Date("2026-10-07T09:30").toISOString(),
          reason: null,
        },
      ]),
    );
  });

  it("clears an active timeout", async () => {
    serve(OWNER);
    await renderMenu(OWNER, { timeoutUntil: "2999-01-01T00:00:00Z" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear timeout" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation ClearTimeout")).toEqual([
        { serverId: "ws-1", userId: "u-alice" },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cleared Alice's timeout"));
  });

  it("kicks after confirming in the dangerous-action dialog", async () => {
    serve(MODERATOR);
    await renderMenu(MODERATOR);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kick..." }));
    expect(screen.getByRole("dialog", { name: "Kick Alice?" })).toBeInTheDocument();
    expect(screen.getByText("DANGEROUS")).toBeInTheDocument();
    expect(callsTo(requestMock, "mutation KickMember")).toHaveLength(0);
    fireEvent.click(confirmButton("Kick"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation KickMember")).toEqual([
        { serverId: "ws-1", userId: "u-alice", reason: null },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Kicked Alice"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms with Ctrl+Enter", async () => {
    serve(OWNER);
    await renderMenu(OWNER);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kick..." }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "rude" } });
    fireEvent.keyDown(screen.getByLabelText("Reason (optional)"), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation KickMember")).toEqual([
        { serverId: "ws-1", userId: "u-alice", reason: "rude" },
      ]),
    );
  });

  it("shows the server's message and offers Retry when a kick fails", async () => {
    serve(MODERATOR, {
      "mutation KickMember": () => {
        throw graphqlError("FORBIDDEN", "permission denied");
      },
    });
    await renderMenu(MODERATOR);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kick..." }));
    fireEvent.click(confirmButton("Kick"));

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(confirmButton("Retry")).toBeInTheDocument();
    expect(confirmButton("Close")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("bans with a reason and a preset expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
    serve(OWNER);
    await renderMenu(OWNER, { role: MODERATOR });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ban..." }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "raid" } });
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    fireEvent.click(confirmButton("Ban"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation BanMember")).toEqual([
        {
          serverId: "ws-1",
          userId: "u-alice",
          reason: "raid",
          expiresAt: "2026-10-12T10:00:00.000Z",
        },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Banned Alice"));
  });

  it("bans until lifted by default", async () => {
    serve(MODERATOR);
    await renderMenu(MODERATOR, { role: GUEST });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ban..." }));
    expect(screen.getByRole("button", { name: "Never" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(confirmButton("Ban"));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation BanMember")).toEqual([
        { serverId: "ws-1", userId: "u-alice", reason: null, expiresAt: null },
      ]),
    );
  });
});
