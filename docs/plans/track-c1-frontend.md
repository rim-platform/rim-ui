# Track C1 — On-call & Escalation: Frontend UX Architecture (Phase 1)

_Author: Vision (frontend architect). Date: 2026-07-10._
_Scope: Phase 1 = contract-independent UX architecture. Phase 2 (data layer: hooks,
query keys, escalation event handling) is appended after iron-man's
`../rim-server/docs/specs/track-c1-oncall.md` SDL lands, under the same frozen-contract
verification discipline we used for the B2 incident events._
_Source: ROADMAP.md Track C (ratified 2026-07-10, C1 = spearhead) +
`../rim-server/docs/research/mattermost-playbooks-teardown-2026-07-10.md`._

## Why this shape
The teardown is unambiguous: on-call scheduling + escalation policies IN THE BOX is the
single strongest structural gap vs Mattermost (which punts to PagerDuty/Opsgenie). So C1
isn't a settings nicety — it's a first-class incident-domain surface and it must feel
native to RIM's keyboard-first, command-driven DNA, not like a bolted-on calendar widget.

Two distinct audiences, which drives all placement below:
- **Authoring** (schedules, escalation policies) — owner/moderator work, low-frequency,
  form-heavy. Lives in a managed surface, gated by role.
- **Operating** (who's on-call now, ack, escalation countdown) — every responder, during
  an incident, must be one keystroke away. Lives on the incident surfaces + ambient shell.

---

## 1. Where on-call lives in the shell

**Decision: a new "On-call" area *inside the Incidents surface*, not in Settings.**

`AppShell` already has `mainSurface.kind === "incidents"` rendering `IncidentHistoryPage`.
Promote that surface from a single page to an **Incidents hub with in-surface sub-tabs**:

```
Incidents surface (mainSurface.kind === "incidents")
├── Active / History   ← existing IncidentHistoryPage content
├── On-call            ← NEW: schedule list + rotation preview + overrides
└── Escalation         ← NEW: escalation policy editor
    (Metrics tab lands later with C5)
```

Rationale:
- Schedules and policies are **incident-domain objects**, not client/workspace preferences.
  Settings is already 14 tabs and is about *preferences and workspace primitives*; burying
  the wedge feature there is wrong for discoverability and wrong conceptually.
- People look for on-call *near incidents*. Co-locating gives the hub room to grow into
  C3/C5 without another top-level surface.
- Keeps `AppShell`'s surface-switch untouched in shape (still `kind === "incidents"`); the
  sub-tab state is local to the incidents feature (lowest-level state per our conventions).

Sub-tab nav mirrors `SettingsPage`'s in-surface tab pattern (segmented header, local
`useState` tab, deep-linkable later via a `mainSurface` `tab?` field if needed — same trick
SettingsPage uses). **Do not** add new top-level `mainSurface` kinds for these.

New feature slice: `src/features/oncall/` (`api/ → components/ → state/`), consistent with
the feature-sliced layout. The Escalation editor may live in `src/features/oncall/` too (it
is the on-call domain) or a sibling `src/features/escalation/` — recommend keeping both
under `oncall/` to avoid a thin slice; decide at phase 2.

---

## 2. Schedule editor UX — structured, keyboard-first, with a computed preview

**Decision: a structured list/form editor, NOT a drag-and-drop rotation calendar.** A
drag-drop calendar is mouse-centric, hard to make keyboard-accessible, heavy for the shared
web+desktop build, and — critically — it invites the frontend to *own rotation math*, which
it must not (see the hard rule below).

