# Track C2 — Frontend Assessment & Spec (Agent Operator)

_Spec by vision, 2026-07-13. Requested by nick-fury. Backend spec (ratified):
`../rim-server/docs/specs/track-c2-agent-operator.md`. Backend implemented in
parallel by hulk. **No SDL change (backend §7) — do NOT run codegen; do NOT
touch `schema.graphql` or `src/core/graphql/generated/`.**_

**Headline: the FE agent runtime handles C2 generically — this is
verification-plus-one-small-change.** Deltas 2 and 3 are VERIFIED-NO-CHANGE.
Delta 1 (ack consequence copy in the confirmation modal) needs a small,
mechanical change: `Command.description` is fetched by the tool loader but
dropped before registration, so the modal can never render it — the backend §4
ruling ("modal copy source = `Command.description`") is only satisfied today by
accident, via the duplicated copy in `nl_description`. We thread `description`
through the existing pipeline (7 small edits, no new component, no engine
change) and add regression tests for all three deltas.

Scope guard: no agent-UI redesign, no engine changes, no new modal elements,
no changes to `runWithConfirmation` control flow.

---

## Delta 1 — Ack warning copy in the confirmation modal: CHANGE NEEDED (small)

### Verified current behavior (evidence)

- The modal subtitle renders **only `nlDescription`**:
  `src/features/agent/components/ConfirmCommandModal.tsx:291-295`
  (`{request.nlDescription && <p ...>{request.nlDescription}</p>}`). No other
  element renders command copy; `Command.description` never reaches the modal.
- The loader **fetches** `description` (`src/features/agent/tools/loader.ts:64`,
  `AI_COMMANDS_QUERY`) but **drops** it at registration:
  `src/features/agent/tools/generator.ts:98-108`
  (`buildAiToolRegistrationOptions` keeps `sensitivity`, `requiresConfirmation`,
  `nlDescription` — not `description`).
- `RegisteredTool` has no `description` field
  (`src/features/agent/tools/types.ts:12-25`), so the challenge enrichment at
  `src/features/agent/tools/loader.ts:182-192` (`interpretResult` →
  `ConfirmationRequiredError`) can only attach `sensitivity` + `nlDescription`.
- `ConfirmationRequest` has no `description`
  (`src/features/agent/state/confirmationModalStore.ts:5-22`), and the gate
  passthrough (`src/features/agent/runtime/confirmationGate.ts:74-84`) carries
  only `nlDescription`/`serverMessage`.
- The original UX spec **already ruled** the subtitle source is
  `nl_description ?? description`
  (`docs/ux/confirm-command-modal-spec.md:139-143`) — the fallback half was
  never implemented.

### Why this is a change, not a no-op

For `incident.ack` the consequence IS currently visible, because backend §1d
duplicates it into `nl_description`. But:

1. The ratified backend §4 ruling designates **`Command.description`** as the
   human-facing warning carrier. Relying on the model-facing `nl_description`
   (sanitized, length-capped, tuned for the LLM) means a future copy edit to
   `nl_description` silently deletes the human warning.
