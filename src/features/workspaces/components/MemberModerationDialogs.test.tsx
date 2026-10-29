import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { fakeServerInfo } from "../../../test/serverInfo";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { DELETE_MEMBER_MESSAGES } from "../../updater/api/serverCapabilities";
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
    "query MemberMessageCounts": () => ({
      memberMessageCounts: {
        readable: { messages: 38, channels: 3 },
        unjoinedPrivate: { messages: 4, channels: 1 },
      },
    }),
    "mutation DeleteMemberMessages": () => ({
      deleteMemberMessages: { deleted: 42, channels: 4, hasMore: false },
    }),
    ...extra,
  });
}

const alice: ModeratedMember = { userId: "u-alice", displayName: "Alice", role: MEMBER };

/**
 * Renders the dialog of `moderation` against a server that lists `capabilities`; a role change
 * waits for the viewer's role.
 */
async function renderDialog(
  viewerRole: ServerMemberRoleGql,
  moderation: MemberModeration,
  capabilities?: string[],
) {
  const qc = createTestQueryClient();
  qc.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
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

/** The operation names of the mutations sent, in order. */
function mutationOrder(): string[] {
  return requestMock.mock.calls
    .map(([document]) => /mutation (\w+)/.exec(String(document))?.[1])
    .filter((name): name is string => Boolean(name));
}

/** Serves the counts of every period as `readable` and `unjoinedPrivate`. */
function countsOf(readable: [number, number], unjoinedPrivate: [number, number]) {
  return () => ({
    memberMessageCounts: {
      readable: { messages: readable[0], channels: readable[1] },
      unjoinedPrivate: { messages: unjoinedPrivate[0], channels: unjoinedPrivate[1] },
    },
  });
}

const PRIVATE_LABEL = "Also private channels you're not in: 4 messages in 1 channel";

describe("MemberModerationDialog message deletion", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    vi.useRealTimers();
  });

  const banAlice: MemberModeration = { action: "ban", member: alice };
  const deleteAlice: MemberModeration = { action: "delete-messages", member: alice };
  const withDeletion = [DELETE_MEMBER_MESSAGES];

  it("offers no message deletion when banning on a server without delete_member_messages", async () => {
    serve(OWNER);
    await renderDialog(OWNER, banAlice);
    expect(screen.getByRole("dialog", { name: "Ban Alice?" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Last hour" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Don't delete" })).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query MemberMessageCounts")).toHaveLength(0);
  });

  it("bans without deleting or counting by default", async () => {
    serve(OWNER);
    const { onClose } = await renderDialog(OWNER, banAlice, withDeletion);
    expect(screen.getByRole("radio", { name: "Don't delete" })).toBeChecked();
    expect(screen.getByRole("group", { name: "Delete their messages from:" })).toBeInTheDocument();
    fireEvent.click(confirmButton("Ban"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutationOrder()).toEqual(["BanMember"]);
    expect(callsTo(requestMock, "query MemberMessageCounts")).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Banned Alice");
  });

  it("counts the chosen period and names the total on the confirm button", async () => {
    serve(OWNER);
    await renderDialog(OWNER, banAlice, withDeletion);
    fireEvent.click(screen.getByRole("radio", { name: "Last 24 hours" }));

    expect(await screen.findByText("38 messages in 3 channels")).toBeInTheDocument();
    expect(callsTo(requestMock, "query MemberMessageCounts")).toEqual([
      { serverId: "ws-1", userId: "u-alice", since: "2026-10-04T10:00:00.000Z" },
    ]);
    expect(screen.getByRole("checkbox", { name: PRIVATE_LABEL })).toBeChecked();
    expect(confirmButton("Ban and delete 42 messages")).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: PRIVATE_LABEL }));
    expect(confirmButton("Ban and delete 38 messages")).toBeEnabled();
  });

  it("hides the private channels checkbox when they hold nothing", async () => {
    serve(OWNER, { "query MemberMessageCounts": countsOf([38, 3], [0, 0]) });
    await renderDialog(OWNER, banAlice, withDeletion);
    fireEvent.click(screen.getByRole("radio", { name: "Last 7 days" }));

    expect(await screen.findByText("38 messages in 3 channels")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(confirmButton("Ban and delete 38 messages")).toBeEnabled();
  });

  it("bans first, then deletes until none remain, and says how many", async () => {
    let round = 0;
    serve(OWNER, {
      "mutation DeleteMemberMessages": () => {
        round += 1;
        return {
          deleteMemberMessages:
            round === 1
              ? { deleted: 1000, channels: 3, hasMore: true }
              : { deleted: 42, channels: 4, hasMore: false },
        };
      },
    });
    const { onClose } = await renderDialog(OWNER, banAlice, withDeletion);
    fireEvent.click(screen.getByRole("radio", { name: "Last 24 hours" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ban and delete 42 messages" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutationOrder()).toEqual(["BanMember", "DeleteMemberMessages", "DeleteMemberMessages"]);
    for (const vars of callsTo(requestMock, "mutation DeleteMemberMessages")) {
      expect(vars).toEqual({
        serverId: "ws-1",
        userId: "u-alice",
        since: "2026-10-04T10:00:00.000Z",
        includeUnjoinedPrivate: true,
      });
    }
    expect(toast.success).toHaveBeenCalledWith("Banned Alice");
    expect(toast.success).toHaveBeenCalledWith("Deleted 1042 messages");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says nothing to delete and only bans when the period is empty", async () => {
    serve(OWNER, { "query MemberMessageCounts": countsOf([0, 0], [0, 0]) });
    const { onClose } = await renderDialog(OWNER, banAlice, withDeletion);
    fireEvent.click(screen.getByRole("radio", { name: "Everything" }));

    expect(await screen.findByText("Nothing to delete.")).toBeInTheDocument();
    fireEvent.click(confirmButton("Ban"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutationOrder()).toEqual(["BanMember"]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Banned Alice");
  });

  it("says the ban went through when deleting fails", async () => {
    serve(OWNER, {
      "mutation DeleteMemberMessages": () => {
        throw graphqlError("FORBIDDEN", "permission denied");
      },
    });
    const { onClose } = await renderDialog(OWNER, banAlice, withDeletion);
    fireEvent.click(screen.getByRole("radio", { name: "Last hour" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ban and delete 42 messages" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      "Banned Alice, but deleting their messages failed: permission denied",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("deletes nothing when the ban fails", async () => {
    serve(OWNER, {
      "mutation BanMember": () => {
        throw graphqlError("FORBIDDEN", "permission denied");
      },
    });
    const { onClose } = await renderDialog(OWNER, banAlice, withDeletion);
    fireEvent.click(screen.getByRole("radio", { name: "Last hour" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ban and delete 42 messages" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(confirmButton("Retry")).toBeInTheDocument();
    expect(mutationOrder()).toEqual(["BanMember"]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the delete messages dialog starts on the last hour and deletes what it counted", async () => {
    serve(MODERATOR);
    const { onClose } = await renderDialog(MODERATOR, deleteAlice, withDeletion);
    expect(screen.getByRole("dialog", { name: "Delete Alice's messages?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Last hour" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Don't delete" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Delete 42 messages" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo(requestMock, "query MemberMessageCounts")[0]).toEqual({
      serverId: "ws-1",
      userId: "u-alice",
      since: "2026-10-05T09:00:00.000Z",
    });
    expect(callsTo(requestMock, "mutation DeleteMemberMessages")).toEqual([
      {
        serverId: "ws-1",
        userId: "u-alice",
        since: "2026-10-05T09:00:00.000Z",
        includeUnjoinedPrivate: true,
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Deleted 42 messages");
  });

  it("the delete messages dialog reads naturally for a person with no name left", async () => {
    serve(MODERATOR);
    await renderDialog(
      MODERATOR,
      { action: "delete-messages", member: { ...alice, displayName: "", isFormerMember: true } },
      withDeletion,
    );
    expect(screen.getByRole("dialog", { name: "Delete their messages?" })).toBeInTheDocument();
    expect(screen.getByText(/^Their messages in this workspace's channels/)).toBeInTheDocument();
  });

  it("the delete messages dialog cannot confirm with nothing to delete", async () => {
    serve(MODERATOR, { "query MemberMessageCounts": countsOf([0, 0], [0, 0]) });
    await renderDialog(MODERATOR, deleteAlice, withDeletion);

    expect(await screen.findByText("Nothing to delete.")).toBeInTheDocument();
    expect(confirmButton("Delete messages")).toBeDisabled();
  });

  it("the delete messages dialog sends no since for everything", async () => {
    serve(MODERATOR);
    const { onClose } = await renderDialog(MODERATOR, deleteAlice, withDeletion);
    fireEvent.click(screen.getByRole("radio", { name: "Everything" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "query MemberMessageCounts")).toContainEqual({
        serverId: "ws-1",
        userId: "u-alice",
        since: null,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete 42 messages" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation DeleteMemberMessages")).toEqual([
      { serverId: "ws-1", userId: "u-alice", since: null, includeUnjoinedPrivate: true },
    ]);
  });

  it("the delete messages dialog shows the failure with Retry", async () => {
    serve(MODERATOR, {
      "mutation DeleteMemberMessages": () => {
        throw graphqlError("FORBIDDEN", "permission denied");
      },
    });
    const { onClose } = await renderDialog(MODERATOR, deleteAlice, withDeletion);
    fireEvent.click(await screen.findByRole("button", { name: "Delete 42 messages" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(confirmButton("Retry")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
