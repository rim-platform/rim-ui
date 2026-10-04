> **Status:** Draft 2026-04-30 — design only, awaiting `nick-fury` review and `spider-man` implementation.
> **Author:** Vision (Frontend / UX Architect)
> **Drives:** `spider-man`'s implementation pass to merge `AgentSettingsPanel` and `AiProviderKeySettings` into one panel, fixing Jakub's findings #3 ("AI agent and AI keys, why? Just have one settings for setting up the agents.") and #4 ("AI agent cannot be saved").
> **Scope:** Tactical merge of two duplicate settings panels and a deliberate cutover from Stronghold-backed key storage to OS-keyring. NOT a redesign of the agent runtime, NOT a Phase 6 MCP-bridge initiative, NOT touching macros / pipelines / Plugin AI consent panels.

# Agent Settings Consolidation — Stronghold → OS Keyring + Single "AI" Tab

---

## 0. TL;DR

Three things change:

1. **One tab, one panel.** "AI Agent" and "AI Keys" collapse into a single tab called **"AI Agent"**. The provider list (Anthropic, OpenAI), key field, validate-then-save flow, model picker, and custom system prompt all live in one place.
2. **OS keyring is the single source of truth.** Stronghold-backed `keyStore.ts` is retired for API keys. The runtime (`agent_chat_completion`) already reads from the keyring; the new panel writes there too. One read path, one write path.
3. **One-shot migration on first launch.** If a user has a key in Stronghold but not in the keyring, we copy it across silently and emit one info toast. The orphaned Stronghold entry is then deleted. This avoids a forced re-entry of API keys for existing desktop users.

A latent bug fix falls out of #2: the chat path is currently broken end-to-end (see §6). The merge is necessary anyway, but it also unblocks Jakub's finding #4. Fixing that bug *without* the merge would still leave users staring at two confusing tabs that disagree.

---

## 1. Status quo, factually

### 1.1. Two panels, two stores, two contracts

| Surface | File | Storage backend | Save semantics | Validation |
|---|---|---|---|---|
| `AgentSettingsPanel` ("AI Agent" tab) | `src/features/agent/settings/AgentSettingsPanel.tsx` | Stronghold (via `runtime/keyStore.ts`) | **On blur, no validation** (line 129–135) | Optional "Test" button (line 137–191), validation result is UI-only — does not gate persistence |
| `AiProviderKeySettings` ("AI Keys" tab) | `src/features/agent/settings/AiProviderKeySettings.tsx` | OS keyring (via Tauri commands `set_provider_key` / `clear_provider_key` / `is_provider_key_configured`) | **Validate-first, persist only on `valid`** (line 107–143) | `agent_validate_provided_key` is mandatory and gates `set_provider_key` (line 116–124) |

