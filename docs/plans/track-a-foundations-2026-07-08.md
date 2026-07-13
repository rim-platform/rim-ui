# Track A Foundations — Frontend Implementation Spec

_Author: Vision (frontend architect). For: Spider-Man (implementation). Date: 2026-07-08._
_Source: rim-server `ROADMAP.md` Track A (items 3, 4, 7) + `rim-ui/fable-notes.md` findings 1, 2, 3, 6._

This spec covers four independent items. Do them in order; each is self-contained.
**Do not deviate from the architecture below** — if something here doesn't match the
code you find, stop and message Vision rather than improvising.

## Global constraints (apply to every item)

- **Web build must keep working.** Anything Tauri-specific stays behind the existing
  runtime-capability / `safeInvoke` abstractions. None of these four items should touch
  Tauri APIs directly — if you think one does, you've taken a wrong turn.
- **Every new exported function/component gets tests AND docs.** Tests are Vitest +
  Testing Library (already configured: `vitest.config.ts`, `src/test/setup.ts`). Docs =
  JSDoc on the export, plus the markdown files named per-item below.
- **Gates that must pass before you report done:** `npm run build`, `npm test`, and
  (after item 4 lands) `npm run lint` and `npm run format:check`.
- TypeScript strict, double quotes, semicolons, relative imports only, `rim-*` design
  tokens only (no hardcoded colors). Match surrounding style.
- No git commits/pushes. Hawkeye reviews before anything is reported complete.

---

## Item 1 — Scope WS-reconnect cache invalidation

### Problem
`src/core/events/useWorkspaceEvents.ts:34-41` calls `qc.invalidateQueries()` with **no
filter** on every WebSocket reconnect, refetching the entire TanStack Query cache. On a
flaky network (exactly when reconnects happen) each client becomes a refetch storm.

### Design
Invalidate only the **active workspace's volatile server-state keys** instead of the
whole cache. Correctness rule (from Nick): because events that occur *during* the
disconnect are currently lost (Track B will add resume-since-cursor later), on reconnect
we must refetch everything workspace-scoped that could have changed. We do NOT need to
refetch account-global or static data (session, server list, plugin registry, command
registry, keybind definitions, server config, audit log) — those don't flow through
`workspaceEvents` and aren't invalidated by the existing per-event handlers either.

#### 1a. Add the key inventory to the query-key factory

The invalidation set must be derived from the single query-key factory in
`src/core/query/keys.ts` (do not hardcode key strings in the hook). Every listed root
places the workspace/server id at position `[1]`, so the two-element prefix
`[root, workspaceId]` matches all of that root's queries via TanStack Query's default
prefix matching.

Add to `src/core/query/keys.ts`:

```ts
/**
 * Query-key roots holding volatile server state scoped to one workspace (server).
 * On WS reconnect we invalidate only these for the active workspace instead of the
 * whole cache. Each root keys the workspace/server id at position [1], so the prefix
 * [root, workspaceId] matches every query for that workspace.
 */
export const VOLATILE_WORKSPACE_KEY_ROOTS = [
  "messages",
  "conversations",
  "channels",
  "threadByRoot",
  "threadMessages",
  "pinnedMessages",
  "searchMessages",
  "lenses",
  "lensMessages",
  "unreadCounts",
  "mutedConversations",
  "workspacePresence",
  "serverMembers",
  "server",
  "customEmojis",
  "workspaceState",
  "workspaceStateList",
  "pipelines",
  "macros",
  "resolvedKeybinds",
  "activeIncident",
  "listIncidents",
] as const;

/**
 * Volatile roots NOT scoped by workspace id in their key (e.g. incident timelines are
 * keyed by incidentId). Invalidated by root prefix on reconnect. Safe because a user
 * views one active workspace at a time; worst case is one redundant refetch.
 */
export const VOLATILE_GLOBAL_KEY_ROOTS = ["incidentTimeline"] as const;
```

Also add the presence key to the factory so it stops being hand-written:

```ts
  workspacePresence: (workspaceId?: string) => ["workspacePresence", workspaceId] as const,
```

