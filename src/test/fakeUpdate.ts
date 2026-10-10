import { vi } from "vitest";

import type { DownloadEvent, Update } from "../features/updater/api/updaterApi";

/** A stand-in for the plugin's `Update` whose download the test drives event by event. */
export interface FakeUpdate {
  update: Update;
  /** Sends a download event to the running download. */
  emit: (event: DownloadEvent) => void;
  /** Ends the running download, successfully or with `error`. */
  finishDownload: (error?: unknown) => void;
  install: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

export function fakeUpdate(version: string, notes?: string): FakeUpdate {
  let onEvent: ((event: DownloadEvent) => void) | undefined;
  let settle: { resolve: () => void; reject: (e: unknown) => void } | undefined;
  const install = vi.fn(() => Promise.resolve());
  const close = vi.fn(() => Promise.resolve());
  const update = {
    version,
    currentVersion: "0.1.0",
    body: notes,
    date: "2026-11-01T12:00:00Z",
    rawJson: {},
    download: vi.fn(
      (handler?: (event: DownloadEvent) => void) =>
        new Promise<void>((resolve, reject) => {
          onEvent = handler;
          settle = { resolve, reject };
        }),
    ),
    install,
    close,
  } as unknown as Update;
  return {
    update,
    emit: (event) => onEvent?.(event),
    finishDownload: (error) => {
      if (error === undefined) {
        onEvent?.({ event: "Finished" });
        settle?.resolve();
      } else {
        settle?.reject(error);
      }
    },
    install,
    close,
  };
}