Both panels enumerate the same two providers (Anthropic, OpenAI) with the same placeholder strings and the same "Get API key" link target. The `AgentSettingsPanel` additionally exposes the model picker and the custom system prompt (which live in `useAgentStore`'s `settings`, persisted to localStorage via zustand `persist`).

### 1.2. Where the runtime actually reads from

The runtime read path for chat is unambiguous: **OS keyring**.

- `src-tauri/src/agent_proxy.rs:295`: `let api_key = keyring_get(request.provider)?;` inside `agent_chat_completion`.
- `src-tauri/src/agent_proxy.rs:177–195`: `keyring_get` reads from `keyring::Entry::new("com.rim.rim-ui", "provider:{provider}")`.
- `src-tauri/src/agent_proxy.rs:329`: same for `agent_validate_credentials`.
- `src-tauri/src/agent_proxy.rs:388`: same for `agent_list_models`.

The Stronghold path in `keyStore.ts` is read in three other places, none of which are the actual chat dispatch:

- `src/features/agent/components/AgentOverlay.tsx:185`: presence check (`hasKey`) before calling `runAgent`.
- `src/features/agent/components/AgentOverlay.tsx:39–45`: `makeKeyLoader` produces a thunk that the JS providers' factory closes over, intended to be called from `chat()`.
- `src/features/agent/settings/AgentSettingsPanel.tsx:73, 95, 131, 139`: load / save / load / load.
- `src/features/macros/runtime/useMacroAgent.ts:126, 139`: presence check + loader thunk for macro generation.

The JS provider factories (`createAnthropicProvider`, `createOpenAiProvider`) call `loadKey()` (Stronghold) inside `chat()` and pass the raw key as `api_key` in the IPC payload — see `src/features/agent/providers/anthropic.ts:123–134` and `src/features/agent/providers/openai.ts:175–185`. **The Rust side rejects this payload outright** (see §6).

### 1.3. Migration command exists but is never invoked

`src-tauri/src/agent_proxy.rs:246–283` defines `migrate_provider_keys`, which emits a `provider-key-migration-needed` event listing providers that have no keyring entry yet. A grep across `src/` for `migrate_provider_keys` and `provider-key-migration-needed` returns zero matches. The Rust migration command was wired (registered in `lib.rs:165`) but never has a JS-side caller. So today, no migration runs; users who configured a key in `AgentSettingsPanel` (Stronghold) and never opened `AiProviderKeySettings` (keyring) have a key that the chat runtime cannot see.

---

## 2. Why two stores exist (informed speculation)

The module header in `runtime/keyStore.ts:21–29` answers this directly:

> Phase 5+ (#56 P5-S1) moves key custody fully to Rust (OS keyring), so JS never sees the bytes at all. Until then, treat any place the key sits in a JS-side variable for longer than one IPC round-trip as a regression and file the cleanup.

And `agent_proxy.rs:1–14`:

> P5-A5 Option B [...] After (Option B): API keys live exclusively in the OS keyring [...] The webview never sees the raw key bytes — it calls `set_provider_key` to store and the proxy reads inline from keyring on every request.

Reading both: Stronghold was the Phase 4 posture (JS holds the key briefly for IPC transit; Stronghold encrypts at rest; Stronghold master is itself in the OS keychain). Phase 5 was specced as Option B — full keyring custody, JS never sees the bytes. The Rust side of Phase 5 landed (`set_provider_key`, `clear_provider_key`, `is_provider_key_configured`, `agent_validate_provided_key`, plus the keyring read in `agent_chat_completion`). The matching frontend cutover happened *partially* — `AiProviderKeySettings` was added as a new panel — but `AgentSettingsPanel` was never deleted, never had its Stronghold writes redirected to the keyring, and the JS providers were never updated to stop sending `api_key` in the IPC payload. The `migrate_provider_keys` command was added with the intent of being called by JS but no JS caller was ever written.

This reads as a half-finished refactor: the security goal (move custody to Rust) was achieved on the IPC / runtime side, but the legacy UI survived alongside the new one and the providers still speak the old contract. Pete's #8 ("must remove `api_key` from the JS call site before this endpoint works") in `agent_proxy.rs:96–98` is, by the look of it, an outstanding TODO that nobody closed.

---

## 3. Decision

**Keep the OS keyring. Retire Stronghold for API keys.**

Justification:

1. **The runtime already reads from keyring.** `agent_chat_completion` is keyring-only. Picking Stronghold would mean either (a) reverting the Rust runtime to read Stronghold or (b) maintaining a bridge where Rust sucks the key out of Stronghold via a new IPC at every chat call. Both are more work than just finishing the cutover that's already 80% done.
2. **Security: keyring is strictly better.** Under Phase 5 / Option B, the raw key bytes never enter the JS heap. With Stronghold, the JS side has to call `loadApiKey()` and pass the string into an `invoke()` arg — even with `Zeroizing<String>` on the Rust side, the JS string is GC-eligible but not *zeroed* and is exposed for the duration of the heap allocation. Black Widow's §C2 (referenced in `agent_proxy.rs:2`) closed the webview-direct-to-provider path; keyring-only closes the JS-heap exposure window too.
3. **Simplicity: one store, one read path.** Today there are two stores, two write surfaces, and the read path (Rust) only ever reads one of them. The user experience consequence is finding #4. The architectural consequence is that nobody can answer "where is my key?" without tracing five files.
4. **Validate-before-save is already a property of the keyring path.** The `AiProviderKeySettings` flow (`tauriValidateProvidedKey` → on `valid` → `tauriSetProviderKey`) is the security-correct contract. We must not regress to `AgentSettingsPanel`'s on-blur unvalidated save.

What we lose: **web build.** Stronghold has a documented in-memory fallback for web (`keyStore.ts:39–40, 89, 102`). Keyring has no web fallback — it's a Tauri-only API. This is acceptable because:

- The new panel is gated by `capabilities.agent`, which is desktop-only today (see `AiProviderKeySettings.tsx:305, 311–315`).
- Web build users currently cannot persist keys across sessions anyway (Stronghold falls back to in-memory).
- If web-mode AI agent is reinstated later, the consolidated panel needs a web variant — that's a separate spec, out of scope here.

---

## 4. Consolidated UX

### 4.1. Tab

Single tab labelled **"AI Agent"** (existing label; preserves muscle memory and the existing `agent` route key in `SettingsPage.tsx:256`). The `"ai-keys"` entry at `SettingsPage.tsx:257` is removed. Drop the `SettingsTab` literal `"ai-keys"` from the union at line 244.

### 4.2. Layout (top to bottom)

```
┌─ AI Agent ─────────────────────────────────────────────┐
│                                                         │
│  Heading: "AI Agent"                                   │
│  Subhead: "Configure an AI provider to use the agent.  │
│            Keys are stored in your OS keyring and       │
│            never leave your device."                    │
│                                                         │
│  ┌─ Data leakage warning (rim-warm/30 banner) ────────┐│
│  │ When you use the AI Agent, workspace data...       ││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│  Provider                       [ Anthropic (Claude) ▾]│
│                                                         │
│  API Key            Get API key ↗                       │
│  [••••••••••••  👁 ]  [Verify & Save]  [🗑 ]           │
│  • Status pill: "Key set" / "No key configured"        │
│  • Inline status line (after verify): valid /          │
│    invalid / network_error                             │
│                                                         │
│  ─── (visible only when key is set) ───                │
│                                                         │
│  Model                          [ Claude Sonnet 4  ▾] ⟳│
│  • "N models loaded from API"                          │
│                                                         │
│  Custom System Prompt (optional)                        │
│  [ textarea, 3 rows                              ]     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.3. Component structure

```
AgentSettingsPanel (new merged version, replaces both old files)
├── header (h2 "AI Agent" + subhead)
├── DataLeakageBanner            // hoisted from current AiProviderKeySettings copy
├── ProviderSelect                // shared provider list
├── ApiKeyField                   // composes input + show/hide + Verify&Save + Delete
│   └── status pill + inline result line
├── ModelPickerSection            // gated on keyConfigured; reuses dynamic-fetch logic
└── SystemPromptSection           // gated on keyConfigured; reuses zustand binding
```

State location:

- **Local component state** (per-row, driven by which provider is selected):
  - `keyInput: string`
  - `showKey: boolean`
  - `keyConfigured: boolean`
  - `verifyState: VerifyState` (idle | verifying | verified | invalid | network_error | error)
  - `dynamicModels: AiModelDef[] | null`
  - `fetchingModels: boolean`
  - `modelsError: string | null`
- **`useAgentStore` (zustand, persisted)**:
  - `settings.providerId` — provider selector (already there)
  - `settings.modelId` — model picker (already there)
  - `settings.systemPrompt` — textarea (already there)
  - `hasApiKey` — flips on successful verify, on delete, and on mount via `is_provider_key_configured`. **Note:** this gets re-derived per-provider — switching providers must re-check.

Rationale: keep validation/transient state local to the panel (it isn't needed elsewhere). Model and prompt persist via zustand because the chat overlay reads them. `hasApiKey` is a hint flag for `AgentOverlay`'s gating UI; keep it.

### 4.4. Design tokens

All `rim-*` tokens preserved from the current `AiProviderKeySettings` (`rim-line`, `rim-panel`, `rim-void`, `rim-text`, `rim-text-muted`, `rim-text-faint`, `rim-warm`, `rim-success`, `rim-danger`, `rim-accent`). No hardcoded colours. Use `Button` from `shared/ui/Button` for the Verify & Save / Delete actions (already in `AiProviderKeySettings`). Use the `toast` helper from `shared/toast/useToastStore` for the verify success/failure flow (already in `AiProviderKeySettings`).

### 4.5. Security warning banner placement

The `rim-warm/30` data-leakage banner sits **directly under the subhead, above the provider selector**. This is the position used in both current panels; it must remain the first thing the user sees. Per Black Widow's "trust UX" rule, security copy is sticky and prominent, not buried.

### 4.6. Provider switching behaviour

When the user changes provider:

1. Reset `keyInput` to empty, `verifyState` to idle, `dynamicModels` to null.
2. Re-run `is_provider_key_configured` for the new provider; update `keyConfigured`.
3. Update `useAgentStore.settings.providerId` and reset `settings.modelId` to the new provider's first static model.
4. Update `useAgentStore.hasApiKey` based on the new provider's `keyConfigured`.

This matches what `AgentSettingsPanel.tsx:69–81, 83–92` does today, but reads `is_provider_key_configured` instead of `loadApiKey`.

### 4.7. What is NOT in this panel (out of scope)

- Plugin AI consent — stays in its own tab (`PluginAiConsentPanel`).
- Macro-builder AI usage — `useMacroAgent.ts` reads from `useAgentStore.settings` and currently calls Stronghold directly; this is fixed by the migration in §5 and the call-site change in §7 step 4. No UI for macro AI lives in the consolidated panel.
- MCP bridges — Phase 6, out of scope, do not touch.

---

## 5. Migration plan

### 5.1. Goal

Existing desktop users who entered a key in the legacy "AI Agent" panel (Stronghold) MUST continue to work after this change, without re-entering the key.

### 5.2. Strategy: one-shot copy on first launch, then forget Stronghold

On app boot, after Tauri commands are available:

1. Call `invoke("migrate_provider_keys")` (the Rust command already exists at `agent_proxy.rs:246`). It returns a `provider-key-migration-needed` event listing providers that are present in Stronghold but absent from the keyring. **Note:** the current Rust implementation only checks keyring presence — it doesn't know about Stronghold. We need to either:
   - (a) extend `migrate_provider_keys` Rust-side to also cross-check Stronghold, OR
   - (b) drive the migration entirely from JS: list `["anthropic", "openai"]`, for each provider call `is_provider_key_configured` (keyring) AND `loadApiKey` (Stronghold), and if Stronghold has a key but keyring does not, call `set_provider_key` to copy it across.
   
   Option (b) is simpler and keeps the Rust command surface unchanged; the existing `migrate_provider_keys` event hook can be left dormant and removed in a follow-up cleanup. **Recommendation: (b).**
2. Migration runs once. After a successful copy, call `deleteApiKey` (Stronghold) to remove the orphan. If keyring `set_provider_key` fails (e.g. user denied keyring access), do NOT delete from Stronghold — leave the user with the panel in "no key configured" state and let them retry through the Verify & Save flow.
3. Emit one toast: "Migrated API keys to OS keyring." Use `toast.info` (or `toast.success` if `info` doesn't exist — confirm during implementation).
4. The migration runs at app boot, not at panel mount, so a user who never opens settings still gets migrated. Add a boot-side flag in localStorage (`rim-keyring-migration-v1: "done"`) to make it idempotent and avoid re-running on every launch.

### 5.3. Why not "drop the orphan and prompt re-entry"

Considered and rejected. Pros: simplest possible code, no new boot logic. Cons: users who haven't touched the agent in weeks open the app and find their AI broken with no warning, blame us. The migration is cheap (two IPC calls per provider, zero network) and the user experience win is large.

### 5.4. What about brand-new installs

`migrate_provider_keys` (or the JS equivalent) is a no-op when Stronghold has no entry. The boot flag is set to "done" after the first run regardless. Cost: a few microseconds at boot. Acceptable.

### 5.5. What about the Stronghold file itself

`keyStore.ts:36` defines `STRONGHOLD_FILE = "rim-secrets.hold"`. After migration, the file may still exist on disk with empty entries (since `deleteApiKey` only removes the entry, not the file). This is fine — Stronghold is encrypted, an empty store is harmless, and a future cleanup PR can delete the file outright if no other consumer uses it. Today, grepping for `STRONGHOLD_FILE` shows only `keyStore.ts` uses it; no other consumer. A follow-up issue should be filed: "Remove Stronghold dependency from rim-ui after keyring cutover settles." Out of scope here.

---

## 6. Investigate finding #4 specifically — "AI agent cannot be saved"

### 6.1. The headline

The merge fixes finding #4, **but there are two compounding bugs underneath it that need to be fixed regardless** to make the chat dispatch path work end-to-end.

### 6.2. Bug A (root cause of "agent doesn't work after save"): JS providers send `api_key` in the IPC payload; Rust rejects it

- `src/features/agent/providers/anthropic.ts:124–134` constructs `proxyRequest = { provider, model, messages, ..., max_tokens, api_key: apiKey }`.
- `src/features/agent/providers/openai.ts:176–185` does the same.
- `src-tauri/src/agent_proxy.rs:99–114` defines `ChatCompletionRequest` with `#[serde(deny_unknown_fields)]` and **no** `api_key` field.
- `src-tauri/src/agent_proxy.rs:96–98` literally states: "any caller still sending the old `api_key` field gets a deserialization error instead of silently hitting `KeyNotConfigured` (Pete's #8 must remove `api_key` from the JS call site before this endpoint works)."
- `src-tauri/src/agent_proxy.rs:749–755` has a regression test that locks this behaviour in: a payload with `api_key` MUST be rejected.

So **today, every chat call from the agent overlay rejects at the IPC boundary** with a deserialization error. The user sees an error toast but doesn't know why; from their perspective, they entered the key, the panel said "API key is valid", and the agent still won't respond. This is finding #4's most likely concrete failure mode — except the failure isn't at *save*, it's at *dispatch*. The save (in `AgentSettingsPanel`) does succeed (writes to Stronghold), and the validation (the "Test" button) does succeed (because `validateCredentials` calls a different command, `agent_validate_credentials`, which has its own bug — see §6.3). Then the user types a prompt, hits enter, and the chat call rejects. To Jakub this presents as "AI agent cannot be saved" because the symptom is downstream of the save and feels indistinguishable.

### 6.3. Bug B: `validateCredentials` and `fetchModels` JS providers pass `apiKey` but Rust commands don't accept it

- `src/features/agent/providers/anthropic.ts:252–254` invokes `agent_validate_credentials` with `{ provider, apiKey: key }`.
- `src/features/agent/providers/openai.ts:295–298` does the same.
- `src/features/agent/providers/anthropic.ts:265–268` and `src/features/agent/providers/openai.ts:307–311` invoke `agent_list_models` with `{ provider, apiKey: key }`.
- `src-tauri/src/agent_proxy.rs:326–332` defines `agent_validate_credentials(provider: Provider)` — **only one parameter**, reads from keyring.
- `src-tauri/src/agent_proxy.rs:386–416` defines `agent_list_models(provider: Provider)` — **only one parameter**, reads from keyring.

Tauri's `invoke` is permissive about extra args (they're ignored when the command's parameter names don't match), so this isn't a hard reject — but it means: **the "Test" button in `AgentSettingsPanel` is validating against whatever is currently in the keyring, NOT the key the user just typed.** If the keyring has no key for that provider, the call fails with `KeyNotConfigured`; the panel would surface this as a network_error (because `anthropic.ts:256–259`'s catch block flips any invoke reject to `network_error`). If the keyring HAS a key (e.g. left over from a previous keyring-backed save), the panel reports "valid" against THAT key, which may not be the one the user just typed. This is genuinely confusing and is part of Jakub's overall "this doesn't work" experience.

