import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { TestProviders } from "../../../test/utils";
import { InviteTokenType } from "../types";
import { usePreviewInviteToken, extractInviteErrorCode } from "./usePreviewInviteToken";

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

describe("usePreviewInviteToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns WORKSPACE tokenType and workspaceName on success", async () => {
    server.use(
      mockGraphQLQuery("PreviewInviteToken", {
        previewInviteToken: {
          tokenType: "WORKSPACE",
          expiresAt: null,
          workspace: {
            serverId: "server-1",
            serverName: "Acme Workspace",
            invitedByDisplayName: "Alice",
          },
        },
      }),
    );

    const { result } = renderHook(
      () => usePreviewInviteToken("valid-workspace-token"),
      { wrapper: TestProviders },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.tokenType).toBe(InviteTokenType.WORKSPACE);
    expect(result.current.data?.workspace?.serverName).toBe("Acme Workspace");
  });

  it("returns INSTANCE tokenType with null workspace on instance invite", async () => {
    server.use(
      mockGraphQLQuery("PreviewInviteToken", {
        previewInviteToken: {
          tokenType: "INSTANCE",
          expiresAt: null,
          workspace: null,
        },
      }),
    );

    const { result } = renderHook(
      () => usePreviewInviteToken("instance-token"),
      { wrapper: TestProviders },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.tokenType).toBe(InviteTokenType.INSTANCE);
    expect(result.current.data?.workspace).toBeNull();
  });

  it("surfaces INVALID_TOKEN code via error extensions", async () => {
    server.use(
      http.post("*/api", async () => {
        return HttpResponse.json({
          data: null,
          errors: [
            {
              message: "Invalid token",
              extensions: { code: "INVALID_TOKEN" },
            },
          ],
        });
      }),
    );

    const { result } = renderHook(
      () => usePreviewInviteToken("invalid-token"),
      { wrapper: TestProviders },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    const code = extractInviteErrorCode(result.current.error);
    expect(code).toBe("INVALID_TOKEN");
  });

  it("surfaces EXPIRED_TOKEN code via error extensions", async () => {
    server.use(
      http.post("*/api", async () => {
        return HttpResponse.json({
          data: null,
          errors: [
            {
              message: "Token expired",
              extensions: { code: "EXPIRED_TOKEN" },
            },
          ],
        });
      }),
    );

    const { result } = renderHook(
      () => usePreviewInviteToken("expired-token"),
      { wrapper: TestProviders },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    const code = extractInviteErrorCode(result.current.error);
    expect(code).toBe("EXPIRED_TOKEN");
  });
});

describe("extractInviteErrorCode", () => {
  it("returns INVALID_TOKEN for a gql error with that extension code", () => {
    const err = { response: { errors: [{ extensions: { code: "INVALID_TOKEN" } }] } };
    expect(extractInviteErrorCode(err)).toBe("INVALID_TOKEN");
  });

  it("returns EXPIRED_TOKEN for a gql error with that extension code", () => {
    const err = { response: { errors: [{ extensions: { code: "EXPIRED_TOKEN" } }] } };
    expect(extractInviteErrorCode(err)).toBe("EXPIRED_TOKEN");
  });

  it("returns NETWORK for an unknown error shape", () => {
    expect(extractInviteErrorCode(new Error("network error"))).toBe("NETWORK");
  });

  it("returns NETWORK for null", () => {
    expect(extractInviteErrorCode(null)).toBe("NETWORK");
  });
});