2. The subtitle is `line-clamp-2` (`ConfirmCommandModal.tsx:292`). The ack
   `nl_description` is ~216 chars; at `max-w-lg`/`text-sm` two lines is
   ~120-140 chars — the "stops paging on-call" clause sits at the clamp
   boundary and can be clipped. The ack `description` ("Acknowledge an
   incident. This cancels the escalation chain and stops paging on-call for
   this incident.", ~103 chars) fits comfortably.

### The change (spider-man)

Thread `description` through the existing pipeline, mirroring `nlDescription`
exactly at every hop, and prefer it in the subtitle:

1. `src/features/agent/tools/types.ts` — add `description?: string` to
   `RegisteredTool`, with a doc comment: raw backend `Command.description`,
   the human-facing consequence line for the confirmation modal (C2 §4);
   distinct from `nlDescription` (model-facing) and from
   `definition.description` (LLM tool string with intent-sample footer).
2. `src/features/agent/tools/generator.ts` — `AiToolRegistrationOptions` gains
   `description?: string`; `buildAiToolRegistrationOptions` sets
   `description: cmd.description`.
3. `src/features/agent/tools/registry.ts` — `registerTool` options gain
   `description`; store it on the `RegisteredTool`.
4. `src/features/agent/tools/loader.ts` — `interpretResult` enrichment adds
   `description: registered?.description` to the `ConfirmationRequiredError`
   challenge (next to `nlDescription`, ~line 189). Also pass `description`
   through both `registerTool` call sites for hardcoded-snapshot re-registration
   (~lines 302-307 and 319-325) so idempotent reloads don't drop it.
5. `src/features/agent/runtime/confirmationGate.ts` —
   `ConfirmationChallengeData` and `RunOptions` gain `description?: string`;
   `awaitDecision` passes `description: opts.description ?? challenge.description`
   into the `ConfirmationRequest` (mirror of the `nlDescription` line at :82).
   No control-flow change. (No `agentEngine.ts` change — the engine keeps
   passing only `{ sensitivity }`; enrichment happens in `interpretResult`,
   same as `nlDescription` today.)
6. `src/features/agent/state/confirmationModalStore.ts` —
   `ConfirmationRequest` gains `description?: string` (doc comment: C2 §4,
   human-facing consequence line, sourced from GraphQL `Command.description`).
7. `src/features/agent/components/ConfirmCommandModal.tsx` — subtitle renders
   `request.description ?? request.nlDescription` (keep `line-clamp-2`, keep
   the single `<p>`; no new elements). Add a brief comment citing C2 §4: the
   backend carries consequence copy (e.g. incident.ack "cancels the escalation
   chain and stops paging") in `description`, which is written for humans;
   `nlDescription` remains the fallback for commands without one.

**Precedence ruling (mine):** `description ?? nlDescription`, superseding the
`nl_description ?? description` preference in
`docs/ux/confirm-command-modal-spec.md:139-143`. Rationale: the ratified C2
backend spec §4 names `description` as the warning carrier; `description` is
the human-facing field (palette copy) while `nl_description` is model-facing
and clamp-prone. "Falling back to title" from backend §4 is satisfied
structurally: the modal `<h2>` already renders the command name
(`ConfirmCommandModal.tsx:288-290`), so we do not thread `title`.
**Side effect (flagged deliberately):** commands whose `description` and
`nl_description` both exist (e.g. `chat.create_channel`) will now show
`description` as the subtitle. This is the intended generalization of §4, not
an accident. If nick-fury wants zero copy change outside incident.ack, the
alternative is per-command special-casing — rejected as an allowlist smell.

### Tests (delta 1)

- `src/features/agent/tools/generator.test.ts`:
  `buildAiToolRegistrationOptions` preserves `description` (and still preserves
  `nlDescription` independently).
- `src/features/agent/tools/registry.test.ts`: `registerTool` stores
  `description`; `getTool` returns it.
- `src/features/agent/tools/loader.test.ts`: a `CONFIRMATION_REQUIRED` response
  for a registered backend command produces a `ConfirmationRequiredError`
  whose challenge carries the registered `description`.
- `src/features/agent/runtime/confirmationGate.test.ts`: the
  `ConfirmationRequest` handed to `modal.open` includes `description` from the
  challenge.
- `src/features/agent/components/ConfirmCommandModal.test.tsx`:
  1. renders `description` as the subtitle when both `description` and
     `nlDescription` are present (precedence pin);
  2. falls back to `nlDescription` when `description` is absent (existing
     behavior regression);
  3. **C2 regression:** request with `commandId: "incident.ack"`,
     `sensitivity: MUTATING`, and `description: "Acknowledge an incident. This
     cancels the escalation chain and stops paging on-call for this incident."`
     → the dialog visibly contains "cancels the escalation chain" and "stops
     paging on-call".

### Docs (delta 1)

- Update `docs/ux/confirm-command-modal-spec.md:139-143`: subtitle source is
  now `description ?? nl_description`, superseded per C2 §4 (link the backend
  spec), dated.
- Update the stale comment at `src/features/agent/tools/generator.ts:102-105`
  (it cites the old subtitle ruling).

---

## Delta 2 — Incident timeline transcript: VERIFIED-NO-CHANGE (rendering)

The backend note arrives as a new `incident_phase` row with `note` set, via the
same mechanism as C1 escalation-step notes. The FE already renders it:

- Query selects `phases { id incidentId phase startedAt endedAt note }` —
  `src/features/incidents/api/useIncident.ts:92-99` (`INCIDENT_TIMELINE`).
- `IncidentTimelinePanel` maps **all** phases
  (`src/features/incidents/components/IncidentTimeline.tsx:160-162`) and
  `PhaseSection` renders `phase.note` unconditionally when present
  (`IncidentTimeline.tsx:81`). The only filter in the component is on
  `taggedMessages` by phase (`IncidentTimeline.tsx:66`) — notes are never
  filtered. `IncidentHistoryPage.tsx` does not render phases/notes at all, so
  no second surface to audit.
- Wording note from backend §3c ("Incident acknowledged by {user_id} via AI
  agent … — escalation chain cancelled, paging stopped") is plain text in
  `phase.note` — no FE parsing, no change.

**Cache-freshness caveat (recommended small addition, nick-fury may strike):**
the human dispatch path invalidates incident queries after ack/escalate
(`src/features/commands/runtime/commandDispatcher.ts:118-121` and `:346-349`),
but the agent tool path performs **no** TanStack Query invalidation anywhere
(verified: zero `queryClient`/`invalidate` references under
`src/features/agent/`). So after a user approves an agent ack, an
already-open timeline panel / incident banner won't refresh until remount or
window refocus (`staleTime` 5s/10s, no `refetchInterval`). The note is never
*hidden* — strictly this delta is no-change — but C2's demo value is "the
timeline proves it", so I recommend:

- New module `src/features/agent/tools/postExecution.ts` exporting
  `invalidateAfterCommand(commandId: string, args: Record<string, unknown>): void`:
  for `incident.ack` / `incident.escalate`, invalidate
  `queryKeys.incidentTimeline(args.incidentId)` when `args.incidentId` is a
  string (else prefix-invalidate `["incidentTimeline"]`) plus prefix-invalidate
  `["activeIncident"]` (the full key needs workspace/conversation ids the agent
  path doesn't reliably have; prefix matching is TanStack-native). Doc comment:
  mirrors `commandDispatcher.ts:118-121`; exists because agent tool calls
  bypass the dispatcher. Keep it a two-entry map — this must not grow into a
  dispatcher clone; anything bigger goes through a real design pass.
- Call site: `loader.ts` `interpretResult`, in the `SUCCESS` branch
  (~line 169-171) — single choke point covering both the one-shot path and the
  post-proof path (`executeCommandWithProof` flows through `interpretResult`).
- Tests (`postExecution.test.ts` + one `loader.test.ts` case): ack/escalate
  success → both invalidations fired with expected keys; non-incident command
  → no invalidation; `CONFIRMATION_REQUIRED`/error results → no invalidation.

---

## Delta 3 — Tool loading of the four commands: VERIFIED-NO-CHANGE

There is no FE allowlist; the backend `ai_callable` flip is sufficient:

- `fetchAiCommands` queries `commands(surface: AI)` with no client-side
  filtering — `src/features/agent/tools/loader.ts:50-80` (query),
  `:212-215` (fetch).
- Every returned command becomes a tool: `commandsToBackendTools` maps the full
  array (`loader.ts:204-210`), and `loadAgentTools` registers all of them
  (`loader.ts:315-329`). The merge only drops **hardcoded** tools on name
  collision (`mergeBackendWins`, `loader.ts:93-113`), and post-#55 the
  hardcoded set is exactly `get_current_context` (`loader.ts:283-287`) — no
  collision with `oncall.*`/`incident.*`.
- Confirmation flow is server-response-driven, confirming nick-fury's ground
  truth: every tool call is wrapped by `runWithConfirmation`
  (`src/features/agent/runtime/agentEngine.ts:258-260`); the gate opens the
  modal on `ConfirmationRequiredError` and re-calls with the `InBandToken`
  proof (`confirmationGate.ts:97-118`, `loader.ts:151-161`); the mutation
  always sends `initiator: AGENT` (`loader.ts:132`) and selects the full
  challenge payload (`loader.ts:35-48`). So: `oncall.who` (Safe) runs one-shot;
  the three Mutating commands gate via the server challenge with **zero engine
  or gate changes**.

Verified adjacent interactions (no change, listed so nobody "fixes" them):

- Turn budget counts the three Mutating commands against
  `MAX_MUTATING_PER_TURN = 3` (`src/features/agent/runtime/turnBudget.ts:21`,
  `isMutating` `:26-30`). An agent run can ack + escalate + take_shift, then
  further mutating calls are skipped with a replan message. Intended.
- Type-to-confirm does not trigger for these (MUTATING tier only requires it
  with the not-yet-emitted `sameTurnAfterToolResult` flag —
  `ConfirmCommandModal.tsx:120-122`); Mutating gets the "Run anyway" warm
  treatment with backdrop-close disabled (`:54-65`). Intended.
- Modal auto-rejects at challenge expiry (`ConfirmCommandModal.tsx:179-189`);
  the gate's single stale-token retry (`confirmationGate.ts:41,108-117`)
  covers re-issue. Intended.

### Tests (delta 3 regression pin)

- `src/features/agent/tools/loader.test.ts`: mock `AgentListAiCommands`
  returning the four C2 commands (realistic shapes: `oncall.who` SAFE, others
  MUTATING, each with `description` + `nlDescription` + `intentSamples`) →
  assert all four are registered (`getTool("incident.ack")` etc.), with
  correct `sensitivity` and stored `description`, and that no allowlist drops
  them. This is the FE mirror of the backend's §5 inventory test.

---

## Consolidated handoff to spider-man

Implementation order:

1. Delta 1 threading (types.ts → generator.ts → registry.ts → loader.ts →
   confirmationGate.ts → confirmationModalStore.ts → ConfirmCommandModal.tsx)
   + its 5 test files + the two doc updates.
2. Delta 2 recommended addition (`postExecution.ts` + `loader.ts` call site)
   + tests — **confirm with nick-fury before building; it is severable.**
3. Delta 3 loader regression test (pure test addition).
4. Docs: add a short "C2 — AI agent operation" subsection to
   `docs/oncall-ui.md` (mirrors backend `docs/oncall.md` §8): the four
   commands are agent tools via `commands(surface: AI)`; Safe read one-shot;
   Mutating gated by ConfirmCommandModal via the server challenge; ack modal
   consequence copy sourced from `Command.description`; agent ack/escalate
   appear as timeline notes through existing `IncidentTimelinePanel` rendering.

Hard rules (restating repo policy): every new function/field gets tests AND
docs (doc comments count for fields; the two .md updates above are mandatory).
No codegen run. No git operations. `npm run build`, `npm test`,
`npm run lint`, `npm run format:check` all green. Hawkeye review before done.

Out of scope (do not do): engine/gate control-flow changes, new modal
elements or severity tiers, human-dispatch (commandDispatcher) changes,
`schema.graphql` edits, any generalized invalidation framework, channel-name
resolution, `title` threading.
