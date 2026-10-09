# Plugin System — Phase Plan (Frontend + Backend)

> **Note (2026-10-09):** `rim-server/docs/research/plugin-backend-validation-2026-04-29.md`,
> linked below, was deleted as outdated; it remains in rim-server's git history.

- **Status:** **DECISIONS-LOCKED 2026-04-29.** Q1, Q3, Q4 answered by Jakub
  this round. Q2 and Q5 remain open but do not block the locked-in phases.
  See "Decision Gates" section below for the locked answers.
- **Last revision: 2026-04-29 (local-install-only directive).** Per Jakub
  2026-04-29 directives: (1) marketplace work is **deferred to its own
  dedicated session** (same treatment as CLI v1); iron-man's marketplace
  discovery memo at
  [`rim-server/docs/research/plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md)
  is the seed for that future session. (2) For now, plugins install **from
  local only** — sideload from folder / git URL. No marketplace, no
  centralized catalog, no remote install in this iteration. Phase 3
  rewritten as "local-install affordance + sideload UX." Phase 4 reduced
  to single-lane TOFU fingerprint tracking; Lane A (registry-signed)
  deferred until the marketplace session lands. Phase 1/2 untouched.
  See "What changed in this revision" at the bottom of the plan.
- **Prior revision: 2026-04-29 (iron-man backend validation pass).**
  Revisions folded in from iron-man's memo at
  [`rim-server/docs/research/plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md).
  Backend gap analysis, Phase 3 BE scope, Phase 4 BE scope, and the
  capability-registry "natural next step" all updated. Phase 6 (MCP)
  numbers confirmed correct — no edit. Marketplace v1 shape (Axum + SQLite
  + REST, new `rim-marketplace` repo, M ~4-5 weeks) folded into Phase 3
  at the time, since superseded by the local-install-only directive above.
- **Author:** vision (frontend / UX architect)
- **Co-author note (original — iron-man could not be dispatched in
  parallel):** This environment exposes only `Read / Glob / Grep / Write /
  Edit` — no `Task` tool — so a real iron-man sub-thread was impossible at
  the time of authoring. I read the backend code paths iron-man would have
  read (capability registry migrations, plugin_host DTO module,
  plugin_model.md, MCP bridge sketch by falcon) and produced a best-effort
  backend section, flagged as provisional pending iron-man's confirmation.
  **Update 2026-04-29:** iron-man's validation memo has now landed. All
  provisional flags have been resolved and the plan reflects his findings;
  see "Last revision" line above. Backend work CAN now be staffed off this
  plan, with iron-man's memo as the authoritative source for `rim-server`
  scope and `rim-marketplace` shape.
