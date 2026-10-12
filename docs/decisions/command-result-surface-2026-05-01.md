> **Status:** Draft 2026-05-01: design only, awaiting review and implementation.
> **Author:** Frontend and UX design
> **Drives:** The implementation pass that adds a first-class result surface for single-command backend results in the palette, and removes the toast preview shipped after finding 5.
> **Scope:** Single-command backend results dispatched via the command palette. NOT pipeline results (`PipelineResultView` is untouched). NOT agent tool results (`agent/tools/registry.ts` is untouched). NOT plugin command results (separate bridge, also out of scope). NO backend changes — payload shapes are fixed.

# Command Result Surface — single-command backend results

---

## 0. TL;DR

Three things change visibly:

1. **Single backend commands that return data render in an inline result panel below the palette input.** The palette stays open. Esc dismisses the result and clears it; Backspace from an empty input does the same; typing replaces the result with command-list filtering as today. Pipe results keep using `PipelineResultView` in their existing slot.
2. **A small per-command renderer registry** picks the right view (channel rows, member rows, message rows, key-value card, scalar/empty card, raw-JSON fallback). The registry keys on `commandId`. An auto-inference fallback handles unknown list shapes so we degrade gracefully when a new backend command lands before a renderer is added.
3. **The toast preview goes away on the same change.** Success with payload → no toast (the panel is the indicator). Success without payload (mutations like `chat.mark_as_read`) → the existing small `result.message` toast and palette closes. Errors → `toast.error` (unchanged).

Virtualisation is `@tanstack/react-virtual`, already in the bundle (`package.json:20`). No new dependency.

The deciding question — when the user runs `list_channels`, do they want to (i) glance and dismiss, (ii) navigate from a row, (iii) keep it open while doing something else — is answered (i) primarily, with (ii) on a row click that closes the palette. (iii) is not the palette's job; it would push us toward a docked panel and pollute the shell with a third long-lived surface that does not earn its keep. The palette is already a transient tool; a transient result panel matches it.

---

## 1. Status quo, factually

| What | Where | Behaviour |
|---|---|---|
| Single-command success path | `CommandPalette.tsx:205-239` (`executeSelected`) | Closes palette before result arrives (line 214), then `toast.success(\`${command.title}${payloadPreview}\`)` where `payloadPreview` is `\` — \${String(result.payload).slice(0, 80)}\`` (lines 228-232). |
| Object payloads | same | `String({...})` produces `[object Object]`. The user sees `"List Channels — [object Object]"`. |
| 100-row payloads | same | Even with `result.message` ("100 channels found") the toast can't show the data — toast is wrong frame. |
| Pipe path | `CommandPalette.tsx:154-203` + `PipelineResultView.tsx` | Stays open, renders `PipelineResultView` in a footer slot (`CommandPalette.tsx:399-404`). Shows per-stage status, message, collapsible payload JSON. |
| Errors | `CommandPalette.tsx:225-226, 234-235` | `toast.error(\`${command.title}: ${...}\`)`. Unchanged here. |
| State location for pipe result | local `useState` in `CommandPalette` (line 50: `pipelineResult`) | Not in zustand. Reset on palette open (line 120). |

Two implications drop out of this. First, the pipe path already proved that "palette stays open and renders structured output below the list" is a working pattern in this component — we generalise it, we do not invent a new surface. Second, the result-state-as-local-`useState` pattern is the right level for the new surface too: the result is meaningless once the palette closes.

---

## 2. Payload taxonomy

Audited every executor in `rim-server/rim_infra_services/src/command/executor/*.rs`. Five shape categories, mapping to four renderer kinds (the count/scalar category overlaps with key-value):

### 2.1. List-of-records
A JSON object with one array-valued key. Rows have heterogeneous columns by command.

| Command | Payload key | Per-row shape | Source |
|---|---|---|---|
| `chat.list_channels` | `channels` | `{id, title, conversation_type}` | `chat.rs:74` |
| `chat.list_members` (registered as `chat.list_members` per executor; backend file is `member.rs`) | `members` | `{username, role, joined}` | `member.rs:48` |
| `chat.search_messages` | `results` | `{id, channel, author, text, sentAt}` | `chat.rs:264` |
| `chat.get_recent_messages` | `messages` | `{author, text, sentAt}` | `chat.rs:324` |
| `state.list` | `entries` | `{key, value, version}` | `state.rs:190` |

