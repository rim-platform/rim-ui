import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "../../../core/query/queryClient";
import { createTestQueryClient } from "../../../test/utils";
import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { toast } from "../../../shared/toast/useToastStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useDraftStore } from "../state/useDraftStore";
import { openDirectWith } from "../../conversations/state/openDirect";
import {
  baseReadHandlers,
  callsTo,
  emptyInbox,
  makeConversation,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  useToastStore: vi.fn(),
}));
vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ handleKeystroke: () => {}, markSent: () => {} }),
}));

import { Composer } from "./Composer";
import { useGlobalKeyHandlers } from "../../../shell/hooks/useGlobalKeyHandlers";

/** The app's global key handling around `children`. */
function WithKeys({ children }: { children: ReactNode }) {
  useGlobalKeyHandlers();
  return <>{children}</>;
}

function serve(extra: Record<string, (vars: Record<string, unknown>) => unknown> = {}) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
    "query Conversation(": () => ({ conversation: makeConversation() }),
    "mutation SendMessage": () => ({ sendMessage: { id: "sent" } }),
    ...extra,
  });
}

/** The composer drawn for `conversationId` in ws-1, as the timeline draws it. */
function composerFor(conversationId: string, qc = createTestQueryClient()) {
  return (
    <QueryClientProvider client={qc}>
      <Composer workspaceId="ws-1" conversationId={conversationId} />
    </QueryClientProvider>
  );
}

/** The channel's composer, drawn for `conv-1` while that conversation is open. */
async function channelComposer() {
  render(composerFor("conv-1"));
  const textbox = await screen.findByRole("textbox");
  fireEvent.change(textbox, { target: { value: "meant for the DM" } });
  return textbox;
}

/** The workspace DM between the viewer and Alice. */
const aliceDm = makeConversation({
  id: "conv-dm",
  title: null,
  conversationType: ConversationTypeEnum.DIRECT,
  memberIds: ["me", "u-alice"],
  memberCount: 2,
});

describe("Composer — a send while the app switches conversations", () => {
  beforeEach(() => {
    requestMock.mockReset();
    // openDirectWith reads the inbox through the app's own query client.
    queryClient.clear();
    vi.mocked(toast.info).mockReset();
    useDraftStore.setState({ drafts: {} });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1", draftDirect: null });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.setState({ selectedConversationId: null, draftDirect: null });
    useAuthStore.setState({ session: null });
  });

  it("sends nothing once another conversation is open, and keeps the text", async () => {
    serve();
    const textbox = await channelComposer();
    // The app opened the DM; this composer has not been drawn for it yet.
    act(() => useShellStore.setState({ selectedConversationId: "conv-dm" }));

    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(textbox).toHaveValue("meant for the DM");
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("meant for the DM");
  });

  it("sends nothing while a direct message is still opening", async () => {
    let answerInbox!: (value: unknown) => void;
    serve({
      "query InboxConversations": () =>
        new Promise((resolve) => {
          answerInbox = resolve;
        }),
    });
    const textbox = await channelComposer();
    const opened = openDirectWith({ workspaceId: "ws-1", otherUserId: "u-2" });
    await waitFor(() => expect(answerInbox).toBeDefined());

    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(textbox).toHaveValue("meant for the DM");
    await act(async () => {
      answerInbox(emptyInbox);
      await opened;
    });
  });

  it("puts keys typed while the DM opens into the DM's composer, never the channel's", async () => {
    let answerInbox!: (value: unknown) => void;
    serve({
      "query InboxConversations": () =>
        new Promise((resolve) => {
          answerInbox = resolve;
        }),
    });
    const qc = createTestQueryClient();
    const view = render(<WithKeys>{composerFor("conv-1", qc)}</WithKeys>);
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "channel draft" } });
    textbox.blur();

    const opened = openDirectWith({ workspaceId: "ws-1", otherUserId: "u-alice" });
    await waitFor(() => expect(answerInbox).toBeDefined());
    for (const key of "hi") fireEvent.keyDown(document.body, { key });
    expect(document.activeElement).not.toBe(textbox);
    await act(async () => {
      answerInbox({ inboxConversations: { ...emptyInbox.inboxConversations, items: [aliceDm] } });
      await opened;
    });
    expect(useShellStore.getState().selectedConversationId).toBe("conv-dm");
    // Typed after the DM opened and before its composer is drawn.
    fireEvent.keyDown(document.body, { key: "!" });
    view.rerender(<WithKeys>{composerFor("conv-dm", qc)}</WithKeys>);

    const dmBox = screen.getByRole("textbox");
    await waitFor(() => expect(dmBox).toHaveValue("hi!"));
    expect(document.activeElement).toBe(dmBox);
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("channel draft");
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("sends as before while the conversation it was drawn for is open", async () => {
    serve();
    const textbox = await channelComposer();

    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation SendMessage")[0]).toMatchObject({
      input: { serverId: "ws-1", conversationId: "conv-1", text: "meant for the DM" },
    });
    expect(toast.info).not.toHaveBeenCalled();
  });
});
