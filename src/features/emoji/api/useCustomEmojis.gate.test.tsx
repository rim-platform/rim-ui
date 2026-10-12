import { afterEach, describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { server } from "../../../test/mocks/server";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { withServerInfo } from "../../../test/serverInfo";
import { useCustomEmojis } from "./useCustomEmojis";

const EMOJI = {
  id: "e-1",
  name: "party",
  imageUrl: "/emoji/party.png",
  serverId: "ws-1",
  uploadedBy: "u-1",
  createdAt: "2026-10-10T00:00:00Z",
};

/** Serves the custom emoji query and counts how often it was asked. */
function serveEmoji(): { calls: number } {
  const seen = { calls: 0 };
  server.use(
    http.post("*/api", async ({ request }) => {
      const body = (await request.json()) as { query?: string };
      if (!body.query?.includes("customEmojis")) return undefined;
      seen.calls += 1;
      return HttpResponse.json({ data: { customEmojis: [EMOJI] } });
    }),
  );
  return seen;
}

describe("useCustomEmojis and the custom_emoji switch", () => {
  afterEach(() => useRelayStore.getState().reset());

  it("loads the workspace's emoji while the server runs custom emoji", async () => {
    const seen = serveEmoji();
    const { result } = renderHook(() => useCustomEmojis("ws-1"), { wrapper: withServerInfo() });

    await waitFor(() => expect(result.current.emojis).toEqual([EMOJI]));
    expect(seen.calls).toBe(1);
  });

  it("asks for nothing and offers none while custom emoji is switched off", async () => {
    const seen = serveEmoji();
    const { result } = renderHook(() => useCustomEmojis("ws-1"), {
      wrapper: withServerInfo({ custom_emoji: ServerFeatureState.DISABLED }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.emojis).toEqual([]);
    expect(seen.calls).toBe(0);
  });

  it("asks for nothing and offers none in a direct space", async () => {
    startRelayWithDirectSpace();
    const seen = serveEmoji();
    const { result } = renderHook(() => useCustomEmojis(DIRECT_SPACE_ID), {
      wrapper: withServerInfo(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.emojis).toEqual([]);
    expect(seen.calls).toBe(0);
  });
});