These are the must-render-well category. Worst case is `list_members` on a workspace with 1000 users; everything else is bounded smaller (channels capped at 100 server-side per `CHAT_LIST_CHANNELS_LIMIT` in `chat.rs:23`, message search clamped at 50, recent at 100).

### 2.2. Key-value lookup
A small object describing a single thing.

| Command | Payload | Source |
|---|---|---|
| `state.get` | `{key, value, version, scope}` (or `null`) | `state.rs:39-50` |
| `state.set` | `{key, value, version}` | `state.rs:94-98` |
| `state.incr` | `{key, value, version}` | `state.rs:230-234` |
| `state.delete` | `{key, deleted}` | `state.rs:138-141` |

`state.get` returning `null` (key not found) is a real case — must render an "(not set)" empty state, not "no result panel".

### 2.3. Single-object confirmation
A creation / mutation that returns the new identifier(s).

| Command | Payload | Source |
|---|---|---|
| `chat.create_channel` | `{conversation_id}` | `chat.rs:127-129` |
| `conversation.create_group` | `{conversation_id}` | `conversation.rs:37-39` |
| `chat.send_message` | `{message_id, conversation_id}` | `chat_messages.rs:41-44` |
| `chat.reply_to_message` | `{message_id, parent_message_id}` | `chat_messages.rs:88-91` |
| `chat.delete_message` | `{message_id, conversation_id}` | `chat_messages.rs:133-136` |
| `chat.edit_message` | `{message_id, conversation_id}` | `chat_messages.rs:179-182` |
| `pin.pin_message` | `{success, pinned}` | `pin.rs:39-42` |
| `reaction.toggle` | `{success, toggled, emoji, action}` | `reaction.rs:66-71` |
| `admin.invite_member` | `{invite_token}` | `admin.rs:35-37` |

These have an ID payload but the user already knows what they did — they just clicked the command. The right surface for these is **not the result panel**: it's a confirmation toast (the existing `toast.success(result.message)`) plus, where applicable, a side effect (the channel created by `chat.create_channel` is already navigated-to via the local handler in `commandDispatcher.ts`). `admin.invite_member` is a real exception — the `invite_token` needs to be visible and copyable. We surface that one through the panel as a key-value renderer with a "copy" action.

### 2.4. Null / empty
`payload: None`. No data, just success.

| Command | Source |
|---|---|
| `chat.mark_as_read` | `chat.rs:163` |
| `chat.mark_all_as_read` | `chat.rs:193` |

Surface: small toast with `result.message`, palette closes. No result panel. Same as today, modulo the broken stringification.

### 2.5. Confirmation-required
Out of scope. The `confirmation_required` field on `CommandResultDto` is its own flow and is not touched here. The result surface only renders results where `confirmation_required` is null/absent. If confirmation arrives we route to whatever the existing confirmation handler is; this design adds nothing there.

### 2.6. Cutover rule

A command surfaces a result panel iff:

- `result.status === "SUCCESS"`, AND
- `result.payload` is non-null, AND
- the command is not in the "single-object confirmation" set above (except `admin.invite_member`).

Every other success path → small toast with `result.message`, palette closes. Every error → `toast.error`, palette closes. The decision is centralised in one helper in the new `commandResult/` module so it cannot be scattered.

---

## 3. Decision: where the surface lives

**Choice: (a) inline result panel below the palette input.**

Reasoning, against the alternatives:

- **(b) Replace main surface.** Tempting for the 1000-row case, but it forces a context-loss transition: the user came in via a transient palette and now finds themselves on a full-window page they have to navigate away from. The 1000-row argument also doesn't survive contact with the data: the four list commands cap at 100 (channels), 50 (search), 100 (recent), and "however many members the workspace has" (the only true unbounded case). For unbounded members, virtualisation in an inline panel handles 1000+ rows fine — `@tanstack/react-virtual` is exactly the tool. The membership of a workspace is also not infinite in any realistic deployment. Promoting a transient tool to a full main-surface page when 90% of uses are "glance and dismiss" is the wrong tradeoff.
- **(c) Side pane / docked tool panel.** Earns its keep when the user *needs* the result alongside other work. None of the listed commands have that pattern. This is also a heavier shell change and breaks the principle that a tool panel is for things you want to keep open across navigations (like the thread pane). Rejected.
- **(d) Modal dialog.** Explicitly excluded by the brief, and rightly so.

