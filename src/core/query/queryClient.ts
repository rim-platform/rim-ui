import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { toast } from "../../shared/toast";
import { disabledFeatureOf } from "../graphql/errors";
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

/** The app's query client: every query or mutation refused for a disabled feature says so. */
export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (err) => reportFeatureDisabled(err, client) }),
    mutationCache: new MutationCache({ onError: (err) => reportFeatureDisabled(err, client) }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
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
