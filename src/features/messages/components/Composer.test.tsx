import { http, HttpResponse } from "msw";
import { server } from "../../../test/mocks/server";
import { useAttachmentUploadStore } from "../api/useAttachmentUploads";
import { MAX_ATTACHMENT_BYTES } from "../api/attachmentTypes";
import { useDraftStore } from "../state/useDraftStore";
import { useReplyTargetStore } from "../state/useReplyTargetStore";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import {
  PostingPolicy,
  ServerFeatureState,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { serverInfoQueryClient, type FakeFeatures } from "../../../test/serverInfo";
import { limitsQueryClient } from "../../../test/limits";
import { queryKeys } from "../../../core/query/keys";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { toast } from "../../../shared/toast/useToastStore";
import { NETWORK_ERROR_MESSAGE, timedOutMessage } from "../../../core/graphql/errors";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useTimeoutStore } from "../../workspaces/state/useTimeoutStore";
import { useKnownHandles } from "../../workspaces/state/useKnownHandles";
import { useSlowModeStore } from "../state/useSlowModeStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useShellStore } from "../../../shell/state/useShellStore";
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
const markTypingSent = vi.hoisted(() => vi.fn());

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
  useTypingIndicator: () => ({ handleKeystroke: () => {}, markSent: markTypingSent }),
}));

import { Composer, ThreadComposer } from "./Composer";

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

  it("says the server could not be reached when a send never gets there", async () => {
    serve(makeConversation(), ServerMemberRoleGql.GUEST, {
      "mutation SendMessage": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hello" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NETWORK_ERROR_MESSAGE));
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("keeps the fallback for a failure that is not the server's", async () => {
    serve(makeConversation(), ServerMemberRoleGql.GUEST, {
      "mutation SendMessage": () => {
        throw new Error("encoder state mismatch");
      },
    });
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hello" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to send message"));
  });
});

describe("Composer — posting policy", () => {
  const restricted = (allowsThreads: boolean) => ({
    "query ChannelPosting(": () => ({
      conversation: {
        id: "conv-1",
        postingPolicy: PostingPolicy.MODERATORS,
        postingAllowsThreads: allowsThreads,
      },
    }),
  });

  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("replaces the composer with a bar for a member of a moderators-only channel", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, restricted(true));
    renderComposer();
    const bar = await screen.findByTestId("posting-restricted-bar");
    expect(bar).toHaveTextContent("Only the owner and moderators can post in this channel.");
    expect(bar).toHaveTextContent("You can still react and reply in threads.");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("leaves out the thread note when threads are closed too", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, restricted(false));
    renderComposer();
    const bar = await screen.findByTestId("posting-restricted-bar");
    expect(bar).not.toHaveTextContent("react and reply");
  });

  it("keeps the composer for a moderator", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MODERATOR, restricted(false));
    const qc = renderComposer();
    await waitFor(() =>
      expect(
        qc.getQueryData([...queryKeys.conversation("ws-1", "conv-1"), "posting"]),
      ).toBeDefined(),
    );
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByTestId("posting-restricted-bar")).not.toBeInTheDocument();
  });

  it("keeps the composer when the server refuses the posting query", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "query ChannelPosting(": () => {
        throw graphqlError("GRAPHQL_VALIDATION_FAILED", 'Unknown field "postingPolicy"');
      },
    });
    const qc = renderComposer();
    await waitFor(() =>
      expect(
        qc.getQueryState([...queryKeys.conversation("ws-1", "conv-1"), "posting"])?.status,
      ).toBe("error"),
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

describe("Composer — slow mode and timeouts", () => {
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
    await screen.findByTestId("slow-mode-indicator");
    await send("too fast");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Slow mode: wait 12 s"));
    expect(screen.getByRole("textbox")).toHaveValue("too fast");
    await waitFor(() =>
      expect(screen.getByTestId("slow-mode-indicator")).toHaveTextContent(
        /Slow mode: wait 1[12] s/,
      ),
    );
  });

  it.each([
    [12, "Slow down: try again in 12 s"],
    [undefined, "Slow down: try again in a moment"],
  ])(
    "RATE_LIMITED outside slow mode (%s s) says to slow down and keeps the text",
    async (retryAfterSeconds, message) => {
      serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
        "mutation SendMessage": () => {
          throw Object.assign(new Error("rate limit exceeded (serialized)"), {
            response: {
              errors: [
                {
                  message: "rate limit exceeded",
                  extensions: { code: "RATE_LIMITED", retryAfterSeconds },
                },
              ],
            },
          });
        },
      });
      renderComposer();
      await send("one more");

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
      expect(screen.getByRole("textbox")).toHaveValue("one more");
      expect(screen.queryByTestId("slow-mode-indicator")).not.toBeInTheDocument();
    },
  );

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

