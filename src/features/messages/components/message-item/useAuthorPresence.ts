import { useContext } from "react";

import { usePresenceStore } from "../../../presence/state/usePresenceStore";
import type { PresenceStatus } from "../../../../shared/ui/Avatar";
import { HiddenPresenceContext } from "./hiddenPresence";

/**
 * Subscribe to one author's presence directly, so a presence change re-renders
 * only the hover-card owners for that author instead of the whole timeline. An author whose
 * presence is hidden here reads as unknown.
 */
export function useAuthorPresence(
  authorId: string,
  fallback: PresenceStatus | null | undefined,
): PresenceStatus | null {
  const hidden = useContext(HiddenPresenceContext) === authorId;
  const storePresence = usePresenceStore((s) => s.presenceMap[authorId]);
  if (hidden) return null;
  return storePresence === "ONLINE" || storePresence === "AWAY" || storePresence === "OFFLINE"
    ? storePresence
    : (fallback ?? null);
}
