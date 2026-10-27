import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { TestProviders } from "../../../test/utils";
import { fakeLimits } from "../../../test/limits";
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
    expect(result.current.info).toEqual({
      version: "0.3.0",
      apiVersion: CLIENT_API_VERSION,
      features: [],
    });
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

  it("reads the server's features", async () => {
    const features = [
      { key: "attachments", state: "DISABLED", reason: null },
      { key: "email", state: "UNAVAILABLE", reason: "SMTP is not configured" },
    ];
    server.use(
      mockGraphQLQuery("ServerInfo", {
        serverInfo: { version: "0.4.0", apiVersion: CLIENT_API_VERSION, features },
      }),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.info?.features).toEqual(features);
  });

  it.each([90, null])("reads the server's audit retention of %s days", async (days) => {
    server.use(
      mockGraphQLQuery("ServerInfo", {
        serverInfo: {
          version: "0.5.0",
          apiVersion: CLIENT_API_VERSION,
          features: [],
          auditRetentionDays: days,
        },
      }),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.info?.auditRetentionDays).toBe(days);
  });

  it("reads the server's instance notice and terms URL", async () => {
    server.use(
      mockGraphQLQuery("ServerInfo", {
        serverInfo: {
          version: "0.6.0",
          apiVersion: CLIENT_API_VERSION,
          features: [],
          auditRetentionDays: null,
          instanceNotice: "Run by Acme.",
          termsUrl: "https://acme.example/terms",
        },
      }),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.info?.instanceNotice).toBe("Run by Acme.");
    expect(result.current.info?.termsUrl).toBe("https://acme.example/terms");
  });

  it("reads the server's limits", async () => {
    const limits = fakeLimits({ workspacesPerUser: 5, messageBytes: 4000, probationHours: 24 });
    server.use(
      mockGraphQLQuery("ServerInfo", {
        serverInfo: { version: "0.7.0", apiVersion: CLIENT_API_VERSION, features: [], limits },
      }),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.limits).toEqual(limits);
    expect(result.current.info?.limits).toEqual(limits);
  });

  it("reads the operator's DM settings, and none from a server older than DM policies", async () => {
    server.use(
      mockGraphQLQuery("ServerInfo", {
        serverInfo: {
          version: "0.9.0",
          apiVersion: CLIENT_API_VERSION,
          features: [],
          dmInbound: "PARTNERS",
          dmOutbound: "ALLOWED",
          dmPartners: ["rims1_partner"],
        },
      }),
    );
    const current = renderHook(() => useServerInfo(), { wrapper: TestProviders });
    await waitFor(() => expect(current.result.current.info).toBeDefined());
    expect(current.result.current.info).toMatchObject({
      dmInbound: "PARTNERS",
      dmOutbound: "ALLOWED",
      dmPartners: ["rims1_partner"],
    });
    current.unmount();

    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        if (body.operationName === "ServerInfo") {
          return HttpResponse.json({
            errors: [{ message: 'Unknown field "dmInbound" on type "ServerInfo"' }],
          });
        }
        return HttpResponse.json({
          data: {
            serverInfo: { version: "0.8.0", apiVersion: 1, features: [] },
          },
        });
      }),
    );
    const older = renderHook(() => useServerInfo(), { wrapper: TestProviders });
    await waitFor(() => expect(older.result.current.info).toBeDefined());
    expect(older.result.current.info?.dmInbound).toBeUndefined();
  });

  it("reads the account cap and safety settings, and a server older than them without", async () => {
    const operations: (string | undefined)[] = [];
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        operations.push(body.operationName);
        return HttpResponse.json({
          data: {
            serverInfo: {
              version: "0.9.0",
              apiVersion: 1,
              features: [],
              registrationFull: true,
              abuseContact: "abuse@acme.example",
              minimumAge: 16,
            },
          },
        });
      }),
    );
    const current = renderHook(() => useServerInfo(), { wrapper: TestProviders });
    await waitFor(() => expect(current.result.current.info).toBeDefined());
    expect(current.result.current.info).toMatchObject({
      registrationFull: true,
      abuseContact: "abuse@acme.example",
      minimumAge: 16,
    });
    expect(operations).toEqual(["ServerInfo"]);
    current.unmount();

    operations.length = 0;
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        operations.push(body.operationName);
        if (body.operationName === "ServerInfo" || body.operationName === "ServerInfoWithAccount") {
          return HttpResponse.json({
            errors: [{ message: 'Unknown field "registrationFull" on type "ServerInfo"' }],
          });
        }
        return HttpResponse.json({
          data: {
            serverInfo: { version: "0.8.5", apiVersion: 1, features: [], dmInbound: "ANYONE" },
          },
        });
      }),
    );
    const older = renderHook(() => useServerInfo(), { wrapper: TestProviders });
    await waitFor(() => expect(older.result.current.info).toBeDefined());
    expect(operations).toEqual(["ServerInfo", "ServerInfoWithAccount", "ServerInfoWithDm"]);
    expect(older.result.current.info?.dmInbound).toBe("ANYONE");
    expect(older.result.current.info?.registrationFull).toBeUndefined();
    expect(older.result.current.info?.minimumAge).toBeUndefined();
  });

  it("reads a server older than instance limits with its notice and no limits", async () => {
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        if (body.operationName === "ServerInfo") {
          return HttpResponse.json({
            errors: [{ message: 'Unknown field "limits" on type "ServerInfo"' }],
          });
        }
        return HttpResponse.json({
          data: {
            serverInfo: {
              version: "0.6.0",
              apiVersion: 1,
              features: [],
              auditRetentionDays: 30,
              instanceNotice: "Run by Acme.",
              termsUrl: null,
            },
          },
        });
      }),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.info?.instanceNotice).toBe("Run by Acme.");
    expect(result.current.info?.auditRetentionDays).toBe(30);
    expect(result.current.info).not.toHaveProperty("limits");
    expect(result.current.limits).toBeUndefined();
    expect(result.current.unreachable).toBe(false);
  });

  it("reads a server older than audit retention with its features, no retention, notice or terms", async () => {
    const features = [{ key: "attachments", state: "DISABLED", reason: null }];
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        if (body.operationName === "ServerInfo") {
          return HttpResponse.json({
            errors: [{ message: 'Unknown field "auditRetentionDays" on type "ServerInfo"' }],
          });
        }
        return HttpResponse.json({
          data: { serverInfo: { version: "0.4.0", apiVersion: 1, features } },
        });
      }),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.info?.features).toEqual(features);
    expect(result.current.info).not.toHaveProperty("auditRetentionDays");
    expect(result.current.info).not.toHaveProperty("instanceNotice");
    expect(result.current.info).not.toHaveProperty("termsUrl");
    expect(result.current.unreachable).toBe(false);
  });

  it("reads a server older than features as listing none", async () => {
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        if (body.operationName !== "ServerVersion") {
          return HttpResponse.json({
            errors: [{ message: 'Unknown field "features" on type "ServerInfo"' }],
          });
        }
        return HttpResponse.json({ data: { serverInfo: { version: "0.3.0", apiVersion: 1 } } });
      }),
    );
    const { result } = renderHook(() => useServerInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.info).toBeDefined());
    expect(result.current.info).toEqual({ version: "0.3.0", apiVersion: 1, features: [] });
    expect(result.current.unreachable).toBe(false);
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
