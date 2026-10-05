import type { Mock } from "vitest";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "../types";

/** A conversation as the `ConversationFields` fragment returns it; defaults to a public channel. */
export function makeConversation(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: "conv-1",
    serverId: "ws-1",
    title: "general",
    conversationType: ConversationTypeEnum.CHANNEL,
    memberIds: ["me"],
    topic: null,
    isPrivate: false,
    isArchived: false,
    archivedAt: null,
    memberCount: 1,
    isMember: true,
    createdBy: null,
    ...overrides,
  };
}

export const workspaceMembers = [
  {
    userId: "me",
    username: "me",
    memberRole: "MEMBER",
    joinedAt: "2026-01-01T00:00:00Z",
    avatarUrl: null,
    statusText: null,
    bio: null,
    displayName: "Me Myself",
  },
  {
    userId: "u-alice",
    username: "alice",
    memberRole: "MEMBER",
    joinedAt: "2026-01-01T00:00:00Z",
    avatarUrl: null,
    statusText: null,
    bio: null,
    displayName: "Alice",
  },
  {
    userId: "u-bob",
    username: "bob",
    memberRole: "MEMBER",
    joinedAt: "2026-01-01T00:00:00Z",
    avatarUrl: null,
    statusText: null,
    bio: null,
    displayName: "Bob",
  },
];

export const currentUser = {
  id: "me",
  username: "me",
  displayName: "Me Myself",
  avatarUrl: null,
  statusText: null,
  bio: null,
};

type Handler = (variables: Record<string, unknown>) => unknown;

/**
 * Routes `graphqlClient.request(document, variables)` calls by a substring of the document
 * (e.g. `"mutation JoinChannel"`). A handler's return value resolves the request; a thrown
 * error rejects it. Unrouted requests never settle, like a slow server.
 */
export function routeRequests(requestMock: Mock, handlers: Record<string, Handler>): void {
  requestMock.mockImplementation((document: unknown, variables: Record<string, unknown> = {}) => {
    const doc = String(document);
    for (const [needle, handler] of Object.entries(handlers)) {
      if (doc.includes(needle)) {
        try {
          return Promise.resolve(handler(variables));
        } catch (err) {
          return Promise.reject(err);
        }
      }
    }
    return new Promise(() => {});
  });
}

/** The variables of every request whose document contains `needle`. */
export function callsTo(requestMock: Mock, needle: string): Record<string, unknown>[] {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes(needle))
    .map(([, variables]) => (variables ?? {}) as Record<string, unknown>);
}

/** A failed request shaped like graphql-request's `ClientError`. */
export function graphqlError(code: string, message: string): Error {
  return Object.assign(new Error(`${message} (serialized response)`), {
    response: { errors: [{ message, extensions: { code } }] },
  });
}

/** Common read handlers: the current user and the workspace member list. */
export const baseReadHandlers: Record<string, Handler> = {
  "query Me": () => ({ me: currentUser }),
  "query ServerMembers": () => ({ serverMembers: workspaceMembers }),
};