What inline gets us:

- Reuses the pattern already proven by the pipeline result slot (`CommandPalette.tsx:399-404`) — same component, same lifecycle, same dismiss semantics.
- Esc dismisses the result without closing the palette, then a second Esc closes the palette. Matches the existing pipe-segment pattern (`CommandPalette.tsx:272-280`) and the user's mental model of "Esc walks me back one level."
- Click-to-action on a row (e.g. channel row → navigate) closes the palette as a side effect, which is the right behaviour for "I came here to find this thing and now I want to go to it."
- The palette stays a transient surface. Nothing about the shell layout changes. Web build is unaffected.

Capability gate: **works on web**. Inline rendering inside the existing palette overlay has no Tauri dependency; the panel is just JSX. `localHandlers` that route to channels (`workspace.navigate_to_channel`) already work on web. No platform check needed at this surface.

---

## 4. Renderer design — list-shaped payloads

### 4.1. Component tree

```
CommandResultPanel (new)
├── CommandResultHeader        // command title + row count + filter input + close button
└── one of:
    ├── ListResultRenderer     // virtualised list, picks row component from registry
    │   └── VirtualRow * N     // per-command row component
    ├── KeyValueResultRenderer // for state.get / state.set / state.incr / admin.invite_member
    ├── EmptyResultCard        // payload === null (state.get miss) or empty array
    └── RawPayloadFallback     // unknown shape — collapsible JSON, same as PipelineResultView's StagePayload
```

### 4.2. Renderer registry vs auto-inference

**Choice: registry with auto-inference fallback.**

Pure auto-inference loses too much. `chat.list_channels` rows want a "click to open this channel" affordance. `chat.list_members` rows want a username-with-avatar layout and click-to-DM. `chat.search_messages` rows want time formatting and a click-to-jump-to-message. None of these can be inferred from `{id, title, conversation_type}` heuristics without becoming brittle.

Pure registry means the result panel breaks the moment a backend executor adds a new list command before the frontend ships a renderer. That is not theoretical — `state.list` is recent, `chat.get_recent_messages` is recent, the agent surface keeps gaining new tools.

So: **registry first, auto-inference fallback.** The fallback renders as a generic table with column headers inferred from the first row's keys, no row-click action, with a banner: "No custom renderer for `commandId` — showing raw fields." Fast to build, safe to ship, and shows up in design QA when a renderer is missing rather than failing silently.

The registry is a plain const map in a new file `src/features/commands/results/registry.ts`:

```ts
type ResultRenderer<TPayload = unknown> = {
  match: (commandId: string, payload: unknown) => boolean;
  render: (props: ResultRendererProps<TPayload>) => JSX.Element;
};
```

Match by exact `commandId` for the curated set; the generic fallback's `match` returns `true` for any object with one array-valued key and a non-empty first element. Lookup is `find()` over the registry — N is in the low tens, no perf concern.

### 4.3. Per-command renderers (initial set)

| Renderer | Commands | Row layout | Row click |
|---|---|---|---|
| `ChannelListRenderer` | `chat.list_channels` | `#channel-title · CONVERSATION_TYPE` | navigate to conversation, close palette |
| `MemberListRenderer` | `chat.list_members` | avatar (if `username` resolves to a known user, else initials) · username · role badge · joined date | open `UserHoverCard` on hover; click opens DM (reuses existing `workspace.navigate_to_dm` path) |
| `MessageListRenderer` | `chat.search_messages`, `chat.get_recent_messages` | `author · channel? · sentAt` (relative) / `text` (one line, truncated) | navigate to conversation + scroll to message id |
| `StateListRenderer` | `state.list` | `key` (mono) · value (truncated JSON) · version | copy value to clipboard |
| `KeyValueRenderer` | `state.get`, `state.set`, `state.incr`, `state.delete`, `admin.invite_member` | label/value pairs with copy button next to each value | n/a (per-field copy) |
| `RawPayloadFallback` | anything unmatched | inferred-column table for arrays; pretty-JSON `<pre>` for objects | none |