`AiProviderKeySettings` does NOT have this bug — it uses `agent_validate_provided_key` (which DOES take `api_key`, see `agent_proxy.rs:343–349`) for the "Verify & Save" path. So the keyring panel's validation is correct; the Stronghold panel's is broken.

### 6.4. Does the merge fix #4?

**The UI merge alone does not fix the underlying chat dispatch bug.** Bug A in §6.2 must be patched independently — in the JS provider files. The patch is small: remove the `api_key` field from `proxyRequest` in `anthropic.ts:133` and `openai.ts:184`, and remove the `loadKey()` call that fed it. The provider becomes a stateless wrapper around `agent_chat_completion`; the keyring is the source of truth and Rust handles the read inline.

**The merge incidentally removes Bug B's failure surface.** After the merge, validation is always done via `agent_validate_provided_key` (which takes `api_key`) before the key is ever in the keyring; `agent_validate_credentials` (the bugged one) goes unused. We can leave the Rust command alone — it's still useful for a "re-test stored key" flow if we ever want one — but the JS provider's `validateCredentials` call site (anthropic.ts:252, openai.ts:295) becomes dead code and should be deleted by spider-man, along with the `validateCredentials` method on the provider interface itself.

**The merge fully fixes #4** if and only if Bug A is also patched. Spider-man's task list (§7) sequences this so the broken chat path is fixed first, before the panels are touched.

