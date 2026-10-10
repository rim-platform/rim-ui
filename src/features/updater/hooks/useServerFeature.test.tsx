import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { withServerInfo } from "../../../test/serverInfo";
import { TestProviders } from "../../../test/utils";
import { useServerFeature } from "./useServerFeature";
import { useServerInfo } from "./useServerInfo";

describe("useServerFeature", () => {
  it("reads an enabled feature as enabled", () => {
    const { result } = renderHook(() => useServerFeature("attachments"), {
      wrapper: withServerInfo(),
    });
    expect(result.current).toEqual({
      enabled: true,
      state: ServerFeatureState.ENABLED,
      reason: null,
    });
  });

  it("reads a disabled feature as not enabled", () => {
    const { result } = renderHook(() => useServerFeature("custom_emoji"), {
      wrapper: withServerInfo({ custom_emoji: ServerFeatureState.DISABLED }),
    });
    expect(result.current).toEqual({
      enabled: false,
      state: ServerFeatureState.DISABLED,
      reason: null,
    });
  });

  it("reads an unavailable feature as not enabled, with its reason", () => {
    const { result } = renderHook(() => useServerFeature("email"), {
      wrapper: withServerInfo({
        email: { state: ServerFeatureState.UNAVAILABLE, reason: "SMTP is not configured" },
      }),
    });
    expect(result.current).toEqual({
      enabled: false,
      state: ServerFeatureState.UNAVAILABLE,
      reason: "SMTP is not configured",
    });
  });

  it("is enabled while the server's info loads, so nothing hides early", () => {
    server.use(mockGraphQLQuery("ServerInfo", { serverInfo: { version: "1", apiVersion: 1 } }));
    const { result } = renderHook(() => useServerFeature("attachments"), {
      wrapper: TestProviders,
    });
    expect(result.current).toEqual({ enabled: true, state: undefined, reason: null });
  });

  it("is enabled when the server cannot be reached", async () => {
    server.use(http.post("*/api", () => HttpResponse.error()));
    const { result } = renderHook(
      () => ({ info: useServerInfo(), ai: useServerFeature("ai_commands") }),
      { wrapper: TestProviders },
    );
    await waitFor(() => expect(result.current.info.unreachable).toBe(true));
    expect(result.current.ai.enabled).toBe(true);
  });

  it("is enabled for a server that does not list the feature", async () => {
    server.use(
      mockGraphQLQuery("ServerInfo", {
        serverInfo: {
          version: "0.4.0",
          apiVersion: 1,
          features: [{ key: "email", state: "DISABLED", reason: null }],
        },
      }),
    );
    const { result } = renderHook(
      () => ({ plugins: useServerFeature("workspace_plugins"), email: useServerFeature("email") }),
      { wrapper: TestProviders },
    );
    await waitFor(() => expect(result.current.email.enabled).toBe(false));
    expect(result.current.plugins).toEqual({ enabled: true, state: undefined, reason: null });
  });
});
