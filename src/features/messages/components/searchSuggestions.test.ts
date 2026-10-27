import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { makeConversation, workspaceMembers } from "../../conversations/__fixtures__/conversations";
import { buildConversationDirectory } from "../api/localSearch";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import {
  MAX_SUGGESTIONS,
  applySuggestion,
  computeSuggestions,
  useOperatorSuggestions,
  findActiveToken,
  type ActiveToken,
} from "./searchSuggestions";

const [me, alice, bob] = workspaceMembers;

function member(username: string, displayName: string | null): ServerMember {
  return { ...alice, userId: `u-${username}`, username, displayName };
}

const directory = buildConversationDirectory([
  [
    makeConversation({ id: "c-general", title: "general" }),
    makeConversation({ id: "c-dev", title: "dev-general" }),
    makeConversation({ id: "c-ops", title: "ops" }),
    makeConversation({ id: "c-spaced", title: "team news" }),
    makeConversation({
      id: "c-dm",
      title: "general dm",
      conversationType: ConversationTypeEnum.DIRECT,
    }),
  ],
]);

function token(query: string, caret = query.length): ActiveToken {
  const found = findActiveToken(query, caret);
  if (!found) throw new Error(`no operator token at ${caret} in "${query}"`);
  return found;
}

const NOW = new Date(2026, 9, 13, 15, 30);

describe("findActiveToken", () => {
  it("finds the operator token around a caret in the middle of the query", () => {
    const query = "deploy from:@al in:#ops";
    expect(findActiveToken(query, "deploy from:@al".length)).toEqual({
      key: "from",
      prefix: "al",
      start: 7,
      end: 15,
    });
  });

  it("takes the prefix up to the caret when the caret is inside a value", () => {
    expect(findActiveToken("in:#general", "in:#gen".length)).toMatchObject({
      key: "in",
      prefix: "gen",
      start: 0,
      end: 11,
    });
  });

  it("finds a bare operator with no value", () => {
    expect(findActiveToken("from:", 5)).toMatchObject({ key: "from", prefix: "" });
    expect(findActiveToken("has:", 4)).toMatchObject({ key: "has", prefix: "" });
  });

  it("finds nothing after a space, inside the key, or in free text and unknown keys", () => {
    expect(findActiveToken("from:@alice ", 12)).toBeNull();
    expect(findActiveToken("from:@alice", 2)).toBeNull();
    expect(findActiveToken("deploy", 3)).toBeNull();
    expect(findActiveToken("to:@alice", 9)).toBeNull();
    expect(findActiveToken("FROM:@alice", 11)).toBeNull();
  });
});

