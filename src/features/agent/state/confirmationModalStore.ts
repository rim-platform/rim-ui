import { create } from "zustand";

import type { CommandSensitivity } from "../../../core/graphql/generated/schema-types";

export interface ConfirmationRequest {
  commandId: string;
  toolName: string;
  args: Record<string, unknown>;
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

export const useConfirmationModalStore = create<ConfirmationModalState>((set) => ({
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
