import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import {
  deleteInRounds,
  useMemberMessageCounts,
  type MemberMessageCountsResult,
  type MemberMessagesDeleted,
} from "../api/useModeration";
import { messagesToDelete, type DeletePeriod } from "../memberMessages";
import { payloadField, runConfirmedModeration } from "../moderationCommands";

/** The state of a choice to delete a person's messages: the period, the counts and the delete. */
export interface MemberMessageDeletion {
  /** The chosen period; `none` deletes nothing. */
  period: DeletePeriod;
  /** Picks another period, which counts it anew. */
  setPeriod: (period: DeletePeriod) => void;
  /** Whether the private channels the viewer is not in are included. */
  includePrivate: boolean;
  /** Includes or leaves out the private channels the viewer is not in. */
  setIncludePrivate: (include: boolean) => void;
  /** The counts of the chosen period, with the `since` they were asked for. */
  counts: UseQueryResult<MemberMessageCountsResult>;
  /** Whether the private channels the viewer is not in hold any of the messages. */
  offerPrivate: boolean;
  /** How many messages the delete removes; 0 for `none` or before the counts arrive. */
  total: number;
  /** Whether the choice is settled: `none`, or the counts arrived. */
  ready: boolean;
  /**
   * Deletes the counted messages over the chosen period with the Delete Member's Messages
   * command, run again while more remain; the dialog that calls it was the confirmation.
   *
   * @throws When nothing is chosen, the counts have not arrived, or the delete fails.
   */
  run: () => Promise<MemberMessagesDeleted>;
}

/**
 * The state of deleting `userId`'s messages in `workspaceId`, starting on `initialPeriod`, with
 * the private channels the viewer is not in included.
 */
export function useMemberMessageDeletion(
  workspaceId: string,
  userId: string,
  initialPeriod: DeletePeriod,
): MemberMessageDeletion {
  const [period, setPeriod] = useState<DeletePeriod>(initialPeriod);
  const [includePrivate, setIncludePrivate] = useState(true);
  const counts = useMemberMessageCounts(workspaceId, userId, period);

  const data = counts.data;
  const offerPrivate = (data?.counts.unjoinedPrivate.messages ?? 0) > 0;
  const total =
    period === "none" || !data ? 0 : messagesToDelete(data.counts, includePrivate && offerPrivate);
  const ready = period === "none" || counts.isSuccess;

  async function run(): Promise<MemberMessagesDeleted> {
    if (period === "none") throw new Error("Choose how far back to delete");
    if (!data) throw new Error("Their messages have not been counted yet");
    const args = {
      user_id: userId,
      window: period,
      include_unjoined_private: includePrivate && offerPrivate,
    };
    return deleteInRounds(async () => {
      const result = await runConfirmedModeration(
        workspaceId,
        "admin.delete_member_messages",
        args,
      );
      if (!result) throw new Error("Cancelled");
      const deleted = payloadField(result, "deleted");
      return {
        deleted: typeof deleted === "number" ? deleted : 0,
        hasMore: payloadField(result, "has_more") === true,
      };
    });
  }

  return {
    period,
    setPeriod,
    includePrivate,
    setIncludePrivate,
    counts,
    offerPrivate,
    total,
    ready,
    run,
  };
}
