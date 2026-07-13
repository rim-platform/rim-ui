# Error boundaries

RIM's shell has three tiers of React error boundary. Pick the right one when adding
a new surface, and always wire `resetKeys` correctly — a boundary without the right
`resetKeys` can leave a pane permanently stuck in its fallback UI.

## The three tiers

| Tier | Component | Scope | File |
|---|---|---|---|
| App | `AppErrorBoundary` | Whole app, full-screen fallback | `src/app/AppErrorBoundary.tsx` |
| Surface | `SurfaceErrorBoundary` | One pane inside `WorkspaceShell` | `src/shared/ui/SurfaceErrorBoundary.tsx` |
| Plugin | `PluginErrorBoundary` | One plugin panel | `src/features/plugins/components/PluginErrorBoundary.tsx` |

**`AppErrorBoundary`** sits at the app root. If it catches an error, the entire UI is
gone — the user sees a full-screen "UI ERROR" page with Try Again / Reload App. This
is the backstop: it should only ever fire for errors outside any surface (routing,
providers, or a bug in the shell chrome itself).

**`SurfaceErrorBoundary`** wraps an individual pane inside `WorkspaceShell` —
Conversation, Thread, Tool panel, Settings, Incidents, Audit log, and the three
conversation side-panels (Pinned messages, Incident timeline, Postmortem). A crash in
one pane shows a contained, in-pane fallback (surface name, error message,
Retry/Report buttons) while the rest of the shell — including the WebSocket
subscription and `KeybindProvider`, which live above these boundaries in
`WorkspaceShell` — stays mounted and functional. This is the default choice for any
new top-level pane added to the shell.

**`PluginErrorBoundary`** is different in kind: it's not a render-error boundary at
all, it's a health-state UI driven by the plugin runtime's `PluginHealth` (running /
crashed / timeout / slow-loading). It already renders its own restart/disable
actions, so plugin panels (`PluginSlotContainer`) are **not** additionally wrapped in
`SurfaceErrorBoundary` — doing so would produce a confusing double fallback if a
plugin's own render also threw synchronously.

## When to use `SurfaceErrorBoundary`

Wrap any new top-level pane rendered inside `WorkspaceShell` that isn't a plugin
panel. Do not wrap:

- Side-effect-only hooks (`useWorkspaceEvents`, `useHeartbeat`, etc.) — these live in
  `WorkspaceShell` itself, above any boundary, so a pane crash never tears down the
  WS subscription.
- `KeybindProvider` — global keybind handling must survive a pane crash.
- Plugin panels — they keep `PluginErrorBoundary`.

## `resetKeys` — mandatory for any surface tied to navigable state

`SurfaceErrorBoundary` does not auto-recover: once it catches an error, it stays in
the fallback state until either the user clicks **Retry**, or a value in `resetKeys`
changes. Without `resetKeys`, a pane that crashed while showing conversation A stays
crashed after the user navigates to conversation B — even though B's render might
have worked fine.

Rule of thumb: pass the id(s) that identify what the surface is currently showing.

- Conversation pane → `[selectedConversationId]`
- Thread pane → `[selectedRootMessageId]`
- Tool panel → `[selectedConversationId]` (its content follows the active conversation)
- Settings / Incidents / Audit log → `[]` (nothing to scope to; these are single-instance
  pages, so only Retry recovers them)
- Conversation side-panels (Pinned messages, Incident timeline, Postmortem) →
  `[selectedConversationId]` — they only render while a conversation is selected, and
  their content is scoped to that conversation.

## Current wiring

`WorkspaceShell` (`src/shell/layouts/AppShell.tsx`) wraps nine surfaces — the
conversation surface's list is complete:

- Tool panel — `resetKeys={[selectedConversationId]}`
- Conversation (`ConversationHeader` + `MessageTimeline`) — `resetKeys={[selectedConversationId]}`
- Thread (`ThreadPanel`) — `resetKeys={[selectedRootMessageId]}`
- Pinned messages (`PinnedMessagesPanel`) — `resetKeys={[selectedConversationId]}`
- Incident timeline (`IncidentTimelinePanel`) — `resetKeys={[selectedConversationId]}`
- Postmortem (`PostmortemPreview`) — `resetKeys={[selectedConversationId]}`
- Settings (`SettingsPage`) — `resetKeys={[]}`
- Incidents (`IncidentsHub`) — `resetKeys={[]}`
- Audit log (`AuditLogPage`) — `resetKeys={[]}`

`IncidentsHub` (Track C1) additionally wraps each of its three sub-tabs in its own
`SurfaceErrorBoundary`, finer-grained than the outer Incidents boundary above — a
crash in the On-call or Escalation editor doesn't take the whole hub (or the History
tab) down with it:

- History (`IncidentHistoryPage`, `embedded`) — `resetKeys={[activeTab]}`
- On-call (`OnCallSubTab`) — `resetKeys={[activeTab]}`
- Escalation (`EscalationSubTab`) — `resetKeys={[activeTab]}`

## Adding a new surface

1. Import `SurfaceErrorBoundary` from `src/shared/ui/SurfaceErrorBoundary`.
2. Wrap the pane's root element, not the whole `<main>` chrome around it, if the
   chrome contains controls that should stay interactive after a crash (see the
   Conversation pane's "Exit Zen" button, which sits outside the boundary).
3. Pick a human-readable `surface` name — it's shown verbatim in the fallback
   heading ("`{surface} failed to load`").
4. Set `resetKeys` per the rule of thumb above. If in doubt, prefer scoping over `[]`.
