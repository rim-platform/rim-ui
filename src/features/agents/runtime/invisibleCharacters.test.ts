import { describe, expect, it } from "vitest";

import { showInvisibleCharacters } from "./invisibleCharacters";

describe("showInvisibleCharacters", () => {
  it("leaves ordinary text, tabs and newlines as they are", () => {
    const text = "Dobrý den,\n\tto je zpráva: שלום مرحبا 日本語";
    expect(showInvisibleCharacters(text)).toBe(text);
  });

  it.each([
    ["right-to-left override", "\u202E", "U+202E"],
    ["left-to-right override", "\u202D", "U+202D"],
    ["right-to-left isolate", "\u2067", "U+2067"],
    ["pop directional isolate", "\u2069", "U+2069"],
    ["right-to-left mark", "\u200F", "U+200F"],
    ["zero-width space", "\u200B", "U+200B"],
    ["zero-width non-joiner", "\u200C", "U+200C"],
    ["word joiner", "\u2060", "U+2060"],
    ["byte order mark", "\uFEFF", "U+FEFF"],
    ["soft hyphen", "\u00AD", "U+00AD"],
    ["a tag character", "\u{E0041}", "U+E0041"],
    ["carriage return", "\r", "U+000D"],
    ["null", "\0", "U+0000"],
    ["escape", "\u001B", "U+001B"],
    ["delete", "\u007F", "U+007F"],
    ["line separator", "\u2028", "U+2028"],
    ["paragraph separator", "\u2029", "U+2029"],
  ])("names %s", (_what, character, name) => {
    expect(showInvisibleCharacters(`a${character}b`)).toBe(`a⟦${name}⟧b`);
  });

  it("names each of several in a row", () => {
    expect(showInvisibleCharacters("\u202E\u200B")).toBe("⟦U+202E⟧⟦U+200B⟧");
  });

  it.each([
    ["a Hangul filler", "\u3164", "U+3164"],
    ["a Hangul choseong filler", "\u115F", "U+115F"],
    ["a Hangul jungseong filler", "\u1160", "U+1160"],
    ["a supplementary variation selector", "\u{E0100}", "U+E0100"],
    ["a tag character", "\u{E0041}", "U+E0041"],
  ])("names %s, which draws nothing", (_what, character, name) => {
    expect(showInvisibleCharacters(`a${character}b`)).toBe(`a⟦${name}⟧b`);
  });

  it("leaves variation selectors alone", () => {
    expect(showInvisibleCharacters("❤\uFE0F")).toBe("❤\uFE0F");
    expect(showInvisibleCharacters("a\uFE00b")).toBe("a\uFE00b");
  });

  it.each([
    ["a family", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"],
    ["a joiner after a variation selector", "\u{1F3F3}\uFE0F\u200D\u{1F308}"],
    ["a skin tone before a joiner", "\u{1F469}\u{1F3FD}\u200D\u{1F4BB}"],
    ["a joiner before a symbol", "\u{1F3C3}\u200D♂\uFE0F"],
  ])("keeps the joiner in %s", (_what, emoji) => {
    expect(showInvisibleCharacters(emoji)).toBe(emoji);
  });

  it.each([
    ["between letters", "a\u200Db", "a⟦U+200D⟧b"],
    ["after an emoji only", "\u{1F468}\u200Db", "\u{1F468}⟦U+200D⟧b"],
    ["before an emoji only", "a\u200D\u{1F468}", "a⟦U+200D⟧\u{1F468}"],
    ["at the start", "\u200D\u{1F468}", "⟦U+200D⟧\u{1F468}"],
    ["at the end", "\u{1F468}\u200D", "\u{1F468}⟦U+200D⟧"],
    [
      "beside another joiner",
      "\u{1F468}\u200D\u200D\u{1F468}",
      "\u{1F468}⟦U+200D⟧⟦U+200D⟧\u{1F468}",
    ],
  ])("names a joiner %s", (_what, text, shown) => {
    expect(showInvisibleCharacters(text)).toBe(shown);
  });

  it("gives the same answer every call", () => {
    expect(showInvisibleCharacters("\u202E")).toBe(showInvisibleCharacters("\u202E"));
    expect(showInvisibleCharacters("\u202E")).toBe("⟦U+202E⟧");
  });
});