### 6.5. Other suspect code paths I checked and ruled out

- **The blur handler in `AgentSettingsPanel.tsx:129–135`.** The `void saveApiKey(...).then(...)` does not race with anything observable: it writes to Stronghold and updates the `hasApiKey` flag. No follow-up effect could undo it. Not a bug.
- **`useAgentStore` persistence.** The store correctly persists `settings` (provider, model, prompt) via zustand `persist` middleware; the API key is *deliberately* not stored here. No bug.
- **`loadApiKeyStatus` is `loading` indefinitely.** `AgentSettingsPanel.tsx:72–79` flips it `loaded` in the same effect that loads the key, so this is fine — but if Stronghold is broken (e.g. master password derivation fails) the toast warning fires once and the in-memory fallback takes over. After the migration this code path is gone.
- **Race between provider-switch and load.** The cancellation flag in `AgentSettingsPanel.tsx:69–81` handles this correctly. Preserved in the merge.

---

## 7. Spider-man's task list

Order matters. Steps 1–2 fix the broken chat dispatch (Bug A) BEFORE the UI is touched, so we don't ship a UI that "saves" but still doesn't dispatch. Steps 3–6 do the UI merge. Steps 7–8 wire migration. Step 9 cleans up.

1. **Patch Bug A in `anthropic.ts` and `openai.ts`.**
   - Remove the `api_key: apiKey` field from `proxyRequest` in both files (`anthropic.ts:133`, `openai.ts:184`).
   - Remove the `await loadKey()` call that produces `apiKey` (`anthropic.ts:123`, `openai.ts:175`).
   - The `loadKey` parameter on `createAnthropicProvider` / `createOpenAiProvider` becomes unused for `chat()`. It is still used for `validateCredentials` and `fetchModels`, but those are about to be deleted in step 9 — leave the parameter for now to keep the diff smaller.
   - Update the closure documentation block in both files to reflect that the provider no longer reads the key client-side.