describe("Composer — offline", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useOfflineStore.setState({ offline: true });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useOfflineStore.setState({ offline: false });
  });

  it("says sending is off, keeps typing, and sends nothing", async () => {
    serve(makeConversation());
    renderComposer();

    expect(await screen.findByTestId("offline-composer-notice")).toBeInTheDocument();
    const textbox = await screen.findByRole("textbox");
    expect(textbox).toBeEnabled();
    fireEvent.change(textbox, { target: { value: "written offline" } });
    fireEvent.submit(textbox.closest("form")!);

    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(textbox).toHaveValue("written offline");
  });
});

describe("Composer — attachments switch", () => {
  beforeEach(() => {
    useAttachmentUploadStore.setState({ failed: [], busy: [] });
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  function renderWith(features: FakeFeatures = {}) {
    return render(
      <QueryClientProvider client={serverInfoQueryClient(features)}>
        <Composer workspaceId="ws-1" conversationId="conv-1" />
      </QueryClientProvider>,
    );
  }

  function dropFile(name: string) {
    const form = screen.getByRole("textbox").closest("form")!;
    fireEvent.drop(form, { dataTransfer: { files: [new File(["x"], name)] } });
  }

  it("offers the attach button and takes a drop while the server runs attachments", async () => {
    serve(makeConversation());
    renderWith();
    await screen.findByRole("textbox");
    expect(screen.getByRole("button", { name: "Attach file" })).toBeInTheDocument();

    dropFile("notes.txt");
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
  });

  it("offers no attach button and takes no drop while attachments are switched off", async () => {
    serve(makeConversation());
    renderWith({ attachments: ServerFeatureState.DISABLED });
    await screen.findByRole("textbox");
    expect(screen.queryByRole("button", { name: "Attach file" })).not.toBeInTheDocument();

    dropFile("notes.txt");
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("keeps text, its saved draft and selected files when sending fails", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => {
        throw new Error("network unavailable");
      },
    });
    const view = renderWith();
    const textbox = await screen.findByRole("textbox");
    dropFile("notes.txt");
    fireEvent.change(textbox, { target: { value: "keep this draft" } });
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(textbox).toHaveValue("keep this draft");
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("keep this draft");
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    view.unmount();
    renderWith();
    expect(await screen.findByRole("textbox")).toHaveValue("keep this draft");
  });

  it("retries failed files without resending the delivered message", async () => {
    let ticketAttempts = 0;
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "delivered" } }),
      "mutation CreateAttachment": () => {
        if (ticketAttempts++ === 0) throw new Error("disconnected");
        return { createAttachment: { attachmentId: "att-1", uploadToken: "token" } };
      },
      "mutation FinalizeAttachment": () => ({
        finalizeAttachment: { id: "att-1", status: "READY" },
      }),
    });
    server.use(http.post("*/api/files/upload", () => new HttpResponse(null, { status: 204 })));
    const view = renderWith();
    const textbox = await screen.findByRole("textbox");
    dropFile("notes.txt");
    fireEvent.change(textbox, { target: { value: "file for you" } });
    fireEvent.submit(textbox.closest("form")!);
    await screen.findByRole("button", { name: "Retry files" });
    expect(textbox).toHaveValue("");
    view.unmount();
    renderWith();
    fireEvent.click(await screen.findByRole("button", { name: "Retry files" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Retry files" })).not.toBeInTheDocument(),
    );
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1);
    expect(callsTo(requestMock, "mutation CreateAttachment")).toHaveLength(2);
    expect(callsTo(requestMock, "mutation FinalizeAttachment")).toHaveLength(1);
  });

  it("refuses an unsupported file when it is attached", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "unexpected" } }),
    });
    renderWith();
    await screen.findByRole("textbox");
    dropFile("program.exe");

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
    expect(screen.queryByText("program.exe")).toBeNull();
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("refuses a file over 25 MiB when it is attached", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER);
    renderWith();
    const textbox = await screen.findByRole("textbox");
    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
    fireEvent.drop(textbox.closest("form")!, { dataTransfer: { files: [big] } });

    expect(toast.error).toHaveBeenCalledWith(
      "big.bin is larger than 25 MiB, the largest file you can attach.",
    );
    expect(screen.queryByText("big.bin")).toBeNull();
  });

  it("submits once and preserves text entered while that send is pending", async () => {
    let deliver!: (value: unknown) => void;
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    });
    renderWith();
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "first message" } });
    fireEvent.submit(textbox.closest("form")!);
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    fireEvent.change(textbox, { target: { value: "next draft" } });
    await act(async () => deliver({ sendMessage: { id: "delivered" } }));
    expect(textbox).toHaveValue("next draft");
  });

  it("says attachments are switched off when the server refuses the upload", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
      "mutation CreateAttachment": () => {
        throw Object.assign(new Error("serialized"), {
          response: {
            errors: [
              {
                message: "the attachments feature is not available on this server",
                extensions: { code: "FEATURE_DISABLED", feature: "attachments" },
              },
            ],
          },
        });
      },
    });
    renderWith();
    const textbox = await screen.findByRole("textbox");
    dropFile("notes.txt");
    await screen.findByText("notes.txt");
    fireEvent.change(textbox, { target: { value: "see attached" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Attachments are switched off on this server", {
        id: "feature-disabled-attachments",
      }),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe("Composer — message byte cap", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
    });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  async function typeWithCap(messageBytes: number | null, text: string) {
    render(
      <QueryClientProvider client={limitsQueryClient({ messageBytes })}>
        <Composer workspaceId="ws-1" conversationId="conv-1" />
      </QueryClientProvider>,
    );
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: text } });
    return textbox;
  }

  it("shows the UTF-8 byte count only near the cap", async () => {
    const textbox = await typeWithCap(100, "a".repeat(89));
    expect(screen.queryByTestId("message-bytes-counter")).not.toBeInTheDocument();

    fireEvent.change(textbox, { target: { value: "é".repeat(45) } });
    expect(screen.getByTestId("message-bytes-counter")).toHaveTextContent(/^90 of 100 bytes$/);
  });

  it("shows no counter on a server without a byte cap", async () => {
    await typeWithCap(null, "a".repeat(5000));
    expect(screen.queryByTestId("message-bytes-counter")).not.toBeInTheDocument();
  });

  it("refuses a message over the cap in the server's words and keeps the text", async () => {
    const textbox = await typeWithCap(100, "a".repeat(101));
    expect(screen.getByTestId("message-bytes-counter")).toHaveTextContent(
      "101 of 100 bytes: too long to send",
    );

    fireEvent.submit(textbox.closest("form")!);

    expect(toast.error).toHaveBeenCalledWith("This instance allows 100 bytes of text per message.");
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(textbox).toHaveValue("a".repeat(101));
  });

  it("sends a message at the cap", async () => {
    const textbox = await typeWithCap(100, "a".repeat(100));
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("Composer — typing indicator", () => {
  beforeEach(() => {
    requestMock.mockReset();
    markTypingSent.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("lifts the typing throttle once a message is sent, not before", async () => {
    let answer: (value: unknown) => void = () => {};
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => new Promise((resolve) => (answer = resolve)),
    });
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hello" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    expect(markTypingSent).not.toHaveBeenCalled();

    answer({ sendMessage: { id: "m-1" } });
    await waitFor(() => expect(markTypingSent).toHaveBeenCalledTimes(1));
  });
});

describe("Composer — mentions by handle", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useKnownHandles.setState({ byUser: { "u-alice": "@alice:elsewhere.example" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
    useKnownHandles.setState({ byUser: {} });
  });

  function sentText(): string | undefined {
    const vars = callsTo(requestMock, "mutation SendMessage")[0] as
      { input?: { text?: string } } | undefined;
    return vars?.input?.text;
  }

  it("turns a member's whole handle typed out into a mention, and a bare name it starts with not", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
    });
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    await waitFor(() =>
      expect(callsTo(requestMock, "query ServerMembers").length).toBeGreaterThan(0),
    );
    fireEvent.change(textbox, {
      target: { value: "hi @alice:elsewhere.example and @alice:elsewhere.example.org" },
    });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(sentText()).toBeDefined());
    expect(sentText()).toBe("hi <@u-alice> and @alice:elsewhere.example.org");
  });

  it("offers a member by their handle and inserts it", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
    });
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    await waitFor(() =>
      expect(callsTo(requestMock, "query ServerMembers").length).toBeGreaterThan(0),
    );
    fireEvent.change(textbox, { target: { value: "@alice:else", selectionStart: 11 } });

    const row = await screen.findByRole("button", { name: /Alice/ });
    expect(row).toHaveTextContent("@alice:elsewhere.example");
    fireEvent.click(row);
    expect(textbox).toHaveValue("@alice:elsewhere.example ");
  });
});

