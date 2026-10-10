import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const runtime = { platform: "desktop", capabilities: { updater: true } };

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => runtime,
}));

vi.mock("../api/updaterApi", () => ({
  BUILD_VERSION: "0.1.0",
  fetchUpdaterConfigured: vi.fn(),
  checkForUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  readClientVersion: vi.fn(),
}));

import { checkForUpdate, fetchUpdaterConfigured } from "../api/updaterApi";
import { useToastStore } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { initialUpdaterData, useUpdaterStore } from "../state/useUpdaterStore";
import { fakeUpdate } from "../../../test/fakeUpdate";
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_TOAST_ID, useUpdateSchedule } from "./useUpdateSchedule";

const mockConfigured = vi.mocked(fetchUpdaterConfigured);
const mockCheck = vi.mocked(checkForUpdate);

/** Lets pending promise callbacks run under fake timers. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function updateToasts() {
  return useToastStore.getState().toasts.filter((t) => t.id === UPDATE_TOAST_ID);
}

describe("useUpdateSchedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    useUpdaterStore.setState(initialUpdaterData);
    useToastStore.setState({ toasts: [] });
    runtime.capabilities.updater = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks at launch and announces a new version with a toast that opens About", async () => {
    mockConfigured.mockResolvedValue(true);
    mockCheck.mockResolvedValue(fakeUpdate("0.2.0").update);
    renderHook(() => useUpdateSchedule());
    await settle();

    expect(mockCheck).toHaveBeenCalledTimes(1);
    const [notice] = updateToasts();
    expect(notice.title).toBe("Update available");
    expect(notice.description).toContain("0.2.0");
    expect(notice.persistent).toBe(true);

    act(() => notice.action?.onClick());
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "about" });
  });

  it("checks again every 24 hours and announces each version once", async () => {
    mockConfigured.mockResolvedValue(true);
    mockCheck.mockResolvedValue(fakeUpdate("0.2.0").update);
    renderHook(() => useUpdateSchedule());
    await settle();
    act(() => useToastStore.getState().remove(UPDATE_TOAST_ID));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    });
    expect(mockCheck).toHaveBeenCalledTimes(2);
    expect(updateToasts()).toHaveLength(0);

    mockCheck.mockResolvedValue(fakeUpdate("0.3.0").update);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    });
    expect(mockCheck).toHaveBeenCalledTimes(3);
    expect(updateToasts()[0].description).toContain("0.3.0");
  });

  it("raises nothing when the app is up to date or the check fails", async () => {
    mockConfigured.mockResolvedValue(true);
    mockCheck.mockResolvedValueOnce(null);
    renderHook(() => useUpdateSchedule());
    await settle();
    expect(updateToasts()).toHaveLength(0);

    mockCheck.mockRejectedValueOnce("offline");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    });
    expect(updateToasts()).toHaveLength(0);
    expect(useUpdaterStore.getState().error).toBe("offline");
  });

  it("never checks in a build without an update key", async () => {
    mockConfigured.mockResolvedValue(false);
    renderHook(() => useUpdateSchedule());
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("does nothing on the web", async () => {
    runtime.capabilities.updater = false;
    renderHook(() => useUpdateSchedule());
    await settle();
    expect(mockConfigured).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("stops checking once unmounted", async () => {
    mockConfigured.mockResolvedValue(true);
    mockCheck.mockResolvedValue(null);
    const { unmount } = renderHook(() => useUpdateSchedule());
    await settle();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    });
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });
});
