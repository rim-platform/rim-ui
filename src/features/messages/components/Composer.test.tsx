import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { toast } from "../../../shared/toast/useToastStore";
import { timedOutMessage } from "../../../core/graphql/errors";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useTimeoutStore } from "../../workspaces/state/useTimeoutStore";
import { useSlowModeStore } from "../state/useSlowModeStore";
import type { ConversationSummary } from "../../conversations/types";
import {
  baseReadHandlers,
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
  workspaceMembers,
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

describe("Composer — slow mode and timeouts (Track 1.2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useSlowModeStore.setState({ blockedUntil: {} });
    useTimeoutStore.setState({ byWorkspace: {} });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
    vi.useRealTimers();
  });

  async function send(text: string) {
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: text } });
    fireEvent.submit(textbox.closest("form")!);
  }

  it("shows no slow-mode indicator when slow mode is off", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER);
    renderComposer();
    await screen.findByRole("textbox");
    expect(screen.queryByTestId("slow-mode-indicator")).not.toBeInTheDocument();
  });

  it("shows the interval, then counts down locally after the viewer sends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(makeConversation({ slowModeSeconds: 30 }), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
    });
    renderComposer();
    expect(await screen.findByTestId("slow-mode-indicator")).toHaveTextContent("Slow mode: 30 s");

    await send("hello");
    await waitFor(() =>
      expect(screen.getByTestId("slow-mode-indicator")).toHaveTextContent("Slow mode: wait 30 s"),
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    await waitFor(() =>
      expect(screen.getByTestId("slow-mode-indicator")).toHaveTextContent(
        /Slow mode: wait (19|20) s/,
      ),
    );
    act(() => {
      vi.advanceTimersByTime(21_000);
    });
    await waitFor(() =>
      expect(screen.getByTestId("slow-mode-indicator")).toHaveTextContent("Slow mode: 30 s"),
    );
  });

  it("marks owners and moderators as exempt, without a countdown", async () => {
    serve(makeConversation({ slowModeSeconds: 60 }), ServerMemberRoleGql.MODERATOR, {
      "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
    });
    renderComposer();
    await waitFor(() =>
      expect(screen.getByTestId("slow-mode-indicator")).toHaveTextContent(
        "Slow mode: 1 min (you are exempt)",
      ),
    );
    await send("hello");
    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    expect(screen.getByTestId("slow-mode-indicator")).toHaveTextContent("(you are exempt)");
  });

  it("RATE_LIMITED from a send says how long to wait and gives the text back", async () => {
    serve(makeConversation({ slowModeSeconds: 30 }), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => {
        throw Object.assign(new Error("rate limit exceeded (serialized)"), {
          response: {
            errors: [
              {
                message: "rate limit exceeded",
                extensions: { code: "RATE_LIMITED", retryAfterSeconds: 12 },
              },
            ],
          },
        });
      },
    });
    renderComposer();
    await send("too fast");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Slow mode: wait 12 s"));
    expect(screen.getByRole("textbox")).toHaveValue("too fast");
    await waitFor(() =>
      expect(screen.getByTestId("slow-mode-indicator")).toHaveTextContent(
        /Slow mode: wait 1[12] s/,
      ),
    );
  });

  it("shows the timed-out banner and disables the composer from the member directory", async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) =>
          m.userId === "me" ? { ...m, timeoutUntil: until } : m,
        ),
      }),
    });
    renderComposer();

    expect(await screen.findByTestId("timed-out-banner")).toHaveTextContent(timedOutMessage(until));
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("ignores a timeout that has already ended", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) =>
          m.userId === "me" ? { ...m, timeoutUntil: "2000-01-01T00:00:00Z" } : m,
        ),
      }),
    });
    const qc = renderComposer();
    await waitFor(() => expect(qc.getQueryData(queryKeys.serverMembers("ws-1"))).toBeDefined());
    expect(screen.queryByTestId("timed-out-banner")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).not.toBeDisabled();
  });

  it("a TIMED_OUT send shows the same message, the banner, and keeps the text", async () => {
    const until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    let timedOut = false;
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      // The member list catches up after the error, as the server would answer.
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) =>
          m.userId === "me" && timedOut ? { ...m, timeoutUntil: until } : m,
        ),
      }),
      "mutation SendMessage": () => {
        timedOut = true;
        throw Object.assign(new Error("timed out (serialized)"), {
          response: {
            errors: [
              { message: `timed out until ${until}`, extensions: { code: "TIMED_OUT", until } },
            ],
          },
        });
      },
    });
    renderComposer();
    await send("hi there");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(timedOutMessage(until)));
    expect(await screen.findByTestId("timed-out-banner")).toHaveTextContent(timedOutMessage(until));
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveValue("hi there");
  });
});
