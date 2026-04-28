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
  serverMessage?: string;
  /**
   * H2 #1 mitigation — backend flags this challenge as having been issued
   * in the same agent turn that consumed an untrusted tool_result block.
   * Modal renders the prominent §4.6 warning banner when true. Backend
   * does not yet emit this; defaults to undefined (banner hidden).
   */
  sameTurnAfterToolResult?: boolean;
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

export const useConfirmationModalStore = create<ConfirmationModalState>(
  (set) => ({
    request: null,
    open: (req) => {
      // Single global modal — if a previous request is in-flight we resolve
      // it as rejected so we never have two parallel pending promises racing
      // against the same store slot.
      if (internal.pending) {
        settle({ approved: false });
      }
      // Assign the resolver BEFORE the set() so synchronous subscribers
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
  }),
);
