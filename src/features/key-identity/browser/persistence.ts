/**
 * Keeping the browser key store: asking the browser to keep this origin's storage under
 * pressure, and running key store work one task at a time across this origin's tabs.
 */

import { logger } from "../../../core/logger";
import type { StoragePersistence } from "../api/keyBackend";
import { useKeyStorageStore } from "../state/keyStorage";

/**
 * Ask the browser to keep this origin's storage, so it does not evict the keys, and record the
 * answer for the UI. A refusal does not stop anything: the keys still work until evicted.
 */
export async function persistStorage(): Promise<StoragePersistence> {
  let answer: StoragePersistence;
  try {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage?.persist) {
      answer = "unavailable";
    } else if (await storage.persisted?.()) {
      answer = "persisted";
    } else {
      answer = (await storage.persist()) ? "persisted" : "refused";
    }
  } catch {
    answer = "unavailable";
  }
  if (answer === "refused") {
    logger.warn("[RIM:keys] the browser may evict this app's storage, keys included");
  }
  useKeyStorageStore.getState().setPersistence(answer);
  return answer;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Run `task` alone: across tabs with the Web Locks API where the browser has it, in this page
 * otherwise. A task must not wait on another serialized task.
 */
export function serialized<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks?.request) return locks.request("rim-key-identity", task);
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}
