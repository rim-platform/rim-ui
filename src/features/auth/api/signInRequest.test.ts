import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { gql } from "graphql-request";
import { http, HttpResponse } from "msw";

import { graphqlErrorCode } from "../../../core/graphql/errors";
import { server } from "../../../test/mocks/server";
import { useAuthStore } from "../state/useAuthStore";
import { signInRequest } from "./signInRequest";

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

/** A mutation that starts a session and asks for its `csrfToken`. */
const SIGN_IN = gql`
  mutation SignIn($input: String!) {
    signIn(input: $input) {
      userId
      csrfToken
    }
  }
`;

/** The same without `csrfToken`. */
const SIGN_IN_WITHOUT_CSRF_TOKEN = gql`
  mutation SignInWithoutCsrfToken($input: String!) {
    signIn(input: $input) {
      userId
    }
  }
`;

interface SignInResponse {
  signIn: { userId: string; csrfToken?: string };
}

/** Sends the sign-in mutation through `signInRequest`; resolves to its payload. */
function login() {
  return signInRequest<SignInResponse>("signIn", SIGN_IN, SIGN_IN_WITHOUT_CSRF_TOKEN, {
    input: "ada",
  });
}

describe("signInRequest", () => {
  beforeEach(() => {
    operations.length = 0;
  });

  afterEach(() => {
    useAuthStore.setState({ csrfToken: null });
  });

  it("keeps the csrfToken a sign-in returns", async () => {
    answer({ SignIn: { data: { signIn: { userId: "u-1", csrfToken: "tok-login" } } } });

    expect(await login()).toEqual({ signIn: { userId: "u-1", csrfToken: "tok-login" } });
    expect(useAuthStore.getState().csrfToken).toBe("tok-login");
  });

  it("signs in without the token on a server older than csrfToken", async () => {
    answer({
      SignIn: { errors: [{ message: 'Unknown field "csrfToken" on type "LoginPayload"' }] },
      SignInWithoutCsrfToken: { data: { signIn: { userId: "u-1" } } },
    });

    expect(await login()).toEqual({ signIn: { userId: "u-1" } });
    expect(operations).toEqual(["SignIn", "SignInWithoutCsrfToken"]);
    expect(useAuthStore.getState().csrfToken).toBeNull();
  });

  it("does not send the older mutation for a refusal with a code", async () => {
    answer({
      SignIn: { errors: [{ message: "bad credentials", extensions: { code: "UNAUTHENTICATED" } }] },
    });

    const err = await login().catch((e: unknown) => e);

    expect(graphqlErrorCode(err)).toBe("UNAUTHENTICATED");
    expect(operations).toEqual(["SignIn"]);
  });
});
