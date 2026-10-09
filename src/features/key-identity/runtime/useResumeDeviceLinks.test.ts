import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const resume = vi.hoisted(() => vi.fn());
const deviceKeys = vi.hoisted(() => ({ value: true }));

vi.mock("../api/deviceLink", () => ({ resumePendingDeviceLinks: resume }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: deviceKeys.value } }),
}));

import { useAuthStore } from "../../auth/state/useAuthStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useResumeDeviceLinks } from "./useResumeDeviceLinks";

function signIn(userId: string) {
  act(() => useAuthStore.getState().setSession({ userId }));
}

describe("useResumeDeviceLinks", () => {
  beforeEach(() => {
    deviceKeys.value = true;
    resume.mockReset();
    resume.mockResolvedValue(undefined);
    useAuthStore.getState().clearSession();
    useOfflineStore.getState().setOffline(false);
  });

  it("resumes once per signed-in account, and again for another account", async () => {
    signIn("u-1");
    const { rerender } = renderHook(() => useResumeDeviceLinks());
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(resume).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });

    act(() => useOfflineStore.getState().setOffline(true));
    act(() => useOfflineStore.getState().setOffline(false));
    rerender();
    expect(resume).toHaveBeenCalledTimes(1);

    signIn("u-2");
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
  });

  it("does nothing without a session", () => {
    renderHook(() => useResumeDeviceLinks());
    expect(resume).not.toHaveBeenCalled();
  });

  it("waits while offline", async () => {
    act(() => useOfflineStore.getState().setOffline(true));
    signIn("u-1");
    renderHook(() => useResumeDeviceLinks());
    expect(resume).not.toHaveBeenCalled();
    act(() => useOfflineStore.getState().setOffline(false));
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  });

  it("does nothing without device keys", () => {
    deviceKeys.value = false;
    signIn("u-1");
    renderHook(() => useResumeDeviceLinks());
    expect(resume).not.toHaveBeenCalled();
  });

  it("aborts on cleanup", async () => {
    let signal: AbortSignal | undefined;
    resume.mockImplementation(({ signal: s }: { signal: AbortSignal }) => {
      signal = s;
      return new Promise(() => undefined);
    });
    signIn("u-1");
    const { unmount } = renderHook(() => useResumeDeviceLinks());
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