2. **Update `agentEngine.ts` and `AgentOverlay.tsx`** if anything assumed the key was carried through `chat()`. Per my read, nothing does — the engine just iterates the stream — but verify by `grep`.

3. **Create the merged `AgentSettingsPanel.tsx`** at the existing path `src/features/agent/settings/AgentSettingsPanel.tsx`. Overwrite the current file. Source the per-provider row pattern from `AiProviderKeySettings.tsx`'s `ProviderKeyRow`, but render only ONE row at a time — the row for the currently selected provider in `useAgentStore.settings.providerId`. Add the model picker and system prompt below, gated on `keyConfigured`.

4. **Delete `AiProviderKeySettings.tsx`** and its test file `AiProviderKeySettings.test.tsx`. Move the tests' useful assertions into the new `AgentSettingsPanel.test.tsx` (see §8).

5. **Update `SettingsPage.tsx`:**
   - Remove the `"ai-keys"` literal from the `SettingsTab` union (line 244).
   - Remove the `{ key: "ai-keys", label: "AI Keys" }` entry from the `tabs` array (line 257).
   - Remove the `AiProviderKeySettings` lazy import (line 22).
   - Remove the `{activeTab === "ai-keys" && <AiProviderKeySettings />}` render (line 322).
   - Keep the `agent` tab and label `"AI Agent"`.

