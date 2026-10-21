# Search UI

Covers the frontend of full-text message search: the paginated
`useSearchMessages` hook, the `SearchOverlay` flat-list UI, `SearchSnippet`'s
sanitization, and the operator-discovery affordance. Backend contract and operator
semantics: `../rim-server/docs/search.md`.

## Recency ordering, not relevance

`searchMessages` results are paginated by **recency** (`sentAt DESC, id DESC`), the
same cursor contract as every other message list — **not** by `rank`. Each result
still carries a `rank` (`ts_rank`) field, but it's display-only. This is a deliberate
backend tradeoff: cursor pagination needs a stable, unique total order, and `ts_rank`
is neither unique nor stable across concurrent inserts, so paginating by it would
produce skips and duplicate rows across pages. See
`../rim-server/docs/search.md`'s "Ranking vs. pagination" section for the full
rationale.

**UI implication:** don't present results as "best match first" — they're
"most recent first". `rank` is available on `SearchMessageItem` if a future UI wants
a secondary sort *within* an already-loaded page, but nothing does that today.

## Flat list, not grouped by conversation

The previous UI grouped results by conversation (`ResultGroup`, with a `Tab`-to-next-
group keyboard shortcut). That assumed the whole result set was present at once.
With recency-ordered cursor pagination, a single conversation's hits can span
multiple pages — grouping across an incrementally-loading list fragments and
reorders as more pages load. `SearchOverlay` now renders a flat, recency-ordered
list; each row shows its conversation label (`# general` / `@ dm`) inline instead of
under a group header. The `Tab`-next-group shortcut was removed along with grouping;
`↑`/`↓`/`Enter`/`Esc` remain.

## Pagination UX

`useSearchMessages` is a `useInfiniteQuery` over `SearchResultPage`. `SearchOverlay`:

- Auto-prefetches the next page (`fetchNextPage()`) once the keyboard-selected row is
  within 5 of the last loaded item, so scrolling/navigating through results feels
  continuous.
- Always renders an explicit **"Load more"** row at the list end while
  `hasNextPage` is true — a click/keyboard fallback for when the auto-prefetch
  hasn't fired (e.g. pure mouse hovering, which never moves the keyboard selection
  index). It's a normal keyboard-navigable row: `↓` can select it, `Enter` fetches
  the next page instead of jumping to a message.
- Selection resets when the user starts a **new search** (the raw query changes),
  not when a page is appended — resetting on every page load would fight in-progress
  keyboard navigation.

## Snippet rendering — DOMPurify `mark`-only sanitization (security-critical)

`SearchResultMessage.headline` is a server-generated `ts_headline` snippet
containing literal `<mark>…</mark>` tags around matched terms — but the *surrounding
text* is raw, unsanitized user message content, which may itself contain arbitrary
markup an attacker embedded in a message (`<img onerror=...>`, `<script>`, etc.).
`SearchSnippet` (`src/features/messages/components/SearchSnippet.tsx`) sanitizes with:

```ts
DOMPurify.sanitize(headline, { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] });
```

This strips every tag except a bare `<mark>` and strips all attributes (including on
`<mark>` itself, so an attacker can't smuggle `onclick` or similar through it),
neutralizing injection while preserving the highlight markers. This is the one
sanctioned DOMPurify-for-HTML pattern applied to search snippets — see
`CLAUDE.md`'s "DOMPurify on all user-generated HTML" rule and
`src/shared/ui/MarkdownRenderer.tsx` for the sibling pattern used for message bodies.

There is **no client-side substring highlighting** — the server headline is the
single source of truth for match highlighting. When `headline` is `null` (a purely
operator-based query with no free-text component, e.g. `from:@alice`), `SearchSnippet`
falls back to the plain `text`, rendered as ordinary React children (auto-escaped, no
highlight — there's nothing server-side to highlight).

## Local search (desktop app)

The desktop app also searches its encrypted local message cache (`docs/local-message-cache.md`,
"Local search"). The behaviour, kept deliberately simple:

- **Server unreachable** (a network failure or a 5xx, the same rule the timeline uses): each
  results page comes from the local index, with the same recency order and cursor, so paging
  works the same. The overlay says it is showing matches saved on this device. An answer the
  server gave (a GraphQL error, a 401) is never replaced with local results.
- **Online**: the server's results as before, plus local matches the server did not return
  (`mergeSearchResults` in `api/localSearch.ts`). A local match is added only if no loaded page
  has the same message id, its conversation is in the channel or DM lists the server returned
  now, and, while more server pages remain, it is no older than the oldest loaded result, so the
  list stays in recency order as pages load. Up to the 100 newest local matches are considered.
  In practice this adds prefix matches (`depl` finds `deploy`) the server's stemmed search misses.
- A local match from a conversation the lists no longer show is left out and that conversation is
  synced again, which drops it from the cache if access was lost. The lists are the first pages
  the sidebar loads (100 channels, 50 DMs), so online, a match in a DM older than the 50 most
  recent is left out too (offline pages are not filtered by the lists).
- Local snippets are escaped by the cache before the `<mark>` tags are added, then go through
  the same `SearchSnippet` sanitization.
- The operators are parsed in the client for local search only (`parseLocalSearchQuery`), with
  the server's grammar; `in:#name` resolves against the channel lists, and an unknown channel
  matches nothing, as on the server. Server queries still pass the text through unchanged.
- The web app has no cache and behaves as before.

## Operator discovery

The `from:`/`in:`/`has:link`/`has:attachment`/`before:`/`after:` operators are parsed
**server-side** for server search; the frontend passes `query` through unchanged (the
only client parser is the local-search one above, deliberately conservative — see `../rim-server/docs/search.md` for the exact
grammar). Discoverability is handled two ways:

- The search input's placeholder hints at the syntax directly:
  `Search — try from:@user, in:#channel, has:link, before:2026-01-01`.
- Typing an operator's value suggests values (`searchSuggestions.ts`). `from:` lists members
  by display name or handle and inserts the member's whole handle when the app knows it
  (`from:@ada:example.org`, which the server resolves here or elsewhere), else
  `from:@<username>`; a person from another server whose handle is not known yet is not listed,
  so no internal `r_…` name is ever offered.
- An info (`?`-style) icon button in the input row toggles a static "Search
  operators" legend popover listing each operator with a one-line example. It has no
  state beyond open/closed, and `Esc` closes it before falling through to clearing
  the query or closing the overlay (tips → query → overlay).

The existing scope chip (All / current channel) is unchanged and sets an explicit
`conversationId` on the query input; it **coexists** with an in-query `in:#x`
operator rather than being unified with it — the backend intersects both. See the
comment above `conversationId` in `SearchOverlay.tsx`.
