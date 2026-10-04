import { describe, it, expect } from "vitest";
import { createGraphqlClient, graphqlClient } from "./client";

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
});
