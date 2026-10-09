import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../core/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "../../../core/logger";
import type { SafeInvokeResult } from "../../../core/tauri/safeInvoke";
import type { ExportReport } from "../api/historyArchive";
import { createArchiveExportScheduler } from "./archiveExport";

const alice = { endpoint: "http://localhost:8080/api", userId: "alice" };
const bob = { endpoint: "http://localhost:8080/api", userId: "bob" };
const done: SafeInvokeResult<ExportReport> = {
  ok: true,
  value: { segments: 1, messages: 3, conversations: 1 },
};

describe("createArchiveExportScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports once per interval however many syncs ask", async () => {
    const exportNow = vi.fn(async () => done);
    const scheduler = createArchiveExportScheduler({ exportNow, delayMs: 1_000 });

    scheduler.request(alice);
    scheduler.request(alice);
    await vi.advanceTimersByTimeAsync(500);
    scheduler.request(alice);
    expect(exportNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);

    expect(exportNow).toHaveBeenCalledTimes(1);
    expect(exportNow).toHaveBeenCalledWith(alice);
  });

  it("keeps accounts apart", async () => {
    const exportNow = vi.fn(async () => done);
    const scheduler = createArchiveExportScheduler({ exportNow, delayMs: 1_000 });

    scheduler.request(alice);
    scheduler.request(bob);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(exportNow).toHaveBeenCalledTimes(2);
  });

  it("schedules another export for a request that arrives while one runs", async () => {
    let finish: () => void = () => {};
    const exportNow = vi.fn(
      () =>
        new Promise<SafeInvokeResult<ExportReport>>((resolve) => {
          finish = () => resolve(done);
        }),
    );
    const scheduler = createArchiveExportScheduler({ exportNow, delayMs: 1_000 });

    scheduler.request(alice);
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.request(alice);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(exportNow).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(exportNow).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when no archive is set up or it is locked, and warns otherwise", async () => {
    const results: SafeInvokeResult<ExportReport>[] = [
      {
        ok: false,
        error: { kind: "backend_error", code: "ARCHIVE_NOT_CONFIGURED", message: "none" },
      },
      { ok: false, error: { kind: "backend_error", code: "ARCHIVE_LOCKED", message: "locked" } },
      { ok: false, error: { kind: "ipc_unavailable", message: "web" } },
      {
        ok: false,
        error: { kind: "backend_error", code: "ARCHIVE_UNAVAILABLE", message: "unplugged" },
      },
    ];
    const exportNow = vi.fn(async () => results.shift()!);
    const scheduler = createArchiveExportScheduler({ exportNow, delayMs: 10 });

    for (let i = 0; i < 4; i++) {
      scheduler.request(alice);
      await vi.advanceTimersByTimeAsync(10);
    }

    expect(exportNow).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
