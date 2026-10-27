import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importWithRetry, isChunkLoadError } from "./importWithRetry";

const CHUNK_ERROR = new TypeError(
  "Failed to fetch dynamically imported module: https://x/assets/native-a.js",
);

describe("importWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a failed chunk fetch and returns the module", async () => {
    const load = vi.fn().mockRejectedValueOnce(CHUNK_ERROR).mockResolvedValue({ ok: true });
    const result = importWithRetry(load, 2, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retries with the last error", async () => {
    const last = new TypeError("Failed to fetch dynamically imported module: last");
    const load = vi
      .fn()
      .mockRejectedValueOnce(CHUNK_ERROR)
      .mockRejectedValueOnce(CHUNK_ERROR)
      .mockRejectedValueOnce(last);
    const result = importWithRetry(load, 2, 500);
    const settled = expect(result).rejects.toBe(last);
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not retry another error", async () => {
    const other = new Error("boom");
    const load = vi.fn().mockRejectedValue(other);
    await expect(importWithRetry(load, 2, 500)).rejects.toBe(other);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("isChunkLoadError", () => {
  it("recognises the Chromium, Firefox and Safari messages", () => {
    expect(isChunkLoadError(CHUNK_ERROR)).toBe(true);
    expect(
      isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/a.js")),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });
});
