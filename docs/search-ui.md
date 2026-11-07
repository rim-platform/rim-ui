# Search UI

Covers the frontend of full-text message search: the paginated
`useSearchMessages` hook, the `SearchOverlay` flat-list UI, `SearchSnippet`'s
sanitization, and the operator-discovery affordance. Backend contract and operator
semantics: `../rim-server/docs/search.md`.

## The search box

The top bar's search field opens the search box under it. It is the command palette's dialog
(`CommandPalette.tsx`) with search first: <kbd>Ctrl+Shift+F</kbd> (`workspace.open_search`) and a
click on the field open it so, and <kbd>Ctrl+K</kbd> (`workspace.open_command_palette`) opens the
same box with commands first. Typing <kbd>&gt;</kbd> at the start, or <kbd>Ctrl+K</kbd> in an
open box, switches it to commands; <kbd>Backspace</kbd> in an empty field switches back.

While you type, the results come in three groups, at most 5 each:

1. **Channels and people**: the conversations of the scope, by name, from the lists the
   conversation list and the palette's pickers already hold.
2. **Messages**: the newest matches from the server search below, after the same 300 ms pause.
   In one workspace, this is the search `SearchOverlay` runs (`useMessageSearchResults`), with
   this device's local matches added in the desktop app.
3. **Commands**: the palette's own list and ranking.

**Scope.** The chip beside the field shows it: the open workspace, the direct messages in the
direct space, or All workspaces. <kbd>Tab</kbd> or a click on the chip switches between the open
workspace and all of them; from Home and Unreads the box starts with all of them. Across
workspaces, Channels and people also lists the channels joined in every workspace on the rail,
the direct messages and the workspaces.

Messages across workspaces asks each workspace for its 5 newest matches and shows the 5 newest of
all, from the server only, with these limits:

- It waits for at least 2 characters and the 300 ms pause; below that it says "Type at least 2
  characters to search messages in every workspace." A new text aborts the requests still
  running (the query client's abort signal).
- It asks at most 10 workspaces per pause: the open one first, then the rest in rail order
  (Direct messages, this server's workspaces, then other servers'). Past 10 it says "Searched 10
  of your \<n\> workspaces. Pick one to search the rest."
- A workspace that fails, or does not answer within 8 seconds, leaves the others' results and
  adds a line naming it, such as "Couldn't search Pixel Guild."; it never shows an error toast.
- Each request goes to its workspace's own host, as the overlay's does
  (`fetchMessageSearchPage`, routed by the client's space router), never through another
  server. The timeout also ends the wait for a workspace on another server, whose transport does
  not take the abort signal.

**Encrypted conversations.** The server cannot search them, so the box says what it covers under
Messages. In the web app, which keeps no copy of them: "Encrypted messages can't be searched in
the web app." In the desktop app, in one workspace: "Encrypted messages: only those saved on this
device."; across workspaces, where the local index is not asked: "Encrypted messages are searched
one workspace at a time." With the server out of reach, it says it is showing matches saved on
this device, as the overlay does.

**Keys.** The field is a combobox: the arrow keys move through every row of every group, the
active row is its `aria-activedescendant`, each group is announced by its title, <kbd>Enter</kbd>
opens the row (a conversation, a workspace, a message in its conversation, or runs the command)
and <kbd>Esc</kbd> closes the box. The footer reads "Enter open · Tab all workspaces · >
commands only", and **Search all messages** opens `SearchOverlay`, below, with the text as typed,
filters included. <kbd>Ctrl+F</kbd> (`workspace.search_in_channel`) still opens the overlay on
the open conversation.

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

## Snippet rendering — DOMPurify `mark`-only parse, plain text out (security-critical)

A snippet comes from one of two sources, both with literal `<mark>…</mark>` tags around the
matched terms: the server's `SearchResultMessage.headline`, a `ts_headline` over the raw
message text, and the desktop cache's FTS5 snippet, whose text is HTML-escaped before the marks
go in. In both, the *surrounding text* is user message content, which may contain arbitrary
markup an attacker embedded in a message (`<img onerror=...>`, `<script>`, etc.) and Markdown
syntax (code fences, emphasis, links). `SearchSnippet`
(`src/features/messages/components/SearchSnippet.tsx`) handles both the same way:

1. **Parse.** DOMPurify parses the headline into a DOM fragment:

   ```ts
   DOMPurify.sanitize(headline, {
     ALLOWED_TAGS: ["mark"],
     ALLOWED_ATTR: [],
     RETURN_DOM_FRAGMENT: true,
   });
   ```

   Every tag except a bare `<mark>` and every attribute is stripped, and HTML entities decode,
   so the desktop cache's `&lt;b&gt;` reads as `<b>` like the server's raw text does.
2. **Flatten.** Only the fragment's text is read. Each `<mark>`'s text is wrapped in two
   private-use characters (U+E000 and U+E001) and any such characters in the message text
   itself are dropped, so the highlights survive as plain text.
3. **Name mentions.** `plainMessagePreview` (`src/features/messages/utils/snippetText.ts`) turns
   each mention token `<@id>` into `@` and the member's display name from the workspace member
   lookup the overlay already holds (`@member` for an id that names no member; the id of an
   encrypted message's mention is a principal id, which the overlay maps to the member). A
   highlight inside a token's id is dropped, one around the whole token stays. A snippet is cut
   at both ends, so what the cut left of a token there (its id and `>` without the `<@` at the
   start, `<`, `<@` or `<@` and part of an id at the end) becomes the member's name when the id
   is whole and known, and is dropped otherwise.
4. **Strip Markdown.** `plainSnippet` (same file) removes code fences with their info string,
   backticks, `**`, `__`, `~~`, single `*` and `_` at word edges (so `snake_case` stays),
   heading, quote and list markers at the start of a line, and link and image syntax (keeping
   their text), then collapses whitespace to single spaces.
5. **Render.** The text splits on the highlight characters into React text and `<mark>` nodes;
   an empty mark is dropped. No HTML from the snippet ever reaches the page and there is no
   `dangerouslySetInnerHTML`.

This is the DOMPurify pattern applied to search snippets — see `CLAUDE.md`'s "DOMPurify on all
user-generated HTML" rule and `src/shared/ui/MarkdownRenderer.tsx` for the sibling pattern used
for message bodies.

There is **no client-side substring highlighting** — the snippet is the single source of
truth for match highlighting. When `headline` is `null` (a purely operator-based query with no
free-text component, e.g. `from:@alice`), `SearchSnippet` falls back to the message `text` with
its mentions named and its Markdown removed the same way, rendered as ordinary React children
(auto-escaped, no highlight — there's nothing to highlight).

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