Then update `src/features/presence/api/useWorkspacePresence.ts:26` to use
`queryKeys.workspacePresence(workspaceId)` instead of the inline `["workspacePresence", workspaceId]`.
(Keep the tuple identical — this is a pure refactor so the reconnect scoping and the
query use the same key.)

**Roots deliberately excluded** (do not add): `healthCheck`, `me`, `myServers`,
`commands`, `plugins`, `serverConfig`, `keybinds`, `listAuditLog`, `previewInviteToken`,
`serverConfig`. Account-global or static; not driven by `workspaceEvents`. If you think
one belongs, message Vision — don't add it silently.

#### 1b. Rewrite the reconnect effect in `useWorkspaceEvents.ts`

Replace the blanket-invalidation effect (lines 33-41) with scoped invalidation that:

1. Reads the **latest** `workspaceId` via a ref (so the `onWsConnected` listener is
   registered once and never re-subscribes on workspace switch).
2. **Skips the first connect.** `wsClient`'s `connected` handler fires on the initial
   connection too; the initial page load already fetches everything, so only invalidate
   on genuine *re*-connects. Track this with a `hasConnectedRef`.
3. On reconnect, if there is an active workspace, loops `VOLATILE_WORKSPACE_KEY_ROOTS`
   calling `qc.invalidateQueries({ queryKey: [root, workspaceId] })`, then loops
   `VOLATILE_GLOBAL_KEY_ROOTS` calling `qc.invalidateQueries({ queryKey: [root] })`.
4. Keeps the existing "Reconnected" toast.

Sketch (adapt to match file style):

```ts
const workspaceIdRef = useRef(workspaceId);
workspaceIdRef.current = workspaceId;
const hasConnectedRef = useRef(false);

useEffect(() => {
  const unsubscribe = onWsConnected(() => {
    if (!hasConnectedRef.current) {
      hasConnectedRef.current = true; // initial connect — cache is already fresh
      return;
    }
    const wsId = workspaceIdRef.current;
    if (!wsId) return;
    logger.debug("[RIM:WS] Reconnected — invalidating active-workspace volatile keys");
    for (const root of VOLATILE_WORKSPACE_KEY_ROOTS) {
      qc.invalidateQueries({ queryKey: [root, wsId] });
    }
    for (const root of VOLATILE_GLOBAL_KEY_ROOTS) {
      qc.invalidateQueries({ queryKey: [root] });
    }
    toast.success("Reconnected", { id: "ws-reconnect", description: "Real-time connection restored." });
  });
  return unsubscribe;
}, [qc]);
```

Leave the second effect (the subscription itself, lines 43-82) and `handleEvent`
untouched.

### Tests (extend `src/core/query/keys.test.ts`; create `src/core/events/useWorkspaceEvents.test.ts`)
- keys.test: assert `VOLATILE_WORKSPACE_KEY_ROOTS` contains the expected roots and
  excludes `me`/`plugins`/`serverConfig` (guards against accidental scope creep);
  assert `queryKeys.workspacePresence("w1")` deep-equals `["workspacePresence", "w1"]`.
- useWorkspaceEvents.test: mock `../graphql/wsClient` so `onWsConnected` captures the
  handler and `wsClient.subscribe` is a no-op. Render the hook with a real
  `QueryClient`, spy on `invalidateQueries`. Assert:
  - first `onWsConnected` invocation does **not** call `invalidateQueries`;
  - the second invocation calls it once per volatile root, each with `[root, workspaceId]`
    (and the global roots), and **never** with an empty/undefined filter;
  - with `workspaceId = null`, a reconnect invalidates nothing.

### Docs
- JSDoc (already specified above) on both new key exports.
- Add a short section to `docs/error-boundaries.md`? No — put a short note in the hook's
  file header comment explaining the reconnect strategy and its Track B successor
  (resume-since-cursor). One paragraph.

---

## Item 2 — Centralize the endpoint config

