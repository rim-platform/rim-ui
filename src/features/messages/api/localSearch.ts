/**
 * Local message search, the pure half. Turns the search box's query into a
 * {@link LocalSearchQuery} for the cache's FTS5 index, local hits into `SearchMessageItem`s,
 * and merges them with the server's results.
 *
 * How local results are used:
 * - Offline (the server cannot be reached): each results page comes from the local index, with
 *   the same recency order and cursor as the server's.
 * - Online: the server's results, plus the local hits it did not return, inside the
 *   time range its loaded pages cover, from conversations the user's current channel and DM
 *   lists still show; never twice the same message.
 */

import type { ConversationSummary } from "../../conversations/types";
import type { LocalSearchHit, LocalSearchPage, LocalSearchQuery } from "./messageCache";
import type { SearchMessageItem, SearchResultPage } from "./useSearchMessages";

/** The conversations the user can see now, from the server's lists: names and types. */
export interface ConversationDirectory {
  byId: Map<string, { title: string | null; type: string }>;
  /** Lower-cased channel title → id, for `in:#name`. */
  idByName: Map<string, string>;
}

export function buildConversationDirectory(
  lists: (readonly ConversationSummary[] | undefined)[],
): ConversationDirectory {
  const byId = new Map<string, { title: string | null; type: string }>();
  const idByName = new Map<string, string>();
  for (const list of lists) {
    for (const c of list ?? []) {
      byId.set(c.id, { title: c.title ?? null, type: c.conversationType });
      if (c.title) idByName.set(c.title.toLowerCase(), c.id);
    }
  }
  return { byId, idByName };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` as UTC midnight in RFC 3339, or null for anything else. */
function utcMidnight(value: string): string | null {
  if (!DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.toISOString();
}

/**
 * The search box's query as a local search, following the server's operator grammar:
 * whitespace-separated `key:value` tokens with a known key and a usable value are operators,
 * everything else is free text.
 *
 * `null` when nothing can match: `in:` names no channel in `directory`, or names a different
 * conversation than the scope chip (the server intersects both too), or the query is empty.
 */
export function parseLocalSearchQuery(
  raw: string,
  scopeConversationId: string | undefined,
  directory: ConversationDirectory,
): LocalSearchQuery | null {
  const query: LocalSearchQuery = { text: "" };
  const words: string[] = [];
  let inConversation: string | undefined;
  let inUnresolved = false;

  for (const token of raw.trim().split(/\s+/)) {
    const colon = token.indexOf(":");
    const key = colon > 0 ? token.slice(0, colon).toLowerCase() : "";
    const value = colon > 0 ? token.slice(colon + 1) : "";
    if (!value) {
      if (token) words.push(token);
      continue;
    }
    switch (key) {
      case "from":
        query.from = value;
        break;
      case "in": {
        const name = value.replace(/^#/, "").toLowerCase();
        const id = directory.idByName.get(name) ?? (directory.byId.has(value) ? value : undefined);
        if (id) inConversation = id;
        else inUnresolved = true;
        break;
      }
      case "has": {
        const what = value.toLowerCase();
        if (what === "link") query.hasLink = true;
        else if (what === "attachment" || what === "file") query.hasAttachment = true;
        else words.push(token);
        break;
      }
      case "before":
      case "after": {
        const instant = utcMidnight(value);
        if (instant) query[key] = instant;
        else words.push(token);
        break;
      }
      default:
        words.push(token);
    }
  }

  if (inUnresolved) return null;
  if (inConversation && scopeConversationId && inConversation !== scopeConversationId) return null;
  const conversationId = scopeConversationId ?? inConversation;
  if (conversationId) query.conversationId = conversationId;
  query.text = words.join(" ");

  const hasFilter =
    query.conversationId !== undefined ||
    query.from !== undefined ||
    query.before !== undefined ||
    query.after !== undefined ||
    query.hasLink === true ||
    query.hasAttachment === true;
  if (!query.text && !hasFilter) return null;
  return query;
}

export function localHitToSearchItem(
  hit: LocalSearchHit,
  directory: ConversationDirectory,
): SearchMessageItem {
  const conversation = directory.byId.get(hit.conversationId);
  return {
    id: hit.id,
    serverId: hit.serverId,
    conversationId: hit.conversationId,
    conversationTitle: conversation?.title ?? null,
    conversationType: conversation?.type ?? "",
    threadId: hit.threadId,
    rootMessageId: hit.rootMessageId,
    authorId: hit.authorId,
    author: hit.author
      ? {
          id: hit.author.id,
          username: hit.author.username,
          displayName: hit.author.displayName ?? null,
          avatarUrl: hit.author.avatarUrl ?? null,
        }
      : null,
    text: hit.text,
    sentAt: hit.sentAt,
    rank: hit.rank,
    headline: hit.headline,
  };
}

/** A local page in the server's page shape, marked as local. */
export function localPageToSearchPage(
  page: LocalSearchPage,
  directory: ConversationDirectory,
): SearchResultPage {
  const items = page.items.map((hit) => localHitToSearchItem(hit, directory));
  const last = items[items.length - 1];
  const next = page.hasMore && last ? { sentAt: last.sentAt, messageId: last.id } : null;
  return {
    items,
    next,
    prev: null,
    pageInfo: { hasNext: next !== null, hasPrev: false },
    source: "local",
  };
}

/**
 * Microseconds since the epoch: the precision the server and the cache order by. `Date.parse`
 * keeps only milliseconds, which would tie messages the server tells apart.
 */
function sentAtMicros(sentAt: string): number {
  const fraction = /\.(\d+)/.exec(sentAt)?.[1] ?? "";
  return Date.parse(sentAt) * 1000 + Number(fraction.slice(3, 6).padEnd(3, "0"));
}

/** Newest first, the id breaking ties: the order of every search page. */
function newestFirst(a: SearchMessageItem, b: SearchMessageItem): number {
  const at = sentAtMicros(a.sentAt);
  const bt = sentAtMicros(b.sentAt);
  if (at !== bt) return bt - at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The loaded result pages as one list, with the local hits the pages did not return added in
 * recency order.
 *
 * A local hit is added only when
 * - no loaded page has it (by message id),
 * - its conversation is in `directory`, so a conversation the user lost access to and the cache
 *   has not heard about yet does not resurface (the cache drops it on its next sync),
 * - and it is no older than the oldest loaded result while more pages remain, so the list stays
 *   in order as pages load.
 *
 * Pages that are themselves local (offline) get nothing added.
 */
export function mergeSearchResults(
  pages: readonly SearchResultPage[],
  hasMore: boolean,
  localHits: readonly SearchMessageItem[],
  directory: ConversationDirectory,
): SearchMessageItem[] {
  const results = pages.flatMap((page) => page.items);
  if (localHits.length === 0 || pages.some((page) => page.source === "local")) return results;

  const seen = new Set(results.map((item) => item.id));
  const oldest = results[results.length - 1];
  const extra = localHits.filter(
    (hit) =>
      !seen.has(hit.id) &&
      directory.byId.has(hit.conversationId) &&
      (!hasMore || !oldest || newestFirst(hit, oldest) <= 0),
  );
  if (extra.length === 0) return results;

  // Slot the local hits in between the server's results without sorting those: the server's
  // order stands as given.
  extra.sort(newestFirst);
  const merged: SearchMessageItem[] = [];
  let next = 0;
  for (const result of results) {
    while (next < extra.length && newestFirst(extra[next], result) < 0) merged.push(extra[next++]);
    merged.push(result);
  }
  merged.push(...extra.slice(next));
  return merged;
}

/** Conversations of local hits that {@link mergeSearchResults} kept out as not visible. */
export function hiddenLocalConversations(
  localHits: readonly SearchMessageItem[],
  directory: ConversationDirectory,
): string[] {
  const hidden = new Set<string>();
  for (const hit of localHits) {
    if (!directory.byId.has(hit.conversationId)) hidden.add(hit.conversationId);
  }
  return [...hidden];
}
