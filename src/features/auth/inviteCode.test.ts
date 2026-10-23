import { describe, expect, it } from "vitest";

import { inviteCodeToken } from "./inviteCode";

describe("inviteCodeToken", () => {
  it.each([
    ["rim_inv_abc123", "rim_inv_abc123"],
    ["  rim_iinv_abc123 \n", "rim_iinv_abc123"],
    ["https://rim.example.org/join/rim_inv_abc123", "rim_inv_abc123"],
    ["http://localhost:8080/join/rim_inv_abc123/", "rim_inv_abc123"],
    ["https://rim.example.org/join/rim_inv_abc123?utm=mail#top", "rim_inv_abc123"],
    ["https://rim.example.org/sub/path/join/rim_iinv_x", "rim_iinv_x"],
    ["https://rim.example.org/join/rim_inv_a%2Bb", "rim_inv_a+b"],
    ["https://rim.example.org/join/\nrim_inv_split", "rim_inv_split"],
    ["https://rim.example.org/join/rim_inv_%E0%A4%A", "rim_inv_%E0%A4%A"],
  ])("reads %j as the token %j", (text, token) => {
    expect(inviteCodeToken(text)).toEqual({ kind: "token", token });
  });

  it("reads a blank field as empty", () => {
    expect(inviteCodeToken("")).toEqual({ kind: "empty" });
    expect(inviteCodeToken(" \n\t")).toEqual({ kind: "empty" });
  });

  it("tells an invite to a workspace on another server apart", () => {
    expect(inviteCodeToken("rim-invite:1:rims1_x:hash:rim_inv_abc:https://host.example")).toEqual({
      kind: "remote",
    });
    expect(inviteCodeToken(" RIM-INVITE:1:rims1_x:hash:tok:https://host.example")).toEqual({
      kind: "remote",
    });
  });

  it.each([
    ["rim_pjl_AAAAAAAAAAAAAAAAAAAAAA", "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA"],
    [
      "https://rim.example.org/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA\n",
      "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA",
    ],
  ])("tells a workspace's public link %j apart from an invite", (text, token) => {
    expect(inviteCodeToken(text)).toEqual({ kind: "publicLink", token });
  });
});
