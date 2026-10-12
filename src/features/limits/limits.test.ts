import { describe, expect, it } from "vitest";

import { isLimitRefusal, limitView, utf8Bytes } from "./limits";

function refusal(code: string, message: string) {
  return { response: { errors: [{ message, extensions: { code } }] } };
}

describe("utf8Bytes", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["é", 2],
    ["€", 3],
    ["😀", 4],
    ["a😀é", 7],
  ])("counts %j as %i bytes, as TextEncoder does", (text, bytes) => {
    expect(utf8Bytes(text)).toBe(bytes);
    expect(utf8Bytes(text)).toBe(new TextEncoder().encode(text).length);
  });

  it("counts a lone surrogate as the replacement character", () => {
    expect(utf8Bytes("\ud83d")).toBe(new TextEncoder().encode("\ud83d").length);
  });
});

describe("limitView", () => {
  const noun = ["workspace", "workspaces"] as const;

  it("is nothing without a cap", () => {
    expect(limitView(null, 3, noun, "workspaces per user")).toBeNull();
    expect(limitView(undefined, 3, noun, "workspaces per user")).toBeNull();
  });

  it("counts below the cap", () => {
    expect(limitView(5, 4, noun, "workspaces per user")).toEqual({
      text: "4 of 5 workspaces",
      full: false,
      reason: "This instance allows 5 workspaces per user.",
    });
  });

  it("is full at the cap, and names one of a cap of one", () => {
    expect(limitView(5, 5, noun, "workspaces per user")?.full).toBe(true);
    expect(limitView(1, 1, noun, "workspaces per user")).toMatchObject({
      text: "1 of 1 workspace",
      full: true,
    });
  });

  it("shows only the cap without a count", () => {
    expect(limitView(50, undefined, noun, "workspaces per user")).toMatchObject({
      text: "Up to 50 workspaces per user",
      full: false,
    });
  });
});

describe("isLimitRefusal", () => {
  it("knows a cap's refusal from another validation error", () => {
    expect(
      isLimitRefusal(refusal("VALIDATION", "this instance allows 5 invites per user per day")),
    ).toBe(true);
    expect(isLimitRefusal(refusal("VALIDATION", "invalid email address"))).toBe(false);
    expect(isLimitRefusal(refusal("CONFLICT", "this instance allows 5 workspaces per user"))).toBe(
      false,
    );
  });
});
