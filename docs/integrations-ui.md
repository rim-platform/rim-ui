# Integrations UI (Track B2: alert ingestion)

Track B2 has two parts (see `docs/plans/track-b-frontend-2026-07-09.md` §2), both now
implemented: the **ingest-token management UI** (`src/features/integrations/`, a new
Settings tab) and **incident WorkspaceEvent handling**.

## Ingest-token management UI

`src/features/integrations/` manages per-workspace alert-ingest tokens — credentials
that let external monitors (Prometheus/Alertmanager, Grafana, or a generic webhook)
open and update incidents via `POST /api/hooks/alerts/{generic|alertmanager|grafana}`
(see `../rim-server/docs/alerts.md`).

- **`api/useIngestTokens.ts`**: `useIngestTokens(serverId)` (list, key
  `queryKeys.ingestTokens(serverId)`), `useCreateIngestToken()`, and
  `useRevokeIngestToken()`. Both mutations invalidate the list for the affected
  workspace on success.
- **`components/IngestTokenSettings.tsx`**: the Settings-tab panel — token list
  (label, target channel name resolved via `useChannels`, relative `lastUsedAt`,
  absolute `createdAt`, revoked badge), a create form (label, channel `<select>`,
  optional `severityDefault`), and a revoke confirmation (`Dialog`).
- **One-time-secret UX**: `createIngestToken`'s `rawToken` is shown exactly once,
  in a copy-to-clipboard row mirroring `InviteDialog`'s pattern — the backend only
  ever stores the hash, so there is no way to retrieve it again after this point.
  The reveal view also shows the three ingest endpoint URLs
  (`${getApiOrigin()}/api/hooks/alerts/{generic|alertmanager|grafana}` — always
  built from `core/graphql/config.ts`'s `getApiOrigin()`, never a hardcoded host,
  per the Track A endpoint-centralization rule) with their own copy buttons, plus
  inline help on the `Authorization: Bearer <token>` / `X-RIM-Ingest-Token` header
  options.

### Owner-only gating — known client-side gap

The backend enforces owner-only on the `ingestTokens` query and the
create/revoke mutations regardless of what the client does. There is **no
client-side owner/role signal** to gate the Settings tab on today — checked before
building this: neither the session nor the workspace store carries an
`isOwner`/role field, and the one existing "admin gate" in the settings area
(`EmojiManagement`'s `isAdmin` prop, set in `SettingsPage.tsx`) is a hardcoded
`true`, not a real signal. Per the frontend spec, `IngestTokenSettings` renders
unconditionally for any workspace member; a non-owner simply sees the query's
error/empty response (rendered as a "this is expected if you're not an owner"
message rather than a raw error). **Follow-up needed:** a real client-side role
model, so the tab (and `EmojiManagement`) can be hidden or shown a proper
"owners only" message instead of relying on the query failing. Not invented here
per the spec's explicit instruction not to guess at a role model.

## Incident WorkspaceEvent handling

Alert ingestion (external monitors hitting `/api/hooks/alerts/*`, see
`../rim-server/docs/specs/track-b2-alerts.md`) creates or updates incidents on the
backend. Two new `WorkspaceEvent` variants carry that to the frontend:

- `IncidentDeclared` — a new incident was created (first alert firing, or a manually
  started incident once the backend wires that emission point too).
- `IncidentUpdated` — an existing incident's status changed (e.g. a repeat alert
  firing on the same fingerprint, or a resolve).

Both are defined in `src/core/events/types.ts` on the `WorkspaceEvent` union and
handled in `handleEvent` (`src/core/events/useWorkspaceEvents.ts`).

### Not codegen-typed — verified against the backend (2026-07-10)

These events flow through the existing `workspaceEvents` subscription as a **JSON
string** (see `useWorkspaceEvents.ts`), the same mechanism as every other
`WorkspaceEvent` variant. They are hand-written TypeScript, not generated from
`schema.graphql` — there is **no compile-time link** between this union and the
backend's `rim_services::events::types::WorkspaceEvent` enum, so a future backend
shape change won't be caught by the type checker; re-verify by reading
`rim_services/src/events/types.rs` directly if either variant changes again.

Verified directly against that file (not just the spec doc) once B2's event-emitting
code landed. Two corrections from the original ahead-of-landing draft:

- **Added `conversation_type: string`** to both variants (`ServerId`/`Vec<UserId>`
  etc. all map to `string`/`string[]` as usual). It's carried so the
  subscription-visibility filter can treat `Channel` conversations as visible to all
  workspace members — channels have no `conversation_member` rows, so falling back to
  `member_user_ids` alone would hide channel-scoped incidents. Same pattern as
  `NewMessage`/`ConversationCreated`.
- **Did NOT add `member_user_ids`**, even though it's a field on the Rust struct: it's
  annotated `#[serde(skip_serializing)]`, meaning it's server-internal only (used to
  build the subscription filter before the event is serialized) and is never actually
  present in the JSON the client receives. Declaring it in the TS type would have been
  actively misleading — reading `event.member_user_ids` on the client would silently
  return `undefined`. (This `skip_serializing` pattern is common across the
  `WorkspaceEvent` enum, not specific to incidents — every variant with
  `member_user_ids` skips it the same way.)

**Tangential finding, not fixed here:** several *other*, pre-existing `WorkspaceEvent`
variants (`NewMessage`, `MessageUpdated`, `MessageDeleted`, `ReactionsUpdated`,
`ConversationCreated`, `ThreadCreated`) also carry a `conversation_type` field on the
backend that is **not** `skip_serializing` (i.e. it genuinely is sent to the client),
but the existing frontend `WorkspaceEvent` union for those variants doesn't declare
or map it. That predates this Track B2 work and is out of scope for this change —
flagged for whoever owns those event types next.

### Cache-invalidation strategy

The incident-facing UI (`IncidentTimelinePanel`, `IncidentHistoryPage`, the
active-incident banner) is entirely TanStack-Query-driven, so both event handlers do
scoped cache invalidation rather than pushing data through the event bus:

- `queryKeys.activeIncident(workspaceId, conversationId)` — refreshes the
  active-incident banner for the affected conversation.
- `["listIncidents", workspaceId]` — a **broad prefix** invalidation (not the full
  `queryKeys.listIncidents(...)` key, which also encodes the status/severity filter
  arguments) so every filtered view of the incident history list picks up the change.
- `queryKeys.incidentTimeline(incidentId)` — refreshes that incident's timeline.

`IncidentDeclared` additionally shows a `toast.info` ("Incident declared: `<title>`",
with the severity in the description when present). `IncidentUpdated` does **not**
toast — a monitor can fire repeatedly on the same fingerprint, and toasting on every
repeat would spam the user; the cache invalidation alone keeps the query-driven panels
current.

No new `BUS_EVENTS` entry was added — nothing today needs to react imperatively to
these events (pipelines already react server-side per
`track-b2-alerts.md` §8, so the frontend doesn't re-trigger anything).

### Reconnect scoping

`"ingestTokens"` is in `VOLATILE_WORKSPACE_KEY_ROOTS` (`src/core/query/keys.ts`) —
added ahead of the management UI landing, now covering the real
`queryKeys.ingestTokens(serverId)` key `useIngestTokens` uses. On WS reconnect, the
ingest-token list is refreshed for the active workspace along with the other
workspace-scoped volatile queries (see the reconnect-strategy comment at the top of
`useWorkspaceEvents.ts`).
