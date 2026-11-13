import { create } from "zustand";

import type {
  CommandArgumentType,
  CommandSensitivity,
} from "../../../core/graphql/generated/schema-types";

export interface ConfirmationRequest {
  commandId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** The types the server declares for `args`, which say which of them hold what kind of id. */
  argumentTypes?: Readonly<Record<string, CommandArgumentType>>;
  token: string;
  argsHash: string;
  expiresAt: string;
  sensitivity?: CommandSensitivity;
  nlDescription?: string;
  /**
   * Raw backend `Command.description` — the human-facing consequence line
   * for the confirmation modal, sourced from GraphQL
   * `Command.description`. Preferred over `nlDescription` for the subtitle;
   * `nlDescription` remains the fallback for commands without one.
   */
  description?: string;
  serverMessage?: string;
  /**
   * Whether the agent proposed this command after reading an untrusted tool_result in the
   * same run. When true the modal shows its tool-result warning banner and asks for the typed
   * word on a `MUTATING` command; false or undefined hides the banner.
   */
  sameTurnAfterToolResult?: boolean;
  /** Who started the command: the AI agent (the default) or the user. */
  initiator?: "agent" | "user";
  /**
   * Word to type for a `RESTRICTED` command, instead of the one derived from `commandId`;
   * `null` asks for no typed word.
   */
  verb?: string | null;
  /** The command, or a stage of the run, is marked dangerous: the dialog draws it in red and says so. */
  dangerous?: boolean;
  /** Set when a program outside RIM asked for this. Shown as the one asking, and holds the words the person is confirming. */
  outsideAgent?: {
    name: string;
    /** What it acts on, in order, as RIM knows them: label and value. */
    target: { label: string; value: string }[];
    /** Exact text being confirmed; shown whole. */
    text?: string;
    /** What the plugin's author says the command does, marked as theirs. */
    pluginWords?: { title: string; description: string };
    /** The arguments being confirmed; shown whole, with a note on any that looks like a secret. */
    args?: Record<string, unknown>;
  };
}

export interface ConfirmationDecision {
  approved: boolean;
}

interface PendingResolver {
  resolve: (decision: ConfirmationDecision) => void;
}

interface ConfirmationModalState {
  request: ConfirmationRequest | null;
  open: (req: ConfirmationRequest) => Promise<ConfirmationDecision>;
  /** Opens the request unless one is open or pending, which it leaves alone and answers `null`. */
  openIfFree: (req: ConfirmationRequest) => Promise<ConfirmationDecision> | null;
  approve: () => void;
  reject: () => void;
  reset: () => void;
}

const internal: { pending: PendingResolver | null } = { pending: null };

function settle(decision: ConfirmationDecision): void {
  const resolver = internal.pending;
  internal.pending = null;
  resolver?.resolve(decision);
}

export const useConfirmationModalStore = create<ConfirmationModalState>((set, get) => ({
  request: null,
  open: (req) => {
    // Single global modal — a previous request still in flight is resolved
    // as rejected, so two parallel pending promises never race against the
    // same store slot.
    if (internal.pending) {
      settle({ approved: false });
    }
    // Assign the resolver before the set() so synchronous subscribers
    // (Zustand fires `subscribe` callbacks inside the set) can call
    // approve()/reject() and find a pending resolver to settle.
    const promise = new Promise<ConfirmationDecision>((resolve) => {
      internal.pending = { resolve };
    });
    set({ request: req });
    return promise;
  },
  openIfFree: (req) => (get().request || internal.pending ? null : get().open(req)),
  approve: () => {
    set({ request: null });
    settle({ approved: true });
  },
  reject: () => {
    set({ request: null });
    settle({ approved: false });
  },
  reset: () => {
    set({ request: null });
    settle({ approved: false });
  },
}));

/** Ends an open confirmation that a program outside RIM asked for. Any other stays open. */
export function rejectOutsideAgentConfirmation(): void {
  const { request, reject } = useConfirmationModalStore.getState();
  if (request?.outsideAgent) reject();
}
