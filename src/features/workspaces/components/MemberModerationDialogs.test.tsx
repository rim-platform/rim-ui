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
import {
  CUSTOM_DURATION,
  MemberModerationDialog,
  type MemberModeration,
  type ModeratedMember,
} from "./MemberModerationDialogs";

const { OWNER, MODERATOR, MEMBER, GUEST } = ServerMemberRoleGql;

function serve(viewerRole: ServerMemberRoleGql, extra: Record<string, () => unknown> = {}) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole } }),
    "mutation SetMemberRole": () => ({ setMemberRole: { userId: "u-alice", memberRole: GUEST } }),
    "mutation TimeoutMember": () => ({
      timeoutMember: { userId: "u-alice", until: "2026-10-05T11:00:00.000Z" },
    }),
    "mutation KickMember": () => ({ kickMember: true }),
    "mutation BanMember": () => ({ banMember: { userId: "u-alice", expiresAt: null } }),
    ...extra,
  });
}

const alice: ModeratedMember = { userId: "u-alice", displayName: "Alice", role: MEMBER };

/** Renders the dialog of `moderation`; a role change waits for the viewer's role. */
async function renderDialog(viewerRole: ServerMemberRoleGql, moderation: MemberModeration) {
  const qc = createTestQueryClient();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemberModerationDialog workspaceId="ws-1" moderation={moderation} onClose={onClose} />
    </QueryClientProvider>,
  );
  if (moderation.action === "role") {
    await waitFor(() =>
      expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
        viewerRole,
      ),
    );
  }
  return { onClose };
}

function confirmButton(label: string) {
  return within(screen.getByTestId("moderation-dialog")).getByRole("button", { name: label });
}

describe("MemberModerationDialog", () => {
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
    await renderDialog(OWNER, { action: "role", member: alice, role: MODERATOR });
    const radios = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(radios).toEqual([MODERATOR, GUEST]);
    expect(screen.getByRole("radio", { name: "Moderator" })).toBeChecked();
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
    await renderDialog(MODERATOR, { action: "role", member: alice, role: GUEST });
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual([GUEST]);
  });

  it("times a member out for the preset the menu chose, with a reason", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
    serve(MODERATOR);
    await renderDialog(MODERATOR, { action: "timeout", member: alice, preset: "1h" });
    expect(screen.getByRole("button", { name: "1 hour" })).toHaveAttribute("aria-pressed", "true");
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
    await renderDialog(OWNER, { action: "timeout", member: alice, preset: CUSTOM_DURATION });
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
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

  it("kicks after confirming in the dangerous-action dialog", async () => {
    serve(MODERATOR);
    const { onClose } = await renderDialog(MODERATOR, { action: "kick", member: alice });
    expect(screen.getByRole("dialog", { name: "Kick Alice?" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Kick Alice?" });
    expect(within(dialog).queryByText("DANGEROUS")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Alice")).not.toBeInTheDocument();
    expect(callsTo(requestMock, "mutation KickMember")).toHaveLength(0);
    fireEvent.click(confirmButton("Kick"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation KickMember")).toEqual([
        { serverId: "ws-1", userId: "u-alice", reason: null },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Kicked Alice"));
    expect(onClose).toHaveBeenCalled();
  });

  it("confirms with Ctrl+Enter", async () => {
    serve(OWNER);
    await renderDialog(OWNER, { action: "kick", member: alice });
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
    await renderDialog(MODERATOR, { action: "kick", member: alice });
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
    await renderDialog(OWNER, { action: "ban", member: { ...alice, role: MODERATOR } });
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
    await renderDialog(MODERATOR, { action: "ban", member: { ...alice, role: GUEST } });
    expect(screen.getByRole("button", { name: "Never" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(confirmButton("Ban"));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation BanMember")).toEqual([
        { serverId: "ws-1", userId: "u-alice", reason: null, expiresAt: null },
      ]),
    );
  });
});
