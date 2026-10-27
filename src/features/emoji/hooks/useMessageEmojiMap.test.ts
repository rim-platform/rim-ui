import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { withServerInfo } from "../../../test/serverInfo";

vi.mock("../../../shared/media/serverMedia", () => ({
  useServerMediaUrls: (urls: readonly string[]) => new Map(urls.map((u) => [u, `blob:${u}`])),
}));

import { useMessageEmojiMap } from "./useMessageEmojiMap";

function emoji(id: string, name: string) {
  return {
    id,
    name,
    imageUrl: `/api/emoji/${id}`,
    serverId: "ws-1",
    uploadedBy: "u-1",
    createdAt: "2026-10-10T00:00:00Z",
  };
}

/** Serves the custom emoji query and counts how often it was asked. */
function serveEmoji(): { calls: number } {
  const seen = { calls: 0 };
  server.use(
    http.post("*/api", async ({ request }) => {
      const body = (await request.json()) as { query?: string };
      if (!body.query?.includes("customEmojis")) return undefined;
      seen.calls += 1;
      return HttpResponse.json({
        data: { customEmojis: [emoji("1", "partyblob"), emoji("2", "other")] },
      });
    }),
  );
  return seen;
}

describe("useMessageEmojiMap", () => {
  it("maps the emoji a message names to their loaded images", async () => {
    serveEmoji();
    const { result } = renderHook(() => useMessageEmojiMap("hi :partyblob: :nope:", "ws-1"), {
      wrapper: withServerInfo(),
    });

    await waitFor(() =>
      expect(result.current).toEqual(new Map([["partyblob", "blob:/api/emoji/1"]])),
    );
  });

  it("asks for nothing when the text names no shortcode", async () => {
    const seen = serveEmoji();
    const { result } = renderHook(() => useMessageEmojiMap("10:30 meeting", "ws-1"), {
      wrapper: withServerInfo(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toBeUndefined();
    expect(seen.calls).toBe(0);
  });
});