Empty list: "No results." (using `rim-text-muted`). Loading state lives on the palette's existing pending state (the panel only mounts once the result is in hand). Error: errors don't reach the panel (they go to `toast.error` and close the palette).

### 4.4. Filter input

Top of the panel, single text input. Filters rows by string-includes against the renderer-declared "filterable" fields (e.g. `MemberListRenderer.filterableFields = ["username", "role"]`). Cheap, big win on 100-row member lists. Re-uses microfuzz the same way the command list does (`CommandPalette.tsx:72-77`), so the matching feel is consistent.

The filter input does not eat the keyboard. It only focuses when explicitly clicked or when the user presses `Tab` from the search input. While the result panel is mounted, ArrowUp/Down/Enter still navigate the command list above — this is important: the user typing more characters in the main palette input is filtering the *commands*, not the *result*. The result filter is opt-in. (Open question at §11.)

### 4.5. Virtualisation

`@tanstack/react-virtual` (already in `package.json:20`). `useVirtualizer` over the filtered row array, fixed estimated row height per renderer (32px channels, 44px members, 56px messages), `overscan: 5`. Container has a fixed `max-height: 50vh` and `overflow-y: auto`.

Why fixed-row not dynamic: the renderers above are designed to be one-line-per-row precisely so virtualisation stays cheap. Dynamic measurement is a slowdown we don't need.

The 1000-row test case: virtualised list mounts ~30 DOM nodes regardless. Test plan covers this (§9).

### 4.6. Design tokens

All colours come from the `rim-*` token set (`rim-panel`, `rim-line`, `rim-text`, `rim-text-muted`, `rim-text-faint`, `rim-accent`, `rim-danger`, `rim-success`). No hardcoded hex anywhere. The CLAUDE.md rule is non-negotiable.

---

## 5. Renderer design — non-list payloads

### 5.1. Key-value card (`KeyValueRenderer`)

Two-column layout: label (mono, `rim-text-muted`) / value (mono, `rim-text`). Each row has a copy-to-clipboard button on hover (lucide `Copy` icon). For `state.get`, the `value` field gets pretty-printed if it parses as JSON, otherwise rendered as a string. `version` and `scope` render as small muted suffix text.

`admin.invite_member`: same layout, but the `invite_token` field gets a more prominent copy button and a "Copied!" feedback toast on click. This is the only per-command treatment in this renderer; the rest are uniform.

### 5.2. Empty card (`EmptyResultCard`)

`state.get` returning `null` is the canonical case. Renders: "Key `<key-from-args>` is not set." The renderer has access to `result.message` and the command's args, so we can be specific.

### 5.3. Mutations (null payload)

Per the cutover rule (§2.6): no result panel. `toast.success(result.message || "Command executed")` and `closeCommandPalette()`. Identical to the pipe-execution success path at `CommandPalette.tsx:191`.

### 5.4. Confirmation-required

Out of scope, untouched.

---

## 6. Toast cutover

The toast preview at `CommandPalette.tsx:228-232` is removed and replaced with this branching, all inside `executeSelected`:

| Branch | Behaviour |
|---|---|
| `result.status === "ERROR"` | `toast.error(\`${command.title}: ${result.message}\`)`, `closeCommandPalette()`. Unchanged from today. |
| `result.status === "SUCCESS"` AND payload is null/undefined | `toast.success(result.message || "Command executed")`, `closeCommandPalette()`. (Today: shows the broken `[object Object]` slice for object payloads, which we are fixing.) |
| `result.status === "SUCCESS"` AND payload is non-null AND command id ∈ "single-object confirmation" set (from §2.3, except `admin.invite_member`) | `toast.success(result.message)`, `closeCommandPalette()`. |
| `result.status === "SUCCESS"` AND payload is non-null AND command id ∉ that set (i.e. list, key-value, or `admin.invite_member`) | Set the result panel state, palette stays open. **No toast.** The panel itself is the success indicator. |

