import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { isSchemaRefusal } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";

const ME_DELETION_QUERY = gql`
  query MeDeletion {
    me {
      id
      deletionScheduledFor
    }
  }
`;

const REQUEST_ACCOUNT_DELETION = gql`
  mutation RequestAccountDeletion($input: RequestAccountDeletionInput!) {
    requestAccountDeletion(input: $input) {
      scheduledFor
    }
  }
`;

const CANCEL_ACCOUNT_DELETION = gql`
  mutation CancelAccountDeletion {
    cancelAccountDeletion
  }
`;

/** What the server says about deleting the signed-in account. */
export interface AccountDeletionStatus {
  /**
   * The server offers account deletion, and with it workspace ownership transfer and workspace
   * deletion. `false` while unknown and for a server that refused the question.
   */
  supported: boolean;
  /** When the pending deletion runs; `null` while none is pending. */
  scheduledFor: string | null;
}

const UNSUPPORTED: AccountDeletionStatus = { supported: false, scheduledFor: null };

/** Asks the server when the account's deletion runs; a server without the field refuses it. */
async function fetchDeletionStatus(): Promise<AccountDeletionStatus> {
  try {
    const res = await graphqlClient.request<{
      me: { id: string; deletionScheduledFor: string | null };
    }>(ME_DELETION_QUERY);
    return { supported: true, scheduledFor: res.me.deletionScheduledFor };
  } catch (err) {
    if (isSchemaRefusal(err)) return UNSUPPORTED;
    throw err;
  }
}

/**
 * Whether the server offers account deletion and when the signed-in account's pending deletion
 * runs. Asked once per session: a server that refuses the question keeps the feature hidden
 * until the next sign-in.
 */
export function useAccountDeletionStatus(): AccountDeletionStatus {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data } = useQuery({
    queryKey: queryKeys.accountDeletion(userId),
    enabled: userId !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: fetchDeletionStatus,
  });
  return data ?? UNSUPPORTED;
}

function useSetScheduledFor() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);
  return (scheduledFor: string | null) =>
    qc.setQueryData<AccountDeletionStatus>(queryKeys.accountDeletion(userId), {
      supported: true,
      scheduledFor,
    });
}

/** Re-reads the pending deletion, as after a `CONFLICT` says one is already pending. */
export function useRefreshDeletionStatus() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);
  return () => qc.invalidateQueries({ queryKey: queryKeys.accountDeletion(userId) });
}

/**
 * Schedules the signed-in account for deletion with its username typed again; resolves to when
 * it runs. The server ends every other session of the account; this one stays.
 */
export function useRequestAccountDeletionMutation() {
  const setScheduledFor = useSetScheduledFor();
  return useMutation({
    mutationFn: async (confirmUsername: string) => {
      const res = await graphqlClient.request<{
        requestAccountDeletion: { scheduledFor: string };
      }>(REQUEST_ACCOUNT_DELETION, { input: { confirmUsername } });
      return res.requestAccountDeletion.scheduledFor;
    },
    onSuccess: (scheduledFor) => setScheduledFor(scheduledFor),
  });
}

/** Keeps the account: cancels its pending deletion. */
export function useCancelAccountDeletionMutation() {
  const setScheduledFor = useSetScheduledFor();
  return useMutation({
    mutationFn: async () => {
      const res = await graphqlClient.request<{ cancelAccountDeletion: boolean }>(
        CANCEL_ACCOUNT_DELETION,
      );
      return res.cancelAccountDeletion;
    },
    onSuccess: () => setScheduledFor(null),
  });
}

/** The day and time a deletion runs, in the reader's locale. */
export function deletionDateText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], { dateStyle: "long", timeStyle: "short" });
}
