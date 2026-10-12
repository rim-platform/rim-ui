import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";

import { ServerFeatureState, type ServerInfo } from "../core/graphql/generated/schema-types";
import { queryKeys } from "../core/query/keys";
import { SERVER_FEATURE_LABELS, type ServerFeatureKey } from "../core/serverFeatures";

/** Features to report other than enabled: a state, or a state with its reason. */
export type FakeFeatures = Partial<
  Record<ServerFeatureKey, ServerFeatureState | { state: ServerFeatureState; reason: string }>
>;

/** Server info fields other than the version and the features, such as `termsUrl`. */
export type FakeServerDetails = Partial<Omit<ServerInfo, "features">>;

/**
 * A server that lists every known feature, enabled unless `features` says otherwise, with
 * `details` over its other fields.
 */
export function fakeServerInfo(
  features: FakeFeatures = {},
  details: FakeServerDetails = {},
): ServerInfo {
  return {
    version: "0.4.0",
    apiVersion: 1,
    features: (Object.keys(SERVER_FEATURE_LABELS) as ServerFeatureKey[]).map((key) => {
      const given = features[key];
      if (given === undefined) return { key, state: ServerFeatureState.ENABLED, reason: null };
      if (typeof given === "string") return { key, state: given, reason: null };
      return { key, state: given.state, reason: given.reason };
    }),
    ...details,
  };
}

/**
 * A query client that already holds `fakeServerInfo(features, details)`, so nothing is fetched.
 */
export function serverInfoQueryClient(
  features: FakeFeatures = {},
  details: FakeServerDetails = {},
): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.serverInfo, fakeServerInfo(features, details));
  return client;
}

/** A render wrapper whose server reports `features` and `details`. */
export function withServerInfo(features: FakeFeatures = {}, details: FakeServerDetails = {}) {
  const client = serverInfoQueryClient(features, details);
  return function ServerInfoProvider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Renders `ui` against a server with every feature on and `details`, such as its `termsUrl`. */
export function renderWithServerInfo(ui: ReactElement, details: FakeServerDetails = {}) {
  return render(ui, { wrapper: withServerInfo({}, details) });
}
