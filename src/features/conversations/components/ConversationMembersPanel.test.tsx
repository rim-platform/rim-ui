import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { ConversationSummary } from "../types";
import {
  baseReadHandlers,
  callsTo,
  makeConversation,
  routeRequests,
} from "../__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { ConversationMembersPanel } from "./ConversationMembersPanel";

const channel = makeConversation({ memberIds: ["me", "u-alice"], memberCount: 2 });

function serve(role: ServerMemberRoleGql, conversation: ConversationSummary = channel) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "query Conversation(": () => ({ conversation }),
    "mutation AddConversationMembers": () => ({
      addConversationMembers: { ...conversation, memberIds: [...conversation.memberIds, "u-bob"] },
    }),
    "mutation RemoveConversationMember": () => ({ removeConversationMember: true }),
    "mutation LeaveConversation": () => ({ leaveConversation: true }),
  });
}

async function renderPanel(role: ServerMemberRoleGql) {
  const qc = createTestQueryClient();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ConversationMembersPanel workspaceId="ws-1" conversationId="conv-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  await screen.findByTestId("member-row-u-alice");
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      role,
    ),
  );
  return { qc, onClose };
}

describe("ConversationMembersPanel", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("lists the members, the viewer first and marked", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await renderPanel(ServerMemberRoleGql.GUEST);
    const rows = screen.getAllByTestId(/^member-row-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual(["member-row-me", "member-row-u-alice"]);
    expect(within(rows[0]).getByText("(you)")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Alice")).toBeInTheDocument();
  });

  it("invites workspace members who are not in the conversation yet", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await renderPanel(ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("button", { name: /invite/i }));

    // Only Bob is offered: the viewer and Alice are already members.
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Bob")]);

    fireEvent.click(options[0]);
    fireEvent.click(screen.getByRole("button", { name: "Add (1)" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation AddConversationMembers")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", userIds: ["u-bob"] },
      ]),
    );
  });

  it("does not offer Remove to a guest", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await renderPanel(ServerMemberRoleGql.GUEST);
    expect(screen.queryByRole("button", { name: "Remove Alice" })).not.toBeInTheDocument();
  });

  it("lets a moderator remove another member after confirming", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await renderPanel(ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("button", { name: "Remove Alice" }));
    expect(callsTo(requestMock, "mutation RemoveConversationMember")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing Alice" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation RemoveConversationMember")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", userId: "u-alice" },
      ]),
    );
    // Never on the viewer's own row: that one is Leave.
    expect(screen.queryByRole("button", { name: /remove me myself/i })).not.toBeInTheDocument();
  });

  it("the viewer's own row leaves the conversation", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    useShellStore.setState({ selectedConversationId: "conv-1" });
    await renderPanel(ServerMemberRoleGql.MODERATOR);
    fireEvent.click(
      within(screen.getByTestId("member-row-me")).getByRole("button", { name: "Leave" }),
    );

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation LeaveConversation")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1" },
      ]),
    );
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
  });

  it("offers no Invite to a viewer who has not joined the public channel", async () => {
    serve(ServerMemberRoleGql.GUEST, makeConversation({ memberIds: ["u-alice"], isMember: false }));
    await renderPanel(ServerMemberRoleGql.GUEST);
    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
  });
});
