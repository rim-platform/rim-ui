import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { TestProviders } from "../../../test/utils";
import { CLIENT_API_VERSION } from "../api/serverInfoApi";
import { useServerInfo } from "./useServerInfo";

function serveInfo(version: string, apiVersion: number) {
  server.use(mockGraphQLQuery("ServerInfo", { serverInfo: { version, apiVersion } }));
}

describe("useServerInfo", () => {
  it("reads the server's version and API version", async () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.info).toEqual({ version: "0.3.0", apiVersion: CLIENT_API_VERSION });
    expect(result.current.unreachable).toBe(false);
    expect(result.current.newerApi).toBe(false);
  });

  it("reports nothing while loading", () => {
    serveInfo("0.3.0", CLIENT_API_VERSION);
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });
    expect(result.current).toEqual({ info: undefined, unreachable: false, newerApi: false });
  });

  it("marks the server unreachable when the request fails", async () => {
    server.use(http.post("*/api", () => HttpResponse.error()));
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.unreachable).toBe(true));
    expect(result.current.info).toBeUndefined();
    expect(result.current.newerApi).toBe(false);
  });

  it("marks the server unreachable when it cannot answer the query", async () => {
    server.use(
      http.post("*/api", () =>
        HttpResponse.json({ errors: [{ message: 'Unknown field "serverInfo"' }] }),
      ),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.unreachable).toBe(true));
  });

  it("flags a server that speaks a newer API", async () => {
    serveInfo("2.0.0", CLIENT_API_VERSION + 1);
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.newerApi).toBe(true));
  });

  it("does not flag a server that speaks an older API", async () => {
    serveInfo("0.0.1", CLIENT_API_VERSION - 1);
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.newerApi).toBe(false);
  });
});
