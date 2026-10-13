import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { graphqlErrorCode } from "../../../core/graphql/errors";
import { server } from "../../../test/mocks/server";
import { TestProviders } from "../../../test/utils";
import { useAuthStore } from "../state/useAuthStore";
import { useLoginMutation } from "./useAuthMutations";

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

/** The operations the server was sent, in order. */
const operations: string[] = [];

/** The server answers each operation by name with its GraphQL response body. */
function answer(bodies: Record<string, unknown>) {
  server.use(
    http.post("*/api", async ({ request }) => {
      const name = ((await request.json()) as { operationName?: string }).operationName ?? "";
      operations.push(name);
      return HttpResponse.json(bodies[name] ?? { errors: [{ message: `unexpected ${name}` }] });
    }),
  );
}

/** Signs in with a password through the login hook; resolves to its payload. */
async function login() {
  const { result } = renderHook(() => useLoginMutation(), { wrapper: TestProviders });
  let payload: unknown;
  await act(async () => {
    payload = await result.current.mutateAsync({ username: "ada", password: "pw" });
  });
  return payload;
}

describe("signInRequest", () => {
  beforeEach(() => {
    operations.length = 0;
  });

  afterEach(() => {
    useAuthStore.setState({ csrfToken: null });
  });

  it("keeps the csrfToken a password login returns", async () => {
    answer({ Login: { data: { login: { userId: "u-1", csrfToken: "tok-login" } } } });

    expect(await login()).toEqual({ login: { userId: "u-1", csrfToken: "tok-login" } });
    expect(useAuthStore.getState().csrfToken).toBe("tok-login");
  });

  it("signs in without the token on a server older than csrfToken", async () => {
    answer({
      Login: { errors: [{ message: 'Unknown field "csrfToken" on type "AuthPayload"' }] },
      LoginWithoutCsrfToken: { data: { login: { userId: "u-1" } } },
    });

    expect(await login()).toEqual({ login: { userId: "u-1" } });
    expect(operations).toEqual(["Login", "LoginWithoutCsrfToken"]);
    expect(useAuthStore.getState().csrfToken).toBeNull();
  });

  it("does not send the older mutation for a refusal with a code", async () => {
    answer({
      Login: { errors: [{ message: "bad credentials", extensions: { code: "UNAUTHENTICATED" } }] },
    });

    const err = await login().catch((e: unknown) => e);

    expect(graphqlErrorCode(err)).toBe("UNAUTHENTICATED");
    expect(operations).toEqual(["Login"]);
  });
});
