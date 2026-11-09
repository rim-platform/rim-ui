import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import {
  NotificationLevel,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import {
  clearServedCommands,
  commandSucceeded,
  sentCommands,
  serveCommands,
} from "../../../test/clickCommands";
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
    "mutation ExecuteCommand": (vars) => {
      const { commandId, args } = (
        vars as { input: { commandId: string; args: Record<string, unknown> } }
      ).input;
      if (commandId !== "notifications.set_level") return commandSucceeded();
      const level = args.level === "default" ? null : args.level;
      return commandSucceeded({
        conversation_id: args.conversation_id,
        level,
        effective_level: level ?? defaultLevel.toLowerCase(),
      });
    },
  });
}

/** What a Notifications item on `conv-1` of `ws-1` sends, as the palette would apart from the initiator. */
function menuRun(commandId: string, args: Record<string, unknown>) {
  return {
    commandId,
    args: { server_id: "ws-1", conversation_id: "conv-1", ...args },
    commandContext: { workspaceId: "ws-1", conversationId: "conv-1" },
    initiator: "CONTEXT_MENU",
  };
}

async function openNotifications(conversation: ConversationSummary, summary: string | RegExp) {
  // The app's own cache, which the commands' effects patch and refresh.
  const qc = queryClient;
  qc.setQueryData(queryKeys.conversation("ws-1", conversation.id), conversation);
  render(
    <QueryClientProvider client={qc}>
      <ConversationActionsMenu workspaceId="ws-1" conversation={conversation} />
    </QueryClientProvider>,
  );
  // The menu reads the workspace default and the mutes from the cache when it opens.
  await waitFor(() => {
    expect(qc.getQueryData(queryKeys.notificationSettings("ws-1"))).toBeDefined();
    expect(qc.getQueryData(queryKeys.mutedConversations("ws-1"))).toBeDefined();
  });
  fireEvent.click(screen.getByRole("button", { name: "Conversation menu" }));
  const name = typeof summary === "string" ? `Notifications: ${summary}` : summary;
  fireEvent.click(screen.getByRole("menuitem", { name }));
  return qc;
}

/** The open Notifications submenu. */
function submenu() {
  return screen.getByRole("menu", { name: "Notifications" });
}

function choice(name: string | RegExp) {
  return within(submenu()).getByRole("menuitemradio", { name });
}