describe("computeSuggestions", () => {
  it("lists every member for a bare from:, by name", () => {
    const rows = computeSuggestions(token("from:"), workspaceMembers, directory);
    expect(rows.map((r) => r.label)).toEqual(["Alice", "Bob", "Me Myself"]);
    expect(rows[0]).toMatchObject({ detail: "@alice", insert: "from:@alice" });
  });

  it("matches a member by a word prefix of the display name or the username", () => {
    const members = [me, alice, bob, member("carol", "Carol Bobbins")];
    const byDisplay = computeSuggestions(token("from:@myself"), members, directory);
    expect(byDisplay.map((r) => r.insert)).toEqual(["from:@me"]);

    const byUsername = computeSuggestions(token("from:@CAR"), members, directory);
    expect(byUsername.map((r) => r.insert)).toEqual(["from:@carol"]);
  });

  it("inserts a member's whole handle where it reads, and leaves out r_ names without one", () => {
    const members = [
      { ...member("kuba", "Kuba"), handle: { shown: "@kuba", copied: "@kuba:rim.example" } },
      {
        ...member("r_abcdef", "Ada"),
        handle: { shown: "@ada:elsewhere.example", copied: "@ada:elsewhere.example" },
      },
      { ...member("r_ghijkl", null), handle: null },
    ];
    const rows = computeSuggestions(token("from:"), members, directory);
    expect(rows.map((r) => [r.label, r.detail, r.insert])).toEqual([
      ["Ada", "@ada:elsewhere.example", "from:@ada:elsewhere.example"],
      ["Kuba", "@kuba", "from:@kuba:rim.example"],
    ]);
    const byDomain = computeSuggestions(token("from:@ada:else"), members, directory);
    expect(byDomain.map((r) => r.id)).toEqual(["u-r_abcdef"]);
  });

  it("drops a member whose handle is typed in full without the own domain", () => {
    const members = [
      { ...member("kuba", "Kuba"), handle: { shown: "@kuba", copied: "@kuba:rim.example" } },
    ];
    const { result } = renderHook(() =>
      useOperatorSuggestions("from:@kuba", "from:@kuba".length, members, directory),
    );
    expect(result.current.suggestions).toEqual([]);
    const partial = renderHook(() =>
      useOperatorSuggestions("from:@ku", "from:@ku".length, members, directory),
    );
    expect(partial.result.current.suggestions.map((r) => r.insert)).toEqual([
      "from:@kuba:rim.example",
    ]);
  });

  it("orders members by match position, then by name, at most eight", () => {
    const members = [
      member("aaron", "Aaron Bobson"),
      member("zed", "Bobby Z"),
      bob,
      ...Array.from({ length: 10 }, (_, i) => member(`bot${i}`, null)),
    ];
    const rows = computeSuggestions(token("from:bo"), members, directory);
    expect(rows).toHaveLength(MAX_SUGGESTIONS);
    expect(rows.slice(0, 3).map((r) => r.label)).toEqual(["Bob", "Bobby Z", "bot0"]);
    expect(rows.map((r) => r.label)).not.toContain("Aaron Bobson");

    const narrower = computeSuggestions(token("from:bob"), members, directory);
    expect(narrower.map((r) => r.label)).toEqual(["Bob", "Bobby Z", "Aaron Bobson"]);
  });

  it("lists the visible channels for in:, filtered and ordered like members", () => {
    expect(computeSuggestions(token("in:#"), [], directory).map((r) => r.label)).toEqual([
      "#dev-general",
      "#general",
      "#ops",
      "#team news",
    ]);
    expect(computeSuggestions(token("in:gen"), [], directory).map((r) => r.insert)).toEqual([
      "in:#general",
      "in:#dev-general",
    ]);
  });

  it("inserts a channel whose title has a space by its id", () => {
    expect(computeSuggestions(token("in:#team"), [], directory)).toEqual([
      { id: "c-spaced", label: "#team news", insert: "in:c-spaced" },
    ]);
  });

  it("lists the has: values the server accepts, filtered by prefix", () => {
    expect(computeSuggestions(token("has:"), [], directory).map((r) => r.insert)).toEqual([
      "has:link",
      "has:attachment",
      "has:file",
    ]);
    expect(computeSuggestions(token("has:a"), [], directory).map((r) => r.insert)).toEqual([
      "has:attachment",
    ]);
  });

  it("offers today's date as the format for an empty before: or after:, and nothing once typed", () => {
    expect(computeSuggestions(token("after:"), [], directory, NOW)).toEqual([
      { id: "date", label: "YYYY-MM-DD", detail: "today: 2026-10-13", insert: "after:2026-10-13" },
    ]);
    expect(computeSuggestions(token("before:20"), [], directory, NOW)).toEqual([]);
  });
});

describe("applySuggestion", () => {
  it("replaces the whole token with the canonical form, a space, and the caret after it", () => {
    const query = "deploy from:al";
    expect(applySuggestion(query, token(query, 12), "from:@alice")).toEqual({
      query: "deploy from:@alice ",
      caret: 19,
    });
  });

  it("reuses the space after a token in the middle of the query", () => {
    const query = "in:#ge deploy";
    expect(applySuggestion(query, token(query, 6), "in:#general")).toEqual({
      query: "in:#general deploy",
      caret: 12,
    });
  });
});
