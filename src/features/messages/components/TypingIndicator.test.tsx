import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import { TypingIndicator } from "./TypingIndicator";
import { useTypingStore } from "../state/useTypingStore";

/** The indicator for conv-1 of ws-1, a conversation of `conversationType`. */
function renderIndicator(conversationType = ConversationTypeEnum.DIRECT) {
  const qc = createTestQueryClient();
  qc.setQueryData(queryKeys.conversation("ws-1", "conv-1"), makeConversation({ conversationType }));
  return render(
    <QueryClientProvider client={qc}>
      <TypingIndicator workspaceId="ws-1" conversationId="conv-1" />
    </QueryClientProvider>,
  );
}

describe("TypingIndicator", () => {
  beforeEach(() => {
    useTypingStore.setState({ typingByConversation: {} });
  });

  it("renders nothing when no one is typing", () => {
    const { container } = renderIndicator();
    expect(container.textContent).toBe("");
  });

  it("shows singular typing message for one user", () => {
    useTypingStore.setState({
      typingByConversation: {
        "conv-1": [{ userId: "u1", username: "alice", expiresAt: Date.now() + 10000 }],
      },
    });

    renderIndicator();
    expect(screen.getByText("alice is typing...")).toBeInTheDocument();
  });

  it("shows plural typing message for two users", () => {
    useTypingStore.setState({
      typingByConversation: {
        "conv-1": [
          { userId: "u1", username: "alice", expiresAt: Date.now() + 10000 },
          { userId: "u2", username: "bob", expiresAt: Date.now() + 10000 },
        ],
      },
    });

    renderIndicator();
    expect(screen.getByText("alice and bob are typing...")).toBeInTheDocument();
  });

  it("shows 'and N others' for three or more users", () => {
    useTypingStore.setState({
      typingByConversation: {
        "conv-1": [
          { userId: "u1", username: "alice", expiresAt: Date.now() + 10000 },
          { userId: "u2", username: "bob", expiresAt: Date.now() + 10000 },
          { userId: "u3", username: "charlie", expiresAt: Date.now() + 10000 },
        ],
      },
    });

    renderIndicator();
    expect(screen.getByText("alice and 2 others are typing...")).toBeInTheDocument();
  });

  it("renders nothing for a different conversation", () => {
    useTypingStore.setState({
      typingByConversation: {
        "conv-2": [{ userId: "u1", username: "alice", expiresAt: Date.now() + 10000 }],
      },
    });

    const { container } = renderIndicator();
    expect(container.textContent).toBe("");
  });

  it("renders nothing for a channel or a group, even with someone in the store", () => {
    useTypingStore.setState({
      typingByConversation: {
        "conv-1": [{ userId: "u1", username: "alice", expiresAt: Date.now() + 10000 }],
      },
    });

    for (const type of [ConversationTypeEnum.CHANNEL, ConversationTypeEnum.GROUP]) {
      const { container, unmount } = renderIndicator(type);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});
