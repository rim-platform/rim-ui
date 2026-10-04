# ADR: Plugin Runtime Wiring — Phase 1

- **Date:** 2026-04-29
- **Status:** Accepted
- **Author:** spider-man
- **Reviewers:** vision, nick-fury

---

## Context

The plugin host skeleton (manifest schema, capability gate, broker, process
spawn, wire protocol) was complete but unconnected.  `plugin_enable` only
flipped a status bit.  `run_broker_loop` existed in `broker.rs:446` but had
no caller.  No Tauri URI scheme handler served `rim-plugin://` URIs.

Phase 1 wires these three gaps so the host actually executes a plugin
end-to-end.

---

## Decision 1 — Spawn-on-enable, not spawn-on-first-call

**Chosen:** spawn the plugin process immediately when `plugin_enable` is
called (and re-spawn on app restart for every plugin that was `Enabled` on
last shutdown).

**Rejected alternative:** lazy spawn on the first inbound RPC or UI panel
open.

**Rationale:**
- The wire protocol sends a `rim.handshake` synchronously on spawn.  The
  broker loop must be running before the frontend opens the iframe, or the
  first heartbeat cycle will fail.
- Eagerly spawn makes the plugin health signal (`[plugin_host] broker loop
  starting for ...`) observable immediately on enable, providing a clear
  proof-of-life line in the log.
- The cost of idle subprocesses is low for v1; lazy spawn would add
  complexity without measurable benefit at this scale.

---

## Decision 2 — Register `rim-plugin://` as an asynchronous URI scheme

**Chosen:** `tauri::Builder::register_asynchronous_uri_scheme_protocol`
registered in `lib.rs` before `.setup(...)`.

**Rejected alternative:** synchronous `register_uri_scheme_protocol`.

**Rationale:**
- The async variant is the Tauri v2 idiomatic API.  It allows non-blocking
  file reads and is required when the protocol handler may need to call async
  code in future (e.g. capability-gate check, content transformation).
- Synchronous file reads inside a sync protocol handler can block the Tauri
  event loop.

**URI format:**
`rim-plugin://<plugin_id>/<panel_id>/<rest>` resolves to
`~/.rim/plugins/<plugin_id>/panels/<panel_id>/<rest>`.

**Path-traversal hardening (see `plugin_protocol.rs`):**
1. Every URI segment is validated individually by `is_safe_segment()` which
   rejects `..`, `/`, `\`, NUL, and percent-encoded equivalents.
2. After joining, the path is canonicalized (`std::fs::canonicalize`) and
   asserted to start with the plugin's bundle root — this closes symlink
   escape vectors.
3. Cross-plugin access is structurally impossible: the plugin_id in the URI
   is used as the root for the `starts_with` assertion.
4. Missing files return 404; traversal attempts return 403 and are audit-logged.

---

## Decision 3 — Orchestration in `runtime.rs`, Tauri-free modules below

**Chosen:** `plugin_host/runtime.rs` is the single Tauri-aware orchestration
boundary.  `process.rs` and `broker.rs` remain Tauri-free and testable in
isolation.

**Rationale:**
- Keeps the unit test surface clean: `process.rs` tests can spawn real
  subprocesses without a Tauri `AppHandle`; `broker.rs` tests use mock IO.
- `runtime.rs` exports `start_plugin` / `stop_plugin` — the only two
  functions that touch `PluginHostState`.

**Spawner trait for testability:**
`runtime.rs` exposes a `Spawner` trait (with `RealSpawner` for production)
so tests can inject a fake without touching the filesystem.  Current tests
use the real spawner with a shell script fixture; the trait is there for
future integration tests that need full process mocking.

---

## Decision 4 — Hello-world plugin uses full `rim-plugin.json` manifest

**Chosen:** `plugins/hello-world/rim-plugin.json` (full v1 manifest) rather
than the simple-mode header-comment format.

**Rationale:**
- The simple-mode format for Python generates an entrypoint string
  `"python main.py"` which `PluginProcess::spawn` joins with the plugin dir
  as `plugin_dir.join("python main.py")` — a path that does not exist.
  The full manifest with `"entrypoint": "main.py"` is joined correctly and
  the Python file's shebang (`#!/usr/bin/env python3`) handles the
  interpreter lookup.
- The full manifest format is the canonical production format; using it for
  the reference plugin exercises the same code path real plugins will use.

---

## Decision 5 — Plugins are desktop-only for v1 (Q3 lock)

**Decision:** Jakub locked Q3 on 2026-04-29 to desktop-only for v1.

