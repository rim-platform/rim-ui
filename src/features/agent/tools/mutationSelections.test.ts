import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { executeCommandWithProof, makeBackendToolHandler } from "./loader";

// This test file exists only to catch one class of bug: a GraphQL
// mutation/query whose selection set omits a backend-populated field, which
// vitest mocks (returning fully-populated objects) silently paper over.
// Instead of re-mocking `graphqlClient.request`, it intercepts `fetch` on the
// real `GraphQLClient` and asserts the outgoing request body string contains
// the required fields.
//
// Rule: every new selection on EXECUTE_COMMAND_MUTATION needs a clause here.
// Dropping one without updating this file means this test fails.

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Neutralise document.cookie for the CSRF middleware path.
  Object.defineProperty(document, "cookie", {
    value: "",
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Stage a fake GraphQL response for the next `fetch()` call and capture
 * the outgoing request body so the test can assert on its structure.
 */
function stageResponse(body: unknown): { getBody: () => string } {
  let captured = "";
  fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    captured = typeof init.body === "string" ? init.body : "";
    return new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { getBody: () => captured };
}

describe("EXECUTE_COMMAND_MUTATION selection set", () => {
  it("requests confirmationRequired { token, argsHash, expiresAt }", async () => {
    // Stage a SUCCESS response; the test asserts on the request body, not
    // on the response handling (that's loader.test.ts's job).
    const { getBody } = stageResponse({
      executeCommand: {
        status: "SUCCESS",
        message: "ok",
        payload: null,
        confirmationRequired: null,
      },
    });

    const handler = makeBackendToolHandler("chat.noop");
    await handler({});

    const body = getBody();
    // Normalise whitespace: graphql-request serialises the mutation with
    // original indentation, and the test must not depend on that.
    const flat = body.replace(/\s+/g, " ");
    expect(flat).toContain("confirmationRequired");
    expect(flat).toContain("token");
    expect(flat).toContain("argsHash");
    expect(flat).toContain("expiresAt");

    // Core result-shape selections (status/message/payload) must also stay
    // requested, otherwise the SUCCESS branch of interpretResult breaks.
    expect(flat).toContain("status");
    expect(flat).toContain("message");
    expect(flat).toContain("payload");
  });

  it("executeCommandWithProof emits the same enriched selection set on re-call", async () => {
    // The proof re-call routes through the same EXECUTE_COMMAND_MUTATION
    // constant, but is asserted independently in case the re-call path ever
    // gets its own copy of the mutation string.
    const { getBody } = stageResponse({
      executeCommand: {
        status: "SUCCESS",
        message: "ok",
        payload: null,
        confirmationRequired: null,
      },
    });

    await executeCommandWithProof("chat.delete_message", { id: "m-1" }, "chat.delete_message", {
      token: "tok",
      argsHash: "hash",
    });

    const flat = getBody().replace(/\s+/g, " ");
    expect(flat).toContain("confirmationRequired");
    expect(flat).toContain("token");
    expect(flat).toContain("argsHash");
    expect(flat).toContain("expiresAt");
  });
});