describe("ConversationActionsMenu — Notifications submenu", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    useMutedStore.setState({ mutedIds: new Set() });
    serveCommands("ws-1", [
      "notifications.set_level",
      "notifications.mute_conversation",
      "notifications.unmute_conversation",
    ]);
  });

  afterEach(() => {
    clearServedCommands();
    queryClient.clear();
  });

  it("lists the levels and the mutes, and checks the workspace default without an override", async () => {
    serve();
    await openNotifications(
      makeConversation({ effectiveNotificationLevel: NotificationLevel.MENTIONS }),
      "Mentions only",
    );

    const radios = within(submenu()).getAllByRole("menuitemradio");
    expect(radios.map((el) => el.getAttribute("aria-label") ?? el.textContent)).toEqual([
      "All messages",
      "Mentions only",
      "Nothing",
      "Workspace default: Mentions only",
    ]);
    expect(radios.map((el) => el.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(
      within(submenu())
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Mute for 1 hour", "Mute for 8 hours", "Mute until tomorrow"]);
  });

  it("checks the conversation's own level", async () => {
    serve();
    await openNotifications(
      makeConversation({
        notificationLevel: NotificationLevel.NONE,
        effectiveNotificationLevel: NotificationLevel.NONE,
      }),
      "Nothing",
    );
    expect(choice("Nothing")).toHaveAttribute("aria-checked", "true");
    expect(choice(/^Workspace default/)).toHaveAttribute("aria-checked", "false");
  });

  it("sets a level and writes it into the conversation cache", async () => {
    serve();
    const qc = await openNotifications(makeConversation(), "All messages");

    fireEvent.click(choice("Mentions only"));

    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([
        menuRun("notifications.set_level", { level: "mentions" }),
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
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Notifications for #general: Mentions only"),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("goes back to the workspace default with level default", async () => {
    serve();
    await openNotifications(
      makeConversation({ notificationLevel: NotificationLevel.ALL }),
      "All messages",
    );

    fireEvent.click(choice(/^Workspace default/));
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([
        menuRun("notifications.set_level", { level: "default" }),
      ]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Notifications for #general: workspace default (Mentions only)",
      ),
    );
  });

  it("Nothing marks the conversation muted in the sidebar store", async () => {
    // Like the server: level NONE lists the conversation as muted (without an end).
    serve({
      muted: () =>
        sentCommands(requestMock).length > 0
          ? [{ conversationId: "conv-1", mutedUntil: null }]
          : [],
    });
    await openNotifications(makeConversation(), "All messages");
    fireEvent.click(choice("Nothing"));
    await waitFor(() => expect(useMutedStore.getState().mutedIds.has("conv-1")).toBe(true));
  });

  it("mutes for an hour with a timed mute", async () => {
    // Like the server: the muted list holds the conversation once the mute is sent.
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    serve({
      muted: () =>
        sentCommands(requestMock).length > 0
          ? [{ conversationId: "conv-1", mutedUntil: later }]
          : [],
    });
    await openNotifications(makeConversation(), "All messages");

    const before = Date.now();
    fireEvent.click(within(submenu()).getByRole("menuitem", { name: "Mute for 1 hour" }));

    await waitFor(() => expect(sentCommands(requestMock)).toHaveLength(1));
    const [sent] = sentCommands(requestMock);
    const until = String(sent.args?.until);
    expect(sent).toEqual(menuRun("notifications.mute_conversation", { duration: "until", until }));
    expect(useMutedStore.getState().mutedIds.has("conv-1")).toBe(true);
    const delta = Date.parse(until) - before;
    expect(delta).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  it("offers Unmute in place of the mutes while a timed mute is in effect", async () => {
    const until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    serve({ muted: () => [{ conversationId: "conv-1", mutedUntil: until }] });
    await openNotifications(
      makeConversation({ effectiveNotificationLevel: NotificationLevel.NONE }),
      /^Notifications: Muted until/,
    );

    expect(within(submenu()).queryByRole("menuitem")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unmute" }));
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([menuRun("notifications.unmute_conversation", {})]),
    );
  });
});

describe("ConversationActionsMenu — Notifications on an older host", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    useMutedStore.setState({ mutedIds: new Set() });
    // The host lists its commands, and not the mute commands.
    serveCommands("ws-1", ["notifications.set_level"]);
  });

  afterEach(() => {
    clearServedCommands();
    queryClient.clear();
  });

  it("mutes with the muteConversation mutation when the host lacks the command", async () => {
    serve();
    routeRequests(requestMock, {
      "query Server(": () => ({
        server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
      }),
      "query MyNotificationSettings": () => ({
        myNotificationSettings: {
          serverId: "ws-1",
          defaultLevel: NotificationLevel.MENTIONS,
          keywords: [],
          dnd: null,
          dndPaused: false,
          dndPausedUntil: null,
          digest: "OFF",
        },
      }),
      "query MutedConversations": () => ({ mutedConversations: [] }),
      "mutation MuteConversation": () => ({ muteConversation: true }),
    });
    await openNotifications(makeConversation(), "All messages");
    fireEvent.click(within(submenu()).getByRole("menuitem", { name: "Mute for 1 hour" }));

    await waitFor(() => expect(callsTo(requestMock, "mutation MuteConversation")).toHaveLength(1));
    expect(sentCommands(requestMock)).toEqual([]);
    expect(
      (callsTo(requestMock, "mutation MuteConversation")[0].input as { conversationId: string })
        .conversationId,
    ).toBe("conv-1");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Muted #general until /)),
    );
  });
});