A **schedule** is authored as structured fields:
- Name.
- Timezone (IANA string; owned server-side — see contract ask #9).
- Ordered **participant list** (the rotation order).
- Rotation length (e.g. 1 week / 1 day / N days).
- Handoff time-of-day + start anchor.

The editor is keyboard-first:
- Participant list is a keyboard-navigable ordered list: `j/k` to move selection, a
  move-up/move-down affordance to reorder (reuse the ordered-list interaction pattern from
  KeybindSettings / macro step editors — check those for the existing idiom), add via a user
  picker, remove inline.
- Rotation length / handoff / timezone are `select`/input fields.
- Everything reachable without a pointer; buttons are real `<button>`s with the shared
  `Button`.

Above the editor, render a **read-only rotation preview strip** — a horizontal band showing
"who is on-call when" for the next N days (e.g. 14), with override layers marked distinctly.

> **HARD RULE — the frontend must NOT compute rotation resolution.** Rotation math with
> overrides, timezones, DST, and handoff boundaries is subtle and MUST match the escalation
> engine's own resolution exactly, or the UI will show a different on-call than the engine
> actually pages. The preview strip is rendered from a **server-resolved** shift list
> (contract ask #1: `onCallShifts(scheduleId, from, to)` → resolved intervals). The client
> only lays out intervals it's handed; it never derives them from the rotation spec.

This keeps the editor deterministic, unit-testable, web/desktop-identical, and correct.

---

## 3. Override flow — "take shift" quick action

An **override** temporarily replaces who's on-call for a window (cover, vacation, "I've got
it"). Surfaced three ways, all routing to one small modal:
- A "Take shift / Override" button in the On-call sub-tab.
- The status-bar on-call indicator's menu (§5).
- Palette command `oncall.override` / `oncall.takeShift` (§7).

Modal (shared `Dialog`), keyboard-first, minimal:
- **Who**: defaults to *me* ("Take shift"); optionally assign someone else ("Cover for…"),
  via the user picker.
- **When**: defaults to *now → end of the current shift* (the common case, one Enter);
  optional custom range.
- Confirm on Enter.

Overrides render as a distinct layer on the §2 preview strip (different token, e.g.
`rim-warm`) so it's visually obvious the base rotation was altered. Override intervals also
come from the server-resolved shift list — the client doesn't merge base+override itself.

---

## 4. Escalation policy editor — ordered steps with delays

An **escalation policy** is an ordered list of steps; each step targets someone and fires
after a delay if the incident is still unacked.

Editor: a keyboard-navigable **ordered step list** (same reorder idiom as §2). Per step:
- **Target**: a schedule (on-call), a specific user, or a channel (contract ask #4 for the
  allowed target types).
- **Delay**: when this step fires. **Semantics are an open contract question** (ask #3):
  recommend *delay-after-previous-step* (composes clearly, "L2 fires 5m after L1"), but
  iron-man owns the engine's actual model — do not assume.

Render the policy as a **vertical stepper** for comprehension:
```
L1  immediately        → @on-call (Primary schedule)
L2  after 5m unacked   → @on-call (Secondary schedule)
L3  after 15m unacked  → #incident-managers
```
Clear, read-only visualization above the editable list.

**Policy attachment** (what a policy applies to) is an open contract question (ask #2):
recommend per-channel and/or per-severity attachment with a workspace default fallback, but
this is iron-man's model to define; the editor's "applies to" control depends on his answer.

The escalation editor is advanced/low-frequency — consider gating its *entry point* behind
`DisclosureGate minTier={INTERMEDIATE}` (the codebase's progressive-disclosure primitive,
already used in StatusBar) so novice workspaces aren't overwhelmed. On-call viewing stays
ungated.

---

## 5. Who-is-on-call-now visibility

Three tiers of ambient → focused visibility:

1. **Status bar (ambient).** Add an on-call indicator to `StatusBar`'s right cluster:
   `On-call: @alice`. Click → opens the Incidents surface On-call sub-tab. Shown only when
   ≥1 schedule exists. With multiple schedules, show the primary (contract ask #10) or a
   count (`On-call: 2`). This is the "who's carrying the pager" signal, always visible.
2. **Incident banner (focused).** During an active incident, `IncidentBanner`
   (`src/features/incidents/components/IncidentBanner.tsx`) gains an on-call + escalation
   strip: current responder/on-call, ack state, and the escalation countdown (§6). This is
   the operational heart.
3. **Palette command `oncall.who`** (§7) → a compact panel/toast of current on-call across
   schedules, for a keyboard user who doesn't want to leave their surface.

(Later, a "on-call" badge on `UserHoverCard`/`Avatar` for whoever's currently paged — nice
to have, defer past C1.)

---

## 6. Ack affordance on incident surfaces

Acknowledgement is the operational heartbeat of escalation — the engine keeps escalating
until someone acks, so **ack must be one action from wherever a responder is looking**:

- **Primary: `IncidentBanner`.** Add an **Ack** button alongside Mitigate/Resolve, shown
  when the incident is unacked and escalating. Next to it, the escalation state:
  - unacked: `Unacked — escalating to L2 in 4:32` (a live countdown, same `setInterval`
    pattern the banner already uses for elapsed time).
  - acked: `Acked by @alice · 2m ago`.
- **Palette command `incident.ack`** (§7) + a **configurable keybind** (never hardcode a
  key — per our hard rule; register it as a keybind users can rebind).
- **Paged toast**: when the current user is the one being paged, a toast ("You're being
  paged for INC-123") with an inline **Ack** action, driven by the escalation
  WorkspaceEvent (§ phase 2).

This requires incident ack/escalation fields on the incident payload (contract ask #5):
`ackedBy`, `ackedAt`, `escalationLevel`, `nextEscalationAt`, `escalationStatus`. Without
these the banner can't render the countdown or ack state.

---

## 7. Palette commands (coordinate with iron-man via nick-fury)

RIM commands are **backend-registry-driven** — the frontend fetches the registry
(`src/features/commands/api/useCommands.ts`) and the palette/dispatcher route them through
the unified command dispatcher with sensitivity tiers + confirmation proofs. So on-call
palette commands should be **registered server-side**, not invented as frontend-only
actions — that's also what makes them composable into macros/pipelines (Track C2). This is a
coordination point, not a unilateral frontend decision.

Proposed command namespace (IDs/tiers/arg-schemas/surfaces to be confirmed by iron-man):
| Command | Tier | Effect |
|---|---|---|
| `oncall.who` | Safe (read) | Show current on-call across schedules |
| `oncall.takeShift` / `oncall.override` | Mutating | Create an override (defaults to me) |
| `incident.ack` | Mutating | Ack the active/target incident (stops escalation) |
| `incident.escalate` | Mutating | Manually bump to the next escalation level |

Note the `incident.declare`/`resolve`-as-commands work is C2, out of C1 scope — but reserve
the `incident.*` / `oncall.*` namespaces now so C2 slots in cleanly. Confirmation tiers
matter: `incident.escalate` and `oncall.override` are mutating and should carry the
appropriate sensitivity tier so the confirmation flow engages.

---

## 8. Role-signal contract — request an explicit `viewerRole`, not another best-effort gate

C1 makes the missing client role signal pressing: schedule and policy **editing** is
owner/moderator territory, and we already carry two best-effort gates (the B2 Integrations
tab; `EmojiManagement`'s hardcoded `isAdmin`). Stacking a third best-effort gate on the
on-call editors is the wrong path.

**Recommendation to iron-man (via nick-fury): expose the viewer's effective role on the
existing server/workspace query.**

```graphql
enum ServerRole { OWNER, MODERATOR, MEMBER }   # align with the backend's actual membership model

type Server {
  # ...existing...
  viewerRole: ServerRole!    # the requesting actor's effective role in THIS server
}
```

Frontend then adds a tiny `useMyServerRole(serverId)` selector over the already-cached
server query (no extra round-trip) and gates *editing affordances* on it: create/edit/delete
schedules & policies, `oncall.override` for others, revoke ingest token, emoji management.

Design constraints to state explicitly when requesting it:
- **Affordance/display gate ONLY.** The server still authoritatively enforces every mutation
  (defense in depth) — the client role never grants anything, it only hides controls the
  user can't use. This is exactly how we framed the B2 gate; now we make it real.
- **Per-server.** Roles differ per workspace; return the viewer's role for the queried
  server, not a global flag.
- **Single source, already loaded.** Put it on the server query the shell already runs so
  there's no new request and no races.
- Adopting this **retroactively fixes** the Integrations owner-gating gap and
  `EmojiManagement`'s fake `isAdmin` — worth doing as a small cleanup once it lands.

Open sub-question for iron-man: is the model owner-only, or owner/moderator/member? Are
there per-channel moderator roles that matter for on-call, or is it purely server-level?
The enum above assumes server-level owner/mod/member — confirm.

---

## 9. Open questions for iron-man's contract (blocking phase 2)

Explicit list to resolve before the phase-2 data layer is written:

1. **Schedule resolution API.** A `whoIsOnCall(serverId | scheduleId, at?)` (point) and
   `onCallShifts(scheduleId, from, to)` (range, for the preview strip). The frontend must
   not compute rotation math — confirm the server resolves rotations+overrides+timezone/DST.
2. **Policy attachment model.** Per-channel? per-severity? workspace default? Resolution
   order when multiple could apply?
3. **Escalation step delay semantics.** Absolute-from-declaration vs relative-to-previous-step?
4. **Escalation step target types.** schedule / user / channel / other?
5. **Incident ack/escalation fields.** Does `Incident` gain `ackedBy`, `ackedAt`,
   `escalationLevel`, `nextEscalationAt`, `escalationStatus`? These drive the §6 banner.
6. **New WorkspaceEvents.** Names + serialized field casing + which fields are
   `#[serde(skip_serializing)]` for: `IncidentEscalated`, `IncidentAcked`, and an on-call
   change event (`OnCallShiftChanged`?). Phase-2 event handling will verify these against
   `rim_services/src/events/types.rs` directly, same as B2 — a mismatch is a silent no-op.
7. **Role signal.** The `ServerRole` enum + `viewerRole` placement (§8).
8. **Command registry.** Will `oncall.*` / `incident.ack` / `incident.escalate` be
   registered backend commands (IDs, tiers, arg schemas, available surfaces), or
   frontend-only actions? Recommend backend commands for C2 composability.
9. **Timezone display.** IANA tz strings on the wire? Should the UI show handoff times in
   viewer-local or schedule-local time (or both)?
10. **Multiple schedules.** Is there a "primary" schedule concept, or are schedules named +
    independent? Drives the status-bar indicator (§5).

---

---

# PHASE 2 — Data layer (written 2026-07-10 against iron-man's `track-c1-oncall.md`)

**Contract LOCKED 2026-07-10** — iron-man folded all six flags into `track-c1-oncall.md`;
this section is final. Spider-man implements it AFTER C1c exposes the SDL, re-verifying the
event casing at that point (B2 discipline). Landing order: commands + events at **C1b**,
GraphQL surface + `escalationRun` at **C1c** — so keybind/command targets exist before the UI.

## Resolved from the contract (no longer open)
- **Delay semantics**: `EscalationStep.delay_seconds` is *before this step, from the previous
  step firing* (from declare for step 0). Exactly the relative model I recommended — the
  stepper renders "L2 · 5m after L1".
- **Policy attachment**: per-channel default (`setChannelEscalationPolicy(conversationId,
  policyId)`) + per-incident override (`StartIncidentCmd.escalationPolicyId`). No per-severity
  binding. The editor's "applies to" control is a channel binding, not severity.
- **Escalation targets**: `User` or `OnCall(schedule)` **only** — there is no channel
  *target*. A channel is reached via the `MENTION_IN_CHANNEL` *action* (posts into the
  incident channel). So drop the "#incident-managers" target row from my §4 stepper example;
  targets are user-or-schedule, actions are mention/email.
- **Ack**: orthogonal to status. `Incident` gains `acknowledgedAt`, `acknowledgedBy`,
  `acknowledgedByUser: User`; mutation `acknowledgeIncident(incidentId): Incident`, any
  member, idempotent. Banner ack-state (§6) reads `acknowledgedByUser` + `acknowledgedAt`.
- **Role signal**: use the EXISTING `ServerMemberRole { Owner, Moderator, Guest }` (not a new
  enum) via `Server.viewerRole: ServerMemberRole!`. Gate schedule/policy **editing** on
  `Owner | Moderator`; everyone else is view-only. Note there is no plain "Member" — the base
  role is `Guest`.

## New feature slice `src/features/oncall/`
`api/ → components/ → state/`. The escalation editor lives here too (same domain).

### Query hooks + keys
Add to `queryKeys` (all workspace-scoped ⇒ add their roots to `VOLATILE_WORKSPACE_KEY_ROOTS`
for reconnect scoping, exactly like `ingestTokens`):
- `onCallSchedules(serverId)` → `useOnCallSchedules` (list; the On-call sub-tab).
- `serverOnCall(serverId)` → `useServerOnCall` — the **batch** resolver (`serverOnCall(serverId):
  [OnCallNow!]`, one call, no N+1). Powers the status-bar indicator (§5) and `oncall.who`.
  Each `OnCallNow` carries `scheduleId`, `scheduleName`, `currentUser: User`, `nextUser: User`,
  `shiftEndsAt` — nested Users, so avatars/names render with no extra round-trip.
- `whoIsOnCall(scheduleId)` → `useWhoIsOnCall` — the per-schedule point resolver, for the
  "take shift" modal's default end (`shiftEndsAt`) and a single schedule's detail.
- `onCallShifts(scheduleId, from, to)` → `useOnCallShifts` — server-resolved shift list
  (`[OnCallShift { user: User, startAt, endAt, isOverride }]`). Powers the rotation preview
  strip; the FE lays out intervals it's handed and never computes rotation math (§2 hard rule,
  now fully honored — lands C1a).
- `escalationPolicies(serverId)` → `useEscalationPolicies` (the Escalation sub-tab).
Ack/escalation state is read off the **incident** queries (`activeIncident`,
`incidentTimeline`): `Incident` now carries `acknowledgedAt`, `acknowledgedByUser: User`, and
a nullable `escalationRun { currentStepIndex, nextFireAt, status }` (lands C1c) — that's the
data source for the banner ack-state and the live "escalating to L2 in 4:32" countdown, and it
works for fresh/reconnecting clients (not just live event listeners).

### Mutation hooks (all invalidate their list key on success)
`useCreateOnCallSchedule`/`update`/`delete`, `useAddRotationLayer`/`update`/`remove`,
`useSetRotationParticipants`, `useCreateOnCallOverride`/`delete`,
`useCreateEscalationPolicy`/`update`/`delete`, `useSetChannelEscalationPolicy`,
`useAcknowledgeIncident` (invalidates `activeIncident` + `incidentTimeline`). Editing
mutations are only *rendered* when `viewerRole` is Owner/Moderator; the server enforces
regardless.

### Role gating helper
`useMyServerRole(serverId)` — a selector over the already-cached `server` query's
`viewerRole` (no new request). `const canManage = role === Owner || role === Moderator`.
Gate: schedule/policy create-edit-delete, override-for-others, ingest-token revoke (B2), and
`EmojiManagement` (drop its hardcoded `isAdmin`). **Display gate only** — never a security
boundary.

### Event handling (`useWorkspaceEvents`) — verify casing against the Rust at C1b/C1c
Two new variants (iron-man §9), same B2 shape (`conversation_type` carried,
`member_user_ids` `#[serde(skip_serializing)]` ⇒ NOT in the TS type):
- `EscalationStepFired { workspace_id, conversation_id, conversation_type, incident_id,
  escalation_policy_id, step_index, target_user_ids }` → invalidate `activeIncident` +
  `incidentTimeline`; **if the current user's id ∈ `target_user_ids`, show the paged toast
  with inline Ack** (§6). `target_user_ids` is serialized precisely so the FE can do this.
- `IncidentAcknowledged { workspace_id, conversation_id, conversation_type, incident_id,
  acknowledged_by }` → invalidate `activeIncident` + `incidentTimeline`; dismiss any paged
  toast for that incident.
Add both to `src/core/events/types.ts` with the JSDoc "verify against
`rim_services/src/events/types.rs`" caveat, and cases to `handleEvent`. **These land in the
backend at C1b — do NOT add the TS handlers until then, and verify the serialized shape at
that point** (a mismatch is a silent no-op, per B2).

## Command integration (Flag E resolved — real builtins, not throwaway buttons)
Four builtins register in the command registry at **C1b** (before the UI): `incident.ack`,
`incident.escalate`, `oncall.who`, `oncall.take_shift` — all `keybind_capable=true`,
`ai_callable=FALSE` for C1 (C2 flips `ai_callable` + adds intent routing; nothing here is
thrown away, and macro/pipeline composability comes free). Each executor calls the same
service method as the matching GraphQL mutation via the unified dispatcher. Consequences for
the FE:
- **Ack** is dispatched through the `incident.ack` command from all three entry points — the
  banner button, the paged-toast inline action, and a **configurable keybind** (bound to
  `incident.ack` like any keybind; no hardcoded key, no special-case bypass — satisfies the
  hard rule). The banner button and toast dispatch the same command id, not a bespoke mutation
  call, so behavior is identical everywhere.
- **`oncall.take_shift`** opens the override modal (§3); **`incident.escalate`** bumps the
  level; **`oncall.who`** surfaces the `serverOnCall` panel (§5). These appear in the palette
  automatically because they're registered commands.
- Dispatch flows through the sensitivity/confirmation pipeline. **One UX check (below):**
  `incident.ack` must stay a single action — no confirmation modal in the page-response path.

## Scope / expectations
- All plain React + GraphQL — no Tauri; the web build gets identical on-call UI.
- C1 reachability is **in-app only** (banner strip, paged toast, ack). Real device push is
  Track D4 (PWA) — not C1.
- Full component tree, props, state-location, test-list and doc-list handoff to spider-man
  comes when C1c freezes the SDL — same format as the A/B specs.

## Ack is single-action — RESOLVED 2026-07-11
The ack-friction question is closed (iron-man ruled, verified against the gate code):
`incident.ack` = `Mutating`, `dangerous:false`. `requires_confirmation_for_initiator` only
fires for the `Restricted` tier, the `dangerous` flag, or agentic+≥Mutating dispatch. Every C1
human ack surface (palette / keybind / context-menu / banner button / paged-toast) is
NON-agentic, so plain `Mutating` = **single action, no confirmation prompt**. → Use the
**primary unified-dispatch path** for `incident.ack` (see command wiring); the direct-mutation
fallback is NOT needed.

---

# PHASE 3 — C1c implementation handoff (spider-man)

**Contract landed + reviewed (C1a/C1b green, black-widow cross-tenant-paging HIGH fixed).**
This is the concrete build spec — component tree, props, state location, hooks, tests, docs.
Phase-1/2 above hold the rationale; don't re-derive it here.

## Pre-flight
- **Codegen:** ping nick-fury to re-export the fresh SDL (server was killed by disk
  pressure), then `curl .../api/sdl > schema.graphql && npm run codegen`. Import ALL new
  types from `generated/schema-types.ts` — never hand-write: `OnCallSchedule`, `RotationLayer`,
  `RotationParticipant`, `OnCallOverride`, `OnCallNow`, `OnCallShift`, `EscalationPolicy`,
  `EscalationStep`, `EscalationTarget`, `EscalationActionKind`, `ServerMemberRole`, and the
  `Incident` additions (`escalationRun`, `acknowledgedAt`, `acknowledgedByUser`).
- **Event casing: VERIFIED by Vision 2026-07-11** against `rim_services/src/events/types.rs`
  (Read, not git). Confirmed shapes for the two new variants — build the TS union to match
  exactly:
  - `EscalationStepFired`: `workspace_id, conversation_id, conversation_type, incident_id,
    escalation_policy_id, step_index (i32), target_user_ids: string[]` (serialized). NO
    `member_user_ids` (it's `#[serde(skip_serializing)]` — must NOT be in the TS type).
  - `IncidentAcknowledged`: `workspace_id, conversation_id, conversation_type, incident_id,
    acknowledged_by`. NO `member_user_ids`.
  - PascalCase `type` tag, snake_case fields — same as the B2 incident variants.

## Feature slice `src/features/oncall/`
```
api/     useOnCallSchedules.ts   (list + create/update/delete + layer + participant + override mutations)
         useServerOnCall.ts      (serverOnCall batch — status bar + oncall.who)
         useWhoIsOnCall.ts       (per-schedule point resolver — override-modal default end)
         useOnCallShifts.ts      (range resolver — preview strip)
         useEscalationPolicies.ts(list + create/update/delete + setChannelEscalationPolicy)
components/ OnCallSubTab, ScheduleEditor, RotationLayerEditor, RotationPreviewStrip,
            OverrideModal, EscalationSubTab, EscalationPolicyEditor, EscalationStepList,
            OnCallIndicator (status bar)
```
`useAcknowledgeIncident` lives in `src/features/incidents/api/` (it's an incident mutation).
Query keys + roots (add all to `VOLATILE_WORKSPACE_KEY_ROOTS`): `onCallSchedules`,
`serverOnCall`, `whoIsOnCall`, `onCallShifts`, `escalationPolicies`.

## Role gating — do this FIRST (small, unblocks every editor)
`src/features/.../useMyServerRole.ts`: selector over the cached `server(serverId)` query's
new `viewerRole: ServerMemberRole!` (add the field to that query's selection + regen). Expose:
- `useMyServerRole(serverId): ServerMemberRole | undefined`
- `canManageOnCall = role === Owner || role === Moderator` (schedule/policy/override editing)
- `isOwner = role === Owner`

**Retro-fixes (owned by us, do them here):**
- **B2 Integrations tab** (`IngestTokenSettings`): ingest-token CRUD is **owner-only** on the
  backend (B2 `ensure_server_owner`), so gate its editing affordances on `isOwner`, not
  `canManageOnCall`. Replace the "render + forbidden-state" best-effort with a real
  `useMyServerRole` check (keep the forbidden banner as the belt-and-suspenders fallback).
- **`EmojiManagement`**: replace the hardcoded `isAdmin` prop with a real role check. Confirm
  the backend's emoji permission (owner-only vs owner+moderator) and gate accordingly — do
  NOT guess; check the emoji mutation's server gate and match it.

All role gating is **display-only**; the server enforces every mutation regardless (never a
security boundary — same framing as B2).

## Incidents hub restructure
New `IncidentsHub` (in `src/features/incidents/components/`) replaces the direct
`IncidentHistoryPage` render for `mainSurface.kind === "incidents"` in
`AppShell`/`WorkspaceShell`:
- Segmented sub-tab header (mirror `SettingsPage`'s tab idiom): **Active / History**
  (existing `IncidentHistoryPage` body), **On-call** (`OnCallSubTab`), **Escalation**
  (`EscalationSubTab`).
- Sub-tab state: local `useState<"history"|"oncall"|"escalation">` (default `"history"`).
  Optionally deep-linkable later via a `tab?` field on the incidents surface kind (like
  settings) — not required for v1; keep local.
- Wrap **each** sub-tab body in `SurfaceErrorBoundary` (`surface="On-call"` etc.,
  `resetKeys={[subTab]}`) so one editor crash doesn't take the hub down. (The outer incidents
  surface is already boundary-wrapped from Track A; this is finer-grained.)
- On-call and Escalation sub-tabs are **viewable by all members**; only the editing
  affordances inside are `canManageOnCall`-gated.

## Component specs

### OnCallSubTab
- `useOnCallSchedules(serverId)` → schedule list; each row expands to
  `RotationPreviewStrip` + current on-call (from `useServerOnCall`) + overrides list.
- Header actions (canManageOnCall): "Create schedule" → `ScheduleEditor`; "Take shift" →
  `OverrideModal`.

### ScheduleEditor (canManageOnCall)
- Fields: `name`, `timezone` (IANA select; default from `user.timezone` or
  `Intl.DateTimeFormat().resolvedOptions().timeZone`), and one-or-more rotation layers.
- Orchestrates the granular mutations: `createOnCallSchedule` → then per layer
  `addRotationLayer` + `setRotationParticipants(layerId, [userId] ordered)`. Editing an
  existing schedule uses the update/remove variants. Keep the mutation sequence explicit
  (create schedule first for its id, then layers, then participants).
- **`RotationLayerEditor`** per layer: `name`, `priority`, `kind` (Daily → `handoffTime`;
  Weekly → `handoffWeekday` + `handoffTime`; Custom → `intervalSeconds`), `anchorAt`
  (datetime), and an ordered **participant list**: keyboard-navigable (`j/k` + move up/down),
  add via the user picker, remove inline. Reuse the ordered-list idiom from
  `KeybindSettings`/macro editors (check those for the existing pattern).

### RotationPreviewStrip
- `useOnCallShifts(scheduleId, from=now, to=now+14d)` → `[OnCallShift { user: User, startAt,
  endAt, isOverride }]`. Render a horizontal band of segments positioned by `startAt/endAt`
  across the window, labeled with `Avatar` + name; `isOverride` segments in `rim-warm`.
- **HARD RULE (enforced by test):** the strip renders ONLY the server-resolved intervals it's
  handed. It never derives shifts from the rotation spec — no client rotation/timezone math.
  A test must feed it a fixed `OnCallShift[]` (incl. an override) and assert layout, proving
  no computation.
- Read-only; focusable segments show a tooltip (user, start–end in the viewer's local tz).

### OverrideModal (canManageOnCall)
- **Product note:** `createOnCallOverride` is schedule CRUD → **owner/moderator only** per the
  contract; a Guest cannot self-assign in C1. If we later want members to self-volunteer,
  that's a new member-allowed backend mutation (future). State this so it's a deliberate
  choice, not an oversight.
- **Who:** default *me* ("Take shift"); optional other user ("Cover for…").
- **When:** default `now → whoIsOnCall(scheduleId).shiftEndsAt` (one Enter); optional custom
  range. If invoked without a schedule (status-bar entry with multiple schedules), pick the
  schedule first.
- Confirm → `createOnCallOverride`.

### EscalationSubTab + editors
- `useEscalationPolicies(serverId)` → policy list; each renders the vertical stepper
  (read-only comprehension view). "Create policy" (canManageOnCall).
- A **"Channel default policies"** section: list `conversation → policy` bindings with an
  edit control calling `setChannelEscalationPolicy(conversationId, policyId)` (channel select
  + policy select). Keeps the binding UI in the escalation domain, not channel settings.
- **`EscalationPolicyEditor`**: `name` + ordered `EscalationStepList`. Per step:
  - **Delay** (number + unit → `delaySeconds`; step 0 delay 0 = immediate). Semantics:
    delay-after-previous-step (already resolved in the contract).
  - **Target** (kind toggle → `User` picker OR `OnCall` schedule picker; targets are
    user-or-schedule ONLY — no channel target).
  - **Actions** (checkboxes: `MENTION_IN_CHANNEL`, `EMAIL`; ≥1 required; `PUSH` reserved but
    hidden in C1).
  - Reorder steps `j/k`. Stepper preview above the editable list.
- Save via `createEscalationPolicy(name, steps)` / `updateEscalationPolicy`.

### IncidentBanner extension (ack + escalation)
Extend `src/features/incidents/components/IncidentBanner.tsx`:
- When `incident.escalationRun` present and run `status === active`: an escalation strip —
  `Escalating to L{currentStepIndex + 1} in {countdown to nextFireAt}`, a live countdown
  reusing the existing `setInterval` elapsed pattern. Recompute against `nextFireAt`; when it
  passes, show "escalating…" until the next event/refetch updates `escalationRun`.
- When `incident.acknowledgedAt` set: `Acked by {acknowledgedByUser.displayName} ·
  {relative}` — no countdown.
- **Ack button** (shown when unacked && escalating): dispatches the `incident.ack` command
  (see command wiring). Placed alongside Mitigate/Resolve.

### OnCallIndicator (status bar)
- Add to `StatusBar`'s right cluster: `On-call: @alice` from `useServerOnCall(serverId)`.
  Render only when ≥1 schedule has a current on-call; multiple → show the count
  (`On-call: 2`) or primary. Click → open the Incidents surface On-call sub-tab. Lightweight
  (one batched query, staleTime). NOT behind DisclosureGate — on-call is core.

## Command wiring (resolves the deferred take-shift question — NO backend change)
`dispatchCommand` checks `localHandlers` FIRST for every dispatch path (palette AND keybind),
so a bare keybind fires the local handler with no args, and the handler supplies FE-computed
args — the exact pattern `incident.start`/`incident.resolve`/`admin.invite_member` already
use. Register local handlers in `commandDispatcher.ts` for the four C1 builtins:
- **`oncall.take_shift`**: open `OverrideModal` defaulting to me / `now → shiftEndsAt`
  (computed client-side from cached `serverOnCall`/`whoIsOnCall`). On confirm, dispatch the
  backend command with explicit `{ scheduleId, userId, startAt, endAt }` args (or call
  `createOnCallOverride`). The **backend command stays a general primitive requiring explicit
  args** — correct for macro/pipeline/agent use; the interactive FE supplies them. **This is
  the full resolution of the C1c open question — no iron-man change needed.** (canManageOnCall
  guard: if not, toast "Managing on-call requires Moderator".)
- **`incident.ack`**: read the active incident from `useIncidentStore`; single action, no
  modal. Dispatch `executeBackend({ commandId: "incident.ack", args: { incidentId } })`
  (unified dispatch). **Ack-tier RESOLVED 2026-07-11** — `Mutating`/`dangerous:false`,
  non-agentic human surfaces don't trigger `requires_confirmation_for_initiator`, so this fires
  single-action with no prompt. Use this primary path; there is **no** direct-mutation fallback
  (keeps ack consistent with the other three commands and pre-fits C2).
- **`incident.escalate`**: read active incident; dispatch `executeBackend` (a confirm here is
  acceptable — deliberate action).
- **`oncall.who`**: open a compact `serverOnCall` panel (or navigate to the On-call sub-tab).
  Read-only.

The ack keybind is just a normal keybind bound to `incident.ack` (configurable, no hardcoded
key). Same command id fires from banner button, paged-toast, and keybind.

## Event handlers (`useWorkspaceEvents`) — casing pre-verified above
Add the two variants to `src/core/events/types.ts` (exact shapes in Pre-flight) with the
"verified 2026-07-11 against types.rs" JSDoc note, and `handleEvent` cases:
- **`EscalationStepFired`** → invalidate `activeIncident(workspaceId, conversation_id)` +
  `incidentTimeline(incident_id)` + `["listIncidents", workspaceId]`; **if the current
  user's id ∈ `target_user_ids`**, show the paged toast (`You're being paged for {incident}`)
  with an inline **Ack** action that dispatches `incident.ack`.
- **`IncidentAcknowledged`** → same invalidations; dismiss any paged toast for `incident_id`.

## Tests (Vitest + Testing Library)
Per new hook + component. Non-exhaustive but mandatory coverage:
- Hooks: query shape + key; mutations invalidate their list key; `useServerOnCall` batch
  shape; `useMyServerRole` returns the role and `canManageOnCall`/`isOwner` derive correctly.
- `RotationPreviewStrip`: fed a fixed `OnCallShift[]` incl. an override → correct segment
  layout + override styling, **proving no client-side shift computation**.
- Editors: keyboard reorder of participants/steps; role-gated affordances **hidden for a
  Guest** and shown for Owner/Moderator; mutation called with the right args.
- `OverrideModal`: default window is `now → shiftEndsAt`; owner/mod-gated.
- `IncidentBanner`: countdown renders from `escalationRun`; acked state renders
  `acknowledgedByUser`; Ack button dispatches `incident.ack`.
- `OnCallIndicator`: renders from `serverOnCall`, hidden when none.
- Command handlers: `oncall.take_shift` opens the modal (no args needed); `incident.ack`
  single-action; `oncall.who` opens the panel.
- Event handlers: `EscalationStepFired` invalidates + paged toast only when the current user
  is in `target_user_ids`; `IncidentAcknowledged` invalidates + dismisses the toast.
- Retro-fixes: Integrations affordances hidden for non-owner; EmojiManagement gated.

## Docs
- JSDoc on every new hook/component (state the "FE computes no rotation math" invariant on
  `RotationPreviewStrip` and `useOnCallShifts`, and the keybind→local-handler arg-supply
  pattern on the command wirings).
- New `docs/oncall-ui.md`: Incidents-hub structure, keyboard-first editor model, the
  server-resolved-shifts invariant, override/ack flows, the command-wiring pattern, and role
  gating (canManageOnCall vs isOwner). Cross-link `../rim-server/docs/oncall.md`.
- Update `docs/error-boundaries.md` (new wrapped sub-tabs) and `CLAUDE.md`'s feature list.

## Build order
1. `useMyServerRole` + the two retro-fixes (small, unblocks gating).
2. Query hooks + keys + reconnect roots.
3. Event handlers (casing pre-verified).
4. Incidents hub + OnCallSubTab + ScheduleEditor + RotationPreviewStrip.
5. OverrideModal.
6. EscalationSubTab + policy editor + channel bindings.
7. IncidentBanner ack + countdown; OnCallIndicator.
8. Command wirings.
Codegen (step 0) gates everything — ping nick-fury for the SDL re-export first.
