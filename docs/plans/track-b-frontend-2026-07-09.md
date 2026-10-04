# Track B Foundations — Frontend Implementation Spec

_Author: Vision (frontend architect). For: Spider-Man (implementation). Date: 2026-07-09._
_Source: iron-man's backend specs in `../rim-server/docs/specs/` (track-b1-fts.md,
track-b2-alerts.md, track-b3-email.md) + my Track A error-boundary follow-up._

Four work items. **Three of them (B1, B2 management UI, B3) depend on a backend SDL
change and MUST NOT start their codegen-dependent parts until the matching backend lands.**
Two parts are backend-independent and can start immediately: the B2 event-type handling
and the Track A follow-up. Read the "Sequencing" section before picking up work.

## Global constraints (every item)
- Web build must keep working; nothing here touches Tauri APIs directly.
- Every new exported function/component gets **tests (Vitest + Testing Library) AND docs
  (JSDoc + the named markdown where called out)**.
- Gates before "done": `npm run build`, `npm test`, `npm run lint` (0 errors, warnings
  OK), `npm run format:check`.
- Never hand-write GraphQL enum/input/object types — after each backend SDL lands, run the
  codegen workflow (below) and import from `src/core/graphql/generated/schema-types.ts`.
- TS strict, double quotes, semicolons, relative imports, `rim-*` tokens only. DOMPurify
  is the only sanctioned path for any HTML rendering (CLAUDE.md).
- No git commits. Hawkeye reviews before anything is reported done.

## Codegen workflow (run once per backend SDL landing — B1, B2, B3 each trigger it)
```bash
# with the updated backend running locally:
curl -s http://localhost:8080/api/sdl > schema.graphql
npm run codegen
```
Then update the hand-written `gql` operation strings and import regenerated types. Do NOT
touch `src/core/graphql/generated/**` by hand.

## Sequencing
1. **Now, backend-independent:** Track A follow-up (§4) and B2 event-type handling (§2b).
2. **After hulk lands B1** (searchMessages breaking change): §1.
3. **After hulk lands B2** (ingest-token mutations/query + incident events in SDL): §2a
   management UI. (§2b event handling can precede this — the events are a JSON-string
   subscription, not codegen-typed; see §2b.)
4. **After hulk lands B3** (optional `recipientEmail` on invite inputs): §3.

Each section states its own codegen gate. If you pick up a section before its backend has
landed, stop and message Vision — do not stub the schema.

---

## §1 — B1: Paginated, ranked message search

### What the backend changes (from track-b1-fts.md §6)
`searchMessages` goes from a flat list to a cursor-paginated, ranked connection. **Breaking.**
- Old: `searchMessages(serverId, conversationId, query, limit, includeDeleted): [SearchResultMessage!]!`
- New: `searchMessages(input: SearchMessagesInput!): SearchResultPage!` where
  - `SearchMessagesInput { serverId: ID!, query: String!, conversationId: ID, limit: Int, cursor: MessageCursorInput, dir: PageDir }`
  - `SearchResultPage { items: [SearchResultMessage!]!, next: MessageCursorOutput, prev: MessageCursorOutput, pageInfo: PageInfo! }`
  - `SearchResultMessage` gains `rank: Float!` and `headline: String` (a `ts_headline`
    snippet delimited by literal `<mark>…</mark>`, chosen server-side).
- Results are ordered by **recency** `(sentAt DESC, id DESC)`, **not** by rank (rank is
  display-only) — iron-man's cursor-stability decision. Our UI must not pretend results are
  relevance-ordered.

**Codegen gate:** this section starts only after hulk lands B1 and you've re-exported SDL +
run codegen. Import `SearchMessagesInput`, `SearchResultPage`, `MessageCursorInput`, `PageDir`
from generated types.

### 1a. Rewrite `useSearchMessages` → infinite query
File `src/features/messages/api/useSearchMessages.ts`. Convert from `useQuery` returning a
flat array to **`useInfiniteQuery`** over `SearchResultPage`:
- Query variables build a `SearchMessagesInput`: `{ serverId, query, conversationId?, limit: 25, cursor, dir: After }`.
- `initialPageParam: undefined`; `getNextPageParam: (lastPage) => lastPage.pageInfo.hasNextPage ? lastPage.next : undefined`
  (mirror the existing message-timeline infinite query — check `useMessages`/`MessageTimeline`
  for the exact `next`/`MessageCursorOutput → MessageCursorInput` mapping and reuse that shape).
