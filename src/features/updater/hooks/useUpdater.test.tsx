import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

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

import { checkForUpdate, fetchUpdaterConfigured, relaunchApp } from "../api/updaterApi";
import { initialUpdaterData, useUpdaterStore } from "../state/useUpdaterStore";
import { fakeUpdate } from "../../../test/fakeUpdate";
import { useUpdater } from "./useUpdater";

const mockConfigured = vi.mocked(fetchUpdaterConfigured);
const mockCheck = vi.mocked(checkForUpdate);
const mockRelaunch = vi.mocked(relaunchApp);

async function renderConfigured() {
  mockConfigured.mockResolvedValue(true);
  const hook = renderHook(() => useUpdater());
  await waitFor(() => expect(hook.result.current.status).toBe("idle"));
  return hook;
}

describe("useUpdater", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useUpdaterStore.setState(initialUpdaterData);
    runtime.platform = "desktop";
    runtime.capabilities.updater = true;
    mockRelaunch.mockResolvedValue(undefined);
  });

  it("stays out of the way on a runtime that does not update itself", () => {
    runtime.platform = "web";
    runtime.capabilities.updater = false;
    const { result } = renderHook(() => useUpdater());
    expect(result.current.status).toBe("unsupported");
    expect(mockConfigured).not.toHaveBeenCalled();
  });

  it("reports a build without an update key as not configured and never checks", async () => {
    mockConfigured.mockResolvedValue(false);
    const { result } = renderHook(() => useUpdater());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("unconfigured"));

    await act(() => result.current.check());
    expect(mockCheck).not.toHaveBeenCalled();
    expect(result.current.status).toBe("unconfigured");
  });

  it("treats a shell that cannot answer as not configured", async () => {
    mockConfigured.mockRejectedValue(new Error("command updater_status not found"));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status).toBe("unconfigured"));
  });

  it("reads the status once however many components ask", async () => {
    mockConfigured.mockResolvedValue(true);
    const first = renderHook(() => useUpdater());
    const second = renderHook(() => useUpdater());
    await waitFor(() => expect(first.result.current.status).toBe("idle"));
    expect(second.result.current.status).toBe("idle");
    expect(mockConfigured).toHaveBeenCalledTimes(1);
  });

  it("says the app is up to date when the check finds nothing newer", async () => {
    mockCheck.mockResolvedValue(null);
    const { result } = await renderConfigured();

    let found: unknown = "unset";
    await act(async () => {
      found = await result.current.check();
    });
    expect(found).toBeNull();
    expect(result.current.status).toBe("upToDate");
    expect(result.current.available).toBeNull();
    expect(result.current.lastCheckedAt).not.toBeNull();
  });

  it("offers a newer version with its release notes", async () => {
    const fake = fakeUpdate("0.2.0", "Faster startup.");
    mockCheck.mockResolvedValue(fake.update);
    const { result } = await renderConfigured();

    await act(() => result.current.check());
    expect(result.current.status).toBe("available");
    expect(result.current.available).toEqual({
      version: "0.2.0",
      notes: "Faster startup.",
      date: "2026-11-01T12:00:00Z",
    });
  });

  it("tracks download progress, then installs and restarts on confirm", async () => {
    const fake = fakeUpdate("0.2.0");
    mockCheck.mockResolvedValue(fake.update);
    const { result } = await renderConfigured();
    await act(() => result.current.check());

    let downloading: Promise<void> = Promise.resolve();
    act(() => {
      downloading = result.current.download();
    });
    expect(result.current.status).toBe("downloading");
    expect(result.current.progress).toBeNull();

    act(() => fake.emit({ event: "Started", data: { contentLength: 200 } }));
    act(() => fake.emit({ event: "Progress", data: { chunkLength: 50 } }));
    expect(result.current.progress).toBe(0.25);
    act(() => fake.emit({ event: "Progress", data: { chunkLength: 100 } }));
    expect(result.current.progress).toBe(0.75);

    await act(async () => {
      fake.finishDownload();
      await downloading;
    });
    expect(result.current.status).toBe("ready");
    expect(fake.install).not.toHaveBeenCalled();

    await act(() => result.current.restart());
    expect(fake.install).toHaveBeenCalledTimes(1);
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it("leaves progress unknown when the server sends no length", async () => {
    const fake = fakeUpdate("0.2.0");
    mockCheck.mockResolvedValue(fake.update);
    const { result } = await renderConfigured();
    await act(() => result.current.check());

    act(() => void result.current.download());
    act(() => fake.emit({ event: "Started", data: {} }));
    act(() => fake.emit({ event: "Progress", data: { chunkLength: 50 } }));
    expect(result.current.status).toBe("downloading");
    expect(result.current.progress).toBeNull();
  });

  it("shows a failed check and lets the user try again", async () => {
    mockCheck.mockRejectedValueOnce("Could not fetch a valid release JSON from the remote");
    const { result } = await renderConfigured();

    await act(() => result.current.check());
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Could not fetch a valid release JSON from the remote");

    mockCheck.mockResolvedValueOnce(null);
    await act(() => result.current.check());
    expect(result.current.status).toBe("upToDate");
    expect(result.current.error).toBeNull();
  });

  it("keeps the offer after a failed download so it can be retried", async () => {
    const fake = fakeUpdate("0.2.0");
    mockCheck.mockResolvedValue(fake.update);
    const { result } = await renderConfigured();
    await act(() => result.current.check());

    let downloading: Promise<void> = Promise.resolve();
    act(() => {
      downloading = result.current.download();
    });
    await act(async () => {
      fake.finishDownload(new Error("signature verification failed"));
      await downloading;
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("signature verification failed");
    expect(result.current.available?.version).toBe("0.2.0");
    expect(result.current.progress).toBeNull();
  });

  it("reports a failed install and does not restart", async () => {
    const fake = fakeUpdate("0.2.0");
    fake.install.mockRejectedValue("installer exited with an error");
    mockCheck.mockResolvedValue(fake.update);
    const { result } = await renderConfigured();
    await act(() => result.current.check());
    let downloading: Promise<void> = Promise.resolve();
    act(() => {
      downloading = result.current.download();
    });
    await act(async () => {
      fake.finishDownload();
      await downloading;
    });

    await act(() => result.current.restart());
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("installer exited with an error");
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("does not start a second check while one is running, and releases a replaced offer", async () => {
    const first = fakeUpdate("0.2.0");
    const second = fakeUpdate("0.3.0");
    let answer: (u: typeof first.update) => void = () => undefined;
    mockCheck.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { result } = await renderConfigured();

    let checking: Promise<unknown> = Promise.resolve();
    act(() => {
      checking = result.current.check();
    });
    expect(result.current.status).toBe("checking");
    await act(() => result.current.check());
    expect(mockCheck).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer(first.update);
      await checking;
    });
    mockCheck.mockResolvedValueOnce(second.update);
    await act(() => result.current.check());
    expect(result.current.available?.version).toBe("0.3.0");
    expect(first.close).toHaveBeenCalledTimes(1);
  });
});
