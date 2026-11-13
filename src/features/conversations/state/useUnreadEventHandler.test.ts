import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  BUS_EVENTS,
  type UnreadIncrementEvent,
  type UnreadRewoundEvent,
} from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnreadEventHandler } from "./useUnreadEventHandler";
import { useUnreadStore } from "./useUnreadStore";

function rewound(conversationId: string) {
  act(() => eventBus.emit<UnreadRewoundEvent>(BUS_EVENTS.UNREAD_REWOUND, { conversationId }));
}

beforeEach(() => {
  useUnreadStore.setState({ held: {}, counts: {}, spaceOf: {}, markers: {} });
  useShellStore.setState({ selectedConversationId: "open" });
});

describe("useUnreadEventHandler: a rewind, here or from another device", () => {
  it("holds the open conversation, so reading it does not undo the rewind at once", () => {
    renderHook(() => useUnreadEventHandler());
    rewound("open");
    expect(useUnreadStore.getState().held).toEqual({ open: true });
  });

  it("leaves a conversation that is not open to be read as usual", () => {
    renderHook(() => useUnreadEventHandler());
    rewound("other");
    expect(useUnreadStore.getState().held).toEqual({});
  });
});

function arrived(conversationId: string) {
  act(() =>
    eventBus.emit<UnreadIncrementEvent>(BUS_EVENTS.UNREAD_INCREMENT, {
      conversationId,
      workspaceId: "ws",
      authorId: "maya",
    }),
  );
}

describe("useUnreadEventHandler: new messages", () => {
  beforeEach(() => {
    useAuthStore.setState({ session: { userId: "me" } });
  });

  it("counts nothing for the conversation on screen", () => {
    useShellStore.setState({
      selectedConversationId: "general",
      mainSurface: { kind: "conversation" },
    });
    renderHook(() => useUnreadEventHandler());
    arrived("general");
    arrived("plugins");
    expect(useUnreadStore.getState().counts).toEqual({ plugins: 1 });
  });

  it("counts the selected conversation while Home covers it, with others arriving at once", () => {
    useShellStore.setState({ selectedConversationId: "general", mainSurface: { kind: "home" } });
    renderHook(() => useUnreadEventHandler());
    for (let i = 0; i < 3; i++) {
      arrived("general");
      arrived("plugins");
    }
    expect(useUnreadStore.getState().counts).toEqual({ general: 3, plugins: 3 });
  });
});