The classification table lives in `src/features/commands/results/cutover.ts` as a pure function `classifyResult(commandId, result): "panel" | "toast-success" | "toast-error" | "no-op"`. Single point of change.

---

## 7. Plumbing

### 7.1. Where the result state lives

**Local `useState` inside `CommandPalette`,** mirroring `pipelineResult` at `CommandPalette.tsx:50`. The result is meaningful only while the palette is open; once it closes, the result is gone. Lifting to a zustand store would create a question about persistence across palette opens that we don't want to answer (the user will not want yesterday's `list_channels` result re-appearing tomorrow).

```tsx
const [commandResult, setCommandResult] = useState<{
  command: CommandDefinition;
  result: CommandResult;
} | null>(null);
```

Reset when the palette opens (alongside the existing `setPipelineResult(null)` at line 120).

### 7.2. How `executeSelected` routes the result

```
executeSelected(command):
  if pipeSegments.length > 0: existing path, unchanged
  await dispatchCommand(...)
  switch classifyResult(command.id, result):
    case "panel":          setCommandResult({ command, result })   // palette stays open
    case "toast-success":  toast.success(result.message); closeCommandPalette()
    case "toast-error":    toast.error(...); closeCommandPalette()
    case "no-op":          closeCommandPalette()
```

### 7.3. New module structure

```
src/features/commands/results/
  cutover.ts                 // classifyResult()
  registry.ts                // renderer registry + lookup
  CommandResultPanel.tsx     // top-level panel component
  ListResultRenderer.tsx     // virtualised list shell
  KeyValueRenderer.tsx
  RawPayloadFallback.tsx
  renderers/
    ChannelListRenderer.tsx
    MemberListRenderer.tsx
    MessageListRenderer.tsx
    StateListRenderer.tsx
  __tests__/
    cutover.test.ts
    CommandResultPanel.test.tsx
    ListResultRenderer.test.tsx
    KeyValueRenderer.test.tsx
    renderers/*.test.tsx
```

`CommandPalette.tsx` imports `CommandResultPanel` and `classifyResult`. Nothing else changes structurally.

### 7.4. Tauri / web boundary

None of the new files touch `@tauri-apps/api`. Row-click actions go through existing local handlers (`workspace.navigate_to_channel`, `workspace.navigate_to_dm`) which already abstract platform. Web build is unaffected.

### 7.5. Keyboard handling

Esc:
- if `commandResult` is set → clear `commandResult`, keep palette open. Stops propagation.
- else if `pipeSegments.length > 0` → existing pipe-clear path.
- else → `closeCommandPalette()`.

Backspace from empty search input:
- if `commandResult` is set → clear `commandResult`. Stops propagation.
- else → existing pipe-segment-pop path.

Enter:
- if `commandResult` is set AND a row is focused inside the panel → trigger that row's click action.
- else → existing command-execute path.

Tab from the main search input → moves focus into the result panel's filter input (when present). Shift+Tab returns. The renderer panel manages internal up/down navigation within rows when focused.

No new keybindings beyond Esc-to-dismiss. The shortcuts file is untouched (`useResolvedKeybinds`); these are local to the palette's own `handleKeyDown`.

---

## 8. Task list

Order matters. Each step ships green tests + docs.

