import { describe, it, expect } from "vitest";
import { buildCustomEmojiMap, type CustomEmoji } from "./useCustomEmojis";

describe("buildCustomEmojiMap", () => {
  it("returns an empty map for empty input", () => {
    const map = buildCustomEmojiMap([]);
    expect(map.size).toBe(0);
  });

  it("maps emoji name to imageUrl", () => {
    const emojis: CustomEmoji[] = [
      {
        id: "1",
        name: "party_parrot",
        imageUrl: "https://cdn.example.com/party_parrot.gif",
        serverId: "srv-1",
        uploadedBy: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];

    const map = buildCustomEmojiMap(emojis);
    expect(map.get("party_parrot")).toBe("https://cdn.example.com/party_parrot.gif");
  });

  it("handles multiple emojis", () => {
    const emojis: CustomEmoji[] = [
      {
        id: "1",
        name: "emoji1",
        imageUrl: "url1",
        serverId: "srv-1",
        uploadedBy: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
      },
      {
        id: "2",
        name: "emoji2",
        imageUrl: "url2",
        serverId: "srv-1",
        uploadedBy: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
      },
      {
        id: "3",
        name: "emoji3",
        imageUrl: "url3",
        serverId: "srv-1",
        uploadedBy: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];

    const map = buildCustomEmojiMap(emojis);
    expect(map.size).toBe(3);
    expect(map.get("emoji1")).toBe("url1");
    expect(map.get("emoji2")).toBe("url2");
    expect(map.get("emoji3")).toBe("url3");
  });

  it("last emoji wins if names collide", () => {
    const emojis: CustomEmoji[] = [
      {
        id: "1",
        name: "same",
        imageUrl: "url1",
        serverId: "srv-1",
        uploadedBy: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
      },
      {
        id: "2",
        name: "same",
        imageUrl: "url2",
        serverId: "srv-1",
        uploadedBy: "user-2",
        createdAt: "2025-01-02T00:00:00Z",
      },
    ];

    const map = buildCustomEmojiMap(emojis);
    expect(map.size).toBe(1);
    expect(map.get("same")).toBe("url2");
  });

  it("returns undefined for missing emoji name", () => {
    const emojis: CustomEmoji[] = [
      {
        id: "1",
        name: "exists",
        imageUrl: "url1",
        serverId: "srv-1",
        uploadedBy: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];

    const map = buildCustomEmojiMap(emojis);
    expect(map.get("not_exists")).toBeUndefined();
  });
});