- Keep the 300ms debounce on `query`. Keep `queryKeys.searchMessages(workspaceId, conversationId ?? "__all__", debouncedQuery)`
  as the key (Track A reconnect scoping already covers the `searchMessages` root — no change needed there).
- Extend `SearchMessageItem` with `rank: number` and `headline: string | null`.
- Export a small selector/helper `flattenSearchPages(data)` returning `SearchMessageItem[]`
  across all loaded pages (the overlay consumes a flat list).

**Never fire on an empty query (product decision — Vision, confirmed with nick-fury).**
The backend treats an empty free-text query with no operators as "return ALL accessible
messages, recency-ordered" — effectively a workspace-wide firehose. We do **not** want that
triggered from the search box. **Preserve the existing enablement guard**
(`enabled: Boolean(workspaceId && debouncedQuery.trim())`) when converting to the infinite
query — do not loosen it. Consequences:
- A truly empty input (trimmed length 0) fires nothing; the overlay keeps its purposeful
  empty state (recent searches / prompt).
- An **operator-only** input (e.g. `from:@alice`, `has:link`) is non-empty, so it still
  fires — that's desired; the server applies the operators over the accessible set.
- We are explicitly **not** building an empty-query "recent activity" feed in the overlay
  (option b). If a recent-activity view is wanted, it's a separate, deliberate surface — not
  an accident of the search endpoint. Note it as a future item in `docs/search-ui.md`; do
  not implement it here.

### 1b. SearchOverlay: flat recency list + pagination + safe snippet
File `src/features/messages/components/SearchOverlay.tsx`.

**Drop conversation grouping.** Grouping (`ResultGroup`, the `groups`/`Tab`-next-group logic)
assumed the whole result set was present at once. With recency-ordered cursor pagination a
conversation can span multiple pages, so grouping fragments. Replace with a **flat,
recency-ordered list**; each row shows the conversation label (the existing
`conversationTitle` + `# / @` prefix logic, moved per-row), author, relative time, and the
highlighted snippet. Remove the `Tab`-next-group footer hint; keep ↑/↓/Enter/Esc.

**Pagination UX:** infinite scroll — when the selected index (or scroll) reaches within ~5
of the last loaded item, call `fetchNextPage()` if `hasNextPage`. Also render an explicit
"Load more" row at the list end as a keyboard/click fallback while `hasNextPage`. Show the
existing spinner for `isFetchingNextPage`.

**Snippet rendering (SECURITY-CRITICAL).** `headline` contains server-injected `<mark>`
tags around matches, but the surrounding text is **raw user message content** — it may
contain arbitrary markup. Do **not** pass it to `dangerouslySetInnerHTML` unsanitized.
Replace the current client-side substring `HighlightedText` with a new
`SearchSnippet` component that renders `headline` (when present) as follows:
- Sanitize with DOMPurify configured to allow **only** the `<mark>` tag and **no**
  attributes: `DOMPurify.sanitize(headline, { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] })`.
  This strips any user-embedded tags (script/img/etc.), neutralizing XSS, while keeping the
  highlight markers. Render the sanitized string via `dangerouslySetInnerHTML` inside a
  `line-clamp-2` block; style `mark` with rim tokens (`bg-rim-accent/20 text-rim-accent`,
  reset default `mark` background). This is consistent with the codebase's DOMPurify-for-HTML
  rule.
- When `headline` is `null` (operator-only searches can match with empty free-text →
  backend returns no headline), fall back to rendering the plain `text` truncated (React
  auto-escaped, no highlight) — reuse the escaped-plaintext branch.
- Do NOT re-implement client-side substring highlighting; the server headline is now the
  source of truth for match highlighting.

### 1c. Search-syntax discovery UX
The operators (`from:`, `in:`, `has:link`/`has:attachment`, `before:`, `after:`) are parsed
**server-side** — the frontend passes the raw query string through unchanged (no client
parser; keep it conservative). We only need to make the syntax **discoverable**:
- Update the input placeholder to hint: `Search — try from:@user, in:#channel, has:link, before:2026-01-01`.
- Add a small "Search tips" affordance: a `?`/info icon button in the input row that toggles
  a compact legend panel (a `rim-panel` popover) listing each operator with a one-line
  example. Static content, no state beyond open/closed. Keyboard-dismissable (Esc closes the
  tips first, then the overlay — thread it into the existing Escape handler).