1. **Add `cutover.ts`.** Pure `classifyResult(commandId, result)` function and the union type `CommandResultDisposition`. Tests: every shape category × success/error → expected disposition. Doc: jsdoc on the export, and a 5-line section in `src/features/commands/README.md` (or create one).
2. **Add `registry.ts` skeleton.** Type `ResultRenderer`, the registry array, the `findRenderer(commandId, payload)` function, and the `RawPayloadFallback` as the always-last entry. Tests: registry returns fallback for unknown id; registry returns specific renderer for a known id. Doc: jsdoc + a registry-entry guide section in the README.
3. **Build `RawPayloadFallback`.** Generic auto-inferred table for arrays (one column per first-row key), pretty-JSON `<pre>` for objects. Tests: renders a 3-row array; renders an object; respects `rim-*` tokens (snapshot or class assertion). Doc: jsdoc with example.
4. **Build `ListResultRenderer`.** Takes a `rows: T[]`, a `RowComponent`, a `rowHeight`, a `filterableFields: (keyof T)[]`, and an optional `onRowClick(row)`. Wires `useVirtualizer`, the filter input, the empty-state. Tests: renders 1000 rows without freezing the test runner (assert <50 rendered DOM nodes); filter narrows rows; row click fires `onRowClick`; empty state renders. Doc: jsdoc + props table.
5. **Build `KeyValueRenderer`.** Label/value table with per-row copy. Tests: renders given pairs; copy button writes to clipboard (mock `navigator.clipboard.writeText`); JSON value gets pretty-printed; null payload renders empty card. Doc: jsdoc.
6. **Build per-command renderers.** `ChannelListRenderer`, `MemberListRenderer`, `MessageListRenderer`, `StateListRenderer`. Each is a thin wrapper over `ListResultRenderer` with its row component. Tests per renderer: renders sample payload; row click invokes the right action (mock `useShellStore`, `useCommandStore`); shows empty state; respects design tokens. Docs: jsdoc + a screenshot block in the README is nice-to-have (skip if costly).
7. **Build `CommandResultPanel`.** Composes header + filter + the chosen renderer (via `findRenderer`). Header shows `command.title`, row count from the renderer (call back via a `getRowCount` prop, or pass `result.message` if it already says "100 channels found"; the latter is preferred because the backend already counts). Tests: renders panel for a list result; renders panel for a key-value result; renders fallback for unknown shape; close button clears the result. Doc: jsdoc.
8. **Wire into `CommandPalette.tsx`.** Add `commandResult` state, route via `classifyResult`, render `<CommandResultPanel>` in the existing footer slot below the command list (above the existing `pipelineResult` slot, since they are mutually exclusive). Adjust `handleKeyDown` for Esc / Backspace / Enter / Tab per §7.5. Tests: dispatching `chat.list_channels` mock → panel renders, palette stays open; dispatching `chat.mark_as_read` → no panel, palette closes, success toast fires; dispatching error → no panel, palette closes, error toast fires; Esc clears panel before closing palette.
9. **Remove the toast preview.** Delete lines 228-232 of `CommandPalette.tsx` (the `payloadPreview` block). Replace with the dispatch table from §6. Tests already cover this; verify the snapshot does not contain `[object Object]` in any code path.
10. **Run full gate.** `npm run build` AND `npm test`. Both green. Report format: "N/N tests pass + build green."

Estimate: ~1 day including review feedback. Steps 1-3 are foundational and small; steps 4-6 are the meat; 7-9 are wiring.

---

## 9. Test plan

Enumerated, not written. Where a test belongs to a step in §8, I've noted it; the rest are integration-ish.

### 9.1. Unit
- `classifyResult` table: every command in §2 mapped to its expected disposition. Unknown commandId → "panel" (treat as list-like, fallback renderer handles it).
- `findRenderer` table: each curated id returns the right renderer; unknown id with array payload returns fallback; unknown id with scalar payload returns key-value or fallback per match logic.
- `KeyValueRenderer`: pairs render, JSON pretty-prints, copy button writes to clipboard, null payload empty-card.
- `RawPayloadFallback`: array renders inferred-column table; object renders pre block; banner present.

### 9.2. Component
- `ListResultRenderer` with 1000 rows: renders ≤ a small constant of DOM rows (assert via `screen.queryAllByRole("listitem")`). The exercise must complete in vitest's default timeout — this is the perf canary.
- Filter input narrows visible rows; clearing the filter restores them.
- Row click fires `onRowClick(row)`.
- Empty `rows: []` renders the "No results." copy.
- Each per-command renderer renders its sample payload and invokes the right side-effect on click (mocked store).

### 9.3. Palette integration
- `chat.list_channels` mock dispatch → palette stays open, `CommandResultPanel` renders, no `[object Object]` anywhere.
- `chat.mark_as_read` mock dispatch → palette closes, success toast fires, no panel.
- `state.get` returning `null` → panel renders empty card.
- `admin.invite_member` → panel renders key-value with copy button.
- ERROR dispatch → palette closes, error toast fires, no panel.
- Esc with panel open → panel clears, palette stays open. Second Esc → palette closes.
- Backspace from empty input with panel open → panel clears.
- Tab from main input → focus moves to filter input (when present).
- Row click → calls the corresponding navigation handler and closes the palette.

