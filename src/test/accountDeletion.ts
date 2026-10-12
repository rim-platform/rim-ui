import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../core/query/keys";
import type { AccountDeletionStatus } from "../features/account-deletion/api/accountDeletion";
import { useAuthStore } from "../features/auth/state/useAuthStore";

/** The signed-in account the account deletion fixtures use, `me` of the conversation fixtures. */
export const DELETION_USER_ID = "me";

/** A server that offers account deletion, with nothing pending. */
export const DELETION_OFFERED: AccountDeletionStatus = { supported: true, scheduledFor: null };

/** A server too old to offer account deletion. */
export const DELETION_UNSUPPORTED: AccountDeletionStatus = { supported: false, scheduledFor: null };

/**
 * A query client signed in as `DELETION_USER_ID` whose server already answered the account
 * deletion question with `status`, so nothing is asked.
 */
export function deletionQueryClient(status: AccountDeletionStatus = DELETION_OFFERED): QueryClient {
  useAuthStore.setState({ session: { userId: DELETION_USER_ID } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.accountDeletion(DELETION_USER_ID), status);
  return client;
}
