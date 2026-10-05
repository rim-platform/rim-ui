import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { NotificationLevel } from "../../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { baseReadHandlers, makeConversation, routeRequests } from "../__fixtures__/conversations";
import { useUnreadStore } from "../state/useUnreadStore";
import { useMutedStore } from "../state/useMutedStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../commands/hooks/useKeybindLabel", () => ({ useKeybindLabel: () => null }));
vi.mock("../../../core/events/usePrefetchMessages", () => ({ usePrefetchMessages: () => {} }));

import { ConversationList } from "./ConversationList";

const general = makeConversation({ id: "c-general", title: "general" });
const loud = makeConversation({ id: "c-loud", title: "loud" });
const silenced = makeConversation({
  id: "c-silenced",
  title: "silenced",
  notificationLevel: NotificationLevel.NONE,
  effectiveNotificationLevel: NotificationLevel.NONE,
});
const timedMute = makeConversation({
  id: "c-timed",
  title: "timed",
  notificationLevel: NotificationLevel.ALL,
  effectiveNotificationLevel: NotificationLevel.NONE,
});

function serve() {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Channels": () => ({
      channels: {
        items: [general, loud, silenced, timedMute],
        pageInfo: { hasNext: false, hasPrev: false },
      },
    }),
    "query InboxConversations": () => ({
      inboxConversations: { items: [], pageInfo: { hasNext: false, hasPrev: false } },
    }),
  });
}

async function titleOf(name: string): Promise<HTMLElement> {
  return screen.findByText(name, { selector: "span.block" });
}

describe("ConversationList — effective notification level", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useMutedStore.setState({ mutedIds: new Set() });
    useUnreadStore.setState({ counts: { "c-loud": 3, "c-silenced": 4, "c-timed": 2 } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
    useUnreadStore.setState({ counts: {} });
  });

  it("bolds unread conversations that notify", async () => {
    serve();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ConversationList onNewChannel={vi.fn()} />
      </QueryClientProvider>,
    );
    const title = await titleOf("loud");
    expect(title).toHaveClass("font-semibold");
    expect(title).not.toHaveClass("text-rim-text-faint");
  });

  it("dims conversations whose effective level is NONE and drops their unread bold", async () => {
    serve();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ConversationList onNewChannel={vi.fn()} />
      </QueryClientProvider>,
    );
    for (const name of ["silenced", "timed"]) {
      const title = await titleOf(name);
      expect(title).toHaveClass("text-rim-text-faint");
      expect(title).not.toHaveClass("font-semibold");
    }
    // The unread count stays visible, without the accent.
    expect(screen.getByText("4")).toHaveClass("bg-rim-line");
    expect(screen.getByText("3")).toHaveClass("bg-rim-accent");
  });
});
