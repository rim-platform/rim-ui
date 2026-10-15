import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { createTestQueryClient } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useE2eeStore } from "../../e2ee/state/useE2eeStore";
import { useKeySetupOfferStore } from "../../key-identity/state/keySetupOffer";
import { useConversation } from "../api/useConversation";
import type { ConversationSummary, ConversationSummaryPage } from "../types";
import {
  baseReadHandlers,
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
} from "../__fixtures__/conversations";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../e2ee/runtime/session", () => ({ e2eeSession: () => Promise.resolve(null) }));

import { InvitationGate } from "./ConversationInvitation";

const invitation = makeConversation({
  id: "conv-9",
  title: "plans",
  conversationType: ConversationTypeEnum.GROUP,
  memberIds: ["u-alice", "u-bob"],
  memberCount: 2,
  isMember: false,
  createdBy: "u-alice",
  pendingMemberIds: ["me"],
  encryptedAt: "2026-10-15T00:00:00Z",
});
const accepted = {
  ...invitation,
  memberIds: ["u-alice", "u-bob", "me"],
  memberCount: 3,
  isMember: true,
  pendingMemberIds: [],
};

/** What the inbox answers; handlers change it the way the server would. */
let inbox: ConversationSummary[] = [];

function serve(accept: () => unknown = () => ({ acceptConversationInvite: accepted })) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query InboxConversations": () => ({
      inboxConversations: { items: inbox, pageInfo: { hasNext: false, hasPrev: false } },
    }),
    "query Conversation(": () => ({ conversation: accepted }),
    "mutation AcceptConversationInvite": () => {
      const answer = accept();
      inbox = [accepted];
      return answer;
    },
    "mutation DeclineConversationInvite": () => {
      inbox = [];
      return { declineConversationInvite: true };
    },
  });
}

/** Reads the conversation the way the header does, beside the gate. */
function HeaderProbe() {
  const { data } = useConversation("ws-1", "conv-9");
  return <p>header: {data?.title}</p>;
}

async function renderGate() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <HeaderProbe />
      <InvitationGate workspaceId="ws-1" conversationId="conv-9">
        <p>timeline</p>
      </InvitationGate>
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Invitation" });
  return qc;
}

describe("InvitationGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inbox = [invitation];
    serve();
    useAuthStore.setState({ session: { userId: "me" } });
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "conv-9" });
    useE2eeStore.setState({ webEncryption: "ready" });
    useKeySetupOfferStore.setState({ available: null, requested: false });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("shows the invitation instead of the conversation, from the inbox alone", async () => {
    await renderGate();
    expect(screen.getByRole("heading", { name: "plans" })).toBeInTheDocument();
    expect(await screen.findByText("Group · started by Alice")).toBeInTheDocument();
    expect(screen.getByText("Members: Alice and Bob")).toBeInTheDocument();
    expect(screen.getByText(/You were invited to an encrypted conversation\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
    expect(screen.queryByText("timeline")).not.toBeInTheDocument();
    // The header reads the inbox entry: the server refuses the conversation and its messages.
    expect(screen.getByText("header: plans")).toBeInTheDocument();
    expect(callsTo(requestMock, "query Conversation(")).toEqual([]);
    expect(callsTo(requestMock, "query Messages")).toEqual([]);
  });

  it("joins: the conversation then loads like any other", async () => {
    const user = userEvent.setup();
    await renderGate();
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText("timeline")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Invitation" })).not.toBeInTheDocument();
    expect(callsTo(requestMock, "mutation AcceptConversationInvite")).toEqual([
      { serverId: "ws-1", conversationId: "conv-9" },
    ]);
    await waitFor(() => expect(callsTo(requestMock, "query Conversation(")).not.toEqual([]));
  });

  it("offers to set up encryption on a device that is not ready, instead of Join", async () => {
    const user = userEvent.setup();
    useE2eeStore.setState({ webEncryption: "noDeviceKey" });
    useKeySetupOfferStore.setState({ available: "link" });
    await renderGate();
    expect(screen.getByText(/Set up a device for encryption to join\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up encryption" }));
    expect(useKeySetupOfferStore.getState().requested).toBe(true);
  });

  it("explains linking a browser that has no key setup step here", async () => {
    useE2eeStore.setState({ webEncryption: "noDeviceKey" });
    await renderGate();
    expect(screen.getByText(/link it to your account/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up encryption" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
  });

  it("declines: the invitation leaves the list and closes", async () => {
    const user = userEvent.setup();
    const qc = await renderGate();
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(callsTo(requestMock, "mutation DeclineConversationInvite")).toEqual([
      { serverId: "ws-1", conversationId: "conv-9" },
    ]);
    const page = qc.getQueryData<ConversationSummaryPage>(queryKeys.conversations("ws-1"));
    expect(page?.items.map((c) => c.id)).toEqual([]);
  });

  it("shows the server's reason when it refuses the join", async () => {
    const reason = "every member of an encrypted conversation needs a device set up for encryption";
    serve(() => {
      throw graphqlError("VALIDATION", reason);
    });
    const user = userEvent.setup();
    await renderGate();
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(reason);
    expect(screen.getByRole("region", { name: "Invitation" })).toBeInTheDocument();
  });

  it("reads the inbox again when the invitation is gone, and closes it", async () => {
    serve(() => {
      inbox = [];
      throw graphqlError("NOT_FOUND", "not found");
    });
    const user = userEvent.setup();
    const qc = await renderGate();
    const before = callsTo(requestMock, "query InboxConversations").length;
    await user.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(callsTo(requestMock, "query InboxConversations").length).toBeGreaterThan(before);
    expect(toast.info).toHaveBeenCalledWith("This invitation is no longer open");
    const page = qc.getQueryData<ConversationSummaryPage>(queryKeys.conversations("ws-1"));
    expect(page?.items).toEqual([]);
  });
});
