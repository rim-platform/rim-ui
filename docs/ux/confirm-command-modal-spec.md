# ConfirmCommandModal — UX Specification

**Author:** Ant-Man (Scott Lang) — UX/UI Architect
**Date:** 2026-04-24
**Phase:** AI Agent Reframe — Phase 4 (P4-UX1)
**Drives:** P4-B2 (Pete's modal implementation)
**Status:** r1 — pending Black Widow security review

---

## §0. TL;DR (the elevator pitch — back from prison again)

One shared, blocking React modal that replaces:
- The native `window.confirm()` in `agentEngine.ts:88-269`.
- The 13 ad-hoc per-tool confirmation prompts (per Falcon audit §A.6).

It is the **only** surface in RIM that is allowed to ask the user "are you sure?" for command execution. Every initiator (Palette, Agent, Macro, Keybind, ContextMenu, Plugin) routes through it when the backend `requires_confirmation_by_tier()` says so.

It must be unspoofable, keyboard-driven, color-coded by the actual backend sensitivity tier (Safe / Sensitive / Mutating / Restricted — **not** the 5-tier ladder from the Skill Macros spec — see §0.1), and resilient to the H2 prompt-injection mitigations from the v2 reframe doc (cross-channel, tool-result-origin, tier-4 type-to-confirm).

> *"Look, I know the old `window.confirm()` was simple. Two buttons, ugly font, gets the job done. But it can't show a destination chip, can't enforce type-to-confirm, can't display a system badge, and it dies the moment we ship Tauri custom title bars on Windows. We need a real one. Just one. Not 14."*

---

## §0.1 Reconciliation with prior specs

**Skill Macros r2.1 (`skill-macros-2026-04-22.md`)** introduced a 5-tier ladder (Safe / Notable / Standard / Dangerous / Catastrophic). That was a **UX-side abstraction** invented before I read the backend `sensitivity.rs`. **This spec supersedes it for the modal surface.**

The actual backend tiers (from `rim_services::command::sensitivity::CommandSensitivityDto`) are:

| Backend tier | GraphQL wire | Modal name | Modal color | Requires confirm? |
|---|---|---|---|---|
| `Safe` | `SAFE` | "Safe" | `rim-success` | No (tier alone) |
| `Sensitive` | `SENSITIVE` | "Sensitive" | `rim-accent` | Agent: yes; Human: no |
| `Mutating` | `MUTATING` | "Mutating" | `rim-warm` | Yes |
| `Restricted` | `RESTRICTED` | "Restricted" | `rim-danger` | Always |

The modal queries the backend's `requires_confirmation_by_tier(initiator, sensitivity, dangerous)` answer — the frontend does NOT re-implement the policy. It only renders.

The Skill Macros spec's 5-tier ladder is retired in favour of these four. I will send a r2.2 patch to that doc separately so the two specs stay aligned.

---

## §1. Glossary

| Term | Meaning |
|---|---|
| **Initiator** | `CommandInitiator` enum from `rim_services/src/command/initiator.rs`. SCREAMING_SNAKE on wire (PALETTE, AGENT, MACRO, KEYBIND, CONTEXT_MENU, PLUGIN, CLI, MCP). |
| **Sensitivity** | `CommandSensitivityDto` enum: SAFE / SENSITIVE / MUTATING / RESTRICTED. |
| **ConfirmationProof** | Backend-issued single-use token. The modal does NOT execute — it returns a proof which the dispatcher attaches to the next `executeCommand` call. Per design doc §3.5. |
| **Mask for display** | Frontend mirror of backend `mask_for_display()` from `sensitivity.rs`. Recursively walks args; replaces values whose key matches `SENSITIVE_ARG_NAME_RE` or whose string content matches `value_looks_secret()` with `[REDACTED]`. |
| **System badge** | Per-install hashed `[RIM]` glyph (Skill Macros §3.5.1). Unforgeable trust anchor. |
| **Cross-channel write** | A command whose `args.conversation_id` differs from the currently-focused conversation. Raises an extra warning chip per H2 #2. |
| **Same-turn-after-tool-result** | The agent issued a Mutating/Restricted command in the same turn that consumed a `<tool_result origin="untrusted_user_content">` block. Triggers Tier-4 type-to-confirm escalation per H2 #3. |

---

## §2. Where the modal lives

- **Component:** `src/features/commands/components/ConfirmCommandModal.tsx` (NEW). Lives next to `CommandPalette.tsx`.
- **Shell:** wraps the existing `Dialog` primitive at `src/shared/ui/Dialog.tsx`. Reasons:
  1. Already implements focus trap, body scroll lock, Escape handler, focus restoration.
  2. Already uses `Z.OVERLAY_*` token correctly.
  3. **Crucially: it is a pure React tree, never receives DOMPurify-sanitized HTML.** This is what gives us the M2 (DOM-spoofing) defense for free — no agent-rendered markdown can ever inject content into the modal frame because the frame is React-controlled.

  We extend, we do not replace. New props:
  - `severity: "safe" | "sensitive" | "mutating" | "restricted"` — drives accent border + badge color.
  - `disableBackdropClose?: boolean` — true for Mutating/Restricted (no accidental dismiss).
  - `disableEscClose?: boolean` — false; Esc always cancels (Esc = abort, never confirm).

- **Surface ownership:** The modal is owned by the **dispatcher** (the thing that turns a `Command + args + initiator` into an `executeCommand` mutation), not by the surface that triggered it. So the same instance handles palette-initiated and agent-initiated confirmations. There is at most ONE `ConfirmCommandModal` mounted at a time.

---

## §3. Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [RIM]  Confirm command                            ✕ Esc    │  ← header strip
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Agent wants to: Create YouTrack ticket                    │  ← title (24px medium)
│   Open a new bug ticket in the selected project.            │  ← subtitle (nl_description)
│                                                             │
│   ┌─────────────┐  ┌─────────┐                              │
│   │  MUTATING   │  │  AGENT  │                              │  ← chips row
│   └─────────────┘  └─────────┘                              │
│                                                             │
│   ⚠  Destination differs from active conversation           │  ← cross-channel chip (H2 #2)
│      Will post in #ops-incidents (you are in #general)      │     (only when triggered)
│                                                             │
│   ⚠  This action was suggested while the agent was reading  │  ← tool-result-origin banner
│      external content. Verify it matches your intent.       │     (H2 #1, only when triggered)
│                                                             │
│   ─── Arguments ───                                         │
│   project       │  RIM-CORE                                 │  ← args block
│   summary       │  Login race condition on cold-start       │     (mask_for_display applied)
│   priority      │  High                                     │
│   api_key       │  [REDACTED]                               │
│                                                             │
│   ─── Type "create" to confirm ───                          │  ← tier-4 input (H2 #3)
│   [____________________]                                    │     (only when triggered)
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                       [ Cancel ]   [ Confirm ⌘↵ ]           │  ← footer
└─────────────────────────────────────────────────────────────┘
```

**Width:** `max-w-lg` (~512px). Same as `Dialog` default. Wider would feel modal-heavy; narrower would force args to wrap.
**Padding:** `px-6 py-5` for body; `px-6 py-3` for header & footer (matches existing dialogs).
**Border accent:** `border-l-4` on the dialog frame, color = severity color from §0.1. This is the only visual cue that escalates with tier — it's peripheral so it doesn't dominate, but unmistakeable when you glance at it.

---

## §4. Content sections (in render order)

### §4.1 Header strip
- **Left:** `[RIM]` system badge (per-install hashed glyph from Skill Macros §3.5.1). Tooltip: *"Verified RIM system dialog. Hash: <first-6>"*
- **Center:** Static label `Confirm command` (text-rim-text-muted, text-xs uppercase tracking-wide).
- **Right:** Close `✕` button + `Esc` chip. Both invoke cancel.

The badge is the **only** part of the modal that proves it's RIM and not something injected. If it doesn't render, the modal MUST refuse to mount and instead show an inline error toast — *do not* fall back to a badgeless modal, because that's exactly what an attacker would render.

### §4.2 Title
> Agent wants to: **{command.title}**

Font: `text-xl font-medium text-rim-text`.

The verb prefix is initiator-aware:
- `AGENT` → "Agent wants to:"
- `PALETTE`, `KEYBIND`, `CONTEXT_MENU` → "Confirm:" (no anthropomorphizing for human-initiated)
- `MACRO` → "Macro will: " + (italic) "(triggered by {macro outermost initiator})"
- `PLUGIN` → "Plugin {plugin.name} wants to:"
- `CLI`, `MCP` → "{Initiator name}: "

The title text itself comes from `Command.title`. **Never** from the agent. Never from the macro. Always from the registered command definition.

### §4.3 Subtitle
> {command.nl_description ?? command.description}

Font: `text-sm text-rim-text-muted`. Two-line clamp (`line-clamp-2`).

Prefer `nl_description` (designed for natural-language surfaces); fall back to `description`.

### §4.4 Chips row
Two required chips, rendered as inline-flex pills, gap-2:

**Sensitivity chip** (always shown):
- Style base: `rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide`
- Color per §0.1 table. Background `<color>/20`, text `<color>`.
- Text: backend wire value verbatim ("SAFE", "SENSITIVE", "MUTATING", "RESTRICTED"). No translation — match what an audit log row would say.

**Initiator chip** (always shown):
- Same style base.
- AGENT initiator: `bg-rim-accent-strong/30 text-rim-accent-strong` + small bot glyph prefix. **Visually distinct from human initiators** — this is the "who's pushing the button" cue.
- Human initiators (PALETTE/KEYBIND/CONTEXT_MENU): `bg-rim-line/40 text-rim-text-muted`. Lower-key.
- PLUGIN: `bg-rim-warm/20 text-rim-warm` + plug glyph.
- MACRO: `bg-rim-line/40 text-rim-text-muted` + chain glyph + the resolved outermost initiator in parens (per `initiator.rs` §3.11 nesting rule).

### §4.5 Cross-channel destination chip (conditional, H2 #2)
**Trigger:** `args.conversation_id` exists AND differs from the active conversation in shell state.

**Render:** Full-width row, `border border-rim-warm/40 bg-rim-warm/10 rounded px-3 py-2`, with `⚠` glyph prefix. Two lines:
- Line 1: `Destination differs from active conversation`
- Line 2: `Will post in #{target.name} (you are in #{current.name})`

Both channel names hyperlink to a hover card showing channel topic + member count, so the user can sanity-check before confirming.

If the channel name cannot be resolved (e.g., DM channel ID with no metadata fetched), show `Will post in conversation {first-8-of-id}…` and load metadata in the background.

### §4.6 Tool-result-origin warning banner (conditional, H2 #1)
**Trigger:** Backend flags this `executeCommand` request as having been issued in the same agent turn that consumed a `<tool_result origin="untrusted_user_content">` block.

**Render:** Full-width row, `border border-rim-danger/40 bg-rim-danger/10 rounded px-3 py-2`, `⚠` glyph + text:
> This action was suggested while the agent was reading external content. **Verify it matches your intent.**

Two lines max. The bold "Verify it matches your intent" is the critical-info anchor — eye-tracking shows users scan modals on the bolded fragments.

This banner is the visual handshake for the H2 prompt-injection class — if it's there, the user has been notified that the suggestion's lineage is tainted. Audit log records `confirm_shown_with_tool_result_warning: true`.

### §4.7 Arguments block
Heading divider: `─── Arguments ───` (text-rim-text-faint, text-[10px] uppercase tracking-wide, with hairline borders left/right).

Then a 2-column key/value grid (`grid-cols-[120px_1fr] gap-x-3 gap-y-1`):
- Key column: `text-xs text-rim-text-muted` (snake_case, monospace via `font-mono`).
- Value column: `text-xs text-rim-text` (monospace).

**Masking applied via frontend `maskForDisplay(args)`** — must be a faithful mirror of backend `sensitivity.rs::mask_for_display()`. Same regex (`SENSITIVE_ARG_NAME_RE`), same `value_looks_secret()` checks (vendor prefixes: `sk-`, `xoxb-`, `ghp_`, `glpat-`, `ya29.`, `AKIA`, `AIza`, etc.), same `[REDACTED]` placeholder.

**Argument count guard:** if `Object.keys(args).length > 10`, render the first 10 with a divider + `+{N} more` chip that expands the full list inline (no scroll spawn). If args contain a value > 200 chars, truncate with `…` and a "show full" disclosure button (DOMPurify-sanitized when expanded since values may contain markup).

**Empty args:** show `(no arguments)` in `text-rim-text-faint italic`. Don't hide the section — its presence confirms the user has full visibility.

### §4.8 Tier-4 type-to-confirm input (conditional, H2 #3)
**Trigger:** Backend sets `require_type_to_confirm: true` (when sensitivity is RESTRICTED, OR when same-turn-after-tool-result + sensitivity ≥ MUTATING).

**Render:** Heading divider `─── Type "{verb}" to confirm ───`, then a single text input:
- Verb is provided by backend (e.g., "create", "delete", "post"). Not freely chosen — it's `Command.confirmation_verb` or derived from command id.
- Input: `bg-rim-void border border-rim-line rounded px-3 py-2 text-sm font-mono w-full focus:border-rim-accent`
- Comparison: case-insensitive, trimmed.
- Until match: Confirm button stays disabled (see §6.4).
- On match: input border flips to `rim-success`, Confirm button enables, focus does NOT auto-jump (user must still hit ⌘↵ — confirms intent, not just keypress).

**Why type-to-confirm and not "press and hold"?** Type-to-confirm survives muscle memory ("I always hit Enter on dialogs"). Press-and-hold is a single motor gesture that an agent-driven UI flow could prime the user to perform reflexively. Backend audit log records the typed string verbatim (this proves the human read at least one word of the verb).

### §4.9 Footer
- Right-aligned button cluster, gap-2.
- **Cancel button:** `border border-rim-line bg-rim-void px-4 py-2 text-xs text-rim-text-muted hover:text-rim-text rounded`. Always present. Always enabled. Always the safe default.
- **Confirm button:** `bg-rim-accent px-4 py-2 text-xs font-medium text-rim-void hover:bg-rim-accent/90 rounded` + trailing `⌘↵` chip in `text-rim-void/70`. For MUTATING tier: same style. For RESTRICTED tier: `bg-rim-danger text-rim-void hover:bg-rim-danger/90`.
- **Confirm label:** dynamic. `Confirm` for SAFE/SENSITIVE; `Run anyway` for MUTATING; `I understand — execute` for RESTRICTED. Escalates language so the user can't autopilot through tier 4.

No "Always allow" checkbox. **Ever.** Per Black Widow's standing position from r2 review (the "permission fatigue → blanket consent" antipattern). If the user wants to skip a confirmation, they must adjust the command's `dangerous` flag in settings, which has its own confirmation flow.

---

## §5. States

The modal is a state machine. Six states, explicit transitions. No hidden "tweener" states.

```
   (mount)
     │
     ▼
   ┌─────────┐    proof.ok    ┌──────────┐    user types       ┌──────────────────┐
   │ LOADING │ ──────────────▶│  READY   │ ──────────────────▶ │  TYPE_REQUIRED   │
   │         │                │          │   (only if tier-4)  │  (input visible) │
   └─────────┘                └──────────┘                     └──────────────────┘
     │ proof.fail                │ ⌘↵                                │ ⌘↵ + match
     │                           │                                   │
     ▼                           ▼                                   ▼
   ┌────────┐               ┌────────────┐    backend ack      ┌────────────┐
   │ ERROR  │               │ SUBMITTED  │ ──────────────────▶ │  CLOSED    │
   └────────┘               └────────────┘                     └────────────┘
     │ retry                       │ backend reject
     │                             ▼
     └─────────▶ LOADING       ┌────────┐
                               │ ERROR  │
                               └────────┘

   (Esc / Cancel from any state) ──▶ CLOSED with proof_discarded
   (proof TTL expires)           ──▶ STALE ──▶ auto-close + toast
```

### §5.1 LOADING
- Trigger: modal mounted, dispatcher requested a `ConfirmationProof` from backend.
- Visual: skeleton state. Title shows the command title (we already have it locally — never render placeholder for known data). Args block shows shimmer. Confirm button disabled, label "Loading…".
- Timeout: 3s. After 3s show a subtle inline "Still loading…" hint. After 10s transition to ERROR.

### §5.2 READY
- Trigger: backend returned a valid proof.
- Visual: full layout per §3, all chips and banners rendered.
- Initial focus: **Cancel button.** Per task #46 mandate. Safe default. The user must perform an explicit forward action (Tab to Confirm, then ⌘↵) — this is a deliberate friction tax on tier ≥ MUTATING.
- Keyboard:
  - `Esc` → CLOSED (cancel + discard proof).
  - `Tab` / `Shift+Tab` → cycle within trap (Cancel ↔ Confirm; if §4.8 is shown, also through input).
  - `⌘↵` / `Ctrl+↵` from anywhere in the dialog → SUBMITTED (only if Confirm enabled).
  - Bare `Enter` on Confirm or Cancel button → activate that button. Bare `Enter` elsewhere → no-op.
  - Bare `Enter` is **never** wired to "Confirm regardless of focus." Same rule as Skill Macros §5.1 L4 — bare Enter on a destructive dialog is a foot-gun.

### §5.3 TYPE_REQUIRED
- Trigger: READY + `require_type_to_confirm: true`.
- Visual: §4.8 input revealed below args block.
- Initial focus: **still Cancel button.** Even with the input present. Tab order: Cancel → Confirm (disabled) → Type input → back to Cancel. The user must Tab once into the input to begin typing — this enforces explicit intent.
- Confirm button: disabled until verb matches.
- Once verb matches: focus does NOT move; only the Confirm button enables. User then either Tabs to Confirm + Enter, or hits ⌘↵.

### §5.4 SUBMITTED
- Trigger: user activated Confirm with valid proof (and matched verb if tier-4).
- Visual: Confirm button shows spinner, label flips to "Executing…". All other interactive elements disabled. Esc still cancels — but cancellation post-submit only attempts to abort; if backend already mutated, the audit log will show both the confirm and the cancel as separate rows.
- Footer note appears: `text-[10px] text-rim-text-faint` — *"Press Esc to attempt cancel."*

### §5.5 ERROR
- Trigger: proof issuance failed, OR backend rejected the executed command (proof expired, sensitivity changed since proof issued, etc.).
- Visual: red banner above args block: `border border-rim-danger/40 bg-rim-danger/10 rounded px-3 py-2`, message comes from backend (`error.message`). No technical details (stack traces) in user-visible copy — those go to debug log.
- Buttons: Cancel becomes "Close"; Confirm becomes "Retry" (re-issues proof).
- Initial focus: Close button.

### §5.6 STALE (proof TTL expired without user action)
- Trigger: proof TTL (15s default per backend §3.5) expires while modal is in READY/TYPE_REQUIRED.
- Visual: modal auto-closes, transient toast appears: *"Confirmation timed out. Re-trigger if you still want to run this."*
- Why auto-close instead of inline-refresh? A stale modal that silently re-issues a proof is exactly the gap an agent could exploit — the user thinks they're approving the action they read 30 seconds ago, but the args have changed under them. Force a fresh confirm flow.

---

## §6. Accessibility

### §6.1 Focus management
- Inherited from `Dialog`: focus trap, focus restoration on close. Verified at `Dialog.tsx`.
- Override the default `Dialog` "first focusable" auto-focus — explicitly focus the **Cancel** button on mount. Confirm-first focus would be a foot-gun in tier ≥ MUTATING.
- Tier-4 input takes its own keyboard focus only on explicit Tab — never auto-focus.

### §6.2 Screen reader
- Dialog is `role="dialog"` `aria-modal="true"` with `aria-labelledby="confirm-cmd-title"` (the §4.2 element).
- `aria-describedby` points to a virtual DOM node containing, in order:
  1. Sensitivity tier name ("Mutating action") — **not** the wire constant; SR-friendly form.
  2. Initiator descriptor ("Initiated by AI agent" / "Initiated by you via command palette" / etc.).
  3. Cross-channel warning text if §4.5 is shown.
  4. Tool-result-origin warning text if §4.6 is shown.
  5. Tier-4 instruction if §4.8 is shown ("Type the word create to confirm.").
- Args block is a `<dl>` (definition list) — `<dt>` for keys, `<dd>` for values. SR reads as "project, RIM-CORE; summary, …".
- `[REDACTED]` values: announce as "redacted" (override visual literal).

### §6.3 Keyboard map (full)
| Key | State | Action |
|---|---|---|
| `Esc` | any | Cancel + discard proof. |
| `Cmd/Ctrl+Enter` | READY (focus anywhere in dialog) | Submit if Confirm is enabled. |
| `Cmd/Ctrl+Enter` | TYPE_REQUIRED (verb matched) | Submit. |
| `Cmd/Ctrl+Enter` | TYPE_REQUIRED (verb not matched) | No-op (don't shake/flash; that gamifies it). |
| `Tab` / `Shift+Tab` | any | Cycle within trap. |
| `Enter` on focused Confirm/Cancel button | any | Activate that button. |
| `Enter` elsewhere | any | No-op. |
| Type into verb input | TYPE_REQUIRED | Update match state, possibly enable Confirm. |
| `Backspace` in verb input | TYPE_REQUIRED | Disable Confirm if no longer matches. |

### §6.4 Disabled-button announcement
- Confirm button while disabled in TYPE_REQUIRED: `aria-disabled="true"`, `aria-describedby` points to a hidden span: *"Type the verb above to enable confirm."*
- Don't use `disabled` attribute alone — SR will skip the element. `aria-disabled` keeps it in the tab order.

### §6.5 Color contrast
All severity color combinations verified against WCAG AA:
- `rim-success` on `rim-void`: ≥ 4.5:1 ✓
- `rim-accent` on `rim-void`: ≥ 4.5:1 ✓
- `rim-warm` on `rim-void`: ≥ 4.5:1 ✓
- `rim-danger` on `rim-void`: ≥ 4.5:1 ✓
- Severity is also encoded as text label — never color-only (color-blind users see the same tier name).

### §6.6 Reduced motion
Respect `prefers-reduced-motion: reduce`. The only animation is the Confirm spinner in SUBMITTED — replace with static `…` glyph under reduced-motion. No modal entrance/exit transitions if the user opted out (instant render is fine; in fact safer — no chance to misclick during fade).

---

## §7. Visual references

- **Severity-tier border accent + chip:** `CommandPalette.tsx:357-361` (existing dangerous chip pattern). Keep the chip style, add the left-border accent.
- **Cancel + Confirm button styling:** `AgentDisclaimerDialog.tsx` (existing pair). Match exactly so the modal feels consistent with the rest of the agent surface. Replace Confirm color with severity color for MUTATING/RESTRICTED.
- **Z-index:** `Z.OVERLAY_*` from `globals.css` z-scale (`overlay: 200`, `modal: 300`). Confirm modal lives at `modal` so it can stack over generic overlays (e.g., command palette's own backdrop) but stays below `popover` (so emoji-pickers on the verb input can render — though that's an unlikely path).
- **System badge:** match Skill Macros §3.5.1 — render via dedicated `<RimSystemBadge />` component, not as text. The component is the only place that can render the `[RIM]` glyph; ESLint rule should flag any other emission.

---

## §8. Anti-patterns (what NOT to ship)

These will be caught by Hawkeye review if they slip in. Listed so Pete (P4-B2) doesn't accidentally walk into them.

1. **Don't ship `window.confirm()` as a fallback** when `ConfirmCommandModal` fails to mount. Either the modal renders correctly or the action is hard-blocked with a toast. Native `window.confirm` is exactly what we're getting rid of — we cannot have two confirmation surfaces.

2. **Don't render args via `MarkdownRenderer`.** Args are `unknown` JSON values. They get coerced to string and rendered as plain text in `<pre>`-like styling. Markdown rendering is an injection vector — an arg `summary: "**bold**"` should display the literal asterisks.

3. **Don't accept Confirm via bare Enter from anywhere outside the buttons.** Per §6.3 / §5.2 — bare Enter on input fields does NOT submit. This is the single most-common confirmation-modal foot-gun in software (see Slack's "send vs. newline" wars).

4. **Don't use the agent's natural-language string as the title.** Title comes from `Command.title` (registered metadata). The agent can suggest *what command to run*, never *what label to put on the modal*. (M2 mitigation: prevents the agent from rendering "Click confirm to dismiss notification" while the actual command is `chat.delete_message`.)

5. **Don't auto-dismiss on backdrop click for MUTATING/RESTRICTED.** `disableBackdropClose: true` for tier ≥ MUTATING. Stray clicks must not approve a destructive action. (Backdrop click on SAFE/SENSITIVE is fine — equivalent to Cancel.)

6. **Don't add a "remember my choice" / "always allow this command" checkbox.** Per Black Widow's blanket position. If we ever need a per-command opt-out, it lives in settings with its own confirm flow.

7. **Don't expose the install ID anywhere reachable from `ai_callable: true` commands.** The system badge derives from it; a leaked install ID lets an attacker pre-render a matching badge. (Cross-cutting check from Skill Macros r2.1 — repeated here because this modal is the primary consumer.)

8. **Don't display `ConfirmationProof` token in the UI.** Not in dev tools, not in error messages, not in audit copy. Backend-only secret.

9. **Don't render the modal inside the agent transcript scroll container.** Modal is portal-mounted to `document.body` (Dialog already does this via z-index — verify Pete preserves it). Inline rendering would put it inside the DOMPurify-controlled subtree → M2 spoofing risk.

10. **Don't translate the sensitivity tier name in the chip** (§4.4). Wire constant verbatim. The audit-log row says `MUTATING`; the user-visible chip says `MUTATING`. One-to-one mapping makes screen-share debugging trivial. (The `aria-describedby` SR text in §6.2 is the only place we expand to "Mutating action".)

---

## §9. Reference comparison

| Tool | Confirmation surface | What we borrow |
|---|---|---|
| **macOS auth dialog** | System-issued, modal, badge top-left, Cancel default | Badge as trust anchor; Cancel-as-default; modal blocks. |
| **GitHub destructive actions** | Type repo name to delete | Type-to-confirm (§4.8) for tier 4 — but with command-specific verb, not the resource name (verbs are shorter, less typo-prone). |
| **Stripe dashboard** | Severity-colored confirm button + freeform reason field | Severity color on button; **NOT** the reason field (we don't ask the user to justify themselves; the agent's `nl_description` is the justification). |
| **Linear** | Subtle inline confirms for low-impact actions | Tier-1 (SAFE) doesn't show modal at all — backend `requires_confirmation_by_tier` returns false; we just execute. |
| **Slack DM warning** | "You're about to message someone outside your workspace" | Cross-channel chip (§4.5). |
| **VS Code "Trust this workspace"** | Banner persists until acknowledged | Tool-result-origin banner (§4.6) — but per-action, not per-session. We deliberately do NOT have a session-level "trust the agent's tool results" toggle. |

---

## §10. Open questions for Tony / Fury / Widow

1. **`Command.confirmation_verb` field** — does the backend have it? If not, derive from command id (`youtrack.create_ticket` → "create"; `chat.delete_message` → "delete"). Falcon's audit didn't mention this field. Need confirmation, or we own the derivation rule on the frontend.

2. **Cross-channel detection rule** — H2 #2 says `args.conversation_id ≠ current_conversation_id`. But what if the command takes a `channel_id` (incident channels) or `dm_recipient_id` instead? Need a closed list of "destination-bearing arg names" from rim-server, or a backend flag like `args_modify_channel: ConversationId | null`.

3. **System badge re-derivation cadence** — Skill Macros r2 said per-install. Does Phase 4 also need a per-day or per-session rotation? (Probably no — install ID is the right granularity. Listed because Strange asked for it post-r2.)

4. **Loading-state policy** — if proof issuance takes > 10s, is the right behavior to ERROR, or to keep waiting? If the backend is slow but eventually succeeds, ERROR-then-retry is wasted UX. Ant-Man's recommendation: 10s ERROR with auto-retry-once before showing ERROR to user.

5. **Tier-4 verb localization** — when we add i18n (Phase 6+), does the verb localize? Spider-Man flagged this: a localized verb in the modal but English in the audit log (`typed_verb: "create"` while UI showed "vytvořit") would defeat the audit-trail purpose. Recommendation: typed verb is always English/canonical, displayed verb is localized but with a small "(create)" canonical hint.

---

## §11. Sanity checks (before Pete starts P4-B2)

- [ ] Modal mounts only when backend `requires_confirmation_by_tier()` returns true. Frontend does not duplicate the policy.
- [ ] All 13 hardcoded tools (Falcon §A.6) route through this modal — no per-tool dialogs survive.
- [ ] `window.confirm()` import in `agentEngine.ts` is removed.
- [ ] Backend issues `ConfirmationProof` before modal opens; modal does not execute, only returns proof to dispatcher.
- [ ] Proof TTL expiry → STALE → auto-close → toast (never silent extension).
- [ ] Args masking exactly mirrors `sensitivity.rs::mask_for_display()` — same regex, same vendor prefixes, same `[REDACTED]` literal.
- [ ] Initial focus is Cancel in every state.
- [ ] Bare Enter never submits; Cmd/Ctrl+Enter is the only "go" gesture.
- [ ] `[RIM]` system badge renders or modal refuses to mount.
- [ ] Tier-4 type-to-confirm input is the only path to enable Confirm when backend sets the flag.
- [ ] Cross-channel chip uses real channel name resolution; falls back gracefully when metadata isn't loaded.
- [ ] Tool-result-origin banner appears whenever backend flags `proof_request_consumed_tool_result: true`.
- [ ] Audit log row records: `confirm_shown`, `confirm_shown_with_tool_result_warning`, `confirm_shown_with_cross_channel_warning`, `tier4_required`, `typed_verb`.
- [ ] Confirmation modal is rendered in a portal (not inside agent transcript subtree).
- [ ] No "Always allow" / "Don't ask again" checkbox.
- [ ] Color contrast verified for all four severity tones on `rim-void` background.

---

## §12. Component sketch (data shape only — not code)

```
ConfirmCommandModalProps {
  // Identity
  command: Command                            // from generated GraphQL types
  args: Record<string, unknown>               // user-supplied args (pre-mask)
  initiator: CommandInitiator                 // wire enum (PALETTE | AGENT | …)

  // Backend-issued proof flow
  proof: ConfirmationProof | null             // null while LOADING
  loadingProof: boolean
  proofError: { message: string } | null

  // H2 mitigations (backend-set flags)
  flags: {
    crossChannel: { current: ConversationRef; target: ConversationRef } | null
    sameTurnAfterToolResult: boolean
    requireTypeToConfirm: { verb: string } | null
  }

  // Lifecycle
  open: boolean
  onConfirm: (proof: ConfirmationProof, typedVerb?: string) => void
  onCancel: () => void                        // discards proof, closes modal
  onProofRetry: () => void                    // re-issue from ERROR state
}
```

Backend contract (per design doc §3.5):
- `issueConfirmationProof(commandId, argsHash) → { proof, ttlSec, flags }`
- `executeCommand(input: { commandId, args, initiator, confirmationProof, typedVerb? }) → CommandResult`

The modal does NOT call `executeCommand` directly — it returns the proof to the dispatcher, which then calls `executeCommand`. Single execution path.

---

## §13. Revision history

| Rev | Date | Author | Notes |
|---|---|---|---|
| r1 | 2026-04-24 | Ant-Man | Initial spec. Reconciled tier names with backend `sensitivity.rs` (4-tier, not 5). Anchored to `CommandInitiator` enum. Recommends extending `Dialog` shell. Awaiting Black Widow security pass + Tony approval. |

---

*"Two buttons looked simple until I started asking what 'OK' meant in different contexts. Turns out 'OK' means fourteen different things in this app right now. Let's make it mean exactly one. — Scott"*