6. **Update the SettingsPage test (`SettingsPage.test.tsx`):**
   - Remove the `vi.mock("../../agent/settings/AiProviderKeySettings", ...)` block (line 39).
   - Remove the `expect(screen.getByText("AI Keys")).toBeInTheDocument();` assertion (line 89).
   - Update the existing "switches to AI Agent tab" test to use the merged panel's mock testid (already `agent-settings`).
   - Add an assertion: "AI Keys" text MUST NOT appear (negative assertion for the deleted tab).

7. **Add the boot-time migration handler.** Create `src/features/agent/runtime/migrateApiKeys.ts` exporting `migrateApiKeysOnce()` that:
   - Checks `localStorage.getItem("rim-keyring-migration-v1")`; returns early if `"done"`.
   - For each provider in `["anthropic", "openai"]`:
     - `const inKeyring = await invoke<boolean>("is_provider_key_configured", { provider });`
     - if `inKeyring`, skip.
     - `const inStronghold = await loadApiKey(provider);`
     - if `inStronghold`, `await invoke("set_provider_key", { provider, apiKey: inStronghold });` then `await deleteApiKey(provider)`.
   - Sets `localStorage.setItem("rim-keyring-migration-v1", "done")`.
   - Emits one toast (`toast.info` if it exists, else `toast.success`) on the first run when at least one key was migrated.
   - On any error, log via `core/logger` and DO NOT set the flag — let the next boot retry.
   - Wire it into the existing app boot sequence. Find the entry point (likely `src/main.tsx` or an early `App` effect); call `void migrateApiKeysOnce()` once on Tauri-capable boot only (gate on `useRuntime().capabilities.agent`).

