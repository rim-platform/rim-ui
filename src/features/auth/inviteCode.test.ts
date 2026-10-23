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

  const OWN = ["https://rim.example.org", "https://api.rim.example.org"];
  const TOKEN = "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";

  it.each([
    [TOKEN],
    [`https://rim.example.org/join/${TOKEN}\n`],
    [`https://api.rim.example.org/join/${TOKEN}`],
    [`https://rim.example.org/sub/join/${TOKEN}?from=site`],
  ])("tells a public link of this server %j apart from an invite", (text) => {
    expect(inviteCodeToken(text, OWN)).toEqual({
      kind: "publicLink",
      token: TOKEN,
      hostOrigin: null,
    });
  });

  it.each([
    [`https://other.example/join/${TOKEN}`, "https://other.example"],
    [`  https://other.example:8443/join/${TOKEN}/\n`, "https://other.example:8443"],
    [`http://rim.example.org:8080/join/${TOKEN}`, "http://rim.example.org:8080"],
  ])("reads %j as a public link of the server at %j", (text, hostOrigin) => {
    expect(inviteCodeToken(text, OWN)).toEqual({ kind: "publicLink", token: TOKEN, hostOrigin });
  });

  it("compares a link's origin with this app's own server by default", () => {
    expect(inviteCodeToken(`${window.location.origin}/join/${TOKEN}`)).toMatchObject({
      hostOrigin: null,
    });
    expect(inviteCodeToken(`https://other.example/join/${TOKEN}`)).toMatchObject({
      hostOrigin: "https://other.example",
    });
  });

  it("keeps an invite link of another origin a token of this server", () => {
    expect(inviteCodeToken("https://other.example/join/rim_inv_x", OWN)).toEqual({
      kind: "token",
      token: "rim_inv_x",
    });
  });
});
