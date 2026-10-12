import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryKeys } from "../../../core/query/keys";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";
import { useAuthStore } from "../../auth/state/useAuthStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useAccountDeletionStatus } from "./accountDeletion";

/** What a server without `User.deletionScheduledFor` answers: an error with no code. */
const unknownField = Object.assign(new Error("Unknown field"), {
  response: {
    errors: [{ message: 'Unknown field "deletionScheduledFor" on type "User".' }],
  },
});

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useAccountDeletionStatus", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => useAuthStore.setState({ session: null }));

  it("reports the feature and the pending date from a server that has it", async () => {
    routeRequests(requestMock, {
      "query MeDeletion": () => ({
        me: { id: "me", deletionScheduledFor: "2026-10-26T12:00:00Z" },
      }),
    });
    const qc = new QueryClient();
    const { result } = renderHook(() => useAccountDeletionStatus(), { wrapper: wrapperFor(qc) });

    await waitFor(() =>
      expect(result.current).toEqual({ supported: true, scheduledFor: "2026-10-26T12:00:00Z" }),
    );
  });

  it("hides the feature for the session once an older server refuses the question", async () => {
    routeRequests(requestMock, {
      "query MeDeletion": () => {
        throw unknownField;
      },
    });
    const qc = new QueryClient();
    const first = renderHook(() => useAccountDeletionStatus(), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(callsTo(requestMock, "query MeDeletion")).toHaveLength(1));
    await waitFor(() =>
      expect(qc.getQueryState(queryKeys.accountDeletion("me"))?.status).toBe("success"),
    );

    // A refresh of the account and a second reader do not ask again.
    await qc.invalidateQueries({ queryKey: queryKeys.me });
    const second = renderHook(() => useAccountDeletionStatus(), { wrapper: wrapperFor(qc) });

    expect(first.result.current).toEqual({ supported: false, scheduledFor: null });
    expect(second.result.current).toEqual({ supported: false, scheduledFor: null });
    expect(callsTo(requestMock, "query MeDeletion")).toHaveLength(1);
  });
});
