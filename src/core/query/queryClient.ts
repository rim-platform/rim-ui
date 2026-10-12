import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { toast } from "../../shared/toast";
import {
  AddressBlockedError,
  disabledFeatureOf,
  graphqlErrorCode,
  RATE_LIMITED,
  retryAfterSeconds,
} from "../graphql/errors";
import { featureOffMessage } from "../serverFeatures";
import { queryKeys } from "./keys";

/** The id of the toast for a call refused because `feature` is off; one per feature. */
export function featureDisabledToastId(feature: string): string {
  return `feature-disabled-${feature}`;
}

/**
 * Raises "<Feature> is switched off on this server" for a call the server refused with
 * `FEATURE_DISABLED`, and has `client` reread the server's features so the surface hides.
 * Returns whether `err` was such a refusal.
 */
export function reportFeatureDisabled(err: unknown, client: QueryClient = queryClient): boolean {
  const feature = disabledFeatureOf(err);
  if (!feature) return false;
  toast.error(featureOffMessage(feature), { id: featureDisabledToastId(feature) });
  void client.invalidateQueries({ queryKey: queryKeys.serverInfo });
  return true;
}

/** How long a rate-limited query waits before its retry when the server named no time. */
const RATE_LIMITED_RETRY_MS = 30_000;

/** Whether a query that failed `failureCount` times is tried again: once, never when blocked. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (err instanceof AddressBlockedError) return false;
  return failureCount < 1;
}

/**
 * How long before a failed query is tried again: the `retryAfterSeconds` of a rate-limited
 * answer, else exponential backoff from one second up to thirty.
 */
export function queryRetryDelay(failureCount: number, err: unknown): number {
  if (graphqlErrorCode(err) === RATE_LIMITED) {
    const seconds = retryAfterSeconds(err);
    return seconds === undefined ? RATE_LIMITED_RETRY_MS : seconds * 1000;
  }
  return Math.min(1000 * 2 ** failureCount, 30_000);
}

/**
 * The app's query client: every query or mutation refused for a disabled feature says so, and a
 * failed query is retried once, after the wait a rate limit names.
 */
export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (err) => reportFeatureDisabled(err, client) }),
    mutationCache: new MutationCache({ onError: (err) => reportFeatureDisabled(err, client) }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
        retryDelay: queryRetryDelay,
      },
      mutations: {
        // A write made while offline fails at once rather than waiting, paused, to be sent
        // when the network returns: nothing is queued behind the user's back.
        networkMode: "always",
      },
    },
  });
  return client;
}

export const queryClient = createAppQueryClient();
