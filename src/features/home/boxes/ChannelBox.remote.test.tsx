import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setSpaceRouter } from "../../../core/graphql/client";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { RuntimeProvider } from "../../../core/runtime/RuntimeProvider";
import { createTestQueryClient } from "../../../test/utils";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { ChannelBoxBody } from "./ChannelBox";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const EMPTY_PAGE = {
  items: [],
  next: null,
  prev: null,
  pageInfo: { hasNext: false, hasPrev: false },
};

/** What the second host answers, by the operation a body asks for. */
function hostAnswer(body: string): unknown {
  const { query } = JSON.parse(body) as { query: string };
  if (query.includes("query Conversation(")) {
    return {
      data: {
        conversation: {
          id: "c-remote",
          serverId: "remote-ws",
          title: "launches",
          conversationType: ConversationTypeEnum.CHANNEL,
          memberIds: [],
          topic: null,
          isPrivate: false,
          isArchived: false,
          archivedAt: null,
          memberCount: 3,
          isMember: true,
          createdBy: "u-b",
          slowModeSeconds: 0,
          notificationLevel: null,
          effectiveNotificationLevel: null,
          encryptedAt: null,
          pendingMemberIds: [],
        },
      },
    };
  }
  if (query.includes("query Messages")) {
    return {
      data: {
        messages: {
          ...EMPTY_PAGE,
          items: [
            {
              id: "m-remote",
              serverId: "remote-ws",
              conversationId: "c-remote",
              threadId: null,
              rootThreadId: null,
              authorId: "u-b",
              author: { id: "u-b", username: "bea", displayName: "Bea" },
              text: "liftoff from the other server",
              hasAttachments: false,
              parentMessageId: null,
              isPinned: false,
              mentionedUserIds: [],
              forwardedFromMessageId: null,
              forwardedFrom: null,
              isDeleted: false,
              sentAt: new Date().toISOString(),
              reactions: [],
              attachments: [],
              linkPreviews: [],
            },
          ],
        },
      },
    };
  }
  if (query.includes("query ServerMembers")) return { data: { serverMembers: [] } };
  if (query.includes("query InboxConversations")) {
    return { data: { inboxConversations: EMPTY_PAGE } };
  }
  return { data: {} };
}

describe("a channel box of a workspace on another server", () => {
  const send = vi.fn();
  const fetchSpy = vi.fn();

  beforeEach(() => {
    send.mockReset();
    fetchSpy.mockReset();
    send.mockImplementation(async (_host: string, body: string) => json(hostAnswer(body)));
    // This server answers only its own questions, such as its capabilities.
    fetchSpy.mockImplementation(async () =>
      json({
        data: { serverInfo: { version: "0", apiVersion: 1, features: [], capabilities: [] } },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    setSpaceRouter({
      hostOf: (spaceId) => (spaceId === "remote-ws" ? "host-b" : null),
      send,
    });
    useAuthStore.setState({ session: { userId: "me" } });
    useWorkspaceStore.setState({ workspaceId: "local-ws" });
  });

  afterEach(() => {
    setSpaceRouter(null);
    vi.unstubAllGlobals();
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("reads the channel and its messages from that host, as the timeline does", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RuntimeProvider>
          <ChannelBoxBody
            boxId="ch"
            settings={{ workspaceId: "remote-ws", conversationId: "c-remote", count: 5 }}
          />
        </RuntimeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("liftoff from the other server")).toBeInTheDocument();
    expect(screen.getByText("Updates every minute.")).toBeInTheDocument();
    const asked = send.mock.calls.map(([host, body]) => [
      host,
      (JSON.parse(body as string) as { variables: Record<string, unknown> }).variables,
    ]);
    expect(asked).toContainEqual([
      "host-b",
      expect.objectContaining({ serverId: "remote-ws", conversationId: "c-remote" }),
    ]);
    for (const [host] of asked) expect(host).toBe("host-b");
    for (const [, init] of fetchSpy.mock.calls) {
      expect(String((init as RequestInit).body)).not.toContain("remote-ws");
    }
  });
});
