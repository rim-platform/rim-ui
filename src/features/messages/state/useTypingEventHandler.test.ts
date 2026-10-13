import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { eventBus } from "../../../core/events/eventBus";
import {
  BUS_EVENTS,
  type TypingStartedEvent,
  type TypingStoppedEvent,
} from "../../../core/events/busEvents";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useTypingEventHandler } from "./useTypingEventHandler";
import { useTypingStore } from "./useTypingStore";

function started(userId: string, username: string) {
  eventBus.emit<TypingStartedEvent>(BUS_EVENTS.TYPING_STARTED, {
    conversationId: "conv-1",
    userId,
    username,
  });
}

function stopped(userId: string) {
  eventBus.emit<TypingStoppedEvent>(BUS_EVENTS.TYPING_STOPPED, {
    conversationId: "conv-1",
    userId,
  });
}

function typists(): string[] {
  return (useTypingStore.getState().typingByConversation["conv-1"] ?? []).map((e) => e.userId);
}

describe("useTypingEventHandler", () => {
  beforeEach(() => {
    useTypingStore.setState({ typingByConversation: {} });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("a typist's message removes them and leaves the other typists", () => {
    renderHook(() => useTypingEventHandler());
    started("u-2", "Bob");
    started("u-3", "Carol");

    stopped("u-2");

    expect(typists()).toEqual(["u-3"]);
  });

  it("stops listening for starts and stops once unmounted", () => {
    const { unmount } = renderHook(() => useTypingEventHandler());
    started("u-2", "Bob");
    unmount();

    stopped("u-2");
    started("u-3", "Carol");

    expect(typists()).toEqual(["u-2"]);
  });
});
