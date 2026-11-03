import { UserMinus } from "lucide-react";

import type { MemberRemoval } from "../../conversations/api/useMemberRemovals";
import { NoticeLine } from "../../e2ee/components/E2eeNoticeRow";
import type { MembershipNotice } from "../../e2ee/utils/timeline";

/** The line a channel shows where an Owner or Moderator removed someone from it. */
export function MembershipNoticeRow({
  notice,
  currentUserId,
  nameOf,
}: {
  notice: MembershipNotice;
  currentUserId: string | undefined;
  nameOf: (userId: string, user: MemberRemoval["user"]) => string;
}) {
  const { removal } = notice;
  const removed =
    removal.userId === currentUserId ? "You were" : `${nameOf(removal.userId, removal.user)} was`;
  const by =
    removal.removedById === currentUserId ? "you" : nameOf(removal.removedById, removal.removedBy);
  return (
    <NoticeLine>
      <UserMinus className="h-3 w-3" aria-hidden />
      {removed} removed by {by}
    </NoticeLine>
  );
}
