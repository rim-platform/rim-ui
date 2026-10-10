import { describe, expect, it } from "vitest";

import vectors from "../../../../protocol/relay-vectors.json";
import {
  formatInviteLink,
  InviteLinkError,
  isInviteLink,
  MAX_INVITE_LINK_LEN,
  parseInviteLink,
} from "./inviteLink";

const link = {
  hostServerId: vectors.host.serverId,
  hostKeyHash: vectors.host.keyHash,
  inviteToken: "rim_inv_AbC123",
  hostOrigin: "https://host.example:8443",
};
const text = `rim-invite:1:${link.hostServerId}:${link.hostKeyHash}:${link.inviteToken}:${link.hostOrigin}`;

describe("invite links", () => {
  it("reads a link, keeping the origin's colons", () => {
    expect(parseInviteLink(text)).toEqual(link);
    expect(formatInviteLink(link)).toBe(text);
    expect(isInviteLink(`  RIM-INVITE:1:x`)).toBe(true);
  });

  it("removes whitespace and ignores the scheme's case", () => {
    const wrapped = ` RIM-Invite:1:${link.hostServerId}\n:${link.hostKeyHash}:\t${link.inviteToken}:${link.hostOrigin}\r\n`;
    expect(parseInviteLink(wrapped)).toEqual(link);
  });

  it("refuses links over 400 characters", () => {
    const long = `${text.slice(0, -link.hostOrigin.length)}https://${"a".repeat(MAX_INVITE_LINK_LEN)}.example`;
    expect(() => parseInviteLink(long)).toThrow(InviteLinkError);
  });

  it("asks for a newer app for a later version", () => {
    expect(() => parseInviteLink(text.replace("invite:1:", "invite:2:"))).toThrow(/newer app/);
  });

  it.each([
    ["another scheme", text.replace("rim-invite:", "rim-contact:")],
    ["a missing part", `rim-invite:1:${link.hostServerId}:${link.hostKeyHash}:${link.inviteToken}`],
    ["a bad server id", text.replace(link.hostServerId, "rims1_short")],
    ["a principal id", text.replace("rims1_", "rimp1_")],
    ["a bad key hash", text.replace(link.hostKeyHash, "abc")],
    ["an empty token", text.replace(`:${link.inviteToken}:`, "::")],
    ["an origin with a path", `${text}/api`],
    ["an origin with a query", `${text}?x=1`],
    ["a non-http origin", text.replace("https://", "ftp://")],
    ["version zero", text.replace("invite:1:", "invite:0:")],
  ])("refuses %s", (_what, bad) => {
    expect(() => parseInviteLink(bad)).toThrow(InviteLinkError);
  });
});
