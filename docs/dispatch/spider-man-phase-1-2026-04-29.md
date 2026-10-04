# Phase 1 Dispatch — for spider-man

- **From:** vision
- **To:** spider-man
- **Date:** 2026-04-29
- **Plan reference:** [`docs/plans/plugin-system-phase-plan-2026-04-29.md`](../plans/plugin-system-phase-plan-2026-04-29.md) (Phase 1 section)
- **Why this brief is in a file rather than a Task-tool dispatch:** vision's
  current shell exposes only `Read / Glob / Grep / Write / Edit` — no `Task`
  tool. Per Jakub's instruction (2026-04-29), the brief is captured here
  verbatim so spider-man (or hulk for verification) can pick it up in a
  shell where the Task tool is live and the build environment works.

---

## Goal

Wire the existing plugin host skeleton so it actually executes a plugin
end-to-end. After Phase 1 lands, the plugin host real-spawns a real plugin
process, the broker loop carries real RPC traffic, and the
`rim-plugin://` Tauri URI scheme serves real bundle files. As a fold-in,
the web build shows a coherent "Plugins are desktop-only" message.

---

## Concrete work

### 1. Wire `plugin_enable` to spawn-and-broker

- **File:** `/home/kuba/RustroverProjects/rim-ui/src-tauri/src/plugin_host/commands.rs`
- **Current state (verified 2026-04-29):** `plugin_enable` at line 131
  performs `lifecycle::enable` + `store.save` and returns. No process spawn.
  No broker loop. Same is true of `plugin_disable` (line 144) and
  `plugin_uninstall` (line 158).
- **Required change:** After `lifecycle::enable(...)` succeeds, call a new
  `plugin_host::runtime::start_plugin(plugin_id, manifest, state)` that:
  1. Resolves the plugin's entrypoint via the existing manifest validation
     pattern (look in `manifest.rs` — mirror whatever the discovery /
     install path already does).
  2. Spawns the plugin process via the existing
     `PluginProcess::spawn` in `process.rs`.
  3. Creates a `tokio::sync::watch` shutdown channel.
  4. `tokio::spawn`s `run_broker_loop` from
     `/home/kuba/RustroverProjects/rim-ui/src-tauri/src/plugin_host/broker.rs:446`
     against the spawned process's stdin/stdout.
  5. Stores the `shutdown_tx` in `PluginHostState.shutdown_txs` (add the
     field — `HashMap<String, watch::Sender<bool>>` behind a `Mutex`).
- **Mirror in `plugin_disable` / `plugin_uninstall`:** look up the
  `shutdown_tx` for the plugin, send `true`, await the join handle with a
  timeout (a few hundred ms), fall back to drop (kill_on_drop is set).
- **Mirror in `plugin_host/mod.rs`:** at startup, after discovery + state
  load, iterate plugins where `status == Enabled` and call
  `runtime::start_plugin` for each. Re-spawns on app restart.
- **New file:** `src-tauri/src/plugin_host/runtime.rs` houses
  `start_plugin` / `stop_plugin`. Tauri-aware (takes `State<PluginHostState>`).
  Modules under it (`process.rs`, `broker.rs`) stay Tauri-free.
- **Tests:**
  - Unit: dependency-inject the spawner so a fake can verify
    `start_plugin` calls it once, hands the IO to the broker, registers
    the shutdown_tx. If the existing tests have a process-mock pattern
    in `process.rs:143-164`, follow it; if not, introduce a `Spawner`
    trait (with `RealSpawner` for prod and a test fake) and inject it
    through `runtime::start_plugin`.
  - Unit: `stop_plugin` clean shutdown + timeout-fallback path.
  - Idempotency: double-call of `start_plugin` for the same plugin_id
    should be a no-op or a clean error, never two processes.
  - Existing `process.rs:143-164` tests stay green.
- **Docs:** `# Errors`, `# Examples` on every new public function. Module-
  level doc on `runtime.rs` explaining the spawn-on-enable lifecycle and
  why orchestration lives at this Tauri-aware boundary.

### 2. Register the `rim-plugin://` Tauri asset-protocol handler

- **File:** `/home/kuba/RustroverProjects/rim-ui/src-tauri/src/lib.rs`
  (around lines 71-106 per the discovery memo).
- **Currently absent.** `PluginPanel` references `rim-plugin://` URIs but
  no handler responds.
- **Required change:** In the `setup` closure (or via builder chain),
  call `tauri::Builder::register_asynchronous_uri_scheme_protocol("rim-plugin", ...)`.
  Handler resolves `rim-plugin://<plugin_id>/<panel_id>/<rest>` to
  `~/.rim/plugins/<plugin_id>/panels/<panel_id>/<rest>`.
- **Path-traversal hardening (mandatory):**
  - Reject any segment containing `..`, NUL, or path separators in
    suspicious places. Walk segments individually; do not just `Path::join`.
  - After joining, canonicalize the result and assert that the canonical
    path is still under the plugin's installed bundle root. Reject if not
    — return a 403-shaped response.
  - Constrain to the active plugin's directory only — no cross-plugin
    reads.
  - Mirror the regex/segment logic already in `PluginPanel.tsx:17-37` —
    port that pattern to Rust rather than re-inventing.
