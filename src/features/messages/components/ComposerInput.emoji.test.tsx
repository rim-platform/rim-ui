import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { serverInfoQueryClient } from "../../../test/serverInfo";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { ConversationSummary } from "../../conversations/types";
import {
  baseReadHandlers,
  makeConversation,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ handleKeystroke: () => {}, markSent: () => {} }),
}));

import { Composer } from "./Composer";

const partyblob = {
  id: "e-1",
  name: "partyblob",
  imageUrl: "https://example.com/partyblob.png",
  serverId: "ws-1",
  uploadedBy: "u-alice",
  createdAt: "2026-10-01T00:00:00Z",
};

function serve(conversation: ConversationSummary) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Conversation(": () => ({ conversation }),
    "query CustomEmojis": () => ({ customEmojis: [partyblob] }),
  });
}

function renderComposer() {
  render(
    <QueryClientProvider client={serverInfoQueryClient()}>
      <Composer workspaceId="ws-1" conversationId="conv-1" />
    </QueryClientProvider>,
  );
}

describe("ComposerInput — : emoji suggestions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("suggests a custom emoji and inserts it as :name:", async () => {
    serve(makeConversation());
    renderComposer();
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: ":party", selectionStart: 6 } });
    fireEvent.click(await screen.findByRole("button", { name: /:partyblob:/ }));

    expect(box.value).toBe(":partyblob: ");
  });
});
