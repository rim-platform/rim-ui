/**
 * `useServerConfig` — fetches deployment-wide server configuration.
 *
 * Currently exposes `registrationMode` (`OPEN | INVITE_ONLY`), which controls
 * whether the login page shows a "Create account" link and whether `/join`
 * (no token) is accessible.
 *
 * The hook name is intentionally broad: server config is expected to grow
 * additional fields (password policy, branding, feature flags). A narrower
 * `useRegistrationMode` hook would require a rename later.
 *
 * **Why TanStack Query, not Zustand:** this is server-driven configuration,
 * not client UI state. Zustand owns local session and shell layout; React
 * Query owns async server state.
 *
 * **Why not `useRuntime()`:** runtime capabilities are synchronous platform
 * facts (Tauri vs web). `registrationMode` is async, per-instance, and can
 * change between sessions. Conflating them would force `useRuntime` to become
 * async and couple platform detection to a server fetch.
 *
 * Returns `{ data: undefined, isPending: true }` while loading. Consumers
 * should treat `undefined` as `INVITE_ONLY` (the safer default) — this
 * prevents a slow server-config fetch from accidentally showing a
 * "Create account" link on an invite-only instance.
 */

import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { RegistrationMode } from "../types";

const REGISTRATION_MODE_QUERY = gql`
  query RegistrationMode {
    registrationMode
  }
`;

interface RegistrationModeResponse {
  registrationMode: RegistrationMode;
}

/** Shape returned by `useServerConfig`. */
export interface ServerConfig {
  /** Deployment-wide registration mode. `undefined` while loading. */
  registrationMode: RegistrationMode | undefined;
}

/**
 * Fetches the deployment-wide server configuration.
 *
 * @returns `{ data, isPending, isError }` from React Query where `data` is
 *   `ServerConfig | undefined`. `registrationMode` is `undefined` while the
 *   query is in-flight.
 */
export function useServerConfig() {
  return useQuery({
    queryKey: queryKeys.serverConfig(),
    queryFn: async (): Promise<ServerConfig> => {
      const res = await graphqlClient.request<RegistrationModeResponse>(REGISTRATION_MODE_QUERY);
      return { registrationMode: res.registrationMode };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — server policy changes rarely
  });
}