- **Tests:** unit-test the URI resolver against:
  - Happy path (valid plugin_id + panel_id + filename).
  - `..` segments at every level — must reject.
  - Encoded `%2e%2e` traversal — must reject.
  - Symlink escape (if feasible in the test environment — if not, document
    why the test is skipped).
  - Missing file → 404.
  - Plugin not installed → 404.
  - Cross-plugin attempt (`rim-plugin://plugin-a/...` requesting a path
    that resolves under `plugin-b`'s root) → 403.
- **Docs:** `# Errors`, `# Examples` on the resolver function. ADR mention
  of the asynchronous URI scheme decision.

### 3. Ship one in-tree hello-world plugin

- **Location:** `/home/kuba/RustroverProjects/rim-ui/plugins/hello-world/`
  unless `manifest.rs` discovery expects a different directory — confirm
  before committing to the path.
- **Mode:** simple-mode (header-comment manifest) per the discovery memo.
  Python is fine since the host supports any-language stdio.
- **Capability exercised:** ONE capability-gated method end-to-end. The
  simplest is `ui.notify` via the existing notification handler — the
  plugin sends an RPC, the host's capability gate approves it, the broker
  routes the response, the frontend toast renders. If `ui.notify` isn't
  wired far enough yet for a true round-trip, fall back to a plain
  command registration (`hello.greet` returning `"hello, " + name`) and
  observe it via the broker's log output.
- **Files:**
  - `plugins/hello-world/rim-plugin.json` (or header-comment in `main.py`
    if simple-mode is what the host actually expects — verify against
    `manifest.rs`).
  - `plugins/hello-world/main.py` — Python stdin/stdout JSON-RPC plugin.
    Responds to `initialize`, registers `hello.greet`, replies to
    `rim.heartbeat` with `rim.heartbeat_response`.
  - `plugins/hello-world/panels/main/index.html` — minimal HTML loading
    `app.js`, with one button.
  - `plugins/hello-world/panels/main/app.js` — `window.parent.postMessage`
    on click, sends `rim.ui.notification.show`.
  - `plugins/hello-world/README.md` — what each file does, how to enable,
    what the user should observe.
- **Goal:** when this plugin is enabled via Settings, you observe the
  spawn → broker handshake → capability check → host response cycle in
  real logs. This is the proof-of-life for the entire phase.

### 4. Fold Phase 5 (web build messaging) here

- **Q3-locked (2026-04-29):** plugins are desktop-only for v1.
- **Required:** in the Settings → Plugins tab, when
  `runtime.pluginHost === false` (web build), render a placeholder card
  with copy along the lines of:

  > "Plugins require the RIM desktop app — they need OS-level subprocess
  > access that the browser sandbox doesn't permit. [Get the desktop app]"

  When `runtime.pluginHost === true`, render the existing/normal plugins
  UI.
- **Detection point:** `src/core/runtime/runtime.ts`. Do NOT branch on
  `import.meta.env.TAURI` directly — go through the runtime capability
  abstraction.
- **Tests:** Vitest. Render the panel with a `RuntimeProvider` whose
  `pluginHost: false` — assert placeholder renders, normal UI does not.
  Mirror with `pluginHost: true`.
- **Carve-out:** if folding the messaging *complicates* the spawn/broker
  work (e.g. forces a refactor of the Settings tree that is out of
  scope), drop it from this phase and surface back to vision. Use your
  judgment.

---

## Hard rules (non-negotiable)

- **NEVER** `git commit` / `git push` / `git merge`.
- Tests + docs on every new function/component.
  - Rust: `# Errors`, `# Examples` on every public function.
  - TypeScript: JSDoc on every exported function/component.
- Stay strictly in scope. Do NOT redesign the manifest schema or capability
  gate — both already exist and are correct per the discovery memo.
- Do NOT invoke Hawkeye. Phase gate happens at session end, not per-task.

---

## Verification gate

From `/home/kuba/RustroverProjects/rim-ui`:

```bash
npm run build
npm test
cd src-tauri && cargo test
```

All three must be green. **Report `N/N tests pass + build green` for each
of the three commands.** This is the format vision and fury expect, per
the test-gate-required memory entry.

---

## Smoke test

Confirm the hello-world plugin can be enabled via the Settings UI and
produces an observable side-effect (log line or UI change) end-to-end.

If this can't be done from the agent's shell (no Tauri runtime), describe
the manual steps Jakub should run to verify, in your final report. The
ADR should also document the manual smoke-test recipe.

---

## Out of scope for Phase 1

- Marketplace UI (Phase 3).
- Signed bundles / trust verification (Phase 4).
- Settings persistence (Phase 2).
- SDK (Phase 3).
- GraphQL backend mutations.
- MCP (Phase 6).
- Hot-reload (Phase 4).
- Multi-plugin orchestration tests beyond basic install/enable/disable.

**Resist scope creep.** Anything not explicitly listed in "Concrete work"
above is Phase 2+.

---

## Definition of done

- `npm run build` green.
- `npm test` green (all tests, including new Vitest tests).
- `cargo test` green (all tests, including new Rust unit + integration
  tests).
- Hello-world plugin installable + enable-able + observable side-effect.
- ADR written: `docs/decisions/plugin-runtime-wiring-2026-04-29.md`.
- README written: `plugins/hello-world/README.md`.
- Status line updated in `.claude/status.md` "Plugin systém (Phase 4)"
  header — one line: "Phase 1 (wire-the-host) shipped, hello-world
  reference plugin in-tree at `plugins/hello-world/`."
- Report back to vision in the format
  `N/N tests pass + build green` for all three verification commands,
  plus the smoke-test status (or manual recipe if shell-blocked), plus
  any anomalies that surfaced.

— vision
