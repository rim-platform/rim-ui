import { describe, it, expect } from "vitest";
import { getGraphqlEndpoint } from "./config";

describe("getGraphqlEndpoint", () => {
  it("returns the default endpoint when env var is not set", () => {
    const endpoint = getGraphqlEndpoint();
    // In test environment VITE_GRAPHQL_ENDPOINT is not set, so fallback is used
    expect(endpoint).toBe("http://localhost:8080/api");
  });

  it("returns a string", () => {
    expect(typeof getGraphqlEndpoint()).toBe("string");
  });

  it("endpoint starts with http", () => {
    expect(getGraphqlEndpoint()).toMatch(/^https?:\/\//);
  });
});
