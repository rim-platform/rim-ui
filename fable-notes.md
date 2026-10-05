# Architecture Review — rim-ui

*Reviewed by Claude Fable 5 on 2026-07-08. Companion notes for the backend are in `../rim-server/fable-notes.md`.*

## Overall verdict

The frontend is in very good architectural shape. The state-management split is clean and consistently applied — TanStack Query for server state (centralized hierarchical query-key factory), Zustand for client state (22 focused stores colocated per feature), React Context only for runtime capabilities. TypeScript is strict with essentially no `any` in non-test code. The security posture (cookie sessions with CSRF reflection, LLM API keys in the OS keyring via the Rust `agent_proxy`, tight CSP, DOMPurify on markdown, plugins as separate processes behind capability consent) is better than most shipping desktop apps.

The concerns are about resilience under real-world conditions (flaky networks, feature crashes) and a few growth hotspots — not about the architecture's shape. Listed in priority order.

## Findings

### 1. Blanket cache invalidation on every WS reconnect

`src/core/events/useWorkspaceEvents.ts` calls `qc.invalidateQueries()` with **no key filter** on reconnect, refetching the entire cache. On a flaky network this turns each client into a refetch storm against the server — and flaky networks are exactly when reconnects happen. Scope invalidation to the active workspace's keys, or better, implement "resume since cursor" on the `workspaceEvents` subscription so reconnects replay missed events instead of nuking the cache.

### 2. Only two error boundaries

`AppErrorBoundary` (app root) and `PluginErrorBoundary` are the only boundaries. A throw in any feature panel takes down the whole shell to the top-level fallback. Given the multi-pane layout, per-surface boundaries (conversation pane, tool panel, thread pane, settings, incident panels) are cheap and match the product's "workspace with panels" model.

### 3. Hardcoded default endpoint duplicated in ≥5 places

`http://localhost:8080/api` appears in `src/core/graphql/config.ts:2`, `wsClient.ts:4`, `src/features/messages/api/useAttachments.ts:110`, `src/features/messages/components/MessageItem.tsx:756`, and `src/features/settings/api/useUpdateProfile.ts:75` instead of all routing through `getGraphqlEndpoint()`. This is a self-hosted-deployment bug waiting to happen — centralize it.

### 4. `MessageItem.tsx` is the frontend's god file

938 lines for a single message row — rendering, reactions, pins, attachments, editing, context menus. It is also the hottest render path in a chat app. Split it into focused subcomponents and memoize the pieces. *(Done 2026-10-05: see C-M3 in `fable-findings.md`; `MessageTimeline.tsx` was split the same way.)* Other large components worth watching: `KeybindSettings.tsx` (673), `MessageTimeline.tsx` (611), `ComposerInput.tsx` (589), `WorkspaceStateSettings.tsx` (592).

### 5. AppShell as a growing hub

`src/shell/layouts/AppShell.tsx` (339 lines) mounts ~15 side-effect hooks and hand-switches 6 main-surface kinds inline, including two IIFEs rendering plugin panels. Not urgent, but it is the coupling hotspot every new surface will flow through — consider a surface-registry pattern before it doubles.

### 6. Lopsided test coverage and no lint gate

126 test files (~16.6k test LOC) with strong coverage on agent/auth/commands/core — but `pipelines/` (709 LOC), `lenses/` (923 LOC), and `disclosure/` have **zero** tests, and there is no ESLint/Prettier at all; `npm run build` is the only frontend CI gate. The backend enforces clippy `-D warnings` and a 95% coverage gate — the asymmetry is stark. Adding a linter is cheap; do that first, then backfill tests for the three untested features.

*Update 2026-10-05:* ESLint and Prettier gates exist now (`npm run lint`, `npm run format:check`). The three untested features have behaviour tests: `pipelines/` 24, `lenses/` 30, `disclosure/` 26 (hooks with query variables and cache invalidation, component loading/empty/error/list states, create/edit/delete flows with validation, and the skill-tier gating matrix). Bugs found on the way were fixed: see F-H3 and F-L7 in `fable-findings.md`.

## Strengths to preserve

- Clean server-state vs client-state separation, consistently applied across all 21 features.
- `agent_proxy.rs` moving Anthropic/OpenAI calls out of the webview so API keys live only in the OS keyring, with `zeroize::Zeroizing` on key material.
- Plugin host running plugins as separate processes with manifest validation, capability consent, trust fingerprints, and panels served over a locked-down `rim-plugin://` scheme with restrictive CSP — rather than eval-ing JS in the webview.
- Tight app CSP in `tauri.conf.json` (`script-src 'self'`, no unsafe-inline) and a minimal capability set in `capabilities/default.json`.
- Typed IPC via `safeInvoke` with discriminated-union error narrowing; single WS subscription fanned out through an event bus into surgical cache updates.
- Feature-sliced layout (`api/ → components/ → state/`) applied uniformly; codegen for types only, hand-written operations.

## Top actions

1. Fix the reconnect invalidation storm (scope keys or resume-since-cursor).
2. Centralize the GraphQL endpoint config behind `getGraphqlEndpoint()`.
3. Add per-surface error boundaries, then an ESLint gate to CI.

*Note: reconcile with the existing `fable-findings.md` before turning this into a task list — some findings may overlap.*
