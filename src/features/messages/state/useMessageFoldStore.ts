import { create } from "zustand";

interface MessageFoldState {
  /** Messages whose text renders taller than the fold threshold. */
  foldable: ReadonlySet<string>;
  /** Messages the viewer unfolded. */
  expanded: ReadonlySet<string>;
  setFoldable: (messageId: string, foldable: boolean) => void;
  toggleExpanded: (messageId: string) => void;
}

/** `set` with `id` added or removed, or `set` itself when its membership would not change. */
function withMember(set: ReadonlySet<string>, id: string, member: boolean): ReadonlySet<string> {
  if (set.has(id) === member) return set;
  const next = new Set(set);
  if (member) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * Which messages fold their tall text and which of those the viewer unfolded, for the session,
 * shared by the timeline and the thread pane.
 */
export const useMessageFoldStore = create<MessageFoldState>((set) => ({
  foldable: new Set(),
  expanded: new Set(),
  setFoldable: (messageId, foldable) =>
    set((s) => {
      const next = withMember(s.foldable, messageId, foldable);
      return next === s.foldable ? s : { foldable: next };
    }),
  toggleExpanded: (messageId) =>
    set((s) => ({ expanded: withMember(s.expanded, messageId, !s.expanded.has(messageId)) })),
}));
