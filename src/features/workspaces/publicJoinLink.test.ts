import { describe, expect, it } from "vitest";

import { graphqlError } from "../conversations/__fixtures__/conversations";
import {
  isPublicLinkToken,
  linkRateLimitedMessage,
  publicLinkErrorMessage,
  waitLabel,
} from "./publicJoinLink";

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
    [0.2, "1 minute"],
    [45, "1 minute"],
    [60, "1 minute"],
    [61, "2 minutes"],
    [3420, "57 minutes"],
  ])("reads %d seconds as %j", (seconds, label) => {
    expect(waitLabel(seconds)).toBe(label);
  });
});

describe("linkRateLimitedMessage", () => {
  it("says to try again later without a wait, and when with one", () => {
    expect(linkRateLimitedMessage(undefined)).toBe(
      "Too many tries from this network. Try again later.",
    );
    expect(linkRateLimitedMessage(120)).toBe(
      "Too many tries from this network. Try again in 2 minutes.",
    );
  });
});

describe("publicLinkErrorMessage", () => {
  it("names no cause for an invalid link", () => {
    expect(publicLinkErrorMessage(graphqlError("NOT_FOUND", "not found"), "x")).toBe(
      "This link isn't valid.",
    );
  });

  it("shows the server's own message for a refusal of the input", () => {
    expect(
      publicLinkErrorMessage(
        graphqlError(
          "VALIDATION",
          "your request was declined; you can ask to join this workspace again in 5 hours",
        ),
        "x",
      ),
    ).toBe("Your request was declined; you can ask to join this workspace again in 5 hours.");
  });

  it.each([
    ["already a member of this workspace", "You are already a member of this workspace."],
    ["you already asked to join this workspace", "Your request to join was already sent."],
  ])("tells a member and an asker apart: %s", (message, shown) => {
    expect(publicLinkErrorMessage(graphqlError("CONFLICT", message), "x")).toBe(shown);
  });

  it("says a banned person is banned", () => {
    expect(
      publicLinkErrorMessage(graphqlError("FORBIDDEN", "you are banned from this workspace"), "x"),
    ).toBe("You are banned from this workspace.");
  });

  it("falls back for a failure that names nothing", () => {
    expect(publicLinkErrorMessage({}, "Could not join.")).toBe("Could not join.");
  });
});
