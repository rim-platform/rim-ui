import { describe, it, expect } from "vitest";
import { replaceShortcodes } from "./emojiShortcodes";

describe("replaceShortcodes", () => {
  it("replaces colon-style shortcodes", () => {
    expect(replaceShortcodes("Great job :fire:")).toBe("Great job \u{1F525}");
  });

  it("replaces multiple shortcodes", () => {
    expect(replaceShortcodes(":thumbsup: and :heart:")).toBe("\u{1F44D} and \u2764\uFE0F");
  });

  it("replaces emoticons with word boundaries", () => {
    expect(replaceShortcodes("hello :)")).toBe("hello \u{1F60A}");
  });

  it("replaces <3 emoticon", () => {
    expect(replaceShortcodes("I <3 you")).toBe("I \u2764\uFE0F you");
  });

  it("does not replace emoticons inside words", () => {
    // :) at the start with no space prefix should not match because
    // the regex requires start-of-string or whitespace
    const result = replaceShortcodes("http://example.com");
    expect(result).toBe("http://example.com");
  });

  it("replaces emoticon at start of string", () => {
    expect(replaceShortcodes(":D hello")).toBe("\u{1F603} hello");
  });

  it("leaves text without shortcodes unchanged", () => {
    expect(replaceShortcodes("just normal text")).toBe("just normal text");
  });

  it("handles empty string", () => {
    expect(replaceShortcodes("")).toBe("");
  });
});