8. **Update `AgentOverlay.tsx` and `useMacroAgent.ts`** to use `is_provider_key_configured` instead of `loadApiKey` for the presence check.
   - `AgentOverlay.tsx:185`: replace `const hasKey = !!(await loadApiKey(settings.providerId));` with `const hasKey = await invoke<boolean>("is_provider_key_configured", { provider: settings.providerId });`.
   - `useMacroAgent.ts:126`: same pattern.
   - The provider loader thunks (`AgentOverlay.tsx:39–45`, `useMacroAgent.ts:138–142`) become no-ops for `chat()` after step 1. Keep them in place for now (they still compile because of the parameter); step 9 removes them.

9. **Cleanup pass (same PR, after the merge tests are green):**
   - Delete `validateCredentials` and `fetchModels` methods from `AiProvider` interface (`providers/types.ts`) — confirm grep shows they're unused after step 4. The merged settings panel uses `agent_validate_provided_key` and `agent_list_models` directly via `invoke`, not via the provider interface.
   - Delete the `validateCredentials` and `fetchModels` implementations from `anthropic.ts` and `openai.ts` (lines 244–290 and 290–337 respectively).
   - Drop the `loadKey` parameter from `createAnthropicProvider` and `createOpenAiProvider`. Update the registry / call sites in `AgentOverlay.tsx`, `useMacroAgent.ts`, and any tests.
   - Remove the now-unused exports from `runtime/keyStore.ts` (`saveApiKey`, `withKey`, `ProviderKeyMissingError`) IF grep confirms no other consumer. `loadApiKey` and `deleteApiKey` are still needed by `migrateApiKeys.ts`. Once migration ships and bakes for one release, a follow-up issue can delete the entire `keyStore.ts` module.

10. **Run `npm run build` and `npm test`.** Both must be green. Per Jakub's "test gate required before reporting done" memory rule: report format is "N/N tests pass + build green".

11. **Hand back to Hawkeye for review.** Per the repo's mandatory code-review rule.

---

## 8. Test plan

Spider-man writes / updates these. Do not ship without them.

### 8.1. New tests

**`src/features/agent/settings/AgentSettingsPanel.test.tsx`** (new file, replaces the deleted `AiProviderKeySettings.test.tsx`):

- Renders heading, subhead, and security banner.
- Provider selector lists Anthropic and OpenAI.
- On mount, calls `is_provider_key_configured` for the currently selected provider.
- "No key configured" pill shown when keyring returns false; "Key set" pill shown when true.
- Verify & Save flow:
  - On valid: calls `agent_validate_provided_key` THEN `set_provider_key`, in that order. Asserts the order via the existing `mockInvoke.mock.calls` index pattern from `AiProviderKeySettings.test.tsx:114–117`.
  - On invalid: does NOT call `set_provider_key`. Does NOT call `clear_provider_key` (do not regress the "preserve existing key on invalid" property).
  - On network_error: does NOT call `set_provider_key`. Surfaces the warning copy.
- Delete flow: calls `clear_provider_key`; flips pill back to "No key configured".
- Provider switch: re-runs `is_provider_key_configured` for the new provider; resets keyInput and verifyState.
- **Model picker is hidden when no key is configured.**
- **System prompt textarea is hidden when no key is configured.** (Both gated by `keyConfigured`.)
- Model picker, when visible, allows selecting a model and updates `useAgentStore.settings.modelId`.
- System prompt, when visible, updates `useAgentStore.settings.systemPrompt`.
- Refresh-models button calls `agent_list_models`; shows error message on failure; does not crash on empty list.

**`src/features/agent/runtime/migrateApiKeys.test.ts`** (new file):

- No-op when migration flag is `"done"`.
- No-op when keyring already has a key (does not call `loadApiKey`, does not call `set_provider_key`).
- Copies key from Stronghold to keyring when keyring is empty and Stronghold has it; then deletes Stronghold entry; then sets flag.
- Does NOT set flag when `set_provider_key` throws (so the next boot retries).
- Idempotent: running twice with flag set is a no-op.
- Handles both providers (Anthropic and OpenAI) in one pass; one provider's failure does not block the other.

