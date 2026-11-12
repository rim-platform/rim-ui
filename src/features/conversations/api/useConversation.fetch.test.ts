import { onlineManager, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn().mockRejectedValue(new TypeError("no network")) },
}));

import { fetchConversation } from "./useConversation";

describe("fetchConversation", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("fails at once offline, rather than waiting to come online", async () => {
    onlineManager.setOnline(false);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(fetchConversation(qc, "w1", "c1")).rejects.toThrow("no network");
  });
});
