import { describe, expect, it } from "vitest";

import {
  handleDomain,
  isHandleDomain,
  isInternalUsername,
  parseHandle,
  personName,
  viewHandle,
} from "./handles";

describe("handles", () => {
  it("splits a handle into its username and domain, with or without the @", () => {
    expect(parseHandle("@kuba:rim-platform.org")).toEqual({
      username: "kuba",
      domain: "rim-platform.org",
    });
    expect(parseHandle("kuba:localhost")).toEqual({ username: "kuba", domain: "localhost" });
    expect(handleDomain("@kuba:rim-platform.org")).toBe("rim-platform.org");
  });

  it.each([
    null,
    undefined,
    "",
    "@kuba",
    "@kuba:",
    "@:rim-platform.org",
    "@Kuba:rim-platform.org",
    "@kuba:Rim-Platform.org",
    "@kuba:rim-platform.org.",
    "@ku:rim-platform.org",
    "@kuba:rim_platform.org",
    "@kuba:rim-platform.org:443",
  ])("refuses %j as a handle", (text) => {
    expect(parseHandle(text)).toBeNull();
  });

  it("checks handle domains as the server does", () => {
    for (const ok of ["rim-platform.org", "localhost", "127.0.0.1", `${"a".repeat(63)}.org`]) {
      expect(isHandleDomain(ok), ok).toBe(true);
    }
    for (const bad of ["", "-rim.org", "rim-.org", "rim..org", `${"a".repeat(64)}.org`]) {
      expect(isHandleDomain(bad), bad).toBe(false);
    }
    expect(isHandleDomain(Array.from({ length: 128 }, () => "a").join("."))).toBe(false);
  });

  it("shows a handle of the viewer's own domain as @username and copies it whole", () => {
    expect(viewHandle("kuba", "@kuba:rim-platform.org", "rim-platform.org")).toEqual({
      shown: "@kuba",
      copied: "@kuba:rim-platform.org",
    });
  });

  it("shows a handle of another domain whole", () => {
    expect(viewHandle("r_abcdef", "@ada:elsewhere.example", "rim-platform.org")).toEqual({
      shown: "@ada:elsewhere.example",
      copied: "@ada:elsewhere.example",
    });
    expect(viewHandle("ada", "@ada:elsewhere.example", null)?.shown).toBe("@ada:elsewhere.example");
  });

  it("falls back to @username without a handle, and never shows an r_ name", () => {
    expect(viewHandle("kuba", null, "rim-platform.org")).toEqual({
      shown: "@kuba",
      copied: "@kuba",
    });
    expect(viewHandle("r_abcdef", null, "rim-platform.org")).toBeNull();
    expect(viewHandle("R_ABCDEF", undefined, null)).toBeNull();
    expect(viewHandle(undefined, null, null)).toBeNull();
    expect(isInternalUsername("r_x")).toBe(true);
    expect(isInternalUsername("robert")).toBe(false);
  });

  it("names a person by display name, then handle, then a readable fallback", () => {
    expect(personName({ displayName: "Ada", username: "r_x" }, "u-1234567890", null)).toBe("Ada");
    expect(
      personName({ username: "r_x", handle: "@ada:elsewhere.example" }, "u-1234567890", null),
    ).toBe("ada:elsewhere.example");
    expect(personName({ username: "kuba" }, "u-1234567890", null)).toBe("kuba");
    expect(personName({ username: "r_x" }, "u-1234567890", null)).toBe("Unknown user");
    expect(personName(null, "u-1234567890", null)).toBe("Unknown user");
  });
});
