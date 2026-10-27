import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const CHUNK_LOAD_MESSAGE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;

/** Whether `error` is a chunk of this app that could not be fetched (a dropped connection, a redeploy). */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_MESSAGE.test(error.message);
}

/**
 * Runs `load`, and again up to `retries` times `delayMs` apart while it fails to fetch a chunk;
 * any other error is thrown at once.
 */
export async function importWithRetry<T>(
  load: () => Promise<T>,
  retries = 2,
  delayMs = 500,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= retries || !isChunkLoadError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** `React.lazy` over {@link importWithRetry}. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the constraint `lazy` itself has
export function lazyWithRetry<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(load));
}
