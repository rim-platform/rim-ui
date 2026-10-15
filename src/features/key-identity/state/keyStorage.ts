/**
 * The browser's last answer on keeping this app's storage, for the UI to warn on: a `refused`
 * browser may evict the keys under storage pressure. `null` until the backend asked.
 */

import { create } from "zustand";

import type { StoragePersistence } from "../api/keyBackend";

interface KeyStorageState {
  persistence: StoragePersistence | null;
  setPersistence: (persistence: StoragePersistence) => void;
}

export const useKeyStorageStore = create<KeyStorageState>((set) => ({
  persistence: null,
  setPersistence: (persistence) => set({ persistence }),
}));
