import { describe, expect, it } from "vitest";

import { graphqlError } from "../conversations/__fixtures__/conversations";
import { linkRateLimitedMessage, publicLinkErrorMessage, waitLabel } from "./linkErrors";
import { isPublicLinkToken } from "./token";

describe("isPublicLinkToken", () => {
  it("tells a public link from invite tokens by its prefix", () => {
    expect(isPublicLinkToken("rim_pjl_AAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(isPublicLinkToken("rim_inv_abc")).toBe(false);
    expect(isPublicLinkToken("rim_iinv_abc")).toBe(false);
    expect(isPublicLinkToken("tok-abc")).toBe(false);
  });
});

describe("waitLabel", () => {
  it.each([
    [0.2, "1 second"],
    [45, "45 seconds"],
    [60, "1 minute"],
    [61, "2 minutes"],
    [3600, "60 minutes"],
  ])("reads %d seconds as %j", (seconds, label) => {
    expect(waitLabel(seconds)).toBe(label);
  });
});

describe("linkRateLimitedMessage", () => {
  it("says to try again later without a wait, and when with one", () => {
    expect(linkRateLimitedMessage(undefined)).toMatch(/Try again later\.$/);
    expect(linkRateLimitedMessage(120)).toMatch(/Try again in 2 minutes\.$/);
  });
});

describe("publicLinkErrorMessage", () => {
  it("names no cause for an invalid link", () => {
    expect(publicLinkErrorMessage(graphqlError("NOT_FOUND", "not found"), "x")).toBe(
      "This link isn't valid.",
    );
  });

  it("keeps the server's sentence for a refusal it has no wording for", () => {
    expect(publicLinkErrorMessage(graphqlError("VALIDATION", "something new"), "x")).toBe(
      "Something new.",
    );
  });

  it("falls back for a failure that names nothing", () => {
    expect(publicLinkErrorMessage({}, "Could not join.")).toBe("Could not join.");
  });
});
