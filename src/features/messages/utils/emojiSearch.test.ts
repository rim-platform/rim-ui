import { describe, expect, it } from "vitest";

import { loadEmojiIndex, searchEmoji, SHORTCODE_QUERY, type EmojiIndexEntry } from "./emojiSearch";

const partyblob = { name: "partyblob", imageUrl: "/api/emoji/e-1" };

describe("searchEmoji", () => {
  it("puts the workspace's custom emoji first", () => {
    const index: EmojiIndexEntry[] = [
      { id: "partying_face", keywords: ["celebration"], native: "🥳" },
    ];
    const results = searchEmoji("part", index, [partyblob]);

    expect(results[0]).toEqual({
      code: "partyblob",
      insert: ":partyblob:",
      emoji: null,
      imageUrl: "/api/emoji/e-1",
    });
    expect(results.map((s) => s.insert)).toContain("🥳");
  });

  it("finds Unicode emoji by name and keyword", async () => {
    const index = await loadEmojiIndex();

    expect(searchEmoji("part", index, []).map((s) => s.emoji)).toContain("🥳");
    expect(searchEmoji("thumbsup", index, []).map((s) => s.emoji)).toContain("👍");
    expect(searchEmoji("celebrat", index, []).map((s) => s.emoji)).toContain("🥳");
  });

  it("returns at most 8", async () => {
    const index = await loadEmojiIndex();

    expect(searchEmoji("s", index, [])).toHaveLength(8);
  });

  it("lists each emoji once", async () => {
    const index = await loadEmojiIndex();
    const inserts = searchEmoji("fire", index, []).map((s) => s.insert);

    expect(new Set(inserts).size).toBe(inserts.length);
  });
});

describe("SHORTCODE_QUERY", () => {
  it("matches no query inside a word", () => {
    expect("at 10:30").not.toMatch(SHORTCODE_QUERY);
    expect("hi :pa".match(SHORTCODE_QUERY)?.[1]).toBe("pa");
    expect(":thumbs".match(SHORTCODE_QUERY)?.[1]).toBe("thumbs");
  });
});
