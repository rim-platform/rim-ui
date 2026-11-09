import { create } from "zustand";

import type { CommandArgumentInfo } from "../types";

/** A command waiting for the person to fill in the arguments it still lacks. */
export interface CommandArgumentsRequest {
  /** The command's title, shown as the dialog's title. */
  title: string;
  /** The arguments to ask for, in the order the dialog shows them. */
  arguments: CommandArgumentInfo[];
  /** The workspace whose members and conversations the fields offer. */
  workspaceId?: string;
}

interface CommandArgumentsState {
  request: CommandArgumentsRequest | null;
  /**
   * Shows the argument dialog; resolves to the values the person submitted, or `null` when
   * they cancelled it or another request was already open.
   */
  ask: (request: CommandArgumentsRequest) => Promise<Record<string, unknown> | null>;
  submit: (values: Record<string, unknown>) => void;
  cancel: () => void;
}

let pending: ((values: Record<string, unknown> | null) => void) | null = null;

function settle(values: Record<string, unknown> | null): void {
  const resolve = pending;
  pending = null;
  resolve?.(values);
}

/**
 * The argument form a command opens when it is run without arguments it requires. Only the
 * dialog settles it. One request at a time: while one is open, any other resolves to `null`.
 */
export const useCommandArgumentsStore = create<CommandArgumentsState>((set) => ({
  request: null,
  ask: (request) => {
    if (pending) return Promise.resolve(null);
    const answer = new Promise<Record<string, unknown> | null>((resolve) => {
      pending = resolve;
    });
    set({ request });
    return answer;
  },
  submit: (values) => {
    set({ request: null });
    settle(values);
  },
  cancel: () => {
    set({ request: null });
    settle(null);
  },
}));
