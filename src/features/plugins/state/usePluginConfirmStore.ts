import { create } from "zustand";

/**
 * A run waiting for the user to say yes or no: a dangerous plugin command, or one of the
 * app's own commands a plugin asks to run.
 */
export interface PluginConfirmRequest {
  pluginName: string;
  commandTitle: string;
  description: string;
  args: Record<string, unknown>;
  /**
   * Set when the plugin asks the app to run one of the app's own commands for it: where the
   * command acts, such as the conversation's name, or `null` when it names none.
   */
  runsAppCommand?: { target: string | null };
}

interface PluginConfirmState {
  request: PluginConfirmRequest | null;
  /**
   * Show the dialog; resolves `true` only when the user confirms this run, and `false` at
   * once while another request is open.
   */
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
