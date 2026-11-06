import { beforeEach, describe, expect, it, vi } from "vitest";

const origin = vi.hoisted(() => ({
  serverOrigin: vi.fn<() => Promise<string>>(),
  apiOrigin: vi.fn<() => string>(),
}));
vi.mock("../relay/state/serverOrigin", () => ({ serverOrigin: () => origin.serverOrigin() }));
vi.mock("../../core/graphql/config", () => ({ getApiOrigin: () => origin.apiOrigin() }));

import { webhookUrl } from "./webhookUrl";

describe("webhookUrl", () => {
  beforeEach(() => {
    origin.serverOrigin.mockReset();
    origin.apiOrigin.mockReset().mockReturnValue("https://api.configured.example");
  });

  it("is built from the server's address, not the page's", async () => {
    origin.serverOrigin.mockResolvedValue("https://rim.other.example");
    const url = await webhookUrl("rimhook_abc-DEF_123");
    expect(url).toBe("https://rim.other.example/api/hooks/rimhook_abc-DEF_123");
    expect(url).not.toContain(window.location.origin);
  });

  it("keeps a path the server is mounted under and drops a trailing slash", async () => {
    origin.serverOrigin.mockResolvedValue("https://example.org/rim/");
    expect(await webhookUrl("rimhook_x")).toBe("https://example.org/rim/api/hooks/rimhook_x");
  });

  it("falls back to the configured endpoint's origin when the server's own cannot be read", async () => {
    origin.serverOrigin.mockRejectedValue(new Error("no discovery"));
    expect(await webhookUrl("rimhook_x")).toBe(
      "https://api.configured.example/api/hooks/rimhook_x",
    );
  });
});
