import { useMemo } from "react";

import { viewHandle, type HandleView } from "../../../shared/utils/handles";
import type { ConversationDirectory } from "../api/localSearch";

/** A workspace member as `from:` offers them. */
export interface SearchMember {
  userId: string;
  username: string;
  displayName: string | null;
  /** How their handle reads; derived from `username` when absent. */
  handle?: HandleView | null;
}

/** The search operators the server understands. */
export type OperatorKey = "from" | "in" | "has" | "before" | "after";

const OPERATOR = /^(from|in|has|before|after):/;

/** The element id of the suggestion popover, for the input's `aria-controls`. */
export const SEARCH_SUGGESTIONS_ID = "search-operator-suggestions";

/** Most rows the suggestion popover shows. */
export const MAX_SUGGESTIONS = 8;

/** The operator token the caret sits in: its key, the value typed before the caret, and its span. */
export interface ActiveToken {
  key: OperatorKey;
  /** The value from just after the colon up to the caret, without a leading `@` or `#`. */
  prefix: string;
  /** Index of the token's first character in the query. */
  start: number;
  /** Index just past the token's last character in the query. */
  end: number;
}

/** One row of the suggestion popover; picking it replaces the active token with `insert`. */
export interface Suggestion {
  id: string;
  label: string;
  detail?: string;
  insert: string;
}

/**
 * The operator token at `caret`, or null when the caret is not in the value part of one.
 *
 * Tokens are whitespace-separated, like the server's parser. The caret counts as inside a token
 * from just after its colon to just after its last character, so `from:|` and `from:@al|ice`
 * both find `from`, while a caret after a space or inside the key (`fr|om:`) finds nothing.
 */
export function findActiveToken(query: string, caret: number): ActiveToken | null {
  const at = Math.max(0, Math.min(caret, query.length));
  let start = at;
  while (start > 0 && !/\s/.test(query[start - 1])) start--;
  let end = at;
  while (end < query.length && !/\s/.test(query[end])) end++;

  const match = OPERATOR.exec(query.slice(start, end));
  if (!match) return null;
  const valueStart = start + match[0].length;
  if (at < valueStart) return null;

  const key = match[1] as OperatorKey;
  let prefix = query.slice(valueStart, at);
  if (key === "from") prefix = prefix.replace(/^@/, "");
  if (key === "in") prefix = prefix.replace(/^#/, "");
  return { key, prefix, start, end };
}

/**
 * Where `prefix` starts a word of `text`, case-insensitively: at the start or after a character
 * that is not a letter or digit. -1 when it starts none.
 */
function wordMatchPosition(text: string, prefix: string): number {
  const haystack = text.toLowerCase();
  const needle = prefix.toLowerCase();
  if (!needle) return 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return -1;
    if (index === 0 || !/[\p{L}\p{N}]/u.test(haystack[index - 1])) return index;
    from = index + 1;
  }
}

/** Candidates whose texts have a word starting with `prefix`, best match first, then by name. */
function rank<T>(
  items: readonly T[],
  prefix: string,
  texts: (item: T) => (string | null | undefined)[],
  name: (item: T) => string,
): T[] {
  const scored: { item: T; position: number; name: string }[] = [];
  for (const item of items) {
    const positions = texts(item)
      .filter((text): text is string => Boolean(text))
      .map((text) => wordMatchPosition(text, prefix))
      .filter((position) => position >= 0);
    if (positions.length > 0) {
      scored.push({ item, position: Math.min(...positions), name: name(item) });
    }
  }
  scored.sort(
    (a, b) =>
      a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return scored.slice(0, MAX_SUGGESTIONS).map((entry) => entry.item);
}

/** The values `has:` accepts, with what each one finds. */
const HAS_VALUES: { value: string; detail: string }[] = [
  { value: "link", detail: "Messages containing a URL" },
  { value: "attachment", detail: "Messages with an attachment" },
  { value: "file", detail: "Same as attachment" },
];

/** Today's local date as `YYYY-MM-DD`. */
function today(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The suggestions for `token`.
 *
 * `from:` lists members by display name or handle and inserts their whole handle when it is
 * known, else `from:@<username>`; a member with neither (a person from another server whose
 * handle is not known) is not listed. `in:` lists
 * the channels in `directory` and inserts `in:#<title>`, or `in:<id>` for a title with a space,
 * which a whitespace-separated query cannot carry; `has:` lists its values; `before:` and
 * `after:` with no value offer today's date as a `YYYY-MM-DD` example.
 */
export function computeSuggestions(
  token: ActiveToken,
  members: readonly SearchMember[],
  directory: ConversationDirectory,
  now: Date = new Date(),
): Suggestion[] {
  switch (token.key) {
    case "from": {
      const listed = members.flatMap((m) => {
        const handle = m.handle === undefined ? viewHandle(m.username, null, null) : m.handle;
        return handle ? [{ member: m, handle }] : [];
      });
      return rank(
        listed,
        token.prefix,
        ({ member, handle }) => [handle.shown.slice(1), member.displayName],
        ({ member, handle }) => member.displayName || handle.shown.slice(1),
      ).map(({ member, handle }) => ({
        id: member.userId,
        label: member.displayName || handle.shown.slice(1),
        detail: handle.shown,
        insert: `from:${handle.copied}`,
      }));
    }
    case "in": {
      const channels: { id: string; title: string }[] = [];
      for (const [id, entry] of directory.byId) {
        if (entry.type === "CHANNEL" && entry.title) channels.push({ id, title: entry.title });
      }
      return rank(
        channels,
        token.prefix,
        (c) => [c.title],
        (c) => c.title,
      ).map((c) => ({
        id: c.id,
        label: `#${c.title}`,
        insert: /\s/.test(c.title) ? `in:${c.id}` : `in:#${c.title}`,
      }));
    }
    case "has": {
      const prefix = token.prefix.toLowerCase();
      return HAS_VALUES.filter((h) => h.value.startsWith(prefix)).map((h) => ({
        id: h.value,
        label: h.value,
        detail: h.detail,
        insert: `has:${h.value}`,
      }));
    }
    case "before":
    case "after": {
      if (token.prefix) return [];
      const date = today(now);
      return [
        {
          id: "date",
          label: "YYYY-MM-DD",
          detail: `today: ${date}`,
          insert: `${token.key}:${date}`,
        },
      ];
    }
  }
}

/**
 * The query with `token` replaced by `insert` and a space after it, and the caret just past that
 * space. A space already following the token is reused rather than doubled.
 */
export function applySuggestion(
  query: string,
  token: ActiveToken,
  insert: string,
): { query: string; caret: number } {
  const before = query.slice(0, token.start);
  const rest = query.slice(token.end);
  const caret = before.length + insert.length + 1;
  if (/^\s/.test(rest)) return { query: before + insert + rest, caret };
  return { query: `${before}${insert} ${rest}`, caret };
}

/** The operator token at the caret and the suggestions for it; no suggestions outside a token. */
export function useOperatorSuggestions(
  query: string,
  caret: number,
  members: readonly SearchMember[],
  directory: ConversationDirectory,
): { token: ActiveToken | null; suggestions: Suggestion[] } {
  return useMemo(() => {
    const token = findActiveToken(query, caret);
    return { token, suggestions: token ? computeSuggestions(token, members, directory) : [] };
  }, [query, caret, members, directory]);
}
