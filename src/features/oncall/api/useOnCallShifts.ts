import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { OnCallShiftGql } from "../../../core/graphql/generated/schema-types";

export type OnCallShift = OnCallShiftGql;

const ON_CALL_SHIFTS_QUERY = gql`
  query OnCallShifts($scheduleId: ID!, $from: DateTime!, $to: DateTime!) {
    onCallShifts(scheduleId: $scheduleId, from: $from, to: $to) {
      startAt
      endAt
      isOverride
      user {
        id
        username
        displayName
        avatarUrl
      }
    }
  }
`;

/**
 * Server-resolved on-call coverage for `[from, to)` — rejects spans over 90 days server-side.
 *
 * **HARD RULE (Track C1 §2): the frontend must never compute rotation math.** This hook
 * exists precisely so `RotationPreviewStrip` never has to derive shifts from a rotation
 * spec itself — timezone/DST/handoff/override resolution all happen server-side, and the
 * client only lays out the intervals it's handed. See `docs/oncall-ui.md`.
 */
export function useOnCallShifts(scheduleId?: string, from?: string, to?: string) {
  return useQuery({
    queryKey: queryKeys.onCallShifts(scheduleId, from, to),
    enabled: Boolean(scheduleId && from && to),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ onCallShifts: OnCallShift[] }>(
        ON_CALL_SHIFTS_QUERY,
        { scheduleId: scheduleId!, from: from!, to: to! },
      );
      return res.onCallShifts;
    },
  });
}