**Implementation:** `PluginSettingsPage` checks `capabilities.pluginHost`
from the `useRuntime()` hook (not `import.meta.env.TAURI`).  When false, a
`PluginDesktopOnlyCard` is rendered instead of the plugin list.

**Why through the runtime capability abstraction and not `TAURI`:**
- The runtime abstraction is the single authoritative source for capability
  detection.  Branching on `import.meta.env.TAURI` directly would bypass it
  and create a dual maintenance surface.
- If a future mode (e.g. iframe-only web plugins) flips `pluginHost: true`
  for web, only `runtime.ts` needs to change — no component changes needed.

---

## Manual smoke-test recipe (for Jakub)

**Prerequisites:**
- Python 3.8+ on `$PATH`.
- `npm install` done; no separate `cargo build` needed — `tauri dev` handles it.

**Steps:**

```sh
# 1. Copy the hello-world plugin bundle into place
mkdir -p ~/.rim/plugins
cp -r $(git rev-parse --show-toplevel)/plugins/hello-world ~/.rim/plugins/

# 2. Start the app in dev mode
cd $(git rev-parse --show-toplevel)
npm run tauri dev
```

3. Open **Settings → Plugins** in the running app.

4. Verify "Hello World" appears in the plugin list.

5. Toggle the plugin **ON**.

6. In the terminal where `npm run tauri dev` is running, look for:
   ```
   [plugin_host] plugin dev.example.hello-world started
   [plugin:dev.example.hello-world] [info] [hello-world] plugin process started (pid=…)
   [plugin:dev.example.hello-world] [info] [hello-world] handshake complete — broker loop active
   ```
   These three lines confirm the spawn → broker → handshake cycle.

7. Open the Tauri webview devtools (right-click → Inspect in dev mode).

8. Navigate to the plugin's main surface (if a panel link exists) or open
   it from the tool panel.

9. Click **Say Hello** in the plugin panel.

10. In the devtools console, filter for `[RIM:PluginBridge]` and verify:
    ```
    [RIM:PluginBridge] dev.example.hello-world notification: Hello World
    ```

11. Toggle the plugin **OFF**.

12. Verify in the terminal:
    ```
    [plugin_host] plugin dev.example.hello-world stopped
    ```

**All 12 steps passing = Phase 1 proof-of-life confirmed.**

---

## Phase 2 smoke-test recipe — local-install + TOFU fingerprint (for Jakub)

**Prerequisites:**
- All Phase 1 prerequisites met.
- App is running in dev mode (`npm run tauri dev`).

**Full local-install + enable flow:**

1. Open **Settings → Plugins**.

2. Verify the empty state reads "No plugins installed — Install from a local folder
   or git URL to get started. Marketplace coming soon."

3. Click **Install from local folder**. In the OS folder picker, select
   `<repo root>/plugins/hello-world/`.

4. The plugin list refreshes and shows "Hello World" with status `Installed` (toggle off).

5. Toggle the plugin **ON**.

6. In the terminal, verify:
   ```
   [plugin_host] plugin dev.example.hello-world started
   [plugin:dev.example.hello-world] [info] [hello-world] handshake complete — broker loop active
   ```

**TOFU fingerprint mismatch flow:**

7. Disable the plugin (toggle OFF).

8. Mutate the bundle on disk:
   ```sh
   echo "# mutated" >> ~/.rim/plugins/dev.example.hello-world/main.py
   ```

9. Toggle the plugin **ON** again.

10. The enable call returns a `FingerprintChanged` error.  The plugin row shows a
    **"Bundle changed"** badge and an amber warning banner:
    _"Plugin bundle has changed — files differ from what was recorded at install."_

11. The enable toggle is disabled until the warning is resolved.

12. Click **"Trust new version"** in the warning banner.

13. The fingerprint is updated; the warning clears.  Toggle the plugin **ON** again —
    it spawns normally.

14. In the terminal, verify:
    ```
    [AUDIT] event=plugin_fingerprint_trusted plugin_id=dev.example.hello-world
    [plugin_host] plugin dev.example.hello-world started
    ```

**All 14 steps passing = Phase 2 local-install + TOFU fingerprint confirmed.**

---

## Files added / modified