### 8.2. Updated tests

**`src/features/settings/components/SettingsPage.test.tsx`:**

- Remove the `AiProviderKeySettings` mock and the `AI Keys` tab assertions (per §7 step 6).
- Add the negative assertion that "AI Keys" text is NOT in the DOM.

**`src/features/agent/providers/anthropic.test.ts` and `openai.test.ts`:**

- Update fixtures: `proxyRequest` payload no longer contains `api_key`. The Rust-side regression test (`chat_completion_request_rejects_residual_api_key_field` in `agent_proxy.rs:749`) is the contract; the JS test verifies our payload conforms.
- If the existing tests assert `validateCredentials` and `fetchModels` on the provider, delete those tests after step 9. Replace with tests that hit `invoke("agent_validate_provided_key", ...)` and `invoke("agent_list_models", ...)` directly inside the new `AgentSettingsPanel.test.tsx`.

**`src/features/agent/runtime/keyStore.test.ts`:**

- Existing tests for `saveApiKey`, `loadApiKey`, `deleteApiKey` stay green during the migration phase — they're still exercised by `migrateApiKeys`. Once `keyStore.ts` is fully retired in a follow-up release, delete the file.

### 8.3. Manual smoke tests (Jakub or Fury)

These cannot run from this shell (CSP smoke verification needs human, per memory). Static evidence will be provided by spider-man; live observation is human-driven:

- **Fresh install, no Stronghold key:** open Settings → AI Agent → enter key → Verify & Save → confirm "Key set" pill → close Settings → open agent overlay (Cmd+K or whatever shortcut is bound) → send a prompt → response streams.
- **Existing user with Stronghold key:** before update, set a key via the legacy "AI Agent" panel. After update, open the app — toast "Migrated API keys to OS keyring" appears once → open Settings → AI Agent → confirm "Key set" pill is on without needing to re-enter → send a prompt → response streams.
- **Invalid key flow:** enter a malformed key → Verify & Save → "Invalid key — not saved" inline → keyring unchanged.
- **Network error flow:** disconnect from network → Verify & Save → "Could not reach Anthropic..." inline → keyring unchanged.
- **Provider switch:** with a key set for Anthropic, switch to OpenAI → pill flips to "No key configured" → enter OpenAI key → Verify & Save → switch back to Anthropic → pill still says "Key set" (per-provider isolation in keyring).

---

## 9. Open questions for `nick-fury`

1. **Tab label: "AI Agent" or "AI"?** I picked "AI Agent" because it preserves the existing label and the `agent` route key. "AI" is shorter but ambiguous (Plugin AI is a separate tab). Confirm or override.
2. **Macro-builder AI usage.** `useMacroAgent.ts` is currently part of the migration path (its presence-check changes from `loadApiKey` to `is_provider_key_configured`). Should the macro builder also stop falling back to its own provider-registry entry and instead piggyback on the AgentOverlay's? Out of scope here unless you say otherwise — but flagging it because the macro-AI path has the same Stronghold-vs-keyring split-brain.
3. **Toast variant for migration.** Does `toast.info` exist, or only `success` / `warning` / `error`? If only the latter three, use `success`. Spider-man should confirm during step 7.
4. **`migrate_provider_keys` Rust command.** Leave it dormant for now (option (b) in §5.2)? I recommend yes; deleting it is a separate cleanup.

---

## 10. Constraints honoured

- Single tab in `SettingsPage.tsx:246` collapses "agent" + "ai-keys" into one entry called "AI Agent". ✓
- No Phase 6 MCP-bridge work. ✓
- Validation-before-save contract preserved (the `agent_validate_provided_key` → `set_provider_key` order is the heart of the merged panel's save flow; on-blur unvalidated saves are removed). ✓
- Macros / pipelines / Plugin AI consent panels untouched. ✓
- Tauri-specific code stays behind `invoke` and the existing `runtime` capability gate (`capabilities.agent`). The web build sees the panel as "Agent settings unavailable in web build" (preserves existing copy from `AiProviderKeySettings.tsx:311–315`). ✓
- Plugin API surface unaffected (this is a settings-panel merge, not a plugin API change). ✓
- No keyboard shortcuts added or hardcoded. ✓
- State stays at the lowest level that needs it (local component state for transient verify flow, zustand for cross-panel persisted settings). ✓
- Every new function/component spider-man writes has tests AND docs specified in §7 and §8. ✓
