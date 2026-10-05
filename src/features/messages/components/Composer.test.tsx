import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { toast } from "../../../shared/toast/useToastStore";
import type { ConversationSummary } from "../../conversations/types";
import {
  baseReadHandlers,
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
// Composer imports the toast from the store module directly; mocking it there covers the
// `shared/toast` index too, which re-exports it.
vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  useToastStore: vi.fn(),
}));
vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ handleKeystroke: () => {} }),
}));

import { Composer } from "./Composer";

function serve(
  conversation: ConversationSummary,
  role: ServerMemberRoleGql = ServerMemberRoleGql.GUEST,
  extra: Record<string, (vars: Record<string, unknown>) => unknown> = {},
) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "query Conversation(": () => ({ conversation }),
    ...extra,
  });
}

function renderComposer() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <Composer workspaceId="ws-1" conversationId="conv-1" />
    </QueryClientProvider>,
  );
  return qc;
}

describe("Composer — membership and archive gate", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("shows the composer for a joined channel", async () => {
    serve(makeConversation());
    const qc = renderComposer();
    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.conversation("ws-1", "conv-1"))).toBeDefined(),
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByTestId("join-channel-bar")).not.toBeInTheDocument();
  });

  it("replaces the composer with a join bar for an unjoined public channel", async () => {
    const unjoined = makeConversation({ isMember: false, memberCount: 42 });
    serve(unjoined, ServerMemberRoleGql.GUEST, {
      "mutation JoinChannel": () => ({ joinChannel: { ...unjoined, isMember: true } }),
    });
    renderComposer();

    const bar = await screen.findByTestId("join-channel-bar");
    expect(bar).toHaveTextContent("42 members");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // After joining, the conversation refetches as a member and the composer returns.
    serve({ ...unjoined, isMember: true }, ServerMemberRoleGql.GUEST, {
      "mutation JoinChannel": () => ({ joinChannel: { ...unjoined, isMember: true } }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Join channel" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation JoinChannel")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1" },
      ]),
    );
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
  });

  it("shows an archived bar without Unarchive for a guest", async () => {
    serve(makeConversation({ isArchived: true }));
    const qc = renderComposer();
    expect(await screen.findByTestId("archived-conversation-bar")).toHaveTextContent(
      "This channel is archived",
    );
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(screen.queryByRole("button", { name: "Unarchive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("lets an owner unarchive from the archived bar", async () => {
    serve(makeConversation({ isArchived: true }), ServerMemberRoleGql.OWNER, {
      "mutation SetConversationArchived": () => ({
        setConversationArchived: makeConversation(),
      }),
    });
    renderComposer();
    fireEvent.click(await screen.findByRole("button", { name: "Unarchive" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetConversationArchived")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", archived: false },
      ]),
    );
  });

  it("shows the server message and flips to the archived bar when a send hits CONVERSATION_ARCHIVED", async () => {
    let archived = false;
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "query Server(": () => ({
        server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.GUEST },
      }),
      "query Conversation(": () => ({ conversation: makeConversation({ isArchived: archived }) }),
      "mutation SendMessage": () => {
        archived = true;
        throw graphqlError("CONVERSATION_ARCHIVED", "This conversation is archived");
      },
    });
    renderComposer();

    const textbox = await screen.findByRole("textbox");
    await waitFor(() =>
      expect(callsTo(requestMock, "query Conversation(").length).toBeGreaterThan(0),
    );
    fireEvent.change(textbox, { target: { value: "hello" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This conversation is archived"));
    expect(await screen.findByTestId("archived-conversation-bar")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the server message for other send failures without leaving the composer", async () => {
    serve(makeConversation(), ServerMemberRoleGql.GUEST, {
      "mutation SendMessage": () => {
        throw graphqlError("FORBIDDEN", "You cannot post here");
      },
    });
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hello" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot post here"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
