import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ServerFeatureState, type ServerInfo } from "../core/graphql/generated/schema-types";
import { queryKeys } from "../core/query/keys";
import { SERVER_FEATURE_LABELS, type ServerFeatureKey } from "../core/serverFeatures";

/** Features to report other than enabled: a state, or a state with its reason. */
export type FakeFeatures = Partial<
  Record<ServerFeatureKey, ServerFeatureState | { state: ServerFeatureState; reason: string }>
>;

/** A server that lists every known feature, enabled unless `features` says otherwise. */
export function fakeServerInfo(features: FakeFeatures = {}): ServerInfo {
  return {
    version: "0.4.0",
    apiVersion: 1,
    features: (Object.keys(SERVER_FEATURE_LABELS) as ServerFeatureKey[]).map((key) => {
      const given = features[key];
      if (given === undefined) return { key, state: ServerFeatureState.ENABLED, reason: null };
      if (typeof given === "string") return { key, state: given, reason: null };
      return { key, state: given.state, reason: given.reason };
    }),
  };
}

/** A query client that already holds `fakeServerInfo(features)`, so nothing is fetched. */
export function serverInfoQueryClient(features: FakeFeatures = {}): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.serverInfo, fakeServerInfo(features));
  return client;
}

/** A render wrapper whose server reports `features`. */
export function withServerInfo(features: FakeFeatures = {}) {
  const client = serverInfoQueryClient(features);
  return function ServerInfoProvider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