describe("ThreadComposer", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useDraftStore.setState({ drafts: {} });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("keeps a thread reply's draft apart from the conversation's", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER);
    const view = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ThreadComposer
          workspaceId="ws-1"
          conversationId="conv-1"
          thread={{ rootMessageId: "root-1", threadId: "t-1" }}
        />
      </QueryClientProvider>,
    );
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "half a reply" } });
    view.unmount();
    expect(useDraftStore.getState().getDraft("thread:conv-1:root-1")).toBe("half a reply");
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("");
  });
});

describe("Composer — reply", () => {
  const target = { messageId: "m-parent", authorId: "u-alice", excerpt: "Lunch at noon?" };

  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    useDraftStore.setState({ drafts: {} });
    useReplyTargetStore.setState({ targets: {} });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useReplyTargetStore.setState({ targets: {} });
    useShellStore.getState().setNavigationMode(false);
  });

  function sentInput(): Record<string, unknown> | undefined {
    const vars = callsTo(requestMock, "mutation SendMessage")[0] as
      { input?: Record<string, unknown> } | undefined;
    return vars?.input;
  }

  it("sends a reply with its parent and clears the reply bar", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => ({ sendMessage: { id: "m-2" } }),
    });
    useReplyTargetStore.getState().start("conv-1", target);
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    expect(screen.getByText("Lunch at noon?")).toBeInTheDocument();

    fireEvent.change(textbox, { target: { value: "agreed" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => expect(sentInput()).toBeDefined());
    expect(sentInput()).toMatchObject({ text: "agreed", parentMessageId: "m-parent" });
    await waitFor(() => expect(screen.queryByText("Replying to")).not.toBeInTheDocument());
    expect(useReplyTargetStore.getState().targets["conv-1"]).toBeUndefined();
  });

  it("keeps the reply bar when the send fails", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation SendMessage": () => {
        throw graphqlError("FORBIDDEN", "You cannot post here");
      },
    });
    useReplyTargetStore.getState().start("conv-1", target);
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "agreed" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot post here"));
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    expect(useReplyTargetStore.getState().targets["conv-1"]).toEqual(target);
  });

  it("cancels the reply with its button and with Escape", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER);
    useReplyTargetStore.getState().start("conv-1", target);
    renderComposer();
    const textbox = await screen.findByRole("textbox");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel reply" }));
    expect(screen.queryByText("Replying to")).not.toBeInTheDocument();

    act(() => useReplyTargetStore.getState().start("conv-1", target));
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    fireEvent.keyDown(textbox, { key: "Escape" });
    expect(screen.queryByText("Replying to")).not.toBeInTheDocument();
    expect(useShellStore.getState().navigationMode).toBe(false);

    fireEvent.keyDown(textbox, { key: "Escape" });
    expect(useShellStore.getState().navigationMode).toBe(true);
  });

  it("sends no parent from the thread reply box", async () => {
    serve(makeConversation(), ServerMemberRoleGql.MEMBER, {
      "mutation ReplyToMessage": () => ({ replyToMessage: { id: "r-1" } }),
    });
    useReplyTargetStore.getState().start("conv-1", target);
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ThreadComposer
          workspaceId="ws-1"
          conversationId="conv-1"
          thread={{ rootMessageId: "root-1", threadId: "t-1" }}
        />
      </QueryClientProvider>,
    );
    const textbox = await screen.findByRole("textbox");
    expect(screen.queryByText("Replying to")).not.toBeInTheDocument();
    fireEvent.change(textbox, { target: { value: "in the thread" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => expect(callsTo(requestMock, "mutation ReplyToMessage")).toHaveLength(1));
    expect(JSON.stringify(callsTo(requestMock, "mutation ReplyToMessage")[0])).not.toContain(
      "parentMessageId",
    );
    expect(callsTo(requestMock, "mutation SendMessage")).toEqual([]);
    expect(useReplyTargetStore.getState().targets["conv-1"]).toEqual(target);
  });
});
