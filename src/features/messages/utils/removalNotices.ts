import type { MemberRemoval } from "../../conversations/api/useMemberRemovals";
import { timelineNotice, type TimelineMessage } from "../../e2ee/utils/timeline";

/**
 * `items` (oldest first) with a line for each removal, before the first item sent after it, and
 * after the newest item when nothing was sent since. A removal older than every loaded item is
 * shown only when `complete` (no older page to load); otherwise it waits for its page.
 */
export function withRemovalNotices(
  items: TimelineMessage[],
  removals: MemberRemoval[],
  complete: boolean,
): TimelineMessage[] {
  if (removals.length === 0) return items;
  const sorted = [...removals].sort((a, b) => Date.parse(a.removedAt) - Date.parse(b.removedAt));
  const oldest = items.length > 0 ? Date.parse(items[0].sentAt) : Infinity;
  const pending = complete ? sorted : sorted.filter((r) => Date.parse(r.removedAt) >= oldest);

  const line = (r: MemberRemoval): TimelineMessage => ({
    ...timelineNotice(`removal:${r.id}`, r.removedAt),
    membershipNotice: { kind: "removed", removal: r },
  });
  const out: TimelineMessage[] = [];
  let next = 0;
  for (const item of items) {
    const sentAt = Date.parse(item.sentAt);
    while (next < pending.length && Date.parse(pending[next].removedAt) <= sentAt) {
      out.push(line(pending[next++]));
    }
    out.push(item);
  }
  while (next < pending.length) out.push(line(pending[next++]));
  return out;
}
