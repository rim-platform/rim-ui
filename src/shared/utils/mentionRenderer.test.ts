import { describe, it, expect } from "vitest";
import { preprocessMentions, postprocessMentions } from "./mentionRenderer";

describe("preprocessMentions", () => {
  it("replaces mention tokens with placeholders", () => {
    const memberMap = new Map([["user-1", "Alice"]]);
    const result = preprocessMentions("Hello <@user-1>!", memberMap);
    expect(result.text).toBe("Hello %%MENTION_0%%!");
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toEqual({ userId: "user-1", displayName: "Alice" });
  });

  it("handles multiple mentions", () => {
    const memberMap = new Map([
      ["user-1", "Alice"],
      ["user-2", "Bob"],
    ]);
    const result = preprocessMentions("<@user-1> and <@user-2>", memberMap);
    expect(result.text).toBe("%%MENTION_0%% and %%MENTION_1%%");
    expect(result.mentions).toHaveLength(2);
  });

  it("uses a readable fallback when not in memberMap", () => {
    const memberMap = new Map<string, string>();
    const result = preprocessMentions("Hello <@unknown-user-id>!", memberMap);
    expect(result.mentions[0].displayName).toBe("Former member");
  });

  it("returns unchanged text when no mentions", () => {
    const memberMap = new Map<string, string>();
    const result = preprocessMentions("No mentions here", memberMap);
    expect(result.text).toBe("No mentions here");
    expect(result.mentions).toHaveLength(0);
  });
});

describe("postprocessMentions", () => {
  it("replaces placeholders with styled spans", () => {
    const html = "Hello %%MENTION_0%%!";
    const mentions = [{ userId: "user-1", displayName: "Alice" }];
    const result = postprocessMentions(html, mentions);
    expect(result).toContain("@Alice");
    expect(result).toContain('data-user-id="user-1"');
    expect(result).toContain('class="mention');
  });

  it("handles multiple mentions", () => {
    const html = "%%MENTION_0%% and %%MENTION_1%%";
    const mentions = [
      { userId: "user-1", displayName: "Alice" },
      { userId: "user-2", displayName: "Bob" },
    ];
    const result = postprocessMentions(html, mentions);
    expect(result).toContain("@Alice");
    expect(result).toContain("@Bob");
  });

  it("escapes HTML in display names", () => {
    const html = "%%MENTION_0%%";
    const mentions = [{ userId: "user-1", displayName: '<script>alert("xss")</script>' }];
    const result = postprocessMentions(html, mentions);
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("returns unchanged html when no mentions", () => {
    const html = "<p>No mentions</p>";
    const result = postprocessMentions(html, []);
    expect(result).toBe("<p>No mentions</p>");
  });
});
