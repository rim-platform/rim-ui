import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import {
  NotificationLevel,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import type { ConversationSummary } from "../types";
import { callsTo, makeConversation, routeRequests } from "../__fixtures__/conversations";
import { useMutedStore } from "../state/useMutedStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { ConversationActionsMenu } from "./ConversationActionsMenu";

type MutedRow = { conversationId: string; mutedUntil: string | null };

function serve({ defaultLevel = NotificationLevel.MENTIONS, muted = (): MutedRow[] => [] } = {}) {
  routeRequests(requestMock, {
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
    "query MyNotificationSettings": () => ({
      myNotificationSettings: {
        serverId: "ws-1",
        defaultLevel,
        keywords: [],
        dnd: null,
        dndPaused: false,
        dndPausedUntil: null,
        digest: "OFF",
      },
    }),
    "query MutedConversations": () => ({ mutedConversations: muted() }),
    "mutation SetConversationNotificationLevel": (vars) => ({
      setConversationNotificationLevel: {
        conversationId: vars.conversationId,
        level: vars.level ?? null,
        effectiveLevel: vars.level ?? defaultLevel,
        mutedUntil: null,
      },
    }),
    "mutation MuteConversation": () => ({ muteConversation: true }),
    "mutation UnmuteConversation": () => ({ unmuteConversation: true }),
  });
}

async function openNotifications(conversation: ConversationSummary, summary: string) {
  // Keeps unobserved cache entries so the test can read the patched conversation.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.conversation("ws-1", conversation.id), conversation);
  render(
    <QueryClientProvider client={qc}>
      <ConversationActionsMenu workspaceId="ws-1" conversation={conversation} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversation menu" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: `Notifications: ${summary}` }));
  // The workspace default loads when the menu opens.
  await screen.findByRole("menuitem", { name: /Use workspace default \(/ });
  return qc;
}

function menuItem(name: string | RegExp) {
  return screen.getByRole("menuitem", { name });
}

describe("ConversationActionsMenu — Notifications submenu", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    useMutedStore.setState({ mutedIds: new Set() });
  });

  it("lists the levels and marks the workspace default when there is no override", async () => {
    serve();
    await openNotifications(
      makeConversation({ effectiveNotificationLevel: NotificationLevel.MENTIONS }),
      "Mentions",
    );

    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels).toEqual([
      "Back",
      "All messages",
      "Mentions",
      "None",
      "Current:Use workspace default (Mentions)",
      "Mute for 1 hour",
      "Mute for 8 hours",
      "Mute until tomorrow",
    ]);
  });

  it("marks the conversation's own level", async () => {
    serve();
    await openNotifications(
      makeConversation({
        notificationLevel: NotificationLevel.NONE,
        effectiveNotificationLevel: NotificationLevel.NONE,
      }),
      "None",
    );
    expect(menuItem(/None$/)).toHaveTextContent("Current:None");
    expect(menuItem(/Use workspace default/)).not.toHaveTextContent("Current:");
  });

  it("sets a level and writes it into the conversation cache", async () => {
    serve();
    const qc = await openNotifications(makeConversation(), "All messages");

    fireEvent.click(menuItem("Mentions"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetConversationNotificationLevel")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", level: NotificationLevel.MENTIONS },
      ]),
    );
    await waitFor(() =>
      expect(
        qc.getQueryData<ConversationSummary>(queryKeys.conversation("ws-1", "conv-1")),
      ).toMatchObject({
        notificationLevel: NotificationLevel.MENTIONS,
        effectiveNotificationLevel: NotificationLevel.MENTIONS,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Notifications for #general: Mentions");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("goes back to the workspace default with level null", async () => {
    serve();
    await openNotifications(
      makeConversation({ notificationLevel: NotificationLevel.ALL }),
      "All messages",
    );

    fireEvent.click(menuItem(/Use workspace default/));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetConversationNotificationLevel")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", level: null },
      ]),
    );
  });

  it("None marks the conversation muted in the sidebar store", async () => {
    // Like the server: level NONE lists the conversation as muted (without an end).
    serve({
      muted: () =>
        callsTo(requestMock, "mutation SetConversationNotificationLevel").length > 0
          ? [{ conversationId: "conv-1", mutedUntil: null }]
          : [],
    });
    await openNotifications(makeConversation(), "All messages");
    fireEvent.click(menuItem("None"));
    await waitFor(() => expect(useMutedStore.getState().mutedIds.has("conv-1")).toBe(true));
  });

  it("mutes for an hour with a timed mute", async () => {
    serve();
    await openNotifications(makeConversation(), "All messages");

    const before = Date.now();
    fireEvent.click(menuItem("Mute for 1 hour"));

    await waitFor(() => expect(callsTo(requestMock, "mutation MuteConversation")).toHaveLength(1));
    const input = callsTo(requestMock, "mutation MuteConversation")[0].input as {
      serverId: string;
      conversationId: string;
      mutedUntil: string;
    };
    expect(input).toMatchObject({ serverId: "ws-1", conversationId: "conv-1" });
    const delta = Date.parse(input.mutedUntil) - before;
    expect(delta).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  it("offers Unmute while a timed mute is in effect", async () => {
    const until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    serve({ muted: () => [{ conversationId: "conv-1", mutedUntil: until }] });
    const qc = createTestQueryClient();
    const conversation = makeConversation({
      effectiveNotificationLevel: NotificationLevel.NONE,
    });
    render(
      <QueryClientProvider client={qc}>
        <ConversationActionsMenu workspaceId="ws-1" conversation={conversation} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.mutedConversations("ws-1"))).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Conversation menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Notifications: Muted until/ }));

    expect(screen.queryByRole("menuitem", { name: "Mute for 1 hour" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Unmute \(muted until/ }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UnmuteConversation")).toEqual([
        { input: { serverId: "ws-1", conversationId: "conv-1" } },
      ]),
    );
  });

  it("Back returns to the main menu", async () => {
    serve();
    await openNotifications(makeConversation(), "All messages");
    fireEvent.click(menuItem("Back"));
    expect(screen.getByRole("menuitem", { name: "Members" })).toBeInTheDocument();
  });
});