| Path | Change |
|------|--------|
| `src-tauri/src/plugin_host/runtime.rs` | NEW — `start_plugin`, `stop_plugin`, `Spawner` trait |
| `src-tauri/src/plugin_host/plugin_protocol.rs` | NEW — `rim-plugin://` URI resolver + traversal hardening |
| `src-tauri/src/plugin_host/mod.rs` | Added `runtime` + `plugin_protocol` modules; auto-start on init |
| `src-tauri/src/plugin_host/commands.rs` | `plugin_enable` calls `runtime::start_plugin`; `plugin_disable` / `plugin_uninstall` call `runtime::stop_plugin` (both now `async`) |
| `src-tauri/src/lib.rs` | Registered `rim-plugin://` async URI scheme handler |
| `src/features/plugins/components/PluginSettingsPage.tsx` | Added `PluginDesktopOnlyCard`; web build shows it instead of empty state |
| `src/shell/layouts/AppShell.tsx` | `plugin` main surface now renders `PluginSlotContainer` |
| `plugins/hello-world/` | NEW — reference plugin (manifest + Python script + panel) |
| `docs/decisions/plugin-runtime-wiring-2026-04-29.md` | This ADR |
| **Phase 2 additions** | |
| `src-tauri/src/plugin_host/local_install.rs` | NEW — local-folder install, `compute_bundle_fingerprint`, path-traversal hardening |
| `src-tauri/src/plugin_host/state.rs` | Added `bundle_fingerprint` + `fingerprint_changed` fields to `PluginRecord` |
| `src-tauri/src/plugin_host/lifecycle.rs` | Added `FingerprintChanged` variant to `LifecycleError` |
| `src-tauri/src/plugin_host/commands.rs` | Added `plugin_install_from_local`, `plugin_trust_fingerprint`; fingerprint check in `plugin_enable`; `fingerprint_changed` field in `PluginInfo` |
| `src-tauri/src/lib.rs` | Registered `plugin_install_from_local` + `plugin_trust_fingerprint` |
| `src-tauri/src/plugin_host/runtime.rs` | Added `#[allow(dead_code)]` on `Spawner` + `RealSpawner` |
| `src/features/plugins/components/PluginPanel.tsx` | Fixed `validatePluginUrl` regex (added `.` to allowed chars for reverse-domain IDs) |
| `src/features/plugins/components/PluginPanel.test.tsx` | Added tests: `dev.example.hello-world` passes; `..` and `../` still fail |
| `src/features/plugins/components/PluginSettingsPage.tsx` | Added install affordances, empty state, `PluginRow` with fingerprint warning UI |
| `src/features/plugins/components/PluginSettingsPage.test.tsx` | Updated tests for new UI affordances + fingerprint warning |
| `src/features/plugins/api/usePluginActions.ts` | Added `usePluginInstallFromLocal`, `usePluginInstallFromGit`, `usePluginTrustFingerprint` |
| `src/features/plugins/api/usePluginList.ts` | Added `fingerprint_changed: false` to `MOCK_PLUGINS` |
| `src/features/plugins/types.ts` | Added `fingerprint_changed` to `PluginInfo`; added `PluginInstallResult` |

---

## Known gaps surfaced during implementation

1. **`PluginPanel.tsx:33` `validatePluginUrl` rejects plugin IDs with dots.**
   Fixed in Phase 2: regex now allows `.` — `dev.example.hello-world` is accepted.
   `..` and `../` still fail via the literal-traversal check that runs first.

2. **`plugin_disable` lifecycle check: `disable()` errors when plugin is not
   Enabled.**  The current `lifecycle::disable` returns an error if the
   plugin is not in `Enabled` state.  `stop_plugin` is called before
   `lifecycle::disable`, so the error surfaces correctly, but `stop_plugin`
   is a no-op in that case.  This is correct behavior.

3. **`@tauri-apps/plugin-dialog` is not installed — folder picker uses `<input webkitdirectory>`.**
   The "Install from local folder" button uses a hidden `<input type="file" webkitdirectory>`
   because `@tauri-apps/plugin-dialog` was not a declared dependency and adding it
   requires flagging to vision.  The webkitdirectory approach works in the Tauri
   webview (full path is available via `file.path`) but is less polished than a native
   OS dialog.  Flag to vision: add `tauri-plugin-dialog` + `@tauri-apps/plugin-dialog`
   for a native folder picker experience.

4. **`plugin_install_from_git` does not record a bundle fingerprint.**
   `plugin_install_from_git` predates Phase 2 TOFU.  It stores `bundle_fingerprint: ""`
   in the `PluginRecord` (via the default), so the fingerprint gate is a no-op for
   git-installed plugins until a follow-up patches `git_install.rs` to call
   `compute_bundle_fingerprint` after cloning.  Flagged to vision for Phase 3.
