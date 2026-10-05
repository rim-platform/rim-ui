import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import type { ConversationSummary } from "../types";
import {
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
} from "../__fixtures__/conversations";
import { useMembersPanelStore } from "../state/useMembersPanelStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { ConversationActionsMenu } from "./ConversationActionsMenu";

function serve(role: ServerMemberRoleGql, overrides: Record<string, () => unknown> = {}) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "mutation LeaveConversation": () => ({ leaveConversation: true }),
    "mutation SetConversationArchived": () => ({
      setConversationArchived: makeConversation({ isArchived: true }),
    }),
    ...overrides,
  });
}

async function openMenu(conversation: ConversationSummary, role: ServerMemberRoleGql) {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ConversationActionsMenu workspaceId="ws-1" conversation={conversation} />
    </QueryClientProvider>,
  );
  // Let the role load before reading the menu.
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      role,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversation menu" }));
  return qc;
}

function menuLabels(): string[] {
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

describe("ConversationActionsMenu — role gating", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useShellStore.getState().reset();
    useMembersPanelStore.setState({ open: false });
  });

  afterEach(() => {
    useShellStore.getState().reset();
  });

  it("a guest member of a channel gets Members and Leave, but no Archive", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation(), ServerMemberRoleGql.GUEST);
    expect(menuLabels()).toEqual(["Members", "Leave channel"]);
  });

  it.each([ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MODERATOR])(
    "%s gets Archive channel",
    async (role) => {
      serve(role);
      await openMenu(makeConversation(), role);
      expect(menuLabels()).toEqual(["Members", "Archive channel", "Leave channel"]);
    },
  );

  it("offers Unarchive on an archived channel to a moderator", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation({ isArchived: true }), ServerMemberRoleGql.MODERATOR);
    expect(menuLabels()).toContain("Unarchive channel");
    expect(menuLabels()).not.toContain("Archive channel");
  });

  it("offers no Leave for a public channel the viewer has not joined", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation({ isMember: false }), ServerMemberRoleGql.GUEST);
    expect(menuLabels()).toEqual(["Members"]);
  });

  it("offers no Leave or Archive for a DM, even to an owner", async () => {
    serve(ServerMemberRoleGql.OWNER);
    await openMenu(
      makeConversation({ conversationType: ConversationTypeEnum.DIRECT, title: null }),
      ServerMemberRoleGql.OWNER,
    );
    expect(menuLabels()).toEqual(["Members"]);
  });

  it("offers Leave conversation for a group", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(
      makeConversation({ conversationType: ConversationTypeEnum.GROUP, title: "crew" }),
      ServerMemberRoleGql.GUEST,
    );
    expect(menuLabels()).toEqual(["Members", "Leave conversation"]);
  });

  it("Members toggles the members panel", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation(), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Members" }));
    expect(useMembersPanelStore.getState().open).toBe(true);
  });
});

describe("ConversationActionsMenu — actions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useShellStore.getState().reset();
  });

  it("asks for confirmation before archiving, then archives with the right variables", async () => {
    serve(ServerMemberRoleGql.OWNER);
    await openMenu(makeConversation(), ServerMemberRoleGql.OWNER);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive channel" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive #general?" });
    expect(callsTo(requestMock, "mutation SetConversationArchived")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(callsTo(requestMock, "mutation SetConversationArchived")).toEqual([
      { serverId: "ws-1", conversationId: "conv-1", archived: true },
    ]);
  });

  it("unarchives without a confirmation", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation SetConversationArchived": () => ({
        setConversationArchived: makeConversation(),
      }),
    });
    await openMenu(makeConversation({ isArchived: true }), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive channel" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetConversationArchived")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", archived: false },
      ]),
    );
  });

  it("shows the server's message when archiving is forbidden", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation SetConversationArchived": () => {
        throw graphqlError("FORBIDDEN", "Only owners and moderators can archive channels");
      },
    });
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive channel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only owners and moderators can archive channels"),
    );
  });

  it("leaves a public channel straight away and returns to the workspace home", async () => {
    serve(ServerMemberRoleGql.GUEST);
    useShellStore.setState({ selectedConversationId: "conv-1" });
    await openMenu(makeConversation(), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave channel" }));

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(callsTo(requestMock, "mutation LeaveConversation")).toEqual([
      { serverId: "ws-1", conversationId: "conv-1" },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Left #general");
  });

  it("confirms before leaving a private channel", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation({ isPrivate: true }), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave channel" }));
    await screen.findByRole("dialog", { name: "Leave #general?" });
    expect(callsTo(requestMock, "mutation LeaveConversation")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(callsTo(requestMock, "mutation LeaveConversation")).toHaveLength(1));
  });
});
