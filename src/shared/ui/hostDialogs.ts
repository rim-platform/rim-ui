import { useSyncExternalStore } from "react";

/**
 * How many host dialogs are open. Plugin frames turn `inert` while one is, so a
 * plugin can neither click through nor draw focus away from a host dialog.
 */
let openDialogs = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Count a dialog as open until the returned function is called. */
export function trackOpenDialog(): () => void {
  openDialogs += 1;
  notify();
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    openDialogs -= 1;
    notify();
  };
}

export function hostDialogOpen(): boolean {
  return openDialogs > 0;
}

export function subscribeHostDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while any host dialog is open. */
export function useHostDialogOpen(): boolean {
  return useSyncExternalStore(subscribeHostDialogs, hostDialogOpen);
}
