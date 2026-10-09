import { create } from "zustand";

/** A dangerous plugin command waiting for the user to say yes or no. */
export interface PluginConfirmRequest {
  pluginName: string;
  commandTitle: string;
  description: string;
  args: Record<string, unknown>;
}

interface PluginConfirmState {
  request: PluginConfirmRequest | null;
  /** Show the dialog; resolves `true` only when the user confirms this run. */
  ask: (request: PluginConfirmRequest) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
}

let pending: ((confirmed: boolean) => void) | null = null;

function settle(confirmed: boolean): void {
  const resolve = pending;
  pending = null;
  resolve?.(confirmed);
}

/**
 * The confirmation the host asks for before a dangerous plugin command runs.
 * Only the dialog, which the user answers, settles it: no panel, plugin or
 * agent can. One request at a time: while the user reads one, any other is
 * declined, so the dialog never changes under the user's click.
 */
export const usePluginConfirmStore = create<PluginConfirmState>((set) => ({
  request: null,
  ask: (request) => {
    if (pending) return Promise.resolve(false);
    const answer = new Promise<boolean>((resolve) => {
      pending = resolve;
    });
    set({ request });
    return answer;
  },
  confirm: () => {
    set({ request: null });
    settle(true);
  },
  cancel: () => {
    set({ request: null });
    settle(false);
  },
}));
