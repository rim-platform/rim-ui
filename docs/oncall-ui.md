# On-call & escalation UI (Track C1)

Frontend implementation of RIM's on-call scheduling and escalation policies. Cross-links
`../rim-server/docs/oncall.md` for the backend model (rotation resolution, escalation
timer engine, ack semantics).

## Where it lives

The Incidents surface (`mainSurface.kind === "incidents"`) is a hub
(`IncidentsHub`, `src/features/incidents/components/IncidentsHub.tsx`) with a segmented
sub-tab header, mirroring `SettingsPage`'s in-surface tab idiom:

```
Incidents surface
├── Active / History   ← IncidentHistoryPage, rendered with embedded (chrome-less)
├── On-call            ← OnCallSubTab (src/features/oncall/)
└── Escalation          ← EscalationSubTab (src/features/oncall/), gated behind
                          DisclosureGate minTier={INTERMEDIATE} at the tab level
```

Sub-tab state is local `useState`, deep-linkable via an optional `tab` field on the
`{ kind: "incidents" }` mainSurface variant (added specifically so `oncall.who` and the
status-bar `OnCallIndicator` can jump straight to the On-call tab — same trick
`{ kind: "settings", tab? }` already uses). Each sub-tab body is wrapped in its own
`SurfaceErrorBoundary` (see `docs/error-boundaries.md`), finer-grained than the outer
Incidents boundary from Track A.

On-call and Escalation are viewable by all workspace members; only the editing
affordances inside are gated on `canManageOnCall`.

## Feature slice: `src/features/oncall/`

```
api/         useOnCallSchedules.ts    (list + create/update/delete schedule,
                                        addRotationLayer/updateRotationLayer/removeRotationLayer,
                                        setRotationParticipants, createOnCallOverride/deleteOnCallOverride)
             useServerOnCall.ts       (serverOnCall batch resolver — status bar + oncall.who)
             useWhoIsOnCall.ts        (per-schedule point resolver — OverrideModal's default end)
             useOnCallShifts.ts       (server-resolved shift list — RotationPreviewStrip)
             useEscalationPolicies.ts (list + create/update/delete policy, setChannelEscalationPolicy)
components/  OnCallSubTab, ScheduleEditor, RotationLayerEditor, RotationPreviewStrip,
             OverrideModal, OnCallIndicator,
             EscalationSubTab, EscalationPolicyEditor, EscalationStepList
state/       useOnCallStore.ts (OverrideModal visibility — opened by the
                                 `oncall.take_shift` command's local handler)
utils/       rotationLayer.ts (DraftRotationLayer, makeEmptyDraftLayer, layerFromExisting —
                                pure mappers, split out of RotationLayerEditor.tsx so that
                                component file exports only the component)
```

`useAcknowledgeIncident` lives in `src/features/incidents/api/useIncident.ts` (it's an
incident mutation, not an on-call one) — see the Ack section below for why the human ack
surfaces don't actually call it.

Query keys added to `src/core/query/keys.ts`: `onCallSchedules`, `serverOnCall`,
`whoIsOnCall`, `onCallShifts`, `escalationPolicies`.

**Reconnect scoping split** (`VOLATILE_WORKSPACE_KEY_ROOTS` vs `VOLATILE_GLOBAL_KEY_ROOTS`):
`onCallSchedules`/`serverOnCall`/`escalationPolicies` are keyed by `serverId` at
position `[1]`, so they fit the `[root, workspaceId]` reconnect-invalidation prefix and
live in `VOLATILE_WORKSPACE_KEY_ROOTS`. `whoIsOnCall`/`onCallShifts` are keyed by
`scheduleId` instead — a `[root, workspaceId]` prefix would never match those entries
(`scheduleId !== workspaceId`), so they live in `VOLATILE_GLOBAL_KEY_ROOTS` and get
invalidated by root name alone on reconnect, same as `incidentTimeline`.

## The server-resolved-shifts invariant (hard rule)

**The frontend must never compute rotation math.** Rotation resolution with overrides,
timezones, DST, and handoff boundaries is subtle and must match the escalation engine's
own resolution exactly — otherwise the UI would show a different on-call than who
actually gets paged.

`RotationPreviewStrip` renders *only* the intervals `useOnCallShifts(scheduleId, from,
to)` hands it: it lays out `{ startAt, endAt, user }` as percentages of the window and
does nothing else. `RotationPreviewStrip.test.tsx` feeds it a fixed shift list and
asserts the resulting segment positions/widths, proving there's no client-side rotation
computation involved — the numbers come straight from interval arithmetic on the given
`startAt`/`endAt`, never from a rotation spec.

`OnCallShiftGql.isOverride` (server-flagged §10 FLAG B, not client-derived) drives
distinct styling for override segments (`rim-warm` vs the base-rotation `rim-accent`) —
`RotationPreviewStrip.test.tsx` feeds a mixed `isOverride` list and asserts the two
segments get different classes.

