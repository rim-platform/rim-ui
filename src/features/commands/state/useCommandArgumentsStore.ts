import { create } from "zustand";

import type { FieldValues } from "../runtime/argumentValues";
import type { CommandArgumentInfo } from "../types";

/** The arguments of one command the dialog asks for. */
export interface ArgumentGroup {
  /** The arguments to ask for, in the order the dialog shows them. */
  arguments: CommandArgumentInfo[];
  /**
   * Optional arguments shown under "More options", folded until opened; only those the person
   * sets are sent.
   */
  moreArguments?: CommandArgumentInfo[];
  /** The workspace whose members and conversations the fields offer. */
  workspaceId?: string;
  /** The command the arguments are of, which picks the field for some of them. */
  commandId?: string;
  /** The conversation the command runs in, when known: the one given, else the open one. */
  conversationId?: string;
  /** Values the command already has, for fields that follow them, such as a state key. */
  givenValues?: Readonly<FieldValues>;
}

/** One step of a macro whose arguments the dialog asks for. */
export interface ArgumentStepGroup extends ArgumentGroup {
  /** What the step's values are named by in the answer: `<key>:<argument name>`. */
  key: string;
  /** Text put before each label, such as "Step 2 · Mute Conversation: ". */
  labelPrefix: string;
}

/** A command, or the steps of a macro, waiting for the person to fill in arguments. */
export interface CommandArgumentsRequest extends ArgumentGroup {
  /** The command's or the macro's title, shown as the dialog's title. */
  title: string;
  /**
   * The steps of a macro, each asked with its own command's fields, in place of the request's
   * own arguments. The answer names each value `<step key>:<argument name>`.
   */
  steps?: ArgumentStepGroup[];
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
