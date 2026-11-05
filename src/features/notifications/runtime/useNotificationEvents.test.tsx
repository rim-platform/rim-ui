import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BUS_EVENTS, type NotificationDueBusEvent } from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";

type Observer = { next: (result: { data?: unknown }) => void };
let observer: Observer | null = null;
let connected: (() => void) | null = null;
const stopMock = vi.fn();
const subscribeMock = vi.fn((_request: unknown, o: Observer) => {
  observer = o;
  return stopMock;
});

vi.mock("../../../core/graphql/wsClient", () => ({
  wsClient: { subscribe: (...args: [unknown, Observer]) => subscribeMock(...args) },
  onWsConnected: vi.fn((cb: () => void) => {
    connected = cb;
    return () => {};
  }),
}));

const capabilityMock = vi.fn();
vi.mock("../../updater/api/serverCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../updater/api/serverCapabilities")>()),
  serverHasCapability: (...args: unknown[]) => capabilityMock(...args),
}));

import { useAuthStore } from "../../auth/state/useAuthStore";
import { NOTIFICATION_EVENTS_SUBSCRIPTION, useNotificationEvents } from "./useNotificationEvents";

function mount() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useNotificationEvents(), { wrapper });
}

describe("useNotificationEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observer = null;
    connected = null;
    capabilityMock.mockReset().mockResolvedValue(true);
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("subscribes when the server lists the capability", async () => {
    mount();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    expect(subscribeMock.mock.calls[0][0]).toEqual({ query: NOTIFICATION_EVENTS_SUBSCRIPTION });
  });

  it("announces each notification with its workspace and lower-case reason", async () => {
    const seen: NotificationDueBusEvent[] = [];
    const off = eventBus.on<NotificationDueBusEvent>(BUS_EVENTS.NOTIFICATION_DUE, (e) =>
      seen.push(e),
    );
    mount();
    await waitFor(() => expect(observer).not.toBeNull());
    observer?.next({
      data: {
        notificationEvents: {
          workspaceId: "ws-2",
          notificationId: "n-1",
          conversationId: "c-1",
          messageId: "m-1",
          reason: "THREAD_REPLY",
          quiet: false,
        },
      },
    });
    off();
    expect(seen).toEqual([
      {
        workspaceId: "ws-2",
        notificationId: "n-1",
        conversationId: "c-1",
        messageId: "m-1",
        reason: "thread_reply",
        quiet: false,
      },
    ]);
  });

  it("stays off on a server without the capability", async () => {
    capabilityMock.mockResolvedValue(false);
    mount();
    await waitFor(() => expect(capabilityMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("checks again when the WebSocket connects", async () => {
    capabilityMock.mockResolvedValue(false);
    mount();
    await waitFor(() => expect(capabilityMock).toHaveBeenCalledTimes(1));
    expect(subscribeMock).not.toHaveBeenCalled();

    capabilityMock.mockResolvedValue(true);
    connected?.();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    connected?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a session", async () => {
    useAuthStore.setState({ session: null });
    mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(capabilityMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("stops when unmounted", async () => {
    const { unmount } = mount();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    unmount();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
