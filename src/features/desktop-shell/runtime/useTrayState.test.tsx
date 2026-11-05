import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke,
}));
const events = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    events.listeners.set(name, handler);
    return Promise.resolve(events.unlisten);
  }),
}));
const request = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request },
}));

import { useAuthStore } from "../../auth/state/useAuthStore";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useUpdaterStore } from "../../updater/state/useUpdaterStore";
import { useTrayState } from "./useTrayState";

let trayShown: boolean;
let counts: Record<string, number>;

function wrapper() {
  // Retries like the app's client, so the hook's own setting is what these tests see.
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function stateCalls() {
  return invoke.mock.calls
    .filter(([name]) => name === "desktop_set_tray_state")
    .map(([, args]) => args as Record<string, unknown>);
}

function countRequests() {
  return request.mock.calls.filter(([query]) => String(query).includes("UnreadNotificationCount"));
}

function renderTray() {
  return renderHook(() => useTrayState(), { wrapper: wrapper() });
}

/** Waits for the page to have asked whether the tray icon shows, and for the answer. */
async function trayAsked() {
  await waitFor(() =>
    expect(invoke.mock.calls.some(([name]) => name === "desktop_tray_shown")).toBe(true),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

/** Waits for the page to know the tray icon shows, the counts to be read and the state sent. */
async function expectState(dot: boolean, updateReady = false) {
  await waitFor(() => expect(stateCalls().at(-1)).toEqual({ dot, updateReady }));
}

describe("useTrayState", () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    trayShown = true;
    counts = { "ws-1": 0, "ws-2": 0, "direct-1": 0 };
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "desktop_tray_shown" ? trayShown : null),
    );
    request.mockImplementation((query: string, variables?: { serverId: string }) => {
      if (String(query).includes("MyServers")) {
        return Promise.resolve({
          myServers: [
            { id: "ws-1", name: "One", owner: null },
            { id: "ws-2", name: "Two", owner: null },
          ],
        });
      }
      return Promise.resolve({ myUnreadNotificationCount: counts[variables?.serverId ?? ""] ?? 0 });
    });
    useAuthStore.setState({ session: { userId: "u-1" } });
    useNotificationSettingsStore.setState({ enabled: true });
    useUpdaterStore.setState({ activity: "idle" });
    useRelayStore.setState({ info: { directSpaceId: "direct-1" } as never });
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    invoke.mockReset();
    request.mockReset();
    events.listeners.clear();
    events.unlisten.mockClear();
    useAuthStore.setState({ session: null });
    useRelayStore.setState({ info: null });
    useUpdaterStore.setState({ activity: "idle" });
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it("shows the dot when a workspace has something unread", async () => {
    counts["ws-2"] = 3;
    renderTray();
    await expectState(true);
    expect(stateCalls().at(-1)).toEqual({ dot: true, updateReady: false });
  });

  it("shows the dot when only the direct space has something unread", async () => {
    counts["direct-1"] = 1;
    renderTray();
    await expectState(true);
  });

  it("shows no dot with every count at zero", async () => {
    renderTray();
    await waitFor(() => expect(countRequests()).toHaveLength(3));
    await expectState(false);
    expect(stateCalls().every((args) => args.dot === false)).toBe(true);
  });

  it("shows no dot with this device's notifications off", async () => {
    counts["ws-1"] = 2;
    useNotificationSettingsStore.setState({ enabled: false });
    renderTray();
    await waitFor(() => expect(countRequests()).toHaveLength(3));
    await act(async () => {
      await Promise.resolve();
    });
    expect(stateCalls().every((args) => args.dot === false)).toBe(true);
  });

  it("reads nothing and shows no dot when signed out", async () => {
    useAuthStore.setState({ session: null });
    renderTray();
    await trayAsked();
    await expectState(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("drops the dot on signing out", async () => {
    counts["ws-1"] = 2;
    renderTray();
    await expectState(true);
    act(() => useAuthStore.setState({ session: null }));
    await expectState(false);
  });

  it("reads nothing while the tray icon does not show", async () => {
    trayShown = false;
    renderTray();
    await trayAsked();
    expect(request).not.toHaveBeenCalled();
  });

  it("starts reading on the event that the tray icon shows", async () => {
    trayShown = false;
    counts["ws-1"] = 1;
    renderTray();
    await waitFor(() => expect(events.listeners.has("desktop://tray-shown")).toBe(true));
    await trayAsked();
    expect(request).not.toHaveBeenCalled();
    act(() => events.listeners.get("desktop://tray-shown")?.({ payload: { shown: true } }));
    await expectState(true);
  });

  it("sends the state once at mount, before the tray icon shows", async () => {
    trayShown = false;
    useUpdaterStore.setState({ activity: "ready" });
    renderTray();
    await expectState(false, true);
    expect(stateCalls()).toHaveLength(1);
  });

  it("follows the updater store and sends only the two flags", async () => {
    renderTray();
    await expectState(false, false);
    act(() => useUpdaterStore.setState({ activity: "ready" }));
    await expectState(false, true);
    act(() => useUpdaterStore.setState({ activity: "installing" }));
    await expectState(false, false);
    for (const args of stateCalls()) {
      expect(Object.keys(args).sort()).toEqual(["dot", "updateReady"]);
    }
  });

  it("restarts through the updater store when the menu asks", async () => {
    const restartToUpdate = vi.fn(() => Promise.resolve());
    useUpdaterStore.setState({ restartToUpdate });
    renderTray();
    await waitFor(() => expect(events.listeners.has("desktop://tray-action")).toBe(true));
    act(() =>
      events.listeners.get("desktop://tray-action")?.({
        payload: { action: "restart-to-update" },
      }),
    );
    expect(restartToUpdate).toHaveBeenCalledTimes(1);
  });

  it("logs a failed command and carries on", async () => {
    invoke.mockImplementation((command: string) =>
      command === "desktop_set_tray_state"
        ? Promise.reject(new Error("no"))
        : Promise.resolve(command === "desktop_tray_shown" ? trayShown : null),
    );
    counts["ws-1"] = 1;
    renderTray();
    await waitFor(() => expect(stateCalls().at(-1)).toEqual({ dot: true, updateReady: false }));
  });

  it("keeps reading while the window is hidden, after a failed read too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    focusManager.setFocused(false);
    renderTray();
    await waitFor(() => expect(countRequests()).toHaveLength(3));
    await expectState(false);

    request.mockImplementation(() => Promise.reject(new Error("network")));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    const failed = countRequests().length;
    expect(failed).toBe(6);

    request.mockImplementation(() => Promise.resolve({ myUnreadNotificationCount: 1 }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(countRequests().length).toBe(failed + 3);
    await expectState(true);
  });

  it("stops listening when unmounted", async () => {
    const { unmount } = renderTray();
    await waitFor(() => expect(events.listeners.has("desktop://tray-action")).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(events.unlisten).toHaveBeenCalledTimes(2);
  });
});
