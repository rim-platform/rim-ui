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

const queues = new Map<string, Promise<unknown>>();

/**
 * Run `task` alone among the tasks of lock `name`: across tabs with the Web Locks API where the
 * browser has it, in this page otherwise. A task must not wait on another task of the same lock.
 */
export function exclusive<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks?.request) return locks.request(name, task);
  const run = (queues.get(name) ?? Promise.resolve()).then(task, task);
  queues.set(
    name,
    run.catch(() => undefined),
  );
  return run;
}

/**
 * Run `task` alone among the key store's work, as {@link exclusive} does. A task must not wait
 * on another serialized task.
 */
export function serialized<T>(task: () => Promise<T>): Promise<T> {
  return exclusive("rim-key-identity", task);
}