### Problem
`http://localhost:8080/api` is hardcoded in five places instead of routing through
`src/core/graphql/config.ts`:
- `src/core/graphql/config.ts:2` (the one legitimate default)
- `src/core/graphql/wsClient.ts:4`
- `src/features/messages/api/useAttachments.ts:110`
- `src/features/messages/components/MessageItem.tsx:756`
- `src/features/settings/api/useUpdateProfile.ts:75`

### Design
`config.ts` becomes the single source of truth. The literal default appears **once**.
Extend it to:

```ts
const DEFAULT_GRAPHQL_ENDPOINT = "http://localhost:8080/api";

/** The GraphQL HTTP endpoint (env override or the localhost default). */
export function getGraphqlEndpoint(): string {
  return import.meta.env.VITE_GRAPHQL_ENDPOINT || DEFAULT_GRAPHQL_ENDPOINT;
}

/** API origin with the trailing `/api` stripped, e.g. `http://localhost:8080`.
 *  Use to build REST/file paths like `${getApiOrigin()}/api/files/upload`. */
export function getApiOrigin(): string {
  return getGraphqlEndpoint().replace(/\/api$/, "");
}

/** The graphql-ws endpoint (`ws(s)://…/api/ws`). Resolves relative endpoints
 *  against `window.location`. Moved verbatim from wsClient.getWsEndpoint. */
export function getWsEndpoint(): string {
  /* move the existing logic from wsClient.ts:3-24 here unchanged */
}
```

Then update call sites:
- `wsClient.ts`: delete the local `getWsEndpoint`, import it from `./config`; `url: () => getWsEndpoint()` stays.
- `useAttachments.ts:110-111`: `const uploadUrl = getApiOrigin() + "/api/files/upload";`
- `useUpdateProfile.ts:75-76`: `const uploadUrl = getApiOrigin() + "/api/files/avatar";`
- `MessageItem.tsx:756`: `const baseUrl = getApiOrigin();`

No literal `http://localhost:8080` may remain outside `config.ts` after this. Grep to confirm.

### Tests (extend `src/core/graphql/config.test.ts`)
- `getApiOrigin()` returns `http://localhost:8080` (no trailing `/api`) with the default.
- `getWsEndpoint()`: absolute `http://…/api` → `ws://…/api/ws`; simulate `https` →
  `wss://…/api/ws`. Because it reads `window.location` for the relative-path branch and
  `import.meta.env`, follow the stubbing pattern already in `config.test.ts` /
  `src/test/setup.ts`; if the relative branch is hard to exercise in jsdom, cover at
  least the absolute-http and absolute-https branches and note the gap in a comment.

### Docs
- JSDoc on `getApiOrigin` and `getWsEndpoint` (above).
- No new markdown file; `.env.example` already documents `VITE_GRAPHQL_ENDPOINT`.

---

## Item 3 — Per-surface error boundaries

### Problem
Only `AppErrorBoundary` (root, `src/app/AppErrorBoundary.tsx`) and `PluginErrorBoundary`
(`src/features/plugins/components/PluginErrorBoundary.tsx`, a health-state UI, **not** a
render-error boundary) exist. A throw in any pane's render takes down the whole shell.

### Design — new `SurfaceErrorBoundary`

New file `src/shared/ui/SurfaceErrorBoundary.tsx`. It is a **class component** (React
error boundaries must be classes). Design-system consistent, compact (fits inside a
pane, unlike the full-screen `AppErrorBoundary`), uses `rim-*` tokens and the shared
`Button`.

```ts
interface SurfaceErrorBoundaryProps {
  /** Human-readable surface name shown in the fallback, e.g. "Conversation". */
  surface: string;
  /** When any value in this array changes, the boundary clears its error and
   *  re-renders children. Pass the id that identifies the surface's context
   *  (conversationId, rootMessageId, …) so navigating away recovers automatically. */
  resetKeys?: ReadonlyArray<unknown>;
  /** Optional custom report handler; defaults to logging via core logger. */
  onReport?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}
```

Behavior:
- `getDerivedStateFromError` stores the error; `componentDidCatch` logs via
  `src/core/logger` (`logger.error("[RIM:Surface] <surface> crashed", error, info)`).
