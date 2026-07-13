# Plugin System — Discovery & Status Memo

- **Author:** vision (frontend / UX architect)
- **Co-author note:** This dispatch was solo. The Task tool was not available in
  this environment, so iron-man could not be dispatched in parallel; backend
  findings below are derived from direct filesystem inspection of `rim-server`
  (paths and line numbers cited). Recommend a separate iron-man pass to confirm
  before any backend work is scoped.
- **Date:** 2026-04-29
- **For:** nick-fury

---

## TL;DR

**Current state.** The desktop plugin host has a substantial, mostly correct
*skeleton*: a versioned manifest schema (`rim-plugin.json` v1, plus a "simple
mode" header-comment manifest), a capability-keyed JSON-RPC 2.0 wire protocol
with a length-prefixed framing implementation, a capability gate that maps
methods → capabilities, an iframe-based UI rendering model with origin-locked
postMessage bridge, a broker with rate limiting and heartbeats, manifest
content-hash drift detection, and a settings page wired to TanStack Query
mutations. Three things are missing that prevent end-to-end function: (1) the
`plugin_enable` Tauri command never actually spawns a plugin process — the
`run_broker_loop` exists but no caller wires it to the lifecycle; (2) the
`rim-plugin://` URI scheme used by `PluginPanel` is referenced but no Tauri
asset-protocol handler is registered for it, so panel iframes will currently
fail to load any real plugin; (3) there is no marketplace, no discovery
catalog, and no signed-bundle distribution channel — `plugin_install_from_git`
is the only real install path, and the marketplace UI is a literal `Marketplace
coming soon!` placeholder string in `AppShell.tsx`. Backend `rim-server` has
*no* plugin tables, *no* GraphQL plugin surface, and only contract-level DTOs
in `rim_services::plugin_host` — by deliberate design (see
`rim-server/docs/plugin_model.md`: "Plugins are not backend-managed by
default").

**Smallest meaningful next step (S).** Wire `plugin_enable` to actually spawn
the plugin process and connect its broker loop, register the
`rim-plugin://` URI scheme in `lib.rs`, and ship one in-tree hello-world
plugin (Python, simple-mode) that exercises a single capability-gated method
end-to-end. Without this, every other piece of the host is dead code. With
it, the marketplace, manifest hardening, and signing work all have something
real to install against.

**Top 3 open questions for Jakub.**
1. **Distribution model:** centralized marketplace (signed bundles served by
   `rim-server`), sideload-only (git/local-folder), or both? This decides
   whether plugin tables belong on the server.
2. **Authoring surface:** the host already supports any-language plugins via
   stdin/stdout. Do we commit to that as the v1 story, or do we narrow to a
   blessed TS/JS path with a stronger SDK to keep marketplace QA tractable?
3. **Web build:** plugins are explicitly desktop-only today (`pluginHost:
   false` for web). Do we want a degraded web mode where iframe-only plugins
   work without process backing, or stay desktop-only for v1?

---

## 1. Current State — What Exists

### 1.1 Frontend (`rim-ui/src/features/plugins/`)

The feature module is well-structured and follows the project's `api/` →
`components/` → `runtime/` convention.

**Manifest schema (TypeScript mirror).**
[`src/features/plugins/types.ts:75-85`](../../src/features/plugins/types.ts)
defines `PluginManifest` with `id`, `name`, `version`, `description`, `author`,
`trust_level`, `capabilities`, `commands`, `panels`. The TS mirror is
explicitly tied to the Rust authoritative source: `types.ts:3` reads "*sourced
from src-tauri/src/plugin_host/capability.rs METHOD_CAPABILITY_MAP*". Defensive
parser `parsePluginCapabilities` drops unknown values rather than throwing —
appropriate for a forward-compatible manifest layer.

**Capability model.** Closed set of nine capabilities: `chat.read`,
`chat.write`, `events.read`, `local.process`, `network`, `fs.read`,
`fs.write`, `ui.notify`, `ui.panel`. Each has user-facing label + description
in
[`PluginCapabilityPrompt.tsx:9-31`](../../src/features/plugins/components/PluginCapabilityPrompt.tsx).
Approval prompt allows per-capability deselection at install time.
Approve/revoke wired through `useApproveCapabilities` /
`useRevokeCapabilities` mutations
([`api/usePluginCapabilities.ts`](../../src/features/plugins/api/usePluginCapabilities.ts)).

**Lifecycle hooks.**
[`api/usePluginActions.ts`](../../src/features/plugins/api/usePluginActions.ts)
exposes `usePluginEnable / usePluginDisable / usePluginInstall /
usePluginUninstall` — all mutations targeting `safeInvoke()` Tauri commands.
Successful mutations invalidate `queryKeys.plugins()` *and* call
`reloadCommands()` so the command palette picks up plugin-contributed commands.

**Plugin → host API surface (frontend channel).** The postMessage bridge
([`runtime/pluginBridge.ts`](../../src/features/plugins/runtime/pluginBridge.ts))
is the most architecturally interesting piece. Six message types accepted from
the iframe (`rim.ui.notification.show`, `rim.ui.dialog.confirm`,
`rim.command.execute`, `rim.settings.get`, `rim.settings.set`,
`rim.plugin.ui_event`), with capability gating on each via
`messageCapabilities`. Critical security details done right:
- Origin lock to `"null"` for sandboxed iframes (`pluginBridge.ts:35,48`).
- `event.source` identity check against the actual iframe — *never* trusts a
  `pluginId` field from the message payload (`pluginBridge.ts:51`).
- Scope validation on `rim.command.execute`: command IDs must start with
  `plugin.<pluginId>.` so a plugin cannot fire commands belonging to other
  plugins or the host (`pluginBridge.ts:73-79`).

**Marketplace UI.** Stub. [`shell/state/useShellStore.ts:11`](../../src/shell/state/useShellStore.ts)
declares the `marketplace` surface, [`shell/layouts/AppShell.tsx:280-284`](../../src/shell/layouts/AppShell.tsx)
renders only a placeholder. There is no catalog component, no search, no
detail view, no install affordance.

**Mock-data fallback.** `usePluginList` falls back to
[`MOCK_PLUGINS`](../../src/features/plugins/api/usePluginList.ts) (two
hardcoded entries) when Tauri IPC is unavailable. This means the web build
shows fake plugins — fine for development, but should be feature-flagged or
removed before any production web build.

### 1.2 Tauri Plugin Host (`rim-ui/src-tauri/src/plugin_host/`)

This is the actual runtime, and it is far more developed than the description
"plugin host runtime" might suggest. Eighteen Tauri commands registered in
[`lib.rs:71-106`](../../src-tauri/src/lib.rs).

**Manifest validation.**
[`plugin_host/manifest.rs`](../../src-tauri/src/plugin_host/manifest.rs)
defines `PluginManifest` (versioned: `manifest_version: i32`, currently must
be `1`). Validates reverse-domain plugin_id (≥3 segments, alphanumeric+hyphen
per segment), reserved-prefix detection (`dev.rim.`, `com.rim.`),
keybind/context-action references must point to declared commands. SHA-256
content hash for drift detection (`manifest.rs:202`). Separate
"simple-mode" manifest in
[`simple_manifest.rs`](../../src-tauri/src/plugin_host/simple_manifest.rs)
parses `# rim-plugin: dev.example.foo` style header comments — supports
single-file plugin authoring without a JSON manifest.

**Wire protocol.**
[`plugin_host/wire.rs`](../../src-tauri/src/plugin_host/wire.rs) implements
JSON-RPC 2.0 with 4-byte big-endian length-prefixed framing, 4 MiB max frame
size, async read/write helpers. Application error codes defined
(`CAPABILITY_DENIED = -32000`, `RATE_LIMITED = -32001`, `PLUGIN_ERROR =
-32002`).

**Capability gate.**
[`plugin_host/capability.rs`](../../src-tauri/src/plugin_host/capability.rs)
maps fifteen RPC methods → required capabilities (chat, events, process,
network, fs, ui). `rim.log` and `rim.heartbeat_response` always allowed;
unknown methods denied by default — correct.

**Broker.**
[`plugin_host/broker.rs`](../../src-tauri/src/plugin_host/broker.rs) houses
`PluginBroker` with per-capability rate limiting (default 120 calls/min/cap),
30s heartbeat with 5s response timeout, panel registry ownership checks. The
function `run_broker_loop` (line 446) is the per-plugin event loop — *but see
the gap analysis: nothing currently calls it*.

**Process spawn.**
[`plugin_host/process.rs`](../../src-tauri/src/plugin_host/process.rs)
implements `PluginProcess::spawn` (kill_on_drop, piped stdin/stdout, inherited
stderr) and a graceful 5s SIGTERM-then-SIGKILL shutdown. Tested in isolation.

**Discovery.**
[`plugin_host/discovery.rs`](../../src-tauri/src/plugin_host/discovery.rs)
walks `~/.rim/plugins/`, loads either `rim-plugin.json` or simple-mode
manifests, validates each, audit-logs rejections.

**Install paths.** Two install pipelines:
1. `plugin_install` (lifecycle-only) — registers an already-discovered
   manifest in the store.
2. `plugin_install_from_git`
   ([`git_install.rs`](../../src-tauri/src/plugin_host/git_install.rs)) —
   `git clone --depth 1` into `~/.rim/staging/`, validates manifest, moves to
   `~/.rim/plugins/<plugin_id>/`, runs optional `post_install`.

**State persistence.**
[`plugin_host/state.rs`](../../src-tauri/src/plugin_host/state.rs)
serializes `PluginStateStore` to JSON in app_data_dir with atomic
write-temp-then-rename. Records per-plugin status, approved capabilities,
approved AI commands, manifest hash.

**AI consent gate.** Manifest content-hash change forces re-consent for
ai_callable commands. F2 validation in
[`validation.rs`](../../src-tauri/src/plugin_host/validation.rs) checks that
`ai_callable: true` commands cannot leak a `plugin_install_id` through their
declared `output_schema`. Substantial, security-aware work already done.

### 1.3 Backend (`rim-server`)

**Verdict: intentional minimal surface.** Per
[`rim-server/docs/plugin_model.md:8-23`](../../../rim-server/docs/plugin_model.md):
"Plugins are not backend-managed by default… The first real plugin system
should be desktop-local, user-local, UI/runtime owned, brokered through a
local plugin host."

What exists on the server side:
- **DTOs only.**
  [`rim_services/src/plugin_host/manifest.rs`](../../../rim-server/rim_services/src/plugin_host/manifest.rs)
  defines `LocalPluginManifestCommandDto`, `LocalPluginContextActionDto`,
  `LocalPluginRuntimeKindDto`, etc. These are *contracts* — used by the
  server to understand what a plugin command-id looks like
  (`plugin.<plugin_id>.<verb>`) — not storage models.
  [`rim_services/src/plugin_host/runtime.rs`](../../../rim-server/rim_services/src/plugin_host/runtime.rs)
  defines `LocalPluginHostHandshakeRequestDto` etc. — wire DTOs the desktop
  host will send when calling backend APIs.
- **Capability registry table** (migration
  [`m20260424_120000_create_capability_registry.rs`](../../../rim-server/migration/src/m20260424_120000_create_capability_registry.rs))
  with a `source_kind = 'plugin'` row and a nullable `plugin_id` UUID column.
  The plugin FK is intentionally not enforced ("Phase 1 leaves the FK off
  because plugin entities don't ship until Phase 5; constraint added when
  plugin_install table lands").
- **No plugin tables.** No `plugin_install`, no `plugin_marketplace_listing`,
  no `plugin_version`. None of the migrations under
  [`migration/src/`](../../../rim-server/migration/src) reference a plugin
  install entity.
- **No plugin GraphQL surface.** `rim_api/src/types.rs` mentions "Plugin"
  only as a `CommandSourceKind` enum variant and a `CommandInitiator` variant
  — no `PluginGql` object, no `installPlugin` mutation, no `plugins` query.

This is consistent with the documented direction. Whether it stays this way
is one of the open questions for Jakub (see §5).

### 1.4 Cross-cutting docs

- `rim-server/docs/plugin_model.md` — full plugin philosophy, ownership
  matrix, slot system (5 slots: tool_panel, main_area, side_panel, overlay,
  message_action), language-agnosticism stance, capability list, future
  expansion.
- `rim-server/docs/local_plugin_host.md` — wire protocol spec, host↔plugin
  method tables, framing details. Authoritative.
- `rim-ui/AGENTS.md` (lines 34, 199, 217-218, 243-244) — UX rules: trust
  badges visible, capability prompts at install time, plugins extend shared
  systems rather than parallel ones.
- `rim-ui/docs/implementation-plan.md` (lines 372-379, 547-548) — names
  plugins as a desktop-only Phase 4 deliverable.
- `rim-ui/.claude/status.md` (line 113) — "Plugin systém (Phase 4)" header,
  no detail underneath.
- `rim-ui/docs/decisions/` — currently zero plugin ADRs. Worth filing one
  once the smallest-meaningful-step lands.

---

## 2. Gap Analysis — What's Missing

Compared to a working v1 (Obsidian/VSCode/Lapce reference points). Each gap
labeled **(a) v1 blocker**, **(b) v1.5**, or **(c) v2+**.

### 2.1 Blockers for v1 (a)

**G1. The host doesn't actually run plugins.** `plugin_enable` only flips a
status bit in `PluginStateStore`. `run_broker_loop` exists in
`broker.rs:446` but no Tauri command, lifecycle hook, or app setup spawns a
process or invokes it. The `shutdown_txs: Mutex<HashMap<...>>` field on
`PluginHostState` is allocated and never written to. **This is the single
biggest gap.** Everything below assumes a plugin can run.

**G2. The `rim-plugin://` URI scheme is unregistered.** `PluginPanel.tsx:11`
sets iframe src to `rim-plugin://<pluginId>/<panelId>/index.html`, but
[`lib.rs`](../../src-tauri/src/lib.rs) does not call
`tauri::Builder::register_uri_scheme_protocol` (or async variant). Any real
plugin panel iframe will fail to load. The path-traversal validation in
`PluginPanel.tsx:17-37` is solid; it's just protecting an endpoint that
doesn't exist yet.

**G3. No marketplace, no catalog, no install UX beyond git-clone.**
`plugin_install_from_git` works at the host level but has no UI affordance.
`AppShell.tsx:280-284` is a placeholder. There is no list of available
plugins anywhere in the product.

**G4. No hello-world / reference plugin.** No in-tree example plugin (Python,
JS, anything) that exercises the wire protocol end-to-end. This is needed
both as a smoke test for G1/G2 and as documentation for plugin authors.

**G5. Plugin → host frontend message types are defined but not wired to
real handlers.** The bridge handlers for `rim.ui.notification.show`,
`rim.ui.dialog.confirm`, `rim.settings.get`, `rim.settings.set` only
`logger.debug(...)` — they never actually surface a notification, open a
confirm dialog, or read/write any settings store. Capability gating works,
but the side effects don't happen.

### 2.2 v1.5 — Needed before public marketplace (b)

**G6. No plugin update mechanism in UI.** `plugin_update` Tauri command
exists but no hook calls it; `usePluginActions` doesn't expose update.

**G7. No signed-bundle / trust verification.** `TrustLevel` is in the type
enum (`official | verified | community | unverified`) and `TrustBadge.tsx`
exists, but nothing on the host side actually *verifies* a trust claim. A
plugin can self-declare `trust_level: "official"` in its manifest. No
signature, no registry lookup, no checksum verification.

**G8. No hot-reload / dev mode.** Plugin authors editing a manifest or
entrypoint must currently uninstall+reinstall. Discovery is a startup-only
sweep (`mod.rs:48-63`).

**G9. No plugin-side SDK.** `rim-server/docs/plugin_model.md:91-94` mentions
"optional thin SDKs (rimkit-python, rimkit-rust, rimkit-js)". None exist.
For v1.5, at least one (probably TS for the iframe UI side, since postMessage
is fiddly to get right) needs to ship.

**G10. Settings persistence per plugin.** `rim.settings.get` /
`rim.settings.set` messages are defined but ignored. The `settings_schema`
field in the manifest is parsed but no storage backs it.

### 2.3 v2+ (c)

- **G11. WASM plugin runtime.** Currently every plugin is a child process.
  WASM would be a significantly stronger sandbox but is a v2 architecture
  decision.
- **G12. Cross-device plugin sync.** Backend-managed plugin policy.
- **G13. Plugin marketplace ratings, reviews, telemetry.**
- **G14. Enterprise/admin policy controls** (allowlist/blocklist, capability
  governance per workspace).
- **G15. Process pool / shared runtime for headless plugins** to avoid
  cold-start cost on every command invocation. The existing "lazy startup"
  design (plugin_model.md:276-281) is fine for v1.

---

## 3. Smallest Meaningful Next Step

**Wire `plugin_enable` to spawn-and-broker, register the `rim-plugin://`
asset protocol, and ship one in-tree hello-world plugin.**

**Scope: S** (one Spider-Man week, maybe a touch over).

**Why this is the right starting point:**

1. **It un-blocks every other gap.** G3 (marketplace), G6 (updates), G7
   (signing), G9 (SDK), G10 (settings) all require a running plugin to
   verify against. Right now any of those would be specced against vapor.
2. **It validates the architecture cheaply.** The wire protocol, capability
   gate, broker, manifest schema, iframe bridge, and UI surfaces all already
   exist. The only thing untested end-to-end is the connection between
   them. A hello-world plugin that registers one command, opens one panel,
   shows one notification, and reads one setting will exercise the entire
   pipeline. If anything's structurally wrong, this is where it surfaces.
3. **It produces a reference artifact.** Future plugin authors (and our
   future selves) need a known-good example to crib from. Without one, the
   first community plugin is going to be reverse-engineered from broker.rs.
4. **It's testable.** A scripted hello-world plugin (even Python or bash via
   simple-mode) can be invoked from a Vitest+Tauri integration test.

**Concrete deliverables for the smallest step:**

- (Rust) `plugin_enable` spawns `PluginProcess`, kicks off `run_broker_loop`
  on a tokio task, stores the shutdown_tx in `PluginHostState.shutdown_txs`.
- (Rust) `plugin_disable` and `plugin_uninstall` send the shutdown signal
  and join the task.
- (Rust) `lib.rs` registers `register_asynchronous_uri_scheme_protocol`
  (or sync equivalent) for `rim-plugin://`, serving files from
  `~/.rim/plugins/<plugin_id>/<panel_id>/...` with the same path-safety
  checks the frontend already does.
- (Plugin) `plugins/hello-world/` in-tree example with a `rim-plugin.json`,
  a Python entrypoint, one command (`say_hello`), one panel (`main`), and a
  README explaining what each piece does.
- (Frontend) Promote the existing "Plugin view for X. Coming soon!"
  placeholder in `AppShell.tsx` to actually render `PluginSlotContainer`
  when `mainSurface.kind === "plugin"`. Already has all the props it needs.
- (Tests) End-to-end Vitest test that lists the hello plugin, enables it,
  executes its command, asserts the response. Rust integration tests for
  spawn → handshake → first capability call → graceful shutdown.

**What this step explicitly does NOT include** (to keep it small): no
marketplace UI, no signed bundles, no hot reload, no settings persistence,
no SDK package, no GraphQL backend mutations.

---

## 4. Recommended Sequencing After the Smallest Step

Two-to-three steps, no further. We'll re-plan after these land.

**Step 2 (M).** *Marketplace stub with hardcoded sample plugins.* Replace the
`Marketplace coming soon!` placeholder with a proper catalog component:
search, list of cards, detail view with capability requirements rendered
through the existing `PluginCapabilityPrompt`. Source the catalog from a
hardcoded JSON manifest (no backend yet). Install action calls
`plugin_install_from_git` against the URLs in the catalog. This validates
the *browse → install → approve → enable* flow without committing to a
distribution architecture.

**Step 3 (M).** *Plugin SDK package and developer docs.* Ship `rimkit-ts`
under `packages/rimkit/` (npm-publishable later, in-tree consumed for now)
that wraps the postMessage bridge with typed handlers — `onCommand`,
`registerPanel`, `getSettings`, etc. Pair it with a `docs/plugin-authoring/`
section explaining manifest structure, capability semantics, and the wire
protocol. The hello-world plugin from step 1 gets rewritten to use the SDK
as a second reference.

**Step 4 (variable).** *One product-decision-dependent track.* The right
answer here depends on Jakub's answers in §5:
- If centralized marketplace is the target → backend `plugin_listing` table,
  GraphQL `plugins(filter: ...)` query, signed-bundle storage. ~L scope.
- If sideload-only is the target → harden git-install (signature
  verification, manifest signing, trust badge wiring). ~M scope.
- If web-build plugins are in-scope → spec a degraded iframe-only mode that
  doesn't require a process backend. ~M scope but architecturally invasive.

We should NOT pick step 4 before §5 has answers.

---

## 5. Open Questions for Jakub

These are decisions the architecture turns on. Vision and iron-man should
not pick them.

**Q1. Distribution model.** Three flavors:
- (a) **Centralized marketplace.** `rim-server` hosts plugin metadata, signed
  bundles served from CDN, install is a server-mediated flow. Adds plugin
  tables to backend (currently zero), adds plugin GraphQL surface, but gives
  users a curated, discoverable catalog and gives us trust verification at
  the wire level.
- (b) **Sideload-only.** What we have now: git URL or local folder. Author
  freedom is maximal, but discovery is zero and trust is per-install
  manual.
- (c) **Both.** Sideload always available; marketplace as a curated subset.
  This is what VSCode does, and is probably the right long-term answer, but
  doubles the v1 surface area.

The current backend doc (`plugin_model.md:8-23`) explicitly chooses (b) for
v1 with marketplace deferred. Confirm this still holds, or signal a pivot.

**Q2. Authoring language story.** The wire protocol is language-agnostic by
design — any binary that speaks length-prefixed JSON-RPC over stdio works.
This is great for a maker community but expensive for marketplace QA (we'd
be reviewing Python, Go, Rust, Node, shell-script plugins). Two stances:
- (a) **Stay agnostic.** Embrace the Neovim model. SDK is "optional thin
  helper". Trust the capability gate to be the security boundary.
- (b) **Bless TS/JS for marketplace.** Sideloads can use any language; only
  TS-bundled plugins are eligible for the curated marketplace. Easier to
  audit, easier to ship a single SDK, easier to enable hot-reload.

**Q3. Web-build plugin story.** Today `pluginHost: false` for web in
`runtime.ts:52`. Three options:
- (a) **Desktop-only forever.** Current state. Web users get a "Plugins
  require the desktop app" message.
- (b) **Iframe-only web mode.** UI-only plugins (no `local.process`,
  `fs.*`, `network` capabilities) work in web by serving the iframe content
  from the rim-server CDN. Headless plugins remain desktop-only.
- (c) **WASM web mode.** Full sandboxed runtime in browser, big v2+ effort.

**Q4. Trust / signing.** `TrustLevel` is plumbed through types and UI but
nothing verifies it. When do we want signed bundles, and who's the signing
authority? "official" = signed by RIM team's key? "verified" = passed
some review process tracked on the server? Or do we deliberately defer
signing past v1?

**Q5. Monetization.** Are paid plugins in-scope at all? If yes, when? This
materially affects whether the marketplace needs payment-rail integration
and a revenue-share story baked into the manifest from day one (it's much
cheaper to add a `pricing` block to the manifest before v1 ships than after
plugins exist in the wild).

**Q6. Backend constraint cross-check (for iron-man if dispatched
separately).** The backend currently treats plugin command IDs as opaque
strings (`plugin.<id>.<verb>`) and validates capability keys against the
`capability_registry` table. If marketplace lands and `source_kind =
'plugin'` rows start being written by the backend (rather than by a desktop
host that doesn't exist on the backend's side), we need a clear story for
how the backend learns about a plugin's declared capabilities. Currently it
trusts the desktop host. Is that fine forever, or does the backend need a
plugin manifest registry at some point? This is mostly an iron-man question
but it interacts with Q1.

---

*End of memo. — vision*
