import type { ReactElement, ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";

import type { ServerLimits } from "../core/graphql/generated/schema-types";
import { queryKeys } from "../core/query/keys";
import { useAuthStore } from "../features/auth/state/useAuthStore";
import { serverInfoQueryClient } from "./serverInfo";

/** The signed-in account the limits fixtures use. */
export const LIMITS_USER_ID = "user-me";

/** Every cap off, with `caps` over them. */
export function fakeLimits(caps: Partial<ServerLimits> = {}): ServerLimits {
  return {
    workspacesPerUser: null,
    membersPerWorkspace: null,
    channelsPerWorkspace: null,
    devicesPerUser: null,
    dmRequestsPerDay: null,
    macrosPerWorkspace: null,
    pipelinesPerWorkspace: null,
    pluginsPerWorkspace: null,
    invitesPerUserPerDay: null,
    inviteMaxUses: null,
    messageBytes: null,
    probationHours: null,
    ...caps,
  };
}

/**
 * A query client whose server reports `caps`, signed in as `LIMITS_USER_ID`, and, with
 * `probationEndsAt`, an account whose probation ends then (the server's probation is on).
 */
export function limitsQueryClient(
  caps: Partial<ServerLimits> = {},
  probationEndsAt?: string,
): QueryClient {
  useAuthStore.setState({ session: { userId: LIMITS_USER_ID } });
  const withProbation = probationEndsAt ? { probationHours: 24, ...caps } : caps;
  const client = serverInfoQueryClient({}, { limits: fakeLimits(withProbation) });
  if (probationEndsAt) client.setQueryData(queryKeys.probation(LIMITS_USER_ID), probationEndsAt);
  return client;
}

/** A render wrapper over `limitsQueryClient(caps, probationEndsAt)`. */
export function withLimits(caps: Partial<ServerLimits> = {}, probationEndsAt?: string) {
  const client = limitsQueryClient(caps, probationEndsAt);
  return function LimitsProvider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Renders `ui` against a server that reports `caps`, and the probation when given. */
export function renderWithLimits(
  ui: ReactElement,
  caps: Partial<ServerLimits> = {},
  probationEndsAt?: string,
) {
  return render(ui, { wrapper: withLimits(caps, probationEndsAt) });
}
