import { afterEach, describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import { isServerUnreachable } from "../../features/messages/api/messageCache";
import { createGraphqlClient, graphqlClient } from "./client";
import { useEdgeStore } from "./edgeRefusals";
import { setSessionSecret } from "./sessionSecret";
import {
  AddressBlockedError,
  graphqlErrorCode,
  graphqlErrorMessage,
  isSessionRefused,
  RATE_LIMITED,
  retryAfterSeconds,
} from "./errors";

describe("createGraphqlClient", () => {
  it("returns a GraphQLClient instance", () => {
    const client = createGraphqlClient();
    expect(client).toBeDefined();
    expect(typeof client.request).toBe("function");
  });

  it("graphqlClient singleton is defined", () => {
    expect(graphqlClient).toBeDefined();
    expect(typeof graphqlClient.request).toBe("function");
  });

  it("client has rawRequest method", () => {
    const client = createGraphqlClient();
    expect(typeof client.rawRequest).toBe("function");
  });

  it("sends to the page's own origin when the endpoint is relative", async () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "/api");
    let url: string | null = null;
    server.use(
      http.post("*/api", ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: { __typename: "Query" } });
      }),
    );
    try {
      await createGraphqlClient().request("query Ping { __typename }");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(url).toBe(`${window.location.origin}/api`);
  });
});

describe("the session secret", () => {
  afterEach(() => setSessionSecret(null));

  it("goes in X-RIM-Session-Secret of every request while held, and not otherwise", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.post("*/api", ({ request }) => {
        seen.push(request.headers.get("x-rim-session-secret"));
        return HttpResponse.json({ data: { __typename: "Query" } });
      }),
    );
    const client = createGraphqlClient();
    await client.request("query Ping { __typename }");
    setSessionSecret("c2VjcmV0");
    await client.request("query Ping { __typename }");
    setSessionSecret(null);
    await client.request("query Ping { __typename }");
    expect(seen).toEqual([null, "c2VjcmV0", null]);
  });
});

describe("edge refusals", () => {
  const client = createGraphqlClient();
  const query = "query Ping { __typename }";

  function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
    server.use(http.post("*/api", () => HttpResponse.json(body, { status, headers })));
  }

  async function failure(): Promise<unknown> {
    return client.request(query).then(
      () => expect.unreachable("the request should fail"),
      (err: unknown) => err,
    );
  }

  afterEach(() => useEdgeStore.setState({ blocked: false, tooManyConnections: false }));

  it("surfaces a 429 rate_limited answer as RATE_LIMITED with its seconds", async () => {
    answer(429, { error: "rate_limited", retryAfterSeconds: 17 }, { "Retry-After": "17" });
    const err = await failure();

    expect(graphqlErrorCode(err)).toBe(RATE_LIMITED);
    expect(retryAfterSeconds(err)).toBe(17);
    expect(graphqlErrorMessage(err, "fallback")).toBe("Slow down: try again in 17 s");
    expect(isServerUnreachable(err)).toBe(false);
  });

  it("takes the seconds from Retry-After when the body has none", async () => {
    answer(429, { error: "rate_limited" }, { "Retry-After": "9" });
    expect(retryAfterSeconds(await failure())).toBe(9);
  });

  it("throws AddressBlockedError for a 403 blocked answer and records it", async () => {
    answer(403, { error: "blocked" });
    const err = await failure();

    expect(err).toBeInstanceOf(AddressBlockedError);
    expect(isSessionRefused(err)).toBe(false);
    expect(useEdgeStore.getState().blocked).toBe(true);
  });

  it("clears the blocked state on the next answer that is not a refusal", async () => {
    useEdgeStore.setState({ blocked: true });
    answer(200, { data: { __typename: "Query" } });

    await client.request(query);
    expect(useEdgeStore.getState().blocked).toBe(false);
  });

  it("passes another 403 through unchanged", async () => {
    answer(403, { error: "csrf" });
    const err = await failure();

    expect(err).not.toBeInstanceOf(AddressBlockedError);
    expect(isSessionRefused(err)).toBe(true);
    expect(useEdgeStore.getState().blocked).toBe(false);
  });
});