- `componentDidUpdate(prevProps)`: if `resetKeys` changed (shallow compare), clear the
  error. This is **critical** — without it a crashed pane stays crashed after the user
  navigates to a different conversation.
- Fallback UI: a contained panel (`rounded-xl border border-rim-danger/20 bg-rim-panel`),
  `AlertTriangle` icon (lucide, already a dep), heading `"{surface} failed to load"`,
  the `error.message` in a `pre` with muted tokens, and two actions using shared
  `Button`:
  - **Retry** (`variant="secondary"`) → clears error state (re-mounts children).
  - **Report** (`variant="ghost"`) → calls `onReport(error, info)` if provided, else
    `logger.error`, then shows a `toast.success("Error reported")` from `src/shared/toast`.
- Renders `this.props.children` when no error.

Do **not** wrap the side-effect hooks or `KeybindProvider` — only pane subtrees, so a
crash never unmounts the WS subscription in `WorkspaceShell`.

### Wiring in `src/shell/layouts/AppShell.tsx` (inside `WorkspaceShell`)

Wrap each of these, independently, so one crash can't cascade:

| Surface | Wrap target | `resetKeys` |
|---|---|---|
| Tool panel | `<ToolPanel />` (line 178 area) | `[]` (or `[selectedConversationId]`) |
| Conversation | the non-plugin `<main>` block (ConversationHeader + MessageTimeline, lines 203-216) | `[selectedConversationId]` |
| Thread | `<ThreadPanel />` (line 220) | `[selectedRootMessageId]` |
| Settings | `<SettingsPage />` main (lines 254-258) | `[]` |
| Incidents | `<IncidentHistoryPage />` main (260-264) | `[]` |
| Audit log | `<AuditLogPage />` main (266-270) | `[]` |

Notes:
- The component in the repo is **`ThreadPanel`** (`src/features/threads/components/ThreadPanel.tsx`),
  not "ThreadPane" — that's what Nick's item 3 refers to.
- Do **not** wrap plugin panels (`PluginSlotContainer`) — they keep `PluginErrorBoundary`.
  Leaving that untouched avoids double-fallback UI.
- Keep the surface labels human-readable ("Conversation", "Thread", "Tool panel",
  "Settings", "Incidents", "Audit log").
- Import `SurfaceErrorBoundary` from `../../shared/ui/SurfaceErrorBoundary`.

### Tests (`src/shared/ui/SurfaceErrorBoundary.test.tsx`)
Use a child component that throws on demand (toggle via prop). Suppress the expected
`console.error` noise. Assert:
- renders children when no error;
- on child throw, shows fallback containing the `surface` name and Retry/Report;
- Retry clears the error (render a non-throwing child after retry, assert it shows);
- clicking Report calls a provided `onReport`;
- changing a value in `resetKeys` clears the error without clicking Retry.

### Docs
- JSDoc on `SurfaceErrorBoundary` and its props.
- New `docs/error-boundaries.md`: document the three-tier hierarchy (App → Surface →
  Plugin), when to use each, and the mandatory `resetKeys` guidance for adding a new
  surface. Short (≈1 page).

---

## Item 4 — ESLint + Prettier gate

### Problem
No linter or formatter. `npm run build` is the only frontend gate. Backend enforces
clippy `-D warnings` + coverage; the asymmetry is stark.

### Design — minimal modern flat config

