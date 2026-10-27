import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../../test/mocks/server";
import { withServerInfo } from "../../../../test/serverInfo";

vi.mock("../../../../shared/media/serverMedia", () => ({
  useServerMediaUrls: (urls: readonly string[]) => new Map(urls.map((u) => [u, `blob:${u}`])),
}));

import { MessageReactions } from "./MessageReactions";

/** Serves the workspace's custom emoji: `partyblob`. */
function serveEmoji() {
  server.use(
    http.post("*/api", async ({ request }) => {
      const body = (await request.json()) as { query?: string };
      if (!body.query?.includes("customEmojis")) return undefined;
      return HttpResponse.json({
        data: {
          customEmojis: [
            {
              id: "1",
              name: "partyblob",
              imageUrl: "/api/emoji/1",
              serverId: "ws-1",
              uploadedBy: "u-1",
              createdAt: "2026-10-10T00:00:00Z",
            },
          ],
        },
      });
    }),
  );
}

function renderReactions(emoji: string) {
  const Wrapper = withServerInfo();
  return render(
    <Wrapper>
      <MessageReactions
        messageId="m-1"
        serverId="ws-1"
        reactions={[{ emoji, count: 2, reactedByMe: false, userIds: [] }]}
        onToggleReaction={vi.fn()}
      />
    </Wrapper>,
  );
}

describe("MessageReactions", () => {
  it("shows a custom emoji reaction as its image with :name: as alt text and title", async () => {
    serveEmoji();
    renderReactions(":partyblob:");
    const img = await screen.findByRole("img", { name: ":partyblob:" });
    expect(img).toHaveAttribute("src", "blob:/api/emoji/1");
    expect(img).toHaveAttribute("title", ":partyblob:");
    expect(screen.queryByText(":partyblob:")).toBeNull();
  });

  it("keeps :name: as text when the workspace has no such emoji", async () => {
    serveEmoji();
    renderReactions(":nope:");
    expect(screen.getByText(":nope:")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  });

  it("shows a Unicode reaction as text", () => {
    serveEmoji();
    renderReactions("👍");
    expect(screen.getByText("👍")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
