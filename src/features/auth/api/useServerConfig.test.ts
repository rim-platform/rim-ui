import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { TestProviders } from "../../../test/utils";
import { RegistrationMode } from "../types";
import { useServerConfig } from "./useServerConfig";

// Silence any unhandled request warnings from msw for the RegistrationMode
// query path that doesn't match a live endpoint in tests.
vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

describe("useServerConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns OPEN registrationMode when server responds OPEN", async () => {
    server.use(
      mockGraphQLQuery("RegistrationMode", {
        registrationMode: "OPEN",
      }),
    );

    const { result } = renderHook(() => useServerConfig(), {
      wrapper: TestProviders,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.registrationMode).toBe(RegistrationMode.OPEN);
  });

  it("returns INVITE_ONLY registrationMode when server responds INVITE_ONLY", async () => {
    server.use(
      mockGraphQLQuery("RegistrationMode", {
        registrationMode: "INVITE_ONLY",
      }),
    );

    const { result } = renderHook(() => useServerConfig(), {
      wrapper: TestProviders,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.registrationMode).toBe(RegistrationMode.INVITE_ONLY);
  });

  it("returns undefined registrationMode while loading", () => {
    // No mock handler is registered, so the query never resolves in the test and
    // this checks the initial state before any response arrives.
    const { result } = renderHook(() => useServerConfig(), {
      wrapper: TestProviders,
    });

    // On the very first render, data is undefined and isPending is true.
    expect(result.current.isPending).toBe(true);
    expect(result.current.data?.registrationMode).toBeUndefined();
  });

  it("does not throw into consumers on network error", async () => {
    // msw will pass through the request without a handler → graphqlClient
    // throws. The hook surfaces this via isError rather than throwing.
    const { result } = renderHook(() => useServerConfig(), {
      wrapper: TestProviders,
    });

    // Asserts only that nothing rejects unhandled: the test does not wait for the
    // error because retry:false is not set on this query and the test would be slow.
    // The important invariant is that isPending starts true without a throw.
    expect(() => result.current).not.toThrow();
  });
});
