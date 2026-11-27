/**
 * Whether this app's own IndexedDB stores can keep what it saves on this device. A store that
 * cannot open or write reports here; the first report per store is kept for the rest of the
 * session and logged as an error, so it reaches the log file in release builds too.
 */

import { create } from "zustand";

import { logger } from "./logger";

/** A store that reports here: `account` is `rim-account`, `relay` is `rim-relay`. */
export type StorageArea = "account" | "relay";

interface StorageHealthState {
  /** The first failure of each store that failed, as a short message. */
  failures: Partial<Record<StorageArea, string>>;
}

export const useStorageHealthStore = create<StorageHealthState>(() => ({ failures: {} }));

/**
 * Records that `area` could not open or write. Only the first report per store is kept and
 * logged; later ones change nothing.
 *
 * @param err - What the store's open or write failed with.
 */
export function reportStorageFailure(area: StorageArea, err: unknown): void {
  const { failures } = useStorageHealthStore.getState();
  if (failures[area] !== undefined) return;
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  useStorageHealthStore.setState({ failures: { ...failures, [area]: message } });
  logger.error("[RIM:storage] the", area, "store can't save on this device:", message);
}

/**
 * Whether `area` has failed this session.
 *
 * @returns `true` once the store reported a failure.
 */
export function storageFailed(area: StorageArea): boolean {
  return useStorageHealthStore.getState().failures[area] !== undefined;
}
