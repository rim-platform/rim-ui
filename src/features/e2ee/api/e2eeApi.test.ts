import { beforeEach, describe, expect, it, vi } from "vitest";

const relayRequest = vi.fn();
const hostRequest = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => relayRequest(...args) },
}));
vi.mock("../../relay/transport/remoteFetch", () => ({
  hostClient: vi.fn(() => ({ request: (...args: unknown[]) => hostRequest(...args) })),
}));
vi.mock("../../relay/state/spaces", () => ({ remoteHosts: () => ["host-b"] }));

import { hostClient } from "../../relay/transport/remoteFetch";
import { ackWelcomes, fetchWelcomePage, WELCOME_PAGE_SIZE, welcomeSources } from "./e2eeApi";

describe("Welcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relayRequest.mockResolvedValue({ myMlsWelcomes: [] });
    hostRequest.mockResolvedValue({ myMlsWelcomes: [] });
  });

  it("reads this relay first, then each other host", () => {
    expect(welcomeSources()).toEqual([null, "host-b"]);
  });

  it("asks for a full page from the start, then after the last Welcome read", async () => {
    await fetchWelcomePage(null, null);
    await fetchWelcomePage(null, { id: "w99", createdAt: "2026-10-20T00:00:00Z" });

    expect(relayRequest.mock.calls[0][1]).toEqual({ after: null, limit: WELCOME_PAGE_SIZE });
    expect(relayRequest.mock.calls[1][1]).toEqual({
      after: { createdAt: "2026-10-20T00:00:00Z", welcomeId: "w99" },
      limit: 100,
    });
  });

  it("reads another host's page through that host", async () => {
    await fetchWelcomePage("host-b", null);

    expect(hostClient).toHaveBeenCalledWith("host-b");
    expect(hostRequest).toHaveBeenCalledTimes(1);
    expect(relayRequest).not.toHaveBeenCalled();
  });

  it("acknowledges at most 100 Welcomes per call", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `w${i}`);

    await ackWelcomes(null, ids);

    expect(relayRequest.mock.calls.map((call) => call[1].ids)).toEqual([
      ids.slice(0, 100),
      ids.slice(100, 200),
      ids.slice(200),
    ]);
  });

  it("acknowledges nothing when nothing was read", async () => {
    await ackWelcomes("host-b", []);

    expect(hostRequest).not.toHaveBeenCalled();
  });
});
