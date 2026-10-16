import { describe, it, expect, afterEach, vi } from "vitest";
import { endpointHost, getGraphqlEndpoint, getApiOrigin, getWsEndpoint } from "./config";

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

describe("getApiOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("strips the trailing /api from the default endpoint", () => {
    expect(getApiOrigin()).toBe("http://localhost:8080");
  });

  it("strips the trailing /api from a custom env-configured endpoint", () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "https://api.example.com/rim/api");
    expect(getApiOrigin()).toBe("https://api.example.com/rim");
  });

  it("falls back to the bare origin when the endpoint has no /api suffix", () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "https://api.example.com");
    expect(getApiOrigin()).toBe("https://api.example.com");
  });

  it("falls back to the bare origin, dropping the path, when the endpoint's path isn't /api", () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "https://api.example.com/graphql");
    expect(getApiOrigin()).toBe("https://api.example.com");
  });

  it("resolves a relative endpoint against window.location", () => {
    // jsdom's default test origin is http://localhost:3000.
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "/api");
    expect(getApiOrigin()).toBe("http://localhost:3000");
  });
});

describe("getWsEndpoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("converts an absolute http endpoint to ws and appends /ws", () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "http://localhost:8080/api");
    expect(getWsEndpoint()).toBe("ws://localhost:8080/api/ws");
  });

  it("converts an absolute https endpoint to wss and appends /ws", () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "https://api.example.com/api");
    expect(getWsEndpoint()).toBe("wss://api.example.com/api/ws");
  });

  it("resolves a relative endpoint against window.location and appends /ws", () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "/api");
    expect(getWsEndpoint()).toBe("ws://localhost:3000/api/ws");
  });

  it("still produces a well-formed /api/ws URL when the endpoint has no /api suffix", () => {
    vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "https://api.example.com/graphql");
    expect(getWsEndpoint()).toBe("wss://api.example.com/api/ws");
  });
});

describe("endpointHost", () => {
  it("names the host of an endpoint", () => {
    expect(endpointHost("https://relay.rim-platform.org/api")).toBe("relay.rim-platform.org");
  });

  it("resolves a relative endpoint against the page", () => {
    expect(endpointHost("/api")).toBe(window.location.host);
  });

  it("gives back an endpoint that does not parse", () => {
    expect(endpointHost("http://[::1")).toBe("http://[::1");
  });
});
