import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  forward: vi.fn(),
  send: vi.fn(),
  sendEncrypted: vi.fn(),
}));

vi.mock("../../conversations/api/useChannels", () => ({
  useChannels: () => ({
    data: {
      items: [
        {
          id: "plain",
          title: "general",
          conversationType: "CHANNEL",
          memberIds: [],
          encryptedAt: null,
        },
      ],
    },
  }),
}));
vi.mock("../../conversations/api/useInboxConversations", () => ({
  useInboxConversations: () => ({
    data: {
      items: [
        {
          id: "secret",
          title: "team",
          conversationType: "GROUP",
          memberIds: [],
          encryptedAt: "2026-10-09T00:00:00Z",
        },
      ],
    },
  }),
}));
vi.mock("../../workspaces/hooks/useMemberLookup", () => ({
  useMemberLookup: () => ({ resolve: () => ({ displayName: "x" }) }),
}));
vi.mock("../../workspaces/api/useServerMembers", () => ({
  useServerMembers: () => ({
    data: [
      { userId: "u-me", username: "me", principalId: "rimp1_me" },
      { userId: "u-bob", username: "bob", principalId: "rimp1_bob" },
    ],
  }),
}));
vi.mock("../api/useForwardMessage", () => ({
  useForwardMessageMutation: () => ({ mutateAsync: mocks.forward }),
}));
vi.mock("../api/useMessages", () => ({
  useSendMessageMutation: () => ({ mutateAsync: mocks.send }),
}));
vi.mock("../../e2ee/runtime/send", () => ({ sendEncrypted: mocks.sendEncrypted }));
vi.mock("../../../core/runtime/runtime", async (importActual) => ({
  ...(await importActual<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => "desktop",
}));

import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { ForwardDialog } from "./ForwardDialog";

function renderDialog(source: Record<string, unknown>) {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.messages("ws", "src"), {
    pages: [{ items: [source] }],
    pageParams: [null],
  });
  render(
    <QueryClientProvider client={qc}>
      <ForwardDialog
        open
        onClose={() => {}}
        messageId="m-1"
        messageText="hello"
        workspaceId="ws"
        sourceConversationId="src"
      />
    </QueryClientProvider>,
  );
}

const encryptedSource = {
  id: "m-1",
  text: "hi <@rimp1_bob>",
  sentAt: "2026-10-09T10:00:00Z",
  author: { id: "u-bob", principalId: "rimp1_bob" },
  attachments: [],
  e2ee: { status: "decrypted", senderPrincipalId: "rimp1_bob" },
};

describe("ForwardDialog in encrypted conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().setSession({ userId: "u-me" });
  });

  it("asks before posting an encrypted message's text unencrypted", async () => {
    renderDialog(encryptedSource);
    fireEvent.click(screen.getByText("general"));
    expect(await screen.findByText(/posts its text unencrypted/)).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Forward unencrypted"));
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith({
        workspaceId: "ws",
        conversationId: "plain",
        text: "hi <@u-bob>",
        forwardedFromMessageId: "m-1",
      }),
    );
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("re-sends the content, encrypted, into an encrypted conversation", async () => {
    renderDialog(encryptedSource);
    fireEvent.click(screen.getByText("team"));
    await waitFor(() => expect(mocks.sendEncrypted).toHaveBeenCalled());
    const [ws, target, draft] = mocks.sendEncrypted.mock.calls[0];
    expect([ws, target]).toEqual(["ws", "secret"]);
    expect(draft).toMatchObject({
      body: "hi <@rimp1_bob>",
      forwardedFrom: {
        messageId: "m-1",
        conversationId: "src",
        authorPrincipalId: "rimp1_bob",
        sentAt: "2026-10-09T10:00:00Z",
      },
    });
  });

  it("forwards plaintext to plaintext through the server as before", async () => {
    renderDialog({ ...encryptedSource, e2ee: null, text: "plain" });
    fireEvent.click(screen.getByText("general"));
    await waitFor(() => expect(mocks.forward).toHaveBeenCalled());
  });
});
