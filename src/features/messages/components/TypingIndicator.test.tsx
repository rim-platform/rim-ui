import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TypingIndicator } from "./TypingIndicator";
import { useTypingStore } from "../state/useTypingStore";

describe("TypingIndicator", () => {
  beforeEach(() => {
    useTypingStore.setState({ typingByConversation: {} });
  });

  it("renders nothing when no one is typing", () => {
    const { container } = render(<TypingIndicator conversationId="conv-1" />);
    expect(container.textContent).toBe("");
  });

  it("shows singular typing message for one user", () => {
    useTypingStore.setState({
      typingByConversation: {
        "conv-1": [
          { userId: "u1", username: "alice", expiresAt: Date.now() + 10000 },
        ],
      },
    });

    render(<TypingIndicator conversationId="conv-1" />);
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

    render(<TypingIndicator conversationId="conv-1" />);
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

    render(<TypingIndicator conversationId="conv-1" />);
    expect(screen.getByText("alice and 2 others are typing...")).toBeInTheDocument();
  });

  it("renders nothing for a different conversation", () => {
    useTypingStore.setState({
      typingByConversation: {
        "conv-2": [
          { userId: "u1", username: "alice", expiresAt: Date.now() + 10000 },
        ],
      },
    });

    const { container } = render(<TypingIndicator conversationId="conv-1" />);
    expect(container.textContent).toBe("");
  });
});