## Keyboard-first editors

`RotationLayerEditor` (participants) and `EscalationStepList` (steps) share one ordered-
list idiom: each row is focusable, `j`/`k` reorder the focused row down/up, and visible
up/down chevron buttons give the same reorder to mouse/screen-reader users (matching
`MacroSettings`' step-reorder pattern). Add/remove is inline; there's no drag-and-drop
anywhere in this feature — see the phase-1 rationale in
`docs/plans/track-c1-frontend.md` for why (mouse-centric, hard to make accessible, and
it invites the frontend to own rotation math).

## ScheduleEditor: create and edit rotation layers

`OnCallScheduleGql.rotationLayers` (nested, each with its `participants`, ordered
`priority DESC, created_at ASC`) lets `ScheduleEditor` load an existing schedule's
rotations for editing, not just create new ones:

- **Create**: orchestrates `createOnCallSchedule` → per layer `addRotationLayer` →
  `setRotationParticipants(layerId, [userId] ordered)`, holding everything in local
  component state for the session.
- **Edit**: `RotationLayerEditor`'s draft carries an optional `id` (present only for a
  layer loaded from `existing.rotationLayers`, via `layerFromExisting`). On save,
  `ScheduleEditor` diffs the draft list against what was loaded: a layer with an `id`
  gets `updateRotationLayer` + `setRotationParticipants`; a layer without one (added
  during this editing session) gets the create-flow pair; any originally-loaded layer no
  longer present in the draft list gets `removeRotationLayer`. There's no atomic
  "replace all layers" mutation, so this is a set of granular calls, same shape as
  create. A layer with zero participants **blocks the whole save** with an inline
  validation error ("A rotation layer needs at least one participant. Remove the layer to
  disable it.") rather than being silently skipped — this applies on create and edit
  alike. Silently skipping it would close the modal "successfully" while the server kept
  paging whoever it last saved for that layer; removing the layer entirely is the actual
  way to disable it. `ScheduleEditor.test.tsx` asserts the blocked case fires no
  mutations at all, not even the schedule-level ones.

## Override ("take shift") flow

`OverrideModal` defaults **who** to the current user and **when** to `now →
whoIsOnCall(scheduleId).shiftEndsAt` (confirm on Enter via a native `<form>` submit, so it
works regardless of which field has focus) — both are overridable before confirming.
**Owner/Moderator only**: `createOnCallOverride` is schedule CRUD on the backend, so a
Guest cannot self-assign in C1 by design (not an oversight — a member-allowed "volunteer"
mutation would be a new backend endpoint, future work).

Three entry points open the same modal: the On-call sub-tab's "Take shift" button, the
`oncall.take_shift` command (palette/keybind), and — later — the status-bar indicator's
menu. `oncall.take_shift`'s local handler (`commandDispatcher.ts`) checks
`canManageOnCall` via the cached `server` query before opening the modal, toasting
"Managing on-call requires Moderator" otherwise.

## Ack — single unified-dispatch path, no direct-mutation fallback

`incident.ack` is `Mutating`/`dangerous:false`; `requires_confirmation_for_initiator`
only fires for `Restricted`/`dangerous`/agentic dispatch, and every human ack surface
here is non-agentic — so ack is single-action, no confirmation prompt, from all four
entry points:

1. **`IncidentBanner`'s Ack button** — shown when unacked and `escalationRun.status ===
   ACTIVE`; also renders the live "Unacked — escalating to L{n} in {countdown}" strip
   (recomputed every second against `escalationRun.nextFireAt`, same `setInterval`
   pattern as the existing elapsed-time clock) and, once acked, "Acked by {name} · {relative}".
2. **The paged toast's inline Ack action** — shown to a user whose id appears in an
   `EscalationStepFired` event's `target_user_ids`.
3. **A configurable keybind** bound to the `incident.ack` command (never hardcoded).
4. **The command palette.**

All four dispatch through the *same* `incident.ack` command id via the unified
`executeCommand` GraphQL mutation (`useExecuteCommandMutation`) — never a direct
`acknowledgeIncident` mutation call. `useAcknowledgeIncident` (in
`features/incidents/api/useIncident.ts`) exists for API-surface completeness but is
deliberately unused by any of the four surfaces above; see its doc comment.

`incident.escalate` follows the same direct-`executeCommand` pattern (no local UI, no
modal — "a confirm here is acceptable" per the C1 handoff, deferred to the sensitivity
pipeline).

## Event handling

Two `WorkspaceEvent` variants added to `src/core/events/types.ts` (verified 2026-07-11
against `rim_services/src/events/types.rs` — PascalCase tag, snake_case fields):

- **`EscalationStepFired`** → invalidates `activeIncident`/`incidentTimeline`/
  `listIncidents`; if the current user's id is in `target_user_ids`, shows a persistent
  paged toast (`id: paged-{incident_id}`) with an inline Ack action.
- **`IncidentAcknowledged`** → same invalidations, dismisses the paged toast for that
  incident.

## Role gating: `canManageOnCall` vs `isOwner`

`useMyServerRole(serverId)` (`src/features/workspaces/api/useMyServerRole.ts`) selects
`Server.viewerRole` off the already-cached `server(serverId)` query — no extra
round-trip. Two derived checks:

- `useCanManageOnCall` — `Owner || Moderator`. Gates schedule/policy/override
  create-edit-delete throughout this feature.
- `useIsOwner` — `Owner` only. Gates the two retro-fixed affordances below.

**Display/affordance gate only, never a security boundary** — the backend re-checks
every mutation regardless.

### Retro-fixes landed alongside C1

- **Integrations tab** (`IngestTokenSettings`): ingest-token CRUD is owner-only on the
  backend (`ensure_server_owner`), so the create-token form and revoke buttons are now
  gated on `useIsOwner` (the query itself isn't even issued for a non-owner), replacing
  the earlier best-effort "render unconditionally, let the server 403" approach. The
  forbidden-state message is kept as a belt-and-suspenders fallback.
- **`EmojiManagement`**: the hardcoded `isAdmin` prop is gone. The real backend model
  (`DefaultCustomEmojiService`) is **not** a single admin flag — upload is open to any
  server member (the backend only checks membership), while delete is gated on
  `isOwner || emoji.uploadedBy === me.id` (owner, or the uploader themself; no moderator
  carve-out). The component now matches that exactly per-row.

## Command wiring

Four builtins, all registered server-side (Track C1b) and dispatched through
`localHandlers` in `src/features/commands/runtime/commandDispatcher.ts` — the map that
`dispatchCommand` checks first for every palette/keybind trigger, so a bare keybind
fires the handler with no args and the handler supplies FE-computed args:

- **`oncall.who`** — navigates to the Incidents surface's On-call sub-tab
  (`{ kind: "incidents", tab: "oncall" }`). Read-only, no gating.
- **`oncall.take_shift`** — opens `OverrideModal` (see above), gated on
  `canManageOnCall`.
- **`incident.ack`** — dispatches `executeCommand` directly with the active incident's
  id (read from `useIncidentStore`), invalidates caches, toasts on success/failure.
- **`incident.escalate`** — same pattern as `incident.ack`, no local UI.

## C2 — AI agent operation

The four commands above are also AI agent tools, with no FE allowlist: the agent tool
loader (`src/features/agent/tools/loader.ts`) queries `commands(surface: AI)` and
registers every command the backend returns (`ai_callable` is a backend flag, flipped
per-command; the FE applies no client-side filter). `oncall.who` (Safe) runs one-shot;
`oncall.take_shift` / `incident.ack` / `incident.escalate` (Mutating) are gated by
`ConfirmCommandModal` through the server-issued confirmation challenge — the same
`runWithConfirmation` gate every agent tool call goes through, no command-specific engine
code.

- **Ack modal consequence copy** is sourced from `Command.description` (threaded through
  `RegisteredTool` → `ConfirmationRequiredError` → `ConfirmationRequest`), rendered as
  `request.description ?? request.nlDescription` in `ConfirmCommandModal`'s subtitle. For
  `incident.ack` this reads "Acknowledge an incident. This cancels the escalation chain
  and stops paging on-call for this incident." — see
  `docs/ux/confirm-command-modal-spec.md` §4.3 and
  `../rim-server/docs/specs/track-c2-agent-operator.md` §4.
- **Agent ack/escalate timeline visibility**: the backend's `incident_phase` note (e.g.
  "Incident acknowledged by {user_id} via AI agent … — escalation chain cancelled, paging
  stopped") renders through the existing `IncidentTimelinePanel` phase-notes rendering,
  unconditionally — no FE parsing, no new surface. Because agent tool calls bypass
  `commandDispatcher` (which is where the human ack/escalate paths invalidate incident
  queries), `src/features/agent/tools/postExecution.ts` fires the equivalent
  `incidentTimeline` / `activeIncident` invalidation from `loader.ts`'s `interpretResult`
  SUCCESS branch, scoped to exactly `incident.ack` / `incident.escalate` — not a general
  agent-invalidation framework.

## Remaining backend contract gap (tracked, not blocking what's shipped)

Discovered while implementing C1c; the rotation-layers-listing and `isOverride` gaps
that used to be listed here landed in a backend follow-up and are resolved (see the two
sections above). One remains, with no client-side workaround, called out in
`EscalationSubTab`'s own comment too:

- **No query to read a channel's current escalation-policy binding** — the "Channel
  default policies" control in `EscalationSubTab` can only *set*
  `setChannelEscalationPolicy`, never confirm or list existing bindings.
