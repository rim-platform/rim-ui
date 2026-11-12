import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { BUS_EVENTS, type UnreadRewoundEvent } from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";
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
