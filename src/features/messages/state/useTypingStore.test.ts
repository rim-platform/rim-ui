import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useTypingStore } from "./useTypingStore";

describe("useTypingStore", () => {
  beforeEach(() => {
    useTypingStore.setState({ typingByConversation: {} });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty typing state", () => {
    expect(useTypingStore.getState().typingByConversation).toEqual({});
  });

  it("adds a typing user to a conversation", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    const entries = useTypingStore.getState().typingByConversation["conv-1"];
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe("user-1");
    expect(entries[0].username).toBe("Alice");
  });

  it("updates expiry when same user types again", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    const firstExpiry = useTypingStore.getState().typingByConversation["conv-1"][0].expiresAt;

    vi.advanceTimersByTime(2000);
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    const secondExpiry = useTypingStore.getState().typingByConversation["conv-1"][0].expiresAt;

    expect(secondExpiry).toBeGreaterThan(firstExpiry);
  });

  it("tracks multiple users typing in the same conversation", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    useTypingStore.getState().addTyping("conv-1", "user-2", "Bob");
    const entries = useTypingStore.getState().typingByConversation["conv-1"];
    expect(entries).toHaveLength(2);
  });

  it("tracks typing across multiple conversations", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    useTypingStore.getState().addTyping("conv-2", "user-2", "Bob");
    expect(useTypingStore.getState().typingByConversation["conv-1"]).toHaveLength(1);
    expect(useTypingStore.getState().typingByConversation["conv-2"]).toHaveLength(1);
  });

  it("removeExpired clears expired entries", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    vi.advanceTimersByTime(6000); // past the 5s TTL
    useTypingStore.getState().removeExpired();
    expect(useTypingStore.getState().typingByConversation["conv-1"]).toBeUndefined();
  });

  it("removeExpired keeps non-expired entries", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    vi.advanceTimersByTime(2000); // within TTL
    useTypingStore.getState().removeExpired();
    expect(useTypingStore.getState().typingByConversation["conv-1"]).toHaveLength(1);
  });

  it("removeExpired returns same state when nothing changed", () => {
    const before = useTypingStore.getState();
    useTypingStore.getState().removeExpired();
    // Empty state, nothing to remove — should be same reference
    expect(useTypingStore.getState().typingByConversation).toBe(before.typingByConversation);
  });

  it("removeTyping drops that user's entry and keeps the other typists", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    useTypingStore.getState().addTyping("conv-1", "user-2", "Bob");
    useTypingStore.getState().addTyping("conv-2", "user-1", "Alice");

    useTypingStore.getState().removeTyping("conv-1", "user-1");

    const { typingByConversation } = useTypingStore.getState();
    expect(typingByConversation["conv-1"].map((e) => e.userId)).toEqual(["user-2"]);
    expect(typingByConversation["conv-2"].map((e) => e.userId)).toEqual(["user-1"]);
  });

  it("removeTyping drops the conversation once its last typist is gone", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    useTypingStore.getState().removeTyping("conv-1", "user-1");
    expect(useTypingStore.getState().typingByConversation).toEqual({});
  });

  it("removeTyping of someone not typing returns the same state", () => {
    useTypingStore.getState().addTyping("conv-1", "user-1", "Alice");
    const before = useTypingStore.getState().typingByConversation;
    useTypingStore.getState().removeTyping("conv-1", "user-2");
    useTypingStore.getState().removeTyping("conv-9", "user-1");
    expect(useTypingStore.getState().typingByConversation).toBe(before);
  });
});