**Add devDependencies** (latest stable): `eslint`, `@eslint/js`, `typescript-eslint`
(v8, flat-config native), `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
`eslint-config-prettier`, `prettier`, `globals`.

**`eslint.config.js`** (ESM — `package.json` is `type: module`). Composition:
1. `js.configs.recommended`
2. `tseslint.configs.recommended` — **not** `recommendedTypeChecked`. No type-aware
   linting initially: it needs `parserOptions.project` wiring, and `tsconfig.json`
   *excludes* test files (`tsconfig.json:26-30`), which would break typed linting on
   tests. Fast, no project wiring, pragmatic. Note type-checked rules as a future upgrade.
3. `reactHooks.configs.recommended` (or the flat preset the installed version exposes).
4. `reactRefresh.configs.vite` (warn-level; Vite HMR hygiene).
5. `eslintConfigPrettier` **last** to disable all stylistic rules that would fight Prettier.
6. Global `ignores`: `dist/`, `coverage/`, `node_modules/`, `src-tauri/`,
   `src/core/graphql/generated/`, `vite.config.js`, `vite.config.d.ts`, `*.config.js`
   build artifacts as appropriate.

**Rule tuning (start pragmatic so the codebase passes after mechanical `--fix`):**

Start as **`warn`** (noisy / would need broad manual edits):
- `@typescript-eslint/no-unused-vars` → warn, `{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" }`
  (matches the existing `_pluginId` convention).
- `@typescript-eslint/no-explicit-any` → warn.
- `react-hooks/exhaustive-deps` → warn.
- `react-refresh/only-export-components` → warn.

Keep as **`error`** (correctness, low false-positive):
- `react-hooks/rules-of-hooks`.
- typescript-eslint recommended defaults not downgraded above.

**`.prettierrc.json`** matching existing conventions: `{ "semi": true, "singleQuote": false,
"trailingComma": "all", "printWidth": 100 }`. Verify against the code — double quotes,
semicolons, and trailing commas are already the norm.

**`.prettierignore`**: `dist`, `coverage`, `node_modules`, `src-tauri/target`,
`src/core/graphql/generated`, `package-lock.json`, `schema.graphql`, `*.md` optional.

**`package.json` scripts:**
```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

### Mechanical-fix procedure (do this, and keep it isolated from the logic items above)
1. Install deps, add configs + scripts.
2. Run `npm run format` once (one-time reformat — will touch many files; that's the
   expected mechanical churn, do it as its own step so review can separate it).
3. Run `npm run lint:fix`, then hand-fix remaining **errors** only (warnings may remain).
4. Confirm `npm run lint` exits 0 (warnings allowed, no errors), `npm run format:check`
   passes, `npm run build` and `npm test` still pass.

If a rule at `error` produces more than a handful of unavoidable violations, downgrade it
to `warn` (note which in the doc) rather than sprinkling `eslint-disable`. The goal is a
green gate today with room to tighten later.

### CI note (for Nick / the CI owner — you don't edit CI)
Frontend CI should run, in order: `npm ci` → `npm run lint` → `npm run format:check` →
`npm run build` → `npm test`. Today only `build` runs. Lint/format are non-type-aware so
they're fast. Flag this in your handback so Nick can route the CI change.

### Docs
- New `docs/eslint-prettier.md`: how to run lint/format, the flat-config rationale, the
  warn-vs-error rule split and why, and the "no type-aware linting yet" decision + how to
  upgrade to it later.
- Update `CLAUDE.md`: the line "**No frontend test runner, linter, or formatter is
  configured yet.**" is now stale (vitest already exists; this item adds lint+format).
  Correct it to point at the new scripts.

---

## Suggested order & PR grouping
1. **Item 2** (endpoint) — smallest, unblocks nothing but lowest risk. 
2. **Item 1** (reconnect scoping) — depends on the key factory only.
3. **Item 3** (error boundaries) — independent.
4. **Item 4** (lint/format) — **last**, and its `prettier --write` reformat as an
   isolated step, so it doesn't bury the logic changes from 1-3 under formatting noise.

## Definition of done
- All five hardcoded endpoints route through `config.ts`; grep for `localhost:8080`
  outside `config.ts` returns nothing.
- Reconnect invalidates only active-workspace volatile keys; initial connect invalidates
  nothing; verified by test.
- `SurfaceErrorBoundary` wraps the six surfaces; a thrown error in one pane shows the
  in-pane fallback and the rest of the shell stays mounted.
- `npm run lint`, `npm run format:check`, `npm run build`, `npm test` all pass.
- Every new export has JSDoc + a test; `docs/error-boundaries.md` and
  `docs/eslint-prettier.md` exist; `CLAUDE.md` stale line fixed.
- Hawkeye review passed.
