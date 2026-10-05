import { usePresenceStore } from "../../../presence/state/usePresenceStore";
import type { PresenceStatus } from "../../../../shared/ui/Avatar";

/**
 * Subscribe to one author's presence directly, so a presence change re-renders
 * only the hover-card owners for that author instead of the whole timeline.
 */
export function useAuthorPresence(
  authorId: string,
  fallback: PresenceStatus | null | undefined,
): PresenceStatus | null {
  const storePresence = usePresenceStore((s) => s.presenceMap[authorId]);
  return storePresence === "ONLINE" || storePresence === "AWAY" || storePresence === "OFFLINE"
    ? storePresence
    : (fallback ?? null);
}