### 9.4. Dismiss / re-execute flows
- Open palette → execute → see panel → execute another command → previous panel cleared, new result rendered.
- Open palette → execute → close palette via outside click → re-open → no stale panel.

### 9.5. Web parity
- All component tests run in jsdom without `@tauri-apps/api`. (Should be free given no new Tauri imports.)

### 9.6. Snapshot guard
- One palette snapshot test that asserts the rendered DOM never contains the literal string `[object Object]`. Cheap regression brake.

---

## 10. What's NOT in scope

- **Backend changes.** Payload shapes are fixed; no executor edits.
- **Pipeline rework.** `PipelineResultView` is untouched. Generalising the new result panel to also render pipe stages is a credible follow-up — both render structured per-step output — but folding that in here would expand the surface and risk the pipe path. Filed as a follow-up below.
- **Plugin command results.** Plugin commands flow through `dispatchPluginCommand` (`commandDispatcher.ts:319-345`) and produce `CommandResult` shapes, but the plugin bridge ships its own contract. Not designed against here. The new panel will not crash on a plugin result (the fallback renderer covers it) but no first-class renderer is registered.
- **Agent surface.** `AgentOverlay` and `agent/tools/registry.ts` consume the same payload shapes via a different path. Untouched. Constraint from the brief.
- **Confirmation-required flow.** Dangerous commands that need confirmation flow through the existing `confirmation_required` path. Not changed.
- **New keyboard shortcuts.** Esc-to-dismiss is the only addition, and it's local to the palette's existing `handleKeyDown` — not a new keybind, not added to `useResolvedKeybinds`.
- **Persistence of results across palette opens.** Explicitly rejected; results are session-local.

### 10.1. Possible follow-ups (not this work)

- Generalise `CommandResultPanel` to also render pipe stages, retire `PipelineResultView`. Worth a separate ADR.
- Renderers for plugin command results once the plugin bridge contract is firm.
- "Pin this result to the side pane" affordance — would require choice (c). Don't pre-build.
- Server-side pagination for `chat.list_members` if real workspaces exceed virtualisation comfort. Backend work; not here.

---

## 11. Open questions

1. **Filter focus model.** §4.4 leaves the result-panel filter as opt-in (Tab to focus). Alternative: when `commandResult` is set, the main palette input *becomes* the filter input for the result, and pressing `|` or Esc returns it to command-list filtering. This is more elegant but needs a clear visual cue ("filter result" placeholder, an icon swap). Which is wanted? Default: opt-in; change is small if the answer is the second.
2. **Row click for `chat.search_messages` and `chat.get_recent_messages`.** Both return `id` (or for `get_recent_messages`, currently *don't* — `chat.rs:309-318` only projects `{author, text, sentAt}`, no id). Without an id we can't navigate-to-message. Either we: (a) document that recent-messages rows are non-clickable, or (b) ask the backend to add `id` to the recent-messages projection (one-line backend change, no PII concern). This design recommends (b) but flags it as a backend ask out of scope; not blocking this design.
3. **`admin.invite_member` token visibility.** The token is a credential. We render it in plaintext with a copy button. That matches what the existing dialog does, but is it worth a "click to reveal" gate? Defer to the maintainer on UX vs friction. Default: plaintext + copy.
4. **Scope of the renderer registry's first cut.** We ship six curated renderers (channels, members, messages, state-list, key-value, fallback). Anything missing from §2 that should ship in v1? `chat.create_channel` etc. fall into the toast path so they don't need renderers. Plugin commands explicitly out of scope.

---

## 12. Handoff summary (one line each)

- Surface lives **inline below the palette input**, palette stays open, Esc dismisses.
- Renderer strategy: **registry first with auto-inference fallback**.
- Virtualisation: **`@tanstack/react-virtual`** (already in `package.json:20`, no new dep).
- ADR path: `docs/decisions/command-result-surface-2026-05-01.md`.
- Open questions: see §11 (filter focus model; row-click for recent-messages without id; invite-token visibility; renderer set v1).
