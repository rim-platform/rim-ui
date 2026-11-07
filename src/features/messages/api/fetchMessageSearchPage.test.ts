import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setSpaceRouter } from "../../../core/graphql/client";
import { fetchMessageSearchPage } from "./useSearchMessages";

const EMPTY_PAGE = {
  data: {
    searchMessages: {
      items: [],
      next: null,
      prev: null,
      pageInfo: { hasNext: false, hasPrev: false },
    },
  },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchMessageSearchPage", () => {
  const send = vi.fn();
  const fetchSpy = vi.fn();

  beforeEach(() => {
    send.mockReset();
    fetchSpy.mockReset();
    send.mockImplementation(async () => json(EMPTY_PAGE));
    fetchSpy.mockImplementation(async () => json(EMPTY_PAGE));
    vi.stubGlobal("fetch", fetchSpy);
    setSpaceRouter({
      hostOf: (spaceId) => (spaceId === "remote-ws" ? "host-b" : null),
      send,
    });
  });

  afterEach(() => {
    setSpaceRouter(null);
    vi.unstubAllGlobals();
  });

  it("sends a workspace on another server's search to that server, and no other", async () => {
    await fetchMessageSearchPage("remote-ws", "release", 5);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    const [host, body] = send.mock.calls[0] as [string, string];
    expect(host).toBe("host-b");
    expect(JSON.parse(body).variables.input).toMatchObject({
      serverId: "remote-ws",
      query: "release",
      limit: 5,
    });
  });

  it("sends a workspace this server hosts to this server", async () => {
    await fetchMessageSearchPage("local-ws", "release", 5);
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).variables.input.serverId).toBe("local-ws");
  });

  it("passes the abort signal to the request", async () => {
    const controller = new AbortController();
    await fetchMessageSearchPage("local-ws", "release", 5, controller.signal);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});
