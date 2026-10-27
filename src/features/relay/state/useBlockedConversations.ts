/**
 * Conversations of direct spaces on other servers hidden because someone this account blocked
 * started them, as the last list fetch of each space found them.
 */

import { useMemo } from "react";
import { create } from "zustand";

interface BlockedConversationsState {
  /**
   * Per direct space on another server, the conversations hidden because someone this account
   * blocked started them: conversation id → that person's principal id.
   */
  bySpace: Record<string, Record<string, string>>;
  /** Replace what is recorded for `spaceId`; unchanged contents keep the state as it is. */
  setIn: (spaceId: string, conversations: Record<string, string>) => void;
  reset: () => void;
}

const NONE: ReadonlySet<string> = new Set();

function sameContents(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export const useBlockedConversations = create<BlockedConversationsState>((set) => ({
  bySpace: {},
  setIn: (spaceId, conversations) =>
    set((s) => {
      if (sameContents(s.bySpace[spaceId] ?? {}, conversations)) return s;
      const bySpace = { ...s.bySpace };
      if (Object.keys(conversations).length > 0) bySpace[spaceId] = conversations;
      else delete bySpace[spaceId];
      return { bySpace };
    }),
  reset: () => set({ bySpace: {} }),
}));

/** Whether `conversationId` of `spaceId` is hidden because someone this account blocked started it. */
export function isBlockedConversation(
  spaceId: string | null | undefined,
  conversationId: string | null | undefined,
): boolean {
  return blockedPrincipalOf(spaceId, conversationId) !== null;
}

/** The blocked person who started `conversationId` of `spaceId`, when it is hidden. */
export function blockedPrincipalOf(
  spaceId: string | null | undefined,
  conversationId: string | null | undefined,
): string | null {
  if (!spaceId || !conversationId) return null;
  return useBlockedConversations.getState().bySpace[spaceId]?.[conversationId] ?? null;
}

/** The hidden conversations of `spaceId`. */
export function blockedConversationIdsIn(spaceId: string | null | undefined): ReadonlySet<string> {
  const recorded = spaceId ? useBlockedConversations.getState().bySpace[spaceId] : undefined;
  return recorded ? new Set(Object.keys(recorded)) : NONE;
}

/** The hidden conversations of `spaceId`, as a set that changes only when they do. */
export function useBlockedConversationIds(spaceId: string | null | undefined): ReadonlySet<string> {
  const recorded = useBlockedConversations((s) => (spaceId ? s.bySpace[spaceId] : undefined));
  return useMemo(() => (recorded ? new Set(Object.keys(recorded)) : NONE), [recorded]);
}