- **Date:** 2026-04-29 (decisions locked same day)
- **For:** nick-fury
- **Builds on:** the plugin-system status research memo of 2026-04-29 (`docs/research/plugin-system-status-2026-04-29.md`, since removed; see git history)
- **Sister memo (strategic input):** [`rim-server/docs/research/competitive-landscape-2026-04-29.md`](../../../rim-server/docs/research/competitive-landscape-2026-04-29.md)
- **Sister memo (MCP architecture sketch):** [`rim-server/docs/design/mcp-bridge-sketch-2026-04-22.md`](../../../rim-server/docs/design/mcp-bridge-sketch-2026-04-22.md) — falcon, 2026-04-22
- **Iron-man's backend validation + marketplace discovery — landed
  2026-04-29:** [`rim-server/docs/research/plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md).
  Validates vision's backend claims; defines `rim-marketplace` shape
  (Axum + SQLite + REST, M ~4-5 weeks); confirms MCP estimate range and
  flags 7-10 week real-calendar floor. This plan reflects all 7
  revisions iron-man surfaced.

---

## TL;DR — Phase List

| # | Phase | Scope (FE / BE) | Decision-gated? | One-liner |
|---|-------|-----------------|------------------|-----------|
| **1** | **Wire-the-host** (spawn + asset protocol + hello-world plugin + web-build "desktop-only" message) | **S** / **none** | No — unblocked, dispatch immediately | Make the existing skeleton actually run a plugin end-to-end; ship the web-build "Plugins are desktop-only" message as part of this phase since UI work is already in flight. |
| **2** | **Frontend bridge handlers + settings persistence** (G5 + G10 from discovery) | **S–M** / **none** | No — strictly follows P1 | Plug the postMessage side-effects (notifications, dialogs, settings) into real UI/storage. |
| **3** | **Local-install affordance + sideload UX** (sideload from folder / git URL, list installed, uninstall). Plugin SDK (`rimkit-ts`) for plugin authors, scope-shrunk (no upload/publish flow). | **S–M** / **none** | No — unblocked once Phase 1 verification confirms `plugin_install_from_git` works | Settings UI for installing from local folder or git URL, an installed-plugins list with uninstall, and `rimkit-ts` for plugin authors. **Marketplace catalog UI, browse/search, `marketplaceClient.ts`, and `rim-marketplace` integration are DEFERRED — separate dedicated session per Jakub 2026-04-29.** Iron-man's memo is the seed for that future session. |
| **4** | **Trust / signing / hot-reload — TOFU fingerprint tracking only (single lane)** | **S–M** / **none** | No (but smaller than the deferred marketplace lane suggests) | Record fingerprint at install time, warn on fingerprint change. Trust-badge states reduce to `pinned` (TOFU), `unverified` (no fingerprint yet — first install pending), `dev` (hot-reload). **Lane A (registry-signed cosign-style verification) is DEFERRED — reactivates when the marketplace session lands.** Design rationale preserved in the Phase 4 body for the future session to pick up cleanly. |
| **~~5~~** | **~~Web build plugin story~~** | **folded into P1** | **LOCKED — Q3 = desktop-only for v1** | Web build shows "Plugins are desktop-only" feature-gate message. Folded into Phase 1 since AppShell UI work is already in flight there. No separate phase. |
| **6** | **MCP host + server bridge** (strategic later bet) | **M** / **L** | **YES — depends on P1+P3 landing AND CLI v1 shipped AND AI-agent reframe Phase 5 closed.** Iron-man's memo §2.3 confirms vision's numbers; no estimate revision needed. | RIM consumes MCP servers (host) and exposes commands as MCP tools (server). Per iron-man's memo §2.2, real-calendar floor is **7-10 weeks** with prerequisites (CLI v1 + reframe close) sitting in front of the 4-5-week single-dev cheapest-viable cut. Doctor-strange's "2-3 weeks" is the post-prerequisite optimistic floor. |

**Out of scope for this plan:** CLI v1 (parallel track, full-team session per
Jakub), WASM plugin runtime (v2+), cross-device plugin sync, enterprise admin
controls, ratings/reviews/telemetry, paid-plugin monetization rails.

---

## Honest corrections vs. discovery memo (2026-04-29)

Things the discovery memo got slightly wrong or under-stated, surfaced here so
fury isn't reading two contradictory documents:

1. **Capability registry is more developed than the discovery memo implied.**
   The memo named only the original
   [`m20260424_120000_create_capability_registry.rs`](../../../rim-server/migration/src/m20260424_120000_create_capability_registry.rs)
   migration. There's a follow-up
   [`m20260426_200000_capability_registry_add_is_self_scoped.rs`](../../../rim-server/migration/src/m20260426_200000_capability_registry_add_is_self_scoped.rs)
   that closes a Black Widow H2 finding (`membership_holds(actor, None)`
   short-circuit). The registry now has a real `is_self_scoped` flag, the
   `CapabilityService` trait
   ([`capability/service.rs:42-71`](../../../rim-server/rim_services/src/capability/service.rs))
   has both `check` and `check_many` (latter is bulk for AI surfaces), and
   the registry service is wired through the GraphQL/audit surface. **The
   capability registry is past the "skeleton" stage; it is in active
   production use.** **Update per iron-man's memo §1.4 + §3.6:** the
   plugin-grant store leg is **deferred indefinitely on `rim-server`** under
   Q1 = separate marketplace. Plugin-source caps deny on the server, which
   is correct because plugins don't run on the server. The migration
   docstring's "Phase 5" reference is stale — see "Tiny follow-ups" below.
2. **Falcon's MCP sketch is more mature than doctor-strange's memo
   characterized it.** Doctor-strange named "2-3 weeks" for the MCP bridge.
   Falcon's actual sketch
   ([`mcp-bridge-sketch-2026-04-22.md`](../../../rim-server/docs/design/mcp-bridge-sketch-2026-04-22.md))
   estimates **4-5 weeks single-dev for the cheapest viable v1 (host stdio
   + server stdio bridge), 6-8 weeks for the full v1**. Doctor-strange
   himself flagged the estimate as needing an iron-man spike. **Treat 2-3
   weeks as the optimistic floor, not the working estimate.** See Phase 6
   for the implications.
3. **The smallest-step scope is intact.** Re-reading the live `lib.rs:71-106`
   confirms zero `register_uri_scheme_protocol` call, and `commands.rs:131`
   confirms `plugin_enable` is still `lifecycle::enable + store.save` with
   no spawn. Phase 1 below is dispatchable as written.

---

## Decision Gates (status: 3 of 5 locked, 2 open and non-blocking)

- **Q1 (Distribution model). LOCKED — Jakub 2026-04-29.** Centralized
  marketplace, hosted as a **standalone service in a new repo, deployed
  separately from `rim-server`**. Sideload remains supported as a secondary
  lane (validated by Q4's TOFU answer). Iron-man is producing a discovery
  memo on the marketplace service shape in parallel; that memo will inform
  Phase 3 backend scope. **No `rim-server` plugin tables are needed for v1.**
- **Q2 (Authoring surface).** OPEN. Does not block any locked phase. The
  hello-world plugin in Phase 1 is Python (any-language stdio), and the SDK
  in Phase 3 is `rimkit-ts` (the blessed TS/JS path). Both can coexist; the
  open question is only whether the curated marketplace will *require*
  `rimkit-ts` for listing eligibility.
- **Q3 (Web build). LOCKED — Jakub 2026-04-29.** Desktop-only for v1.
  Phase 5 collapses entirely. Web build shows a "Plugins are desktop-only"
  feature-gate message routed through the existing `runtime.pluginHost`
  capability detection in `src/core/runtime/`. Folded into Phase 1.
- **Q4 (Trust / signing). LOCKED — Jakub 2026-04-29.** **BOTH** lanes ship
  in Phase 4: (1) registry-signed plugins (cosign-style detached signatures
  verified against the marketplace public key on install) AND (2)
  trust-on-first-install (TOFU) for sideload (host records the public-key
  fingerprint on first install, warns the user if the fingerprint changes
  on update). Trust UI distinguishes the two lanes — `verified` for
  registry-signed, `pinned` for TOFU sideloads, `unverified` for
  unrecognized.
- **Q5 (Monetization).** OPEN. Not v1 scope per Jakub's earlier guidance;
  no `pricing` block needed in the manifest yet. Re-open if/when paid
  plugins become a v1.5 conversation.

**Phase 1 ships under any combination of remaining open answers.** Phase 3
and Phase 4 are now unblocked but waiting on iron-man's marketplace-service
discovery memo before they can be fully scoped.

---

## Phase 1 — Wire-the-host + web "desktop-only" message (S, dispatchable now)

**Goal.** Make the existing plugin host actually run a plugin end-to-end,
and make the web build show a coherent "Plugins are desktop-only" message
in place of the current empty/broken state. After this phase lands, every
other piece of the system has something real to exercise against, and the
web build no longer presents a confusing dead UI surface.

**Why fold the web messaging here.** Q3 was locked to desktop-only for v1
(2026-04-29). The "fix" is a feature-gate string + a placeholder card —
minutes of work, and Phase 1 is already touching `AppShell.tsx` and other
UI surfaces. A separate phase for it would be ceremony for ceremony's sake.

**Why this is the right starting point.** Every gap below in this plan (G3
marketplace, G6 update, G7 signing, G9 SDK, G10 settings) requires a running
plugin to verify against. Right now any of those would be specced against
vapor.

### Component / file-level guidance for spider-man

#### Backend (`src-tauri`)

| File | Change |
|------|--------|
| [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) | In the `setup` closure, register an asynchronous URI scheme handler for `rim-plugin://` via `tauri::Builder::register_asynchronous_uri_scheme_protocol`. Handler resolves `rim-plugin://<plugin_id>/<panel_id>/<rest>` to `~/.rim/plugins/<plugin_id>/panels/<panel_id>/<rest>` with the same path-traversal validation already implemented in `PluginPanel.tsx:17-37` — port the regex/segment-walking logic to Rust. **Do NOT** simply `Path::join`; resolve canonical, assert canonical is still under the plugin root, return `403`-shaped response otherwise. |
| [`src-tauri/src/plugin_host/commands.rs`](../../src-tauri/src/plugin_host/commands.rs) (`plugin_enable`, `plugin_disable`, `plugin_uninstall`) | After `lifecycle::enable(...)`, call a new `plugin_host::runtime::start_plugin(plugin_id, manifest, state)` which: (a) spawns `PluginProcess::spawn` from `process.rs`, (b) creates a `tokio::sync::watch` shutdown channel, (c) `tokio::spawn`s `run_broker_loop(...)` from `broker.rs:446`, (d) inserts the `shutdown_tx` into `state.shutdown_txs`. `plugin_disable` and `plugin_uninstall` look up the `shutdown_tx`, send `true`, await join (with timeout — fall back to drop, since `kill_on_drop` is set). |
| `src-tauri/src/plugin_host/runtime.rs` (NEW) | Houses the `start_plugin` / `stop_plugin` orchestration. **Keep this Tauri-aware** (uses `State<PluginHostState>`); the modules under it (`process.rs`, `broker.rs`) stay Tauri-free. |
| [`src-tauri/src/plugin_host/mod.rs`](../../src-tauri/src/plugin_host/mod.rs) | On startup, after discovery + state load, iterate plugins with `status == Enabled` and call `runtime::start_plugin` for each. This re-spawns previously-enabled plugins after an app restart. |

#### Frontend (`src/`)

| File | Change |
|------|--------|
| [`src/shell/layouts/AppShell.tsx:280-284`](../../src/shell/layouts/AppShell.tsx) | Replace the `Plugin view for X. Coming soon!` placeholder. When `mainSurface.kind === "plugin"`, render `PluginSlotContainer` (already exists per the discovery memo). All required props are already on the surface descriptor — no new state. |
| [`src/features/plugins/runtime/pluginBridge.ts`](../../src/features/plugins/runtime/pluginBridge.ts) | **No change required for P1**, BUT verify in tests that the postMessage origin lock still works against the `rim-plugin://` iframe (origin will be `"null"` per sandbox semantics — already handled correctly per discovery memo). If it doesn't: surface as a P1 BLOCK back to vision before continuing. |
| Settings → Plugins panel (file location TBD by spider-man — wherever the existing plugins tab lives) | **Web-build messaging (Q3 lock).** When `runtime.pluginHost === false` (web build), render a single placeholder card with copy along the lines of "Plugins require the RIM desktop app — they need OS-level subprocess access that the browser sandbox doesn't permit. [Get the desktop app]" pointing to the existing download surface. When `pluginHost === true`, render the existing/normal plugins UI. Detection lives in `src/core/runtime/runtime.ts`. **Do not branch on `import.meta.env.TAURI` directly** — go through the runtime capability so the abstraction holds. |

#### In-tree reference plugin

| File | Content |
|------|---------|
| `plugins/hello-world/rim-plugin.json` | v1 manifest with one capability (`ui.notify`), one command (`hello.greet`), one panel (`main`). |
| `plugins/hello-world/main.py` | Python stdin/stdout JSON-RPC plugin. Responds to `initialize`, registers one method `hello.greet`, returns `{ greeting: "hello, " + args.name }`. Replies to `rim.heartbeat` requests with `rim.heartbeat_response`. |
| `plugins/hello-world/panels/main/index.html` | Minimal HTML that loads `app.js` and renders a "Say hello" button. |
| `plugins/hello-world/panels/main/app.js` | Uses `window.parent.postMessage(...)` directly (no SDK yet — that's Phase 3). On button click, sends `rim.ui.notification.show`. |
| `plugins/hello-world/README.md` | What each file does, how to enable, what the user should see. |

### Tests required (per hard rule)

Spider-man must add tests for **every new function/component**:

- **Rust unit tests:**
  - `runtime::start_plugin` spawns a process, runs the loop, idempotent on
    double-call with same plugin_id.
  - `runtime::stop_plugin` cleanly shuts down (timeout → kill path also
    tested).
  - `rim-plugin://` URI handler — happy path, path-traversal attempt
    (`..` segments), canonical-out-of-root attempt (symlink test if feasible
    in CI), missing file → 404, plugin not installed → 404.
  - Existing `PluginProcess` tests (`process.rs:143-164`) stay green.
- **Rust integration test (new):** End-to-end — install hello-world from a
  fixture path, enable, observe broker handshake, send one capability-gated
  RPC, assert response, disable, assert process is gone. This is the
  proof-of-life test for the entire phase.
- **Vitest test:** Mount `AppShell` with a `mainSurface.kind === "plugin"`
  fixture; assert `PluginSlotContainer` renders with the right props.
- **Vitest test:** `pluginBridge` accepts a notification event from a fake
  iframe with `origin === "null"` and the correct `event.source` identity.
- **Vitest test (web-build messaging):** Render the Settings → Plugins panel
  with a `RuntimeProvider` whose `pluginHost: false`. Assert the
  desktop-only placeholder card renders and the normal plugins UI does NOT.
  Mirror with `pluginHost: true` → normal UI, no placeholder.

### Docs required

- **ADR.** New `docs/decisions/plugin-runtime-wiring-2026-04-29.md`. Records:
  the decision to spawn-on-enable rather than spawn-on-first-call; the
  decision to register `rim-plugin://` as an asynchronous URI scheme; the
  hello-world plugin's role as proof-of-life and reference artifact; the
  Q3-locked decision to keep plugins desktop-only for v1 with a runtime
  capability gate as the enforcement point.
- **README.** `plugins/hello-world/README.md` (already in deliverable list
  above).
- **Status.** Update `.claude/status.md` "Plugin systém (Phase 4)" header
  with one line: "Phase 1 (wire-the-host) shipped, hello-world reference
  plugin in-tree at `plugins/hello-world/`."

### Out of scope for Phase 1

No marketplace UI, no signed bundles, no settings persistence, no SDK, no
GraphQL backend mutations, no MCP, no web-build support, no hot-reload, no
multi-plugin orchestration tests beyond the basic install/enable/disable
flow. **Resist scope creep.** Anything not on the lists above is Phase 2+.

### Definition of done

- `npm run build` green.
- `cargo test` green (workspace).
- `npm test` green when added (no test runner today — see CLAUDE.md, so this
  is "Vitest tests pass" once the runner is wired by spider-man as part of
  this phase).
- Manual smoke: install hello-world, enable, click "Say hello", see a
  notification. Documented in the ADR.
- Hawkeye review pass.

---

## Phase 2 — Frontend bridge handlers + settings persistence (S–M, follows P1)

**Goal.** The discovery memo's G5 + G10. Today the postMessage handlers for
`rim.ui.notification.show`, `rim.ui.dialog.confirm`, `rim.settings.get`,
`rim.settings.set` only `logger.debug(...)`. Phase 2 makes them have
side-effects.

**Frontend touchpoints:**
- [`pluginBridge.ts`](../../src/features/plugins/runtime/pluginBridge.ts) —
  swap `logger.debug` calls for real handlers. Notification routes through
  the existing toast system (`shared/ui/Toast`). Dialog uses
  `shared/ui/Dialog` with confirm/cancel. Settings get/set hits a new
  per-plugin settings store (Zustand or Tauri-side persisted JSON — vision
  to specify in dispatch).
- New `src/features/plugins/state/usePluginSettings.ts` — Zustand store
  keyed by plugin_id. Persistence: Tauri-side, in
  `~/.rim/plugins/<plugin_id>/settings.json`. (Web build: in-memory only
  for now — feature-flag the persistence behind `runtime.pluginHost`.)

**Backend touchpoints:** **none** required. The settings file lives next to
the plugin, not in `rim-server`.

**Decision gate before P2:** none. P2 is unblocked once P1 lands.

**What unlocks after P2:** SDKs (Phase 3) have a meaningful API surface to
wrap. Hello-world plugin can demonstrate a real settings round-trip in its
README.

---

## Phase 3 — Local-install affordance + sideload UX (S–M, **local-install-only directive 2026-04-29**)

**Goal.** Give users a coherent UI for installing plugins **from local
sources only**: a folder on disk or a git URL. List what's installed.
Allow uninstall. Ship `rimkit-ts` so plugin authors don't reverse-engineer
postMessage. **No marketplace, no centralized catalog, no remote install
in this iteration.**

**Why this scope (per Jakub 2026-04-29).** The full marketplace work
(catalog UI, signed bundle distribution, `rim-marketplace` repo, author
submission API) is **DEFERRED to a future dedicated session**, same
treatment as CLI v1. Iron-man's marketplace discovery memo at
[`rim-server/docs/research/plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md)
is the seed for that future session and stays as-is. For now, sideload
is the only install path, which lines up cleanly with where Phase 1
already left the system: `plugin_install_from_git` and folder-install
already exist on the backend per iron-man's discovery memo; Phase 3
mostly just adds a UI affordance over them.

### Scope kept

- **Settings UI affordances:**
  - "Install from local folder" — folder picker → invokes the existing
    folder-install backend command → reports success/failure.
  - "Install from git URL" — text input + "Install" button → invokes
    `plugin_install_from_git` → reports success/failure.
- **Installed-plugins list view** — name, version, source (local folder
  path / git URL), enable/disable toggle, uninstall button. Reads the
  same plugin store Phase 1 already populates.
- **Uninstall UX** — confirm dialog → invokes existing uninstall path →
  removes from disk + clears state. Works for both folder-installed and
  git-installed plugins.
- **Plugin SDK (`rimkit-ts`)** — still useful for plugin authors even
  without a marketplace; scope shrinks (no upload/publish flow). Authors
  consume the SDK to write plugins they then sideload via the affordances
  above. **If the SDK turns out to be a clean fit alongside the install
  affordances, ship it inside Phase 3; if it's noticeably bigger or wants
  its own review pass, split it out as Phase 3.5. Vision's call at
  dispatch time.**

### Verification step (carries forward from Phase 1)

Phase 1 landed the spawn path 2026-04-29. Iron-man's memo flagged
`plugin_install_from_git` as already-implemented backend behaviour
that this phase's UI sits on top of. **Phase 3's first task is to
verify `plugin_install_from_git` actually works against Phase 1's now-
functional spawn path** — install a fixture git URL, observe the spawn,
exercise the broker handshake. If it doesn't work, that's a Phase 3 fix
(probably a small one — likely a path-resolution mismatch between the
git checkout layout and what spawn expects). Treat verification as a
gate before building the UI affordances.

### Scope dropped (vs. earlier revision)

Explicitly removed from Phase 3:

- Marketplace catalog UI (`MarketplaceBrowser`, `MarketplaceCard`,
  `MarketplaceDetail`).
- Browse/search functionality.
- `marketplaceClient.ts` abstraction.
- `useMarketplaceCatalog.ts` TanStack Query hook against a remote service.
- Any reference to `rim-marketplace` repo / standalone marketplace service /
  signed-bundle distribution / public-key embedding for marketplace
  verification.
- `VITE_MARKETPLACE_ENDPOINT` env var.

All of the above shifts to the deferred dedicated session.

### Frontend touchpoints

| File | Role |
|------|------|
| `src/features/plugins/components/InstallFromFolder.tsx` (NEW) | Folder picker (uses Tauri dialog plugin) → invokes folder-install backend command. Behind a runtime capability check — desktop only. |
| `src/features/plugins/components/InstallFromGit.tsx` (NEW) | Text input + Install button → invokes `plugin_install_from_git`. Validation: looks roughly URL-shaped before invoke. Error rendering for unreachable URL / non-plugin repo. |
| `src/features/plugins/components/InstalledPluginsList.tsx` (NEW) | Replaces (or sits next to) Phase 1's basic listing. Shows name, version, source, enable toggle, uninstall button. Reads existing plugin store. |
| `src/features/plugins/components/UninstallConfirmDialog.tsx` (NEW) | Confirm dialog using existing `shared/ui/Dialog`. |
| `src/shell/layouts/AppShell.tsx` plugins surface | Render the install affordances + installed list inside the existing Settings → Plugins panel scaffolding. No new top-level surface. |

### SDK package (scope-shrunk)

| File | Role |
|------|------|
| `packages/rimkit/package.json` (NEW) | npm-publishable later, in-tree consumed for now. |
| `packages/rimkit/src/index.ts` (NEW) | Public API surface. Conservative — `onCommand`, `registerPanel`, `getSettings`, `setSettings`, `notify`, `confirm`. Each method wraps the postMessage bridge with typed handlers. **No `publish` / `submitToMarketplace` / `uploadBundle` surface — that's deferred with the marketplace session.** |
| `packages/rimkit/src/types.ts` (NEW) | Mirrors the manifest schema types from `src/features/plugins/types.ts` so plugins author manifests with type help. |
| `packages/rimkit/README.md` (NEW) | Quick-start authoring guide. **Sideload-only instructions** ("write your plugin, then install via Settings → Plugins → Install from local folder / git URL"). No marketplace publishing instructions yet. |

### Reference plugins

- `plugins/hello-world/` — rewrite to use rimkit-ts (already in-tree from
  Phase 1 as raw postMessage; this revision swaps it to the SDK).
- Additional reference plugins (`markdown-preview`, `timestamp-snippet`)
  remain useful as exercises of the broader capability surface but are
  not strictly required by Phase 3's local-install scope. **Vision's call
  whether to ship them in Phase 3 or hold them for the marketplace
  session** (they were originally specced as marketplace-seed content).

### Tests + docs

Standard rule — every component/function gets tests, every public surface
gets docs.

### Backend touchpoints

- **`rim-server`: none.** No new plugin tables, no GraphQL surface.
  Unchanged from prior revision; even more clearly none now since there
  is no marketplace service in this iteration to integrate with.
- **`src-tauri`: none, IF `plugin_install_from_git` and folder-install
  verify clean against Phase 1's spawn path.** If verification fails, the
  fix is in `src-tauri` — small, local — and lives inside Phase 3.

### Marketplace work — DEFERRED to a separate dedicated session

Per Jakub's directive 2026-04-29, the full marketplace track moves to its
own dedicated session, same treatment as CLI v1. That session will
inherit:

- Catalog UI (browse, search, detail, install-from-marketplace).
- `rim-marketplace` repo (Axum + SQLite + REST per iron-man's memo §3.1).
- Author submission flow (admin CLI v1, public API v1.5+).
- Signed bundle distribution + marketplace public-key verification (the
  Lane A work formerly in Phase 4 — see Phase 4's deferred notes).
- `marketplaceClient.ts`, `useMarketplaceCatalog.ts`, the trust-badge
  `verified` state.

**Seed memo for that session:** iron-man's
[`plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md)
§3.1–§3.7. No edits to that memo as part of this revision.

**What unlocks after P3:** Phase 4 (TOFU fingerprint tracking) has a
place to land — sideload install flow exists, fingerprint can be captured
on install, displayed in the installed-plugins list.

---

## Phase 4 — Trust / TOFU fingerprint tracking + hot-reload (S–M FE, **single-lane TOFU only per local-install-only directive 2026-04-29**)

**Goal.** Discovery memo G7 + G8, scoped down. `TrustLevel` is in the
type system but nothing verifies it. Plugin authors editing entrypoints
must uninstall+reinstall. Phase 4 ships **one** trust lane (TOFU
fingerprint tracking) plus the dev-mode hot-reload affordance.

**Why single-lane (per Jakub 2026-04-29 directive).** With marketplace
deferred to its own session and all installs being sideload (folder /
git URL), there is no marketplace public key to verify against in this
iteration. Lane A (registry-signed cosign-style verification) is
**DEFERRED — reactivates when the marketplace session lands.** Design
rationale for Lane A is preserved below so the future session can pick
it up cleanly.

### TOFU fingerprint tracking (this iteration's only trust lane)

Sideloaded plugins (from git, local folder) aren't required to be signed.
The host records a fingerprint of the plugin's manifest+entrypoint hash
on first install, and warns the user if the fingerprint changes on update
or re-install.

- **Fingerprint:** SHA-256 of canonical-form manifest + sorted-by-path
  hashes of every file in the bundle. Stored in
  `~/.rim/plugins/<plugin_id>/.fingerprint.json` (or in a per-user
  fingerprint database if iron-man prefers a single file).
- **First install:** record fingerprint silently, mark plugin as `pinned`
  trust level.
- **Re-install / update:** compare new fingerprint against stored. If
  match: silent. If mismatch: explicit consent dialog through existing
  `PluginCapabilityPrompt` infrastructure ("This plugin's contents have
  changed since you last installed it. Continue?").
- **Trust-badge states (reduced for this iteration):**
  - `pinned` — TOFU fingerprint matches stored value.
  - `unverified` — no fingerprint yet (first install pending, before the
    consent flow has fired).
  - `dev` — hot-reload is active for this plugin; fingerprint checks
    bypassed (otherwise hot-reload is impossible).
  - **`verified` is dropped for now** — there's no marketplace public
    key to verify against in this iteration. Returns when the marketplace
    session lands.

### Hot-reload (dev mode only)

File-watcher in dev mode that re-discovers manifests in
`~/.rim/plugins/<id>/` and emits a Tauri event the frontend subscribes to.
Only active when `import.meta.env.DEV`. Bypasses TOFU fingerprint checks
in dev — surfaced via the `dev` trust-badge state above.

### Frontend touchpoints

- `src/features/plugins/runtime/fingerprintTracker.ts` (NEW) — TOFU
  fingerprint capture, comparison, persistence. Calls into a new Tauri
  command for the actual file IO + hash computation.
- Existing `TrustBadge.tsx` becomes meaningful — three real states:
  `pinned` (fingerprint matches), `unverified` (no fingerprint yet —
  install consent flow), `dev` (hot-reload).
- Hot-reload subscriber: `src/features/plugins/runtime/hotReload.ts` (NEW)
  — listens for Tauri file-watcher events in dev mode, triggers the
  plugin host's reload path.

### Backend touchpoints

- **`rim-server`: none.** TOFU is local to the desktop client.
- **`src-tauri`:** new commands for fingerprint computation
  (`plugin_compute_fingerprint`, `plugin_get_stored_fingerprint`,
  `plugin_store_fingerprint`) — these need to read full bundle contents,
  which the frontend can't and shouldn't do. Capability-gated like the
  rest of the plugin host commands.
- **`rim-marketplace`: N/A in this iteration** (deferred with the
  marketplace session — see "DEFERRED" section below).

### What unlocks

Power users get a sideload path with cryptographic continuity — they
notice when a plugin's contents change between updates. UI distinguishes
"trust this because I trust the source AND the contents haven't changed
since I first installed it" (`pinned`) from "I haven't seen this before"
(`unverified`). Plugin authors get hot-reload during development.

### Lane A — Registry-signed plugins — DEFERRED (reactivates with marketplace session)

**Design rationale preserved here so the future marketplace session can
pick it up cleanly without re-deriving it.**

Plugins installed from the future `rim-marketplace` service would carry
detached Ed25519 signatures. Per iron-man's memo §3.3, the marketplace
co-signs bundles with its private key on accept (admin CLI in v1); the
plugin host verifies the signature against the marketplace public key
list shipped with `rim-ui`.

- **Bundle format:** `bundle.tar.gz` + `bundle.tar.gz.sig` (detached
  signature, Ed25519 or ECDSA — iron-man's call). Signature is over the
  full bundle hash, NOT just the manifest. Verification happens
  *before* extracting bundle contents to disk.
- **Public-key distribution:** marketplace public key embedded in `rim-ui`
  at build time, with a fallback to fetch + TOFU-pin from the marketplace
  service on first run (matches how `cosign`'s Fulcio model degrades).
- **UI signal:** `verified` badge with marketplace-key fingerprint
  visible-on-hover. Failure to verify = install is **rejected** (not
  warned), with a clear error.
- **Frontend touchpoint (deferred):** `signatureVerifier.ts` — Ed25519/
  ECDSA verification. Sodium / WebCrypto SubtleCrypto. Only invoked on
  registry installs.
- **Backend touchpoint (deferred):** `rim-marketplace` (separate repo)
  hosts the signing-key registry (`plugin_signing_key` table per
  iron-man's memo §3.2), bundle co-signing pipeline at accept-time,
  `GET /v1/keys` endpoint for desktop verification, key-rotation policy.
  Detail in iron-man's memo §3.3.
- **Shared infrastructure (deferred):** when both lanes coexist, they
  share one `TrustOutcome` enum (per iron-man's memo §3.5). Phase 4 in
  this iteration ships only the TOFU half of that enum; the marketplace
  session adds the signed half.

When the marketplace session lands and Lane A reactivates, the
trust-badge `verified` state returns and `TrustBadge.tsx` gains a fourth
state.

---

## Phase 5 — COLLAPSED (folded into Phase 1) — was: Web build plugin story

**Status:** **Q3-locked 2026-04-29 to desktop-only for v1.** This phase no
longer exists as a standalone unit. The "Plugins are desktop-only" feature-
gate message is folded into Phase 1's frontend work since AppShell / Settings
UI surfaces are already being touched there. See Phase 1's frontend
touchpoints table for the spec.

**Why folded rather than dropped:** the web build *does* still need a coherent
message instead of an empty plugin tab. That work is real (a placeholder
card + a runtime-capability check) but small enough that giving it its own
phase would be process for process's sake.

**If Jakub later flips Q3 to "iframe-only web mode":** restore this phase as
"Phase 5.5 — Web iframe-only plugin runtime (M FE, S BE)" with the original
spec (web plugin host that skips process spawn, capability gate forbidding
headless caps, server-side asset endpoint). Out of scope for v1.

---

## Phase 6 — MCP host + server bridge (M FE, **L BE — needs iron-man spike**, **gate on P1+P3**)

**Goal.** Per doctor-strange's strategic memo (rank-1 bet) and falcon's
sketch: RIM both consumes MCP servers as plugins (host) and exposes RIM
commands as MCP tools (server). One protocol, two directions.

### Iron-man feasibility verdict (confirmed 2026-04-29)

Iron-man confirmed in his memo §2; see [`plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md) §2.

**My read on doctor-strange's "2-3 weeks" claim:** **Contradicted.** Falcon's
own sketch — which doctor-strange cites as the source of the "RIM is
accidentally MCP-shaped" claim — estimates **4-5 weeks single-dev for the
cheapest viable v1** (host stdio + server stdio bridge only) and **6-8
weeks** for the full v1 (host stdio + MCP Apps UI + server stdio + Streamable
HTTP). Doctor-strange's number appears to be a compression that drops MCP
Apps UI rendering and the HTTP server transport, *and* assumes both CLI v1
and the AI agent reframe ship first as prerequisites. Doctor-strange himself
flagged the estimate as "needs an iron-man spike" in §6 of his memo.

**Verdict:** **needs spike** before any commitment. Most likely revised
estimate range: **M (3-4 weeks for the smallest-viable subset, single dev) to
L (6-8 weeks for the full v1)**. Treat doctor-strange's "2-3 weeks" as the
optimistic floor only — and only after the prerequisites land.

### Why this is Phase 6, not Phase 2

MCP host integration *requires* a working plugin host (P1) and a way to
install MCP servers (P3 marketplace, or at minimum a manifest-extension
mechanism that ships with P3). Falcon's §2.2 explicitly states "an MCP server
is just a special kind of RIM plugin" — that means the plugin host needs to
actually run plugins before MCP can ride on it. **MCP cannot precede P1.**
Per falcon's §5 sequencing, MCP also wants CLI v1 + AI-agent reframe first —
both parallel tracks per the brief. Sequencing implication: MCP slots in
*after* the rim-server-side prerequisites, which means it's calendar-time
later than P5 unless those tracks complete first.

### Prerequisites

- **Phase 1 must have shipped.** Plugin host actually executes plugins. (Per
  vision's discovery memo and falcon's §5.)
- **Phase 3 must have shipped (or be in flight).** Manifest extensions
  (`kind: "mcp"`) need a place to live; install flow needs to handle a new
  plugin kind.
- **CLI v1 (parallel track) should have shipped.** Establishes the API
  token model that the MCP server stdio bridge reuses verbatim — falcon
  §3.4: "Zero new auth concepts. This is the single biggest reason to do
  CLI v1 first." If CLI v1 hasn't shipped when Phase 6 starts, scope
  inflates by the API-token work.
- **AI agent reframe** (Tony's Phase 5 work) should have established
  unified `CommandDefinitionDto.ai_callable` field, which falcon argues is
  the same field as `mcp_safe`.

### Scope breakdown (per falcon §5, with iron-man's caveat)

| Sub-phase | What | Scope |
|-----------|------|-------|
| P6.H1 | MCP host stdio: new `rim_mcp_host` crate, manifest `kind: "mcp"`, `tools/list` → command registration, `tools/call` dispatch through `CommandService` | **L backend** — subprocess lifecycle, JSON-RPC framing, schema translation, error handling |
| P6.H2 | MCP Apps UI (host side): `panel_ref` on `CommandResultDto`, frontend adapter, `ui://` resource fetch + cache | **M frontend** — RIM's plugin slot infra does the heavy lifting |
| P6.S1 | MCP server stdio bridge: new `rim-mcp` thin binary that bridges stdio MCP → HTTP + bearer to rim-server | **M backend** — reuses CLI auth/transport stack |
| P6.S2 | MCP server Streamable HTTP: `/mcp` endpoint on rim-server, `mcp_safe` filtering | **M backend** — new endpoint, reuses `CommandService` |
| P6.S3 | OAuth 2.1 for HTTP transport | **L–XL backend** — defer to v2 |
| P6.H3 | Subprocess sandbox hardening (bubblewrap/landlock/sandbox-exec) | **L backend** — defer to v1.5 |

**Cheapest viable Phase 6 (per falcon):** H1 + S1 only. ~M+L = ~4-5 weeks
single dev. Drops MCP Apps UI rendering and Streamable HTTP server transport.

### Black Widow review checkpoints

Falcon flagged five (G-MCP-1, G-MCP-2, HTTP without OAuth, mcp_safe policy,
iframe sandbox). All apply. Don't ship Phase 6 without explicit Widow
sign-off on each.

### What unlocks after P6

- **Marketplace expands "for free"** — every public MCP server (10,000+ as
  of March 2026, per workos.com) becomes installable.
- **RIM is reachable from any AI workspace** — Cursor/Claude Desktop/Zed
  can drive RIM commands through the bridge.
- **Strategic positioning:** RIM becomes a peer to Cursor/Claude Desktop in
  the agentic-workspace category, not a competitor.

### Risks (per falcon §7)

1. **Spec churn** (HIGH) — MCP rev'd 3x in 2025; lock to a versioned
   snapshot.
2. **Security surface** (HIGH — Black Widow review).
3. **Subprocess fan-out** (MEDIUM) — 10+ MCP servers × keep-alive
   subprocesses.
4. **Ecosystem fragmentation** (LOW–MEDIUM).
5. **Late-entrant penalty** (MEDIUM) — 6-12 month window.

---

## Backend (rim-server) gap analysis — validated by iron-man 2026-04-29

This section was originally drafted by vision (frontend architect) as
provisional. Iron-man's memo
[`plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md)
validated the backend claims and drove the revisions below. Source-of-truth
for `rim-server` plugin scope is now iron-man's memo; this section
summarises what it means for this plan.

### Per Q1 answer (LOCKED 2026-04-29 — standalone marketplace service)

`rim-server` backend scope for the plugin system: **none.** All
plugin-distribution backend work lives on a new `rim-marketplace` repo
(Axum + SQLite + REST per iron-man's memo §3.1).

| Concern | `rim-server` impact | `rim-marketplace` (new repo) impact |
|---------|----------------------|--------------------------------------|
| Listing data model | None | `plugin` / `plugin_version` / `plugin_author` / `plugin_signing_key` / `plugin_install_count` tables per iron-man's memo §3.2. SQLite for v1, promote to Postgres in v1.5+ if write traffic justifies. |
| Install API | None | REST surface per iron-man's memo §3.4 (`GET /v1/plugins`, `GET /v1/plugins/<slug>`, `GET /v1/plugins/<slug>/versions/<v>/manifest`, `GET /v1/plugins/<slug>/versions/<v>/bundle`, `GET /v1/keys`, `POST /v1/plugins/<slug>/install-event`). Anonymous read for browse; admin CLI for v1 catalog seeding. **Author-submission API deferred to v1.5.** |
| Bundle storage | None | Filesystem-on-host for v1 (`/var/lib/rim-marketplace/bundles/<plugin_id>/<version>.tar.gz`). S3-compatible blob and CDN-fronting deferred to v1.5. |
| Signing-key hosting | None | Marketplace's Ed25519 private key in `rim-marketplace` deployment secrets. `plugin_signing_key` table holds key history. Per iron-man's memo §3.3, desktop ships hardcoded marketplace public-key list (current + last-1). |
| Capability registry FK | **Stays nullable. Deferred FK constraint does NOT need to land in v1.** Per iron-man's memo §1.4, plugin grants live desktop-local (option C). | N/A — marketplace doesn't track per-user installed-plugin state in v1 (anonymous install counts only). |
| `rim_services::plugin_host` (1,290 LOC of dead validators) | Per iron-man's memo §1.1, recommended path is to extract to a shared `rim_plugin_contracts` crate (option 2) so both desktop and `rim-marketplace` can reuse the N1 capability-key validator and F2 install-ID-leak walker. **Out of scope for this plan; flagged for iron-man's roadmap.** | Same shared crate consumed for catalog ingestion validation. |

**Historical note:** vision's earlier provisional row "Iron-man scope
estimate (provisional): L" for `rim-server` plugin tables under a
centralized-marketplace assumption is **obsolete** under Q1 = separate
service. The L estimate moves to `rim-marketplace` as **M (~4-5 weeks
single dev)** per iron-man's memo §3.7. `rim-server` plugin scope is
**none** for v1.

### Capability registry — plugin-grant store deferred indefinitely

Per iron-man's memo §1.4, the **plugin-grant store on `rim-server` is no
longer a v1/v1.5 deliverable.** Vision's earlier framing ("the plugin-grant
store is the missing piece for plugin work but only matters if Q1 is
server-managed") was correct as a conditional — Q1 locked to separate
marketplace, so the conditional collapses to: **deferred indefinitely;
plugin-source caps deny on the server, which is correct.**

Today
[`capability/service.rs:23-25`](../../../rim-server/rim_services/src/capability/service.rs)
documents the plugin-grant store as future work referencing "Phase 5" — that
reference is now stale. Per iron-man's memo §3.6, the docstring should read
something like:

> For `Plugin`-source capabilities, the actor must hold an explicit grant.
> Phase 1 ships the workspace-membership half only. Plugin-source caps are
> deferred indefinitely on `rim-server`; plugins don't run on the server,
> so deny-by-default everywhere is the correct behaviour. Per-user
> installed-plugin state lives desktop-local; signed catalog metadata
> lives on `rim-marketplace`.

This is a comment-only fix — flagged as a tiny follow-up below for hulk.

**Coupling:** the plugin-grant store is **independent** of the desktop plugin
host wiring (Phase 1 of this plan). Per iron-man's memo §1.4, per-user
installed-plugin state lives **desktop-local** (option C: `~/.rim/plugins/`
+ `plugin_state.json`, already shipped). The marketplace tracks aggregate
install counts only, not per-user identity. Cross-device install sync is
v2+ scope.

**Recommendation for `rim-server`:** capability registry's deferred FK
stays deferred. Re-evaluate ONLY if a future feature requires plugins to
register grants directly against `rim-server` workspaces (e.g. some future
"this plugin can act in this workspace on behalf of this user" flow). For
now, no further migration extension on the capability registry is needed.

### MCP-specific backend touchpoints

- New crates `rim_mcp_host`, `rim_mcp_server` per falcon §2.1 + §3.1.
- New `mcp_safe: bool` field on `CommandDefinitionDto` (or unify with
  `ai_callable` per falcon's open question 5).
- New `MCP_RPC` variant on command execution_target enum.
- New `MCP` variant on `CommandSourceKindDto`.
- `panel_ref` field on `CommandResultDto` for MCP Apps support (P6.H2).

### Areas where I'd most want iron-man pushback — RESOLVED 2026-04-29

All three open questions answered by iron-man's validation memo. Kept here
for trail; struck through where resolved.

1. ~~**Is the existing
   `m20260426_200000_capability_registry_add_is_self_scoped` migration
   actually solid for the plugin grant work, or does it need another
   extension?**~~ **Resolved (iron-man's memo §1.3).** Migration is solid
   for the H2 closure it shipped. **Moot under Q1 = separate marketplace:**
   plugin-grant work is no longer landing on `rim-server`, so the question
   doesn't apply. No further migration extension needed.
2. ~~**Is `rim-server`'s docstring "Phase 5" reference (in the
   `capability/service.rs` trait doc) still accurate?**~~ **Resolved
   (iron-man's memo §1.3 + §3.6).** Stale. Comment-only cleanup needed —
   replace with the deny-everywhere-is-correct framing in the
   "Capability registry" section above. Flagged for hulk in "Tiny
   follow-ups" below.
3. ~~**Is the `plugin_host` server-side module referenced as "1,290 LOC of
   dead code" still considered dead?**~~ **Resolved (iron-man's memo
   §1.1 + §1.5).** Confirmed dead. 1,283 LOC across `manifest.rs` (165),
   `runtime.rs` (69), `validation.rs` (1056). Zero consumers in `rim_api`,
   `rim_infra_services`, or `rim_server`. Recommended path: extract to
   `rim_plugin_contracts` shared crate so desktop and `rim-marketplace`
   can both consume the N1/F2 validators. Out of this plan's scope.

### Tiny follow-ups (for hulk or whoever next touches the file)

- **`rim_services/src/capability/service.rs:23-25` docstring cleanup.**
  Comment-only fix. Replace the stale "Phase 5" reference with the
  deny-everywhere-is-correct framing per iron-man's memo §3.6. No code
  change. Trivial PR; should land in the same PR that next touches the
  file.

---

## Out of scope for this plan

These are real tracks, but not part of the plugin-system phase sequence.
Listed for clarity so they don't accidentally get pulled into a phase.

- **CLI v1.** Parallel track per Jakub. Will get a dedicated full-team session.
  Mentioned only as a Phase 6 prerequisite (because the MCP server stdio bridge
  reuses CLI's API token model).
- **WASM plugin runtime.** v2+ architecture decision per discovery memo G11.
  Significantly stronger sandbox; not v1.
- **Cross-device plugin sync.** Backend-managed plugin policy. v2+ per G12.
- **Plugin marketplace ratings/reviews/telemetry.** v2+ per G13.
- **Enterprise admin policy controls.** v2+ per G14.
- **Process pool / shared runtime for headless plugins.** v2+ per G15.
- **Voice/video, federation, multi-protocol multiplexing.** Per
  doctor-strange's "what NOT to build" — defer indefinitely.
- **Slack-style horizontal AI agent expansion.** Per doctor-strange's "what
  NOT to build" — RIM stays narrow.

---

## Sequencing recommendation for fury (post local-install-only directive)

1. **Phase 1: DONE.** Spider-man landed wire-the-host 2026-04-29 (spawn +
   asset protocol + hello-world plugin + folded web "desktop-only"
   message). Phase 5 collapsed into this and is also DONE.
2. **Phase 2: still next.** Frontend bridge handlers + settings
   persistence (G5 + G10). No decision gate, follows P1.
3. **Phase 3: now "local-install affordance + sideload UX" — much
   smaller scope.** Dispatchable as soon as Phase 1's verification
   confirms `plugin_install_from_git` works against the now-functional
   spawn path. SDK (`rimkit-ts`) ships inside Phase 3 if it's a clean
   fit, or splits to Phase 3.5 if it's better separated. **Marketplace
   work is deferred to a separate dedicated session.**
4. **Phase 4: TOFU-only — smaller than before.** Single-lane fingerprint
   tracking + dev-mode hot-reload. Lane A (registry-signed) deferred
   with the marketplace session.
5. **Phase 5: N/A** — collapsed into Phase 1, already shipped.
6. **Phase 6 (MCP): unchanged.** Still gated on Phase 1 (DONE) + Phase 3
   landing + CLI v1 shipping + AI-agent reframe Phase 5 closing. Iron-
   man's MCP validation landed 2026-04-29 (memo §2); his real-calendar
   floor including unshipped prerequisites is **7-10 weeks**. Vision's
   M-to-L estimate range was confirmed correct; no Phase 6 scope
   revision in this pass.

### Deferred sessions (not in this plan's phase sequence)

- **Marketplace session.** Catalog UI, `rim-marketplace` repo, signed
  bundle distribution, author submission flow, Lane A trust verification,
  re-introduction of `verified` trust badge state. Seed: iron-man's
  [`plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md)
  §3. Will get its own dedicated session per Jakub 2026-04-29.
- **CLI v1 session.** Parallel track per Jakub. Will get a dedicated
  full-team session. Mentioned only as a Phase 6 prerequisite.

---

## Things that would change this plan

- ~~**Iron-man's marketplace-service discovery memo returns scope >> L.**~~
  **Resolved 2026-04-29:** iron-man's memo §3.7 returned **M (~4-5 weeks
  single dev)**, not >> L. Phase 3 calendar fits the original assumption.
  Stopgap (hardcoded JSON catalog) is no longer needed — marketplace v1
  already ships with a hard-coded plugin list seeded by RIM team via
  admin CLI (per iron-man's §3.4), which IS the stopgap, just better
  shaped.
- ~~**Iron-man's MCP validation pass returns scope >> L.**~~ **Resolved
  2026-04-29:** iron-man's memo §2.3 confirmed vision's M-to-L range
  (cheapest viable H1+S1 = ~4-5 weeks single dev; full v1 = ~6-8 weeks).
  Real-calendar floor including unshipped prerequisites (CLI v1 +
  reframe Phase 5 close) is **7-10 weeks**. Risk to the 6-12 month
  strategic window is real if prerequisites slip, but not from MCP scope
  itself.
  May need to descope MCP Apps UI from the v1 surface and ship pure host
  stdio + server stdio only.
- **CLI v1 doesn't ship before Phase 6 is needed.** Phase 6 absorbs the
  API-token work; scope inflates by ~M.
- **A new BLOCK finding from Hawkeye's review of P1.** Could surface that
  the asset-protocol path-traversal validation needs more rigor — the path
  walking I sketched is a starting point, not a finished spec.
- **Jakub flips Q3 (web build) to "iframe-only mode."** Then the collapsed
  Phase 5 needs to be reinstated. Original spec preserved in the Phase 5
  collapsed-stub above.
- **Jakub answers Q2 (authoring surface) toward "blessed-TS-only for the
  curated marketplace."** Then the SDK becomes the only published lane, and
  the Python hello-world plugin in Phase 1 stays as an internal proof-of-
  life rather than a reference for external authors. Doesn't reshape phases,
  just narrows what gets externally documented.

---

## What changed in this revision (2026-04-29 local-install-only directive)

Per Jakub's two directives 2026-04-29:

1. Marketplace deferred to its own dedicated session (same treatment as
   CLI v1).
2. For now, plugins install from local only — sideload from folder / git
   URL.

### Got smaller

- **Phase 3** rewritten from "Marketplace UI + plugin SDK + standalone
  marketplace service integration (M)" to "Local-install affordance +
  sideload UX (S–M)." Kept: install-from-folder UI, install-from-git UI,
  installed-plugins list, uninstall UX, `rimkit-ts` SDK (scope-shrunk —
  no upload/publish flow).
- **Phase 4** reduced from "two trust lanes (registry-signed + TOFU)"
  to "single-lane TOFU fingerprint tracking + dev-mode hot-reload."
  Trust-badge states reduced to `pinned` / `unverified` / `dev`.

### Got deferred (to dedicated marketplace session)

- Marketplace catalog UI (`MarketplaceBrowser`, `MarketplaceCard`,
  `MarketplaceDetail`).
- `marketplaceClient.ts` abstraction, `useMarketplaceCatalog.ts` hook,
  `VITE_MARKETPLACE_ENDPOINT` env var.
- `rim-marketplace` repo (Axum + SQLite + REST per iron-man's memo §3.1).
- Author submission flow, admin CLI for catalog seeding, signed bundle
  distribution.
- Phase 4 Lane A — registry-signed cosign-style verification, marketplace
  public-key embedding, `verified` trust badge state. Design rationale
  preserved in the Phase 4 body for the future session.

### Got dropped (not coming back unless directive flips)

- Marketplace assumption baked into the Phase 3 frontend touchpoints —
  install-from-marketplace flow, browse/search, detail page.
- SDK upload/publish surface (`publish`, `submitToMarketplace`,
  `uploadBundle`).
- `verified` trust-badge state — returns only when Lane A reactivates
  with the marketplace session.

### Untouched

- Phase 1 (DONE 2026-04-29) — scoping locked, shipped.
- Phase 2 (next) — scoping locked, unchanged.
- Phase 6 (MCP) — scoping unchanged; only the stale "provisional" subheader
  was updated to reflect iron-man's 2026-04-29 confirmation.
- Iron-man's marketplace discovery memo at
  [`rim-server/docs/research/plugin-backend-validation-2026-04-29.md`](../../../rim-server/docs/research/plugin-backend-validation-2026-04-29.md)
  — referenced as the seed for the future marketplace session, not edited.

### Trajectory note for future readers

The plan went from "ship marketplace + signing in Phases 3–4" to "ship
local-install + TOFU in Phases 3–4, defer marketplace + signing to a
dedicated session." The deferred work isn't dropped — its scope and
shape (per iron-man's memo) remain valid. The future marketplace session
inherits a smaller, cleaner job because Phases 1–4 will have already
landed the plugin runtime, sideload UX, SDK, and TOFU half of the trust
model by the time it starts.

— vision
