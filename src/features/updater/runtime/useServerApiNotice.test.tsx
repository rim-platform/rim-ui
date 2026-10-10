import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery } from "../../../test/mocks/graphql";
import { TestProviders } from "../../../test/utils";
import { useToastStore } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { CLIENT_API_VERSION } from "../api/serverInfoApi";
import { NEWER_SERVER_API_MESSAGE, useServerInfo } from "../hooks/useServerInfo";
import {
  SERVER_API_TOAST_ID,
  resetServerApiNotice,
  useServerApiNotice,
} from "./useServerApiNotice";

function serveInfo(apiVersion: number) {
  server.use(mockGraphQLQuery("ServerInfo", { serverInfo: { version: "1.0.0", apiVersion } }));
}

function noticeToasts() {
  return useToastStore.getState().toasts.filter((t) => t.id === SERVER_API_TOAST_ID);
}

/** Runs the notice beside a read of the same query, so a test can wait for it to settle. */
function useNoticeAndInfo() {
  useServerApiNotice();
  return useServerInfo();
}

describe("useServerApiNotice", () => {
  beforeEach(() => {
    resetServerApiNotice();
    useToastStore.setState({ toasts: [] });
  });

  it("raises an info toast that opens About when the server speaks a newer API", async () => {
    serveInfo(CLIENT_API_VERSION + 1);
    renderHook(() => useServerApiNotice(), { wrapper: TestProviders });

    await waitFor(() => expect(noticeToasts()).toHaveLength(1));
    const [notice] = noticeToasts();
    expect(notice.variant).toBe("info");
    expect(notice.description).toBe(NEWER_SERVER_API_MESSAGE);

    act(() => notice.action?.onClick());
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "about" });
  });

  it("raises the toast once per launch", async () => {
    serveInfo(CLIENT_API_VERSION + 1);
    const first = renderHook(() => useServerApiNotice(), { wrapper: TestProviders });
    await waitFor(() => expect(noticeToasts()).toHaveLength(1));
    act(() => useToastStore.getState().remove(SERVER_API_TOAST_ID));
    first.unmount();

    const second = renderHook(() => useNoticeAndInfo(), { wrapper: TestProviders });
    await waitFor(() => expect(second.result.current.newerApi).toBe(true));
    expect(noticeToasts()).toHaveLength(0);
  });

  it("raises nothing when the server speaks the same or an older API", async () => {
    for (const apiVersion of [CLIENT_API_VERSION, CLIENT_API_VERSION - 1]) {
      serveInfo(apiVersion);
      const { result, unmount } = renderHook(() => useNoticeAndInfo(), {
        wrapper: TestProviders,
      });
      await waitFor(() => expect(result.current.info?.apiVersion).toBe(apiVersion));
      unmount();
    }
    expect(noticeToasts()).toHaveLength(0);
  });

  it("raises nothing when the server is unreachable", async () => {
    server.use(http.post("*/api", () => HttpResponse.error()));
    const { result } = renderHook(() => useNoticeAndInfo(), { wrapper: TestProviders });

    await waitFor(() => expect(result.current.unreachable).toBe(true));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
