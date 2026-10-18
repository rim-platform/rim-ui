# Error boundaries

RIM's shell has two tiers of React error boundary. Pick the right one when adding
a new surface, and always wire `resetKeys` correctly — a boundary without the right
`resetKeys` can leave a pane permanently stuck in its fallback UI.

## The two tiers

| Tier | Component | Scope | File |
|---|---|---|---|
| App | `AppErrorBoundary` | Whole app, full-screen fallback | `src/app/AppErrorBoundary.tsx` |
| Surface | `SurfaceErrorBoundary` | One pane inside `WorkspaceShell` | `src/shared/ui/SurfaceErrorBoundary.tsx` |

**`AppErrorBoundary`** sits at the app root. If it catches an error, the entire UI is
gone — the user sees a full-screen "UI ERROR" page with Try Again / Reload App. This
is the backstop: it should only ever fire for errors outside any surface (routing,
providers, or a bug in the shell chrome itself).

**`SurfaceErrorBoundary`** wraps an individual pane inside `WorkspaceShell` —
Conversation, Thread, Tool panel, Settings, Audit log, and the Pinned messages
side-panel. A crash in one pane shows a contained, in-pane fallback (surface name, error message,
Retry/Report buttons) while the rest of the shell — including the WebSocket
subscription and `KeybindProvider`, which live above these boundaries in
`WorkspaceShell` — stays mounted and functional. This is the default choice for any
new top-level pane added to the shell.

Plugin panels (`PluginSlotContainer`) are not wrapped in `SurfaceErrorBoundary`: a plugin
runs in its own process or sandboxed frame, and the plugin host reports its health (running,
crashed, timed out) in Settings → Plugins, where it is disabled or re-enabled.

## When to use `SurfaceErrorBoundary`

Wrap any new top-level pane rendered inside `WorkspaceShell` that isn't a plugin
panel. Do not wrap:

- Side-effect-only hooks (`useWorkspaceEvents`, `useHeartbeat`, etc.) — these live in
  `WorkspaceShell` itself, above any boundary, so a pane crash never tears down the
  WS subscription.
- `KeybindProvider` — global keybind handling must survive a pane crash.
- Plugin panels — the plugin host reports their health in Settings → Plugins.

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
- Settings / Audit log → `[]` (nothing to scope to; these are single-instance pages, so
  only Retry recovers them)
- Conversation side-panels (Pinned messages) → `[selectedConversationId]` — they only
  render while a conversation is selected, and their content is scoped to that
  conversation.

## Current wiring

`WorkspaceShell` (`src/shell/layouts/AppShell.tsx`) wraps six surfaces — the
conversation surface's list is complete:

- Tool panel — `resetKeys={[selectedConversationId]}`
- Conversation (`ConversationHeader` + `MessageTimeline`) — `resetKeys={[selectedConversationId]}`
- Thread (`ThreadPanel`) — `resetKeys={[selectedRootMessageId]}`
- Pinned messages (`PinnedMessagesPanel`) — `resetKeys={[selectedConversationId]}`
- Settings (`SettingsPage`) — `resetKeys={[]}`
- Audit log (`AuditLogPage`) — `resetKeys={[]}`

## Adding a new surface

1. Import `SurfaceErrorBoundary` from `src/shared/ui/SurfaceErrorBoundary`.
2. Wrap the pane's root element, not the whole `<main>` chrome around it, if the
   chrome contains controls that should stay interactive after a crash (see the
   Conversation pane's "Exit Zen" button, which sits outside the boundary).
3. Pick a human-readable `surface` name — it's shown verbatim in the fallback
   heading ("`{surface} failed to load`").
4. Set `resetKeys` per the rule of thumb above. If in doubt, prefer scoping over `[]`.
