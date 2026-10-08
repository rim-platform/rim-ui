import { describe, it, expect } from "vitest";

import type { ConversationSummary } from "../../conversations/types";
import {
  buildConversationDirectory,
  hiddenLocalConversations,
  localPageToSearchPage,
  mergeSearchResults,
  parseLocalSearchQuery,
} from "./localSearch";
import type { LocalSearchHit } from "./messageCache";
import type { SearchMessageItem, SearchResultPage } from "./useSearchMessages";

const directory = buildConversationDirectory([
  [
    { id: "c-general", title: "General", conversationType: "CHANNEL" },
    { id: "c-ops", title: "ops", conversationType: "CHANNEL" },
  ] as ConversationSummary[],
  undefined,
  [{ id: "c-dm", title: null, conversationType: "DIRECT" }] as unknown as ConversationSummary[],
]);

function item(id: string, sentAt: string, conversationId = "c-general"): SearchMessageItem {
  return {
    id,
    serverId: "ws-1",
    conversationId,
    conversationTitle: null,
    conversationType: "CHANNEL",
    threadId: null,
    rootMessageId: null,
    authorId: "u1",
    author: null,
    text: id,
    sentAt,
    rank: 0,
    headline: null,
  };
}

function page(items: SearchMessageItem[], source?: "local"): SearchResultPage {
  return {
    items,
    next: null,
    prev: null,
    pageInfo: { hasNext: false, hasPrev: false },
    source,
  };
}

describe("parseLocalSearchQuery", () => {
  it("passes free text through and reads the server's operators", () => {
    expect(
      parseLocalSearchQuery(
        'deploy "rolled back" from:@alice in:#OPS has:link has:file after:2026-06-01 before:2026-07-01',
        undefined,
        directory,
      ),
    ).toEqual({
      text: 'deploy "rolled back"',
      from: "@alice",
      conversationId: "c-ops",
      hasLink: true,
      hasAttachment: true,
      after: "2026-06-01T00:00:00.000Z",
      before: "2026-07-01T00:00:00.000Z",
    });
  });

  it("treats unknown keys, empty values and bad dates as free text", () => {
    expect(
      parseLocalSearchQuery("http://x.org note: has:pdf before:2026-13-40", undefined, directory),
    ).toEqual({ text: "http://x.org note: has:pdf before:2026-13-40" });
  });

  it("accepts a conversation id for in:", () => {
    expect(parseLocalSearchQuery("in:c-dm", undefined, directory)).toEqual({
      text: "",
      conversationId: "c-dm",
    });
  });

  it("matches nothing for an unknown channel, a scope conflict, or an empty query", () => {
    expect(parseLocalSearchQuery("x in:#nowhere", undefined, directory)).toBeNull();
    expect(parseLocalSearchQuery("x in:#ops", "c-general", directory)).toBeNull();
    expect(parseLocalSearchQuery("   ", undefined, directory)).toBeNull();
  });

  it("applies the scope chip", () => {
    expect(parseLocalSearchQuery("x in:#general", "c-general", directory)).toEqual({
      text: "x",
      conversationId: "c-general",
    });
    expect(parseLocalSearchQuery("", "c-general", directory)).toEqual({
      text: "",
      conversationId: "c-general",
    });
  });
});

describe("localPageToSearchPage", () => {
  it("names the conversation and continues from the last hit", () => {
    const hit: LocalSearchHit = {
      id: "m1",
      serverId: "ws-1",
      conversationId: "c-general",
      threadId: null,
      rootMessageId: null,
      authorId: "u1",
      author: { id: "u1", username: "ada", displayName: null, avatarUrl: null },
      text: "hello",
      sentAt: "2026-10-08T10:00:00Z",
      rank: 1.5,
      headline: "<mark>hello</mark>",
    };
    const result = localPageToSearchPage({ items: [hit], hasMore: true }, directory);
    expect(result.source).toBe("local");
    expect(result.items[0]).toMatchObject({
      conversationTitle: "General",
      conversationType: "CHANNEL",
      headline: "<mark>hello</mark>",
      author: { username: "ada" },
    });
    expect(result.next).toEqual({ sentAt: "2026-10-08T10:00:00Z", messageId: "m1" });
    expect(result.pageInfo.hasNext).toBe(true);

    expect(localPageToSearchPage({ items: [], hasMore: false }, directory).next).toBeNull();
  });
});

describe("mergeSearchResults", () => {
  const server = [item("s3", "2026-10-08T10:03:00Z"), item("s2", "2026-10-08T10:02:00Z")];

  it("adds unseen local hits in recency order, once", () => {
    const merged = mergeSearchResults(
      [page(server)],
      false,
      [
        item("s3", "2026-10-08T10:03:00Z"),
        item("l4", "2026-10-08T10:04:00Z"),
        item("l1", "2026-10-08T10:01:00Z"),
      ],
      directory,
    );
    expect(merged.map((m) => m.id)).toEqual(["l4", "s3", "s2", "l1"]);
  });

  it("holds back local hits older than the loaded pages while more pages remain", () => {
    const merged = mergeSearchResults(
      [page(server)],
      true,
      [item("l4", "2026-10-08T10:04:00Z"), item("l1", "2026-10-08T10:01:00Z")],
      directory,
    );
    expect(merged.map((m) => m.id)).toEqual(["l4", "s3", "s2"]);
  });

  it("drops local hits from conversations the user cannot see now", () => {
    const hits = [item("l4", "2026-10-08T10:04:00Z", "c-left")];
    expect(mergeSearchResults([page(server)], false, hits, directory).map((m) => m.id)).toEqual([
      "s3",
      "s2",
    ]);
    expect(hiddenLocalConversations(hits, directory)).toEqual(["c-left"]);
    expect(
      mergeSearchResults(
        [page([])],
        false,
        [item("l1", "2026-10-08T10:01:00Z")],
        buildConversationDirectory([]),
      ),
    ).toEqual([]);
  });

  it("adds nothing to pages that already came from the local index", () => {
    const local = [item("l1", "2026-10-08T10:01:00Z")];
    expect(
      mergeSearchResults(
        [page(local, "local")],
        false,
        [item("l9", "2026-10-08T10:09:00Z")],
        directory,
      ),
    ).toEqual(local);
  });
});