- Keep the existing scope chip (All / # current-channel). Document in a comment that the chip
  sets `conversationId` and coexists with an in-query `in:#x` (backend intersects both);
  don't try to unify them.

Refer product/operator syntax to `../rim-server/docs/search.md` (iron-man's doc) — link it
from the tips panel copy if useful, but do not duplicate the full table.

### Tests (§1)
- `useSearchMessages.test.ts`: mock the graphql client; assert it sends a `SearchMessagesInput`
  (not the old positional args), maps `SearchResultPage.items` incl. `rank`/`headline`, and
  that `getNextPageParam` returns the next cursor when `hasNextPage` and `undefined` otherwise;
  `flattenSearchPages` concatenates pages in order.
- `SearchOverlay.test.tsx` (extend existing if present): renders a flat list (no group
  headers); `fetchNextPage` is triggered near the end / via "Load more"; **snippet
  sanitization test** — a `headline` containing `<img src=x onerror=alert(1)><mark>hit</mark>`
  renders the `<mark>` highlight but strips the `<img>` (assert no `img` in the DOM, mark
  present); null-headline falls back to escaped plain text; tips panel toggles.
- Keep the keyboard-nav tests working against the flat list.

### Docs (§1)
- JSDoc on `useSearchMessages`, `flattenSearchPages`, `SearchSnippet` (call out the
  DOMPurify `mark`-only sanitization and why).
- Add `docs/search-ui.md`: the snippet-sanitization decision, the recency-ordering (not
  relevance) note for UI expectations, the flat-list-over-grouping rationale, and the
  operator discovery affordance. Cross-link `../rim-server/docs/search.md`.

---

## §2 — B2: Alert ingestion (ingest-token UI + incident events)

Two independent parts. §2b (events) is backend-codegen-independent; §2a (management UI)
needs the ingest-token SDL.

### 2a. Ingest-token management UI
**Codegen gate:** after hulk lands B2's GraphQL (`ingestTokens(serverId)` query,
`createIngestToken`/`revokeIngestToken` mutations). Re-export SDL + codegen; import the
generated input/object types.

New feature slice `src/features/integrations/` (`api/ → components/`). It manages
per-workspace ingest tokens that let external monitors (Prometheus/Grafana/etc.) open
incidents.

- **API hooks** (`src/features/integrations/api/useIngestTokens.ts`):
  - `useIngestTokens(serverId)` — `useQuery`, key `["ingestTokens", serverId]` (add to
    `queryKeys` factory as `ingestTokens: (serverId?) => ["ingestTokens", serverId]`).
    **Add `"ingestTokens"` to `VOLATILE_WORKSPACE_KEY_ROOTS`** in `core/query/keys.ts` so
    reconnect scoping refreshes it (it's workspace-scoped server state).
  - `useCreateIngestToken()` — mutation; on success invalidates `ingestTokens(serverId)`.
    The result carries the **raw token exactly once** — surface it and never refetch it.
  - `useRevokeIngestToken()` — mutation; invalidates on success.
- **Panel** (`src/features/integrations/components/IngestTokenSettings.tsx`):
  - List existing tokens: label, target channel name, `lastUsedAt` (relative), `createdAt`,
    revoked state; a Revoke button per active token (confirm via the shared `Dialog`).
  - Create form: `label` (text), target channel (a channel `<select>` sourced from
    `useChannels(workspaceId)`), optional `severityDefault` (a `<select>` of the generated
    `IncidentSeverityGql` enum). On submit → `useCreateIngestToken`.
  - Create result: show the raw token **once** in a copy-to-clipboard row (mirror
    `InviteDialog`'s copy affordance and one-time-secret pattern), with a "copy the endpoint
    too" hint — show the three ingest URLs built from `getApiOrigin()` (from
    `core/graphql/config.ts`): `${getApiOrigin()}/api/hooks/alerts/{generic|alertmanager|grafana}`.
    Do **not** hardcode the host — reuse `getApiOrigin()` (Track A centralization).
  - Copy shows how to present the token to a monitor: `Authorization: Bearer <token>` (and
    note `X-RIM-Ingest-Token` is also accepted) — brief inline help, link to
    `../rim-server/docs/alerts.md`.
- **Settings integration:** add a new tab to `SettingsPage.tsx`
  (`SettingsPage.tsx:261` tab union + `tabs` array + the render switch), key `"integrations"`,
  label `"Integrations"`, lazy-loaded like the other heavy panels. Render
  `<IngestTokenSettings serverId={workspaceId} />`.
- **Owner-only gating:** these tokens can open incidents, so the tab should be owner-only.
  The server enforces owner-only on the query/mutations regardless. Reuse whatever
  owner/role signal the app already has — **check first**: look at how ownership is
  determined elsewhere (e.g. server membership role in the `me`/server query, or the
  `isAdmin` prop pattern `EmojiManagement` uses). If a clean client-side owner signal
  exists, gate the tab on it. If it does NOT (note: `EmojiManagement` is currently passed a
  hardcoded `isAdmin`, i.e. there is no real client gate today), render the tab but let the
  owner-only query surface a forbidden/empty state, and **flag to Vision** that a proper
  client role gate is a needed follow-up (do not invent a role model here).

### 2b. Incident WorkspaceEvent handling (backend-codegen-independent)
B2 adds two `WorkspaceEvent` variants (track-b2-alerts.md §8). These flow through the
existing `workspaceEvents` subscription as a **JSON string** — they are NOT part of the
GraphQL codegen types, so this part needs no `schema.graphql` change and can be done now.

- **Add the variants to `src/core/events/types.ts`** `WorkspaceEvent` union (snake_case
  fields, matching the existing variants and backend serde):
  ```ts
  | { type: "IncidentDeclared"; workspace_id: string; conversation_id: string;
      incident_id: string; severity: string | null; title: string; member_user_ids: string[] }
  | { type: "IncidentUpdated"; workspace_id: string; conversation_id: string;
      incident_id: string; status: string; member_user_ids: string[] }
  ```
  **Verify the exact tag casing and field names against the backend once B2 lands** — a
  mismatch makes the handler a silent no-op (there's no compile-time link between the JSON
  and this union). iron-man's struct is snake_case fields / PascalCase `type` tag, matching
  the existing variants; confirm before closing.
- **Add cases to `handleEvent`** in `src/core/events/useWorkspaceEvents.ts`:
  - `IncidentDeclared`: invalidate `queryKeys.activeIncident(workspaceId, event.conversation_id)`,
    `queryKeys.listIncidents(workspaceId)` (broad — it keys status/severity filters after
    serverId, so invalidate by the `["listIncidents", workspaceId]` prefix), and
    `queryKeys.incidentTimeline(event.incident_id)`. Then a `toast.info` (`Incident declared: <title>`,
    with SEV in the description if `severity` present).
  - `IncidentUpdated`: same invalidations (use `incident_id` for the timeline); a lighter
    toast is optional — prefer just cache invalidation to avoid toast spam on repeated alert
    firings. Emit nothing to the event bus unless a consumer needs imperative reaction (none
    identified — the incident panels are query-driven, so invalidation refreshes them).
  - Rationale to put in a comment: incident UI (`IncidentTimelinePanel`, `IncidentHistoryPage`,
    active-incident banner) is TanStack-Query-driven, so scoped invalidation is sufficient;
    no new event-bus channel needed. Pipelines already react server-side (iron-man §8), so
    the frontend does not re-trigger anything.
- **No new event-bus (`busEvents.ts`) entries** unless you find a component that must react
  imperatively; if you do, follow the existing `BUS_EVENTS` pattern and add a typed event.

### Tests (§2)
- `useIngestTokens.test.ts`: create sends the expected input, exposes the raw token once,
  invalidates the list; revoke invalidates; list query keyed correctly.
- `IngestTokenSettings.test.tsx`: renders token list, create form submits, raw-token copy
  row appears once after create and the endpoint URLs use `getApiOrigin()` (mock it), revoke
  confirm flow.
- `useWorkspaceEvents.test.ts` (extend): an `IncidentDeclared` event invalidates the three
  incident keys and toasts; `IncidentUpdated` invalidates without a duplicate toast; an
  unknown/removed field shape doesn't throw (defensive parse already wraps in try/catch).
- keys.test.ts: `ingestTokens` present in `VOLATILE_WORKSPACE_KEY_ROOTS`.

### Docs (§2)
- JSDoc on all new hooks/components and the two new event variants (note the "verify against
  backend serde" caveat).
- Add `docs/integrations-ui.md`: where ingest tokens live, the one-time-secret UX, the
  endpoint URLs, owner-only gating (and the gating-gap follow-up), and the incident-event →
  cache-invalidation strategy. Cross-link `../rim-server/docs/alerts.md`.

---

## §3 — B3: Optional recipient email on invite creation

**Codegen gate:** after hulk lands B3's SDL delta (optional `recipientEmail` on
`CreateInviteInput`; instance invite input likewise). Re-export SDL + codegen.

Backend answers I already gave nick-fury (for context): the emailed links are path-based —
password reset `{base}/reset-password/{token}`, invite `{base}/join/{token}` — and the
`recipientEmail` field is additive/optional/nullable. The frontend link builder in
`InviteDialog` (`${window.location.origin}/join/${token}`) already matches; no change needed
to the link format.

### Change
- `src/features/settings/api/useInviteMutations.ts`: extend `useCreateInviteMutation` to
  accept an optional recipient email. Change the mutation input from `{ serverId, maxUses: 10 }`
  to `{ serverId, maxUses: 10, recipientEmail?: string }`, and change the hook's argument
  from `(serverId: string)` to an object `({ serverId, recipientEmail }: { serverId: string; recipientEmail?: string })`
  (update the one caller). Add `recipientEmail` to the `gql` `CreateInviteInput` variables.
- `src/features/settings/components/InviteDialog.tsx`: add an **optional** email input above
  the Generate button:
  - Label it "Email invite (optional)"; helper text: "If provided, we'll email the invite
    link. You can still copy the link below either way."
  - Basic client-side email format check (a simple regex) before submit; if invalid, show an
    inline error and don't submit. Surface a server `Validation` error (bad email) on the
    field if the mutation rejects.
  - Pass `recipientEmail` to `createInvite.mutate({ serverId, recipientEmail })` only when
    non-empty; when empty, behave exactly as today (link-only).
  - Keep the copy-link result flow unchanged — the raw token/link is still returned and
    shown regardless of whether an email was sent (best-effort send, per iron-man §5).

### Tests (§3)
- `useInviteMutations.test.ts`: sends `recipientEmail` when provided, omits it when not;
  input shape correct.
- `InviteDialog.test.tsx`: empty email → link-only path (no `recipientEmail` in the call);
  valid email → included; invalid email → inline error, no mutation; link/copy still shown
  after success.

### Docs (§3)
- JSDoc on the widened hook (note the optional field + best-effort send semantics).
- No new markdown file; a short note in the invite section is enough. Do NOT document the
  email link paths here — that's backend-owned in `../rim-server/docs/email.md`.

---

## §4 — Track A follow-up: wrap the auxiliary conversation side-panels

My Track A spec's six-surface list omitted three conversation-surface side panels; a crash in
any of them still escapes to the root `AppErrorBoundary`. Wrap each in the existing
`SurfaceErrorBoundary` (`src/shared/ui/SurfaceErrorBoundary.tsx`), in
`src/shell/layouts/AppShell.tsx` (`WorkspaceShell`), each independently, wrapping only the
panel subtree (same rule as Track A — do not wrap the shell hooks):

| Panel | Location (approx.) | `surface` label | `resetKeys` |
|---|---|---|---|
| `PinnedMessagesPanel` | ~line 285-301 | "Pinned messages" | `[selectedConversationId]` |
| `IncidentTimelinePanel` | ~line 303-307 | "Incident timeline" | `[selectedConversationId]` |
| `PostmortemPreview` | ~line 309-320 | "Postmortem" | `[selectedConversationId]` |

Backend-independent; do it now. No new component — reuse `SurfaceErrorBoundary`.

### Tests / Docs (§4)
- Extend the AppShell test (or add one) asserting each panel is wrapped (a thrown error in
  one shows the in-pane fallback, shell stays mounted) — mirror the Track A boundary tests.
- Update `docs/error-boundaries.md`: these three panels are now covered; the surface list is
  complete for the conversation surface.

---

## Definition of done
- **B1:** searchMessages uses the paginated input/page; overlay shows a flat recency list
  with DOMPurify-`mark`-only snippet highlighting (XSS test passes), infinite scroll, and a
  discoverable operator legend. Codegen re-run, no hand-written schema types.
- **B2:** ingest-token settings tab (owner-gated best-effort) with one-time-secret UX and
  `getApiOrigin()`-derived endpoint URLs; `IncidentDeclared`/`IncidentUpdated` handled via
  scoped invalidation + toast; `ingestTokens` added to the volatile reconnect set.
- **B3:** optional email field on invite creation, best-effort, link-copy flow intact.
- **§4:** three side-panels wrapped; error-boundary doc updated.
- Every new export has JSDoc + a test; `docs/search-ui.md`, `docs/integrations-ui.md`,
  updated `docs/error-boundaries.md` exist. `npm run build`, `npm test`, `npm run lint`,
  `npm run format:check` all pass. Hawkeye review passed.

## Open coordination notes (Vision → nick-fury)
- Owner-only client gating for the Integrations tab has no existing clean signal
  (`EmojiManagement` fakes `isAdmin`). Flagged as a follow-up; server enforces regardless.
- The incident-event TS union is not codegen-linked to the backend; spider-man must verify
  tag/field casing when B2 lands, or the handler silently no-ops.
