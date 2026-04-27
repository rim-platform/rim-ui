# Skill Macros — UX Spec

**Author:** Scott Lang (Ant-Man, UX Architect)
**Date:** 2026-04-22
**Revision:** r2 — incorporates Black Widow's security review (M2 spoofing defense, sensitive-arg masking extension, capability-name leak, bare-Enter supersession amplification). See §14 for the diff vs r1.
**Audience:** Kuba (owner, morning briefing), Tony (CTO), Nick Fury (architect), Black Widow (security)
**Scope:** UX-only. No implementation. Pure surface, flow, and trust design.
**Source of truth this leans on:** Falcon's audit `rim-server/docs/design/ai-agent-audit-2026-04-22.md` (sections A.6, C, E.3, E.4) + Black Widow's review `rim-server/docs/security/ai-reframe-review-2026-04-22.md` (M2, §3.4 extension, §6.5 leak, L4 amplification).

> "I may shrink to the size of an ant, but I can spot a bad confirm dialog from a mile away. Make this one count."

---

## 0. TL;DR — what we're building, and what's at stake

We are turning a **MacroDef** (today: a named, NL-described, `steps_json` blob) into something the AI can route into. A user types intent in the agent overlay, the agent matches it to a macro or command, **the user sees exactly what is about to happen**, then either confirms, edits, or cancels.

The single load-bearing surface in this entire feature is the **Confirmation Modal**. Every other surface is supporting cast. If confirmation is broken — ambiguous, dismissible-by-accident, lying about args, hiding side effects — the agent becomes untrustworthy and users will stop using it. So most of this doc is about that modal.

Three rules drive every decision below:

1. **AI suggesting ≠ user picking.** A palette pick is a user-authored intent. An AI tool call is an *inferred* intent. Disambiguation, args echo, and a "this is what I think you meant" beat must always be present in the AI path even when they're skipped in the palette path.
2. **Keyboard wins.** RIM is keyboard-first (CLAUDE.md, AGENTS.md). Every screen below is operable without touching the mouse. Mouse parity is required, but the design is keyboard-driven.
3. **Confirm is irreversible. Cancel is free.** Build the surface so the easy, low-effort gesture is always "stop." The deliberate, slightly-more-effortful gesture is "go." No `Enter`-to-confirm on dangerous actions. Ever.

---

## 1. Glossary (so we all use the same words)

| Term | What it is | Where it lives today |
|---|---|---|
| **Command** | A single executable unit registered in `CommandRegistry` (e.g., `chat.post_message`, `youtrack.create_ticket`). `dangerous` flag, `arguments[]`, `required_capabilities[]`. | `rim-server/rim_services/src/command/dto.rs:68-86` |
| **User Command** | A user-defined composition of commands. Namespace `user.*`. Used today via palette + keybinds. | `rim-server/rim_core/src/command/model.rs` |
| **Macro (MacroDef)** | A named, NL-described composition of steps. `name` + `description` already exist. **This is what becomes the "Skill Macro."** | `rim-server/rim_core/src/macro_def/model.rs` |
| **Skill Macro** | A MacroDef that has been promoted with `nl_description`, `intent_samples[]`, and `ai_callable: true`. Routable by the agent. (Naming aside: per Falcon's E.5 there's an open question whether UserCommand and MacroDef consolidate; this spec uses **Skill Macro** as the user-facing umbrella term and is implementation-agnostic.) | New surface |
| **Skill** | User-facing: any AI-callable unit. A built-in command can be a Skill, a plugin command can be a Skill, a Skill Macro is a Skill. *"All Skill Macros are Skills; not all Skills are Skill Macros."* This matters for the visual badge system in §4. | New |
| **Intent** | The natural-language user utterance ("file a youtrack ticket for this") that gets routed to a Skill. | New |
| **Confirmation surface** | The shared modal that gates dangerous execution, regardless of caller (palette, agent, keybind, plugin RPC). Falcon E.3. | New |

A note on naming for the morning: we should keep "Macro" as the durable noun (it's already in the codebase, in MacroDef, in user mental model from VS Code/Vim). "Skill Macro" is what we call the Macro-with-AI-routing-attached. "Skill" is the umbrella. If Kuba dislikes "Skill," fall back to "AI-routable command." But please don't invent a fourth word.

---

## 2. User Journeys

Three journeys. I'll walk each one as a sequence of frames so we can spot rough edges before we build them.

### 2.1 Author — turning a macro into a Skill Macro

**Persona:** A power user (think: Linear's "make a custom view," Raycast's "create script command"). Already comfortable with macros today. Wants to add NL routing.

**Entry points (pick one, do not build all three):**

1. **Settings → AI Agent → Skill Macros tab.** *Recommended primary.* Same tree as `SettingsPanel.tsx` and `UserCommandSettings.tsx:12`. Discoverable, doesn't fight the existing palette/keybind surfaces.
2. From the Command Palette, on a `user.*` macro row: a small `[Make AI-callable]` action surface (icon + tooltip). Right-click context menu acceptable too. Opens the editor.
3. From the agent overlay's empty state ("Want me to learn a new task? Create a Skill Macro →"). Defer to v2 — discovery via empty-state advertising is good but not critical for v1.

**The editor itself** — extends today's `UserCommandSettings.tsx` create form. Adds three fields below the existing Steps section, in this exact order:

```
┌─ Skill Macro: AI Routing ─────────────────────────────┐
│ [ ] Make this AI-callable                             │
│                                                       │
│ When AI-callable is on:                               │
│                                                       │
│ NL description (what this does, in plain English)     │
│ ┌───────────────────────────────────────────────┐     │
│ │ File a YouTrack ticket from the selected       │     │
│ │ message, including title, description,         │     │
│ │ assignee, and priority.                        │     │
│ └───────────────────────────────────────────────┘     │
│ Hint: write the description for a teammate, not       │
│ for the LLM. The LLM reads this verbatim.             │
│                                                       │
│ Sample triggers (one per line, optional)              │
│ ┌───────────────────────────────────────────────┐     │
│ │ make a youtrack ticket for this                │     │
│ │ file a bug for the issue alice mentioned       │     │
│ │ create a ticket: ...                           │     │
│ └───────────────────────────────────────────────┘     │
│ Hint: 3–5 phrasings improve matching. Plain text.     │
│                                                       │
│ Capability badge: This macro will run as YOU.         │
│ Steps: 3 (chat.search_messages → ... → youtrack...)   │
│ Marked dangerous: ✓ (because youtrack.create_ticket   │
│                       is dangerous)                   │
└───────────────────────────────────────────────────────┘
```

Design notes:

- The "Make AI-callable" checkbox is **off by default** for new macros. AI routing is an opt-in. (Don't surprise users. Author intent != routing intent.)
- The dangerous flag at the bottom is **derived, read-only**. If any underlying step is dangerous, the macro is dangerous. We do NOT let users untick this. (Black Widow will love that.)
- The Steps list shown is a collapsed echo of what they configured above — anchors the user that the NL description must match the steps. If steps change, NL description goes stale. (We could add a "doesn't match steps?" warning later via heuristic, but v1 just relies on the visual proximity.)
- "The LLM reads this verbatim" hint is doing real work: it tells the user this is not marketing copy, it's prompt-engineering.
- Save button: `[Save]` (primary, accent). `[Cancel]` (text-only). Standard pattern from existing form. Disabled-state if AI-callable is on but description is empty.

**Empty-Skill-description edge case:** If user ticks AI-callable but leaves description blank, save button is disabled with inline `Add an NL description to enable AI routing` text under the field. Don't allow ai_callable=true with empty description — the LLM will hallucinate matches.

### 2.2 Discover — what Skill Macros exist?

**Three surfaces, in priority order:**

1. **Command Palette filter chip.** When palette opens, add a filter row above the input (or as a collapsible row) with chips: `[All] [Built-in] [Plugin] [Macros] [AI Skills]`. Clicking `[AI Skills]` filters to `ai_callable: true`. Chips are keyboard-navigable with `Tab` from the input. *(Palette is the discovery hub for everything else; don't fragment.)* See `CommandPalette.tsx:307-317` for the input row this attaches above.

2. **Settings → AI Agent → Skill Macros tab.** Lists installed Skill Macros (own + workspace + plugin-provided), with: name, NL description (truncated), source badge (own/workspace/plugin), `[Try it]` quick-action that opens the agent overlay pre-filled with the first `intent_sample`.

3. **Agent overlay slash menu (defer to v2):** typing `/` in the agent input opens an inline picker of Skill Macros, similar to Raycast's command picker inside chat. Nice-to-have, not v1.

**For v1, do NOT build a Marketplace surface for skills.** That's a separate feature; the existing `workspace.open_marketplace` command (from Falcon's audit B.6) can host it later.

### 2.3 Use — the AI routing flow (this is the journey that makes or breaks the feature)

The **happy path** in seven beats. Each beat is a frame; each frame names what the user sees and what their next gesture is.

**Beat 1 — Open the agent.**
- Trigger: `Ctrl+Shift+A` (today's `useAgentStore.open()` per `AgentOverlay.tsx:5-15`). Focus lands in the input.

**Beat 2 — User types intent.**
- `"create a youtrack ticket for the bug @alice mentioned"`
- Press `Enter` to submit.
- The input clears, status flips to "thinking" (the existing `Loader2` indicator in `AgentOverlay.tsx:316-320`).

**Beat 3 — Agent matches a Skill.** (See §3 for the matching feedback states; for now, assume one confident match.)
- Within the agent transcript, **before** any tool call fires, a new `SkillSuggestionCard` renders (replaces the `window.confirm()` of today). This card is the heart of the feature.

```
┌─ I think you want to: ────────────────────────────────┐
│  ⚡  Create YouTrack ticket                            │
│      Skill Macro · Plugin: YouTrack · ⚠ Dangerous     │
│                                                       │
│  Args I extracted:                                    │
│   title ........... "Login button broken on mobile"   │
│                     ↳ from selected message           │
│   description ..... "Alice reported tap target is..."  │
│                     ↳ from selected message body      │
│   assignee ........ @alice (Alice Chen)               │
│                     ↳ from your phrase "alice"        │
│   priority ........ "High"                            │
│                     ↳ inferred (default: Normal)      │
│                                                       │
│  Capabilities used: plugin.youtrack.write             │
│                                                       │
│  [Edit args]  [Cancel]              [Confirm and run] │
│   (e)          (Esc)                       (⌘+Enter)  │
└───────────────────────────────────────────────────────┘
```

This card is the Confirmation Modal in inline form. It is NOT a separate floating dialog over the agent. **It renders inline in the transcript**, where the user is already looking. (See §2.3.1 below for why.)

**Beat 4 — User decides.** Three paths:

- **Confirm**: presses `Cmd/Ctrl+Enter` (or clicks `[Confirm and run]`). Card collapses to a "running…" state. Tool fires.
- **Cancel**: presses `Esc`. Card collapses with "Cancelled." line. Agent enters idle, focus returns to input. No call made. (Esc inside the transcript doesn't close the overlay while a card is awaiting confirmation; see §5.)
- **Edit args**: presses `e`. Card expands inline into an editable form (each arg becomes a labeled input). Tab moves between fields. `Cmd/Ctrl+Enter` re-confirms. `Esc` collapses back to read-only state without losing edits. (See §6.1 for the wrong-args fix journey.)

**Beat 5 — Execution.**
- The card replaces its body with a single-line progress: `Running Create YouTrack ticket…` + spinner.
- For long-running steps, see §6.3.

**Beat 6 — Result.**
- Success: card body becomes `✓ Created YouTrack ticket FOO-123 → https://youtrack/.../FOO-123`. The link is keyboard-focusable and openable via Enter.
- Failure: card body becomes `✗ Failed at step 2 (youtrack.create_ticket): {message}`. With a `[Retry]` and `[Edit args]` button. Per §6.4.

**Beat 7 — Continue or close.**
- After result, focus returns to the agent input. The card stays in the transcript as a permanent record (audit trail; closes Falcon G7 in UX terms — every executed Skill is visible in the conversation history).
- Press `Esc` to close the overlay, `Enter` to start typing the next intent.

#### 2.3.1 Why inline-in-transcript instead of a separate modal

I've been staring at this question for an hour. The answer is: the agent surface is *itself* a chat-like interaction. Putting a separate modal on top of a chat transcript creates two layers of focus, two layers of "what's the active thing right now?" — and Tauri webviews on smaller laptop screens already have limited vertical space. Inline cards keep eyes in one place, allow the user to scroll up and see prior context (what they typed, what the agent thought), and let multiple cards coexist if the agent proposes a multi-step plan.

The shared Confirmation Modal contract (Falcon E.3) is a *logical* contract — "the same data shape and decision flow drives both surfaces." It does NOT mean the visual treatment must be identical. **Palette gets a centered floating modal** (because the palette is a small floating surface and you can't nest a modal inside it well). **Agent gets the inline card** described above. Both render the same fields, both call the same backend with `confirmed_dangerous: true` on accept.

That's a divergence I want Kuba to weigh in on before we build. If he prefers visual parity, we can build a centered modal for both. I think inline is better; happy to be overruled.

---

## 3. Confirmation UX (the critical surface)

This section is the design of the inline `SkillSuggestionCard` (and, by reference, the centered `ConfirmCommandModal` for the palette path). I'm going to be obsessive about this. This is where trust lives.

### 3.1 What the user must see, in priority order

Anchored to Nielsen-ish hierarchy: identity → consequences → details → action.

1. **What is this thing?** Title (`Create YouTrack ticket`) — biggest text in the card.
2. **What kind of thing?** A subline of badges: `Skill Macro · Plugin: YouTrack · ⚠ Dangerous`. This is the "trust strip."
3. **What will it do, concretely?** The args list. **Each arg shows its source** (selected message, your phrase, default, inferred). The source line is what makes this trustworthy — without it, the user has no way to verify the AI didn't hallucinate.
4. **What permission does this need?** Capabilities row: `Capabilities used: plugin.youtrack.write`. Tiny, but present. Power users will read it; everyone else can ignore it.
5. **Three actions, ranked by frequency:**
   - `[Edit args]` — middle priority, soft button (text + border, no fill)
   - `[Cancel]` — destructive-friendly, text-only, left of confirm
   - `[Confirm and run]` — primary, accent fill, **always rightmost** (Fitts: longest mouse travel for the most consequential action; muscle memory aligns with most apps)

### 3.2 Visual spec (ground in design tokens)

Using `globals.css:5-17` tokens:

| Element | Token | Notes |
|---|---|---|
| Card background | `bg-rim-panel-soft` | distinct from agent message bubbles (which use `bg-rim-void` per `AgentOverlay.tsx:407`) — establishes "this is a system card, not a message" |
| Card border (default) | `border-rim-line` | 1px |
| Card border (dangerous) | `border-rim-danger/40` | subtle danger tint, NOT a full red border (avoids alarm fatigue) |
| Title color | `text-rim-text` | high contrast |
| Badge: Skill Macro | `bg-rim-accent/10 text-rim-accent` | matches the existing `dangerous` badge pattern at `CommandPalette.tsx:357-361` |
| Badge: Dangerous | `bg-rim-danger/15 text-rim-danger` | reuses existing `dangerous` chip exactly — consistency! |
| Args label column | `text-rim-text-muted` | secondary |
| Args value column | `text-rim-text` | primary |
| Args source line | `text-rim-text-faint` | tertiary, smallest, with `↳` glyph |
| Confirm button | `bg-rim-accent text-rim-void` | matches existing accept button at `AgentDisclaimerDialog.tsx:42-46` |
| Cancel button | text-only, `text-rim-text-muted hover:text-rim-text` | matches existing cancel pattern at `AgentDisclaimerDialog.tsx:33-39` |
| Edit args button | `border border-rim-line text-rim-text-muted hover:text-rim-text` | new, uses existing border-line pattern |
| Keybind hint chips under buttons | `text-[10px] text-rim-text-faint font-mono` | matches palette footer hints at `CommandPalette.tsx:401-404` |

I went through `CommandPalette.tsx` and `AgentOverlay.tsx` to make sure these match what's already there. **The dangerous chip is the same chip used in palette today.** Don't invent a new one. Same icon (or no icon — palette uses no icon, just the text chip; let's keep parity).

### 3.3 The five-tier confirmation ladder

Not all dangerous is equal. `chat.send_message` to a public channel and `incident.resolve` are both flagged dangerous in some sense, but the consequences are wildly different. I'm proposing **five tiers**, mapped from existing `dangerous: bool` plus a future `severity` field on `CommandDefinitionDto` (Nick's call whether to add this):

| Tier | What it covers | Confirmation UX | Default keybind |
|---|---|---|---|
| **0 — Safe** | Read-only / navigation (`list_channels`, `navigate_to_channel`) | None. Fires silently. Logged in transcript. | n/a |
| **1 — Notable** | Mutates personal state (`mark_as_read`, `add_reaction`) | Brief inline acknowledgement after the fact, no pre-confirm | n/a |
| **2 — Standard** | Sends/posts in user's name (`chat.post_message`) | Inline card, single confirm gesture | `Cmd/Ctrl+Enter` to confirm |
| **3 — Dangerous** | External side effects, hard to reverse (`youtrack.create_ticket`, `delete_message`, `incident.resolve`) | Inline card, confirm requires `Cmd/Ctrl+Enter` (NOT bare Enter) | Bare `Enter` does nothing in this card; Esc cancels |
| **4 — Catastrophic** | Bulk/irreversible (`admin.invite_member` to many, future `chat.delete_channel`) | Inline card + **type-to-confirm** field (e.g., type the channel name to delete it). Same pattern as GitHub repo deletion. | No keybind shortcut |

Rationale: today, `dangerous: bool` is a single flag; if we keep it boolean for v1, then **Tier 3 is the implementation target**, and Tier 4 is the v1.5 escape valve we design *for* but don't ship until needed. Tiers 0–2 don't show the card at all (or show a lightweight ack). The point of the ladder is: don't make users see a giant confirm card for `mark_as_read`, but DO make them work to confirm something irreversible.

**Critical:** Confirm-keybind is `Cmd/Ctrl+Enter`, **not** bare `Enter`. This is the single most important keyboard decision in the spec. Bare `Enter` is what users press by reflex when finishing typing in the agent input — if the input loses focus to the card, bare `Enter` would fire the confirm. Catastrophic. `Cmd/Ctrl+Enter` requires a deliberate two-finger gesture, matches "send" in many apps, and won't trigger by accident. (Slack's `Cmd+Enter` for sending in compose mode is the same instinct.)

### 3.4 Args display rules — get this right

Args are the second-most-important thing in the card after the title. Bad args display = invisible mistakes = silent destruction.

**Rules:**

- **Always show all args.** Even nulls. Even defaults. Hide nothing. If the macro takes 6 args and only 2 were provided, show all 6.
- **Source line is mandatory** for every non-default arg. Forms: `↳ from selected message`, `↳ from your phrase "alice"`, `↳ from current channel context`, `↳ inferred`, `↳ default`.
- **Long values get truncated with ellipsis + hover tooltip + click-to-expand.** `"Login button..."` with hover showing full. Don't make the card 800px tall because the user pasted a paragraph.
- **Sensitive-looking values get masked.** Two-axis detection — name OR value (Widow's review extended this in r2):
   - **Name-based:** arg name (case-insensitive) contains any of `password`, `token`, `secret`, `key`, `credential`, `auth`, `api_key`, `bearer`, `cookie`, `session`. Value renders as `••••••••` with a hover-to-reveal action (click on touch).
   - **Value-shape-based** (mask even if name is innocuous): JWT shape (three base64url chunks separated by dots, each ≥10 chars), high-entropy base64-ish strings of >40 chars, or known provider-key prefixes — `sk-…` (OpenAI), `xoxb-…` / `xoxp-…` (Slack), `ghp_…` / `gho_…` / `ghu_…` / `ghs_…` / `ghr_…` (GitHub), `ya29.…` (Google OAuth), `AKIA…` (AWS access key), `glpat-…` (GitLab PAT). The detection list lives in a single shared module so it can grow without scattering changes; defaults are conservative (false positives mask innocuous data, which is fine — user can reveal with one click).
   - **Mask styling:** value column shows `•••• (masked)` with an info `ⓘ` glyph. Hover/long-press tooltip: `Looked like a credential — click to reveal`. Reveal is per-arg, not per-card; revealing one secret doesn't reveal others.
   - **The reveal action is logged** in the audit transcript (Falcon G7 in UX terms — the audit trail entry includes "user revealed sensitive arg `X`" so a security-conscious user can review later). Don't do this silently. Concrete contract for Falcon Phase 5: log structured field `revealed_arg_name: String` (the arg name), NEVER `revealed_arg_value` (the value). Same heuristic feeds both the UX mask AND the audit-log args sanitizer — define the sensitivity classifier once, consume it in two places.
   - (Defense-in-depth note: this is UX hardening, not enforcement. Real protection is the server flagging args as `sensitive: true` in `CommandArgumentDto` (Nick's call) — when present, the frontend MUST mask regardless of name/value heuristic. Sensitive args should not be in Skill Macros to begin with, but the masks make accidental exposure far less likely.)
- **References (UserId, ChannelId, MessageId) resolve to human names.** `assignee: @alice (Alice Chen)`, not `assignee: 0192-blah-uuid`. Falcon's audit B.3 confirms typed arg kinds support this server-side; the frontend resolver is the missing piece.
- **A diff if the user edited.** If the user clicked `[Edit args]` and changed something, the changed value shows in `text-rim-warm` for one second after re-collapse, signalling "this isn't what the AI suggested."

### 3.5 The "Always allow" trap — DO NOT BUILD THIS in v1

There will be pressure to add `[ ] Always allow this Skill` checkbox on the confirmation card. Slack does it. Some IDEs do it.

**My recommendation: do not ship it in v1.** Reasons:

1. **It defeats the entire point of confirmation.** The user gives the agent a fast-pass, then the agent changes its behavior, then the fast-pass becomes a liability.
2. **It creates a hidden state surface.** "Wait, why did this just fire? Oh, I allowlisted it three weeks ago." Hidden state is bad for trust.
3. **The right power-user escape valve is already in the design**: Skill Macros that the user authored themselves have implicit trust (they know what's in them). For agent-routed AI calls to *other* skills, the friction is the feature.

If we MUST add it later (v2+), the pattern is: a `[ ] Don't ask for this Skill in this workspace for the next 24 hours` checkbox. Time-bounded. Workspace-scoped. Visible in Settings → AI Agent → Allowlist with a clear list and a one-click revoke. NOT permanent. NOT global.

### 3.5.1 The card MUST be unspoofable from LLM output (Widow M2)

The single most important architectural property of the card, in security terms: **the LLM transcript and the card live in the same DOM**. The transcript is sanitized markdown via DOMPurify (`MarkdownRenderer.tsx:59-62` — allowlist tags, no `style` attr, no event handlers, no inline data attrs beyond `data-user-id`). But sanitization stops HTML/JS injection; it does not stop *visual mimicry*. An LLM message that renders text styled like the card — same accent color words, fake `[Confirm and run]` buttons, same trust strip phrasing — could trick a user into clicking a malicious link that looks identical to the real confirm action. This is the prompt-injection-as-UI-spoofing class.

Three rules close the gap:

1. **Card is rendered in a distinct React component tree, NOT inside any sanitized markdown region.** `SkillSuggestionCard` is a sibling of message bubbles in the transcript flow (`AgentOverlay.tsx:304-327` extension), NOT a child of `MarkdownRenderer`. No path exists from LLM output → card-shaped DOM. The transcript renderer must NEVER pass card-rendering primitives through markdown.
2. **A `[RIM]` system badge** sits in the card's top-right corner (matches the existing `Bot` icon position at `AgentOverlay.tsx:280-281`). It uses an SVG glyph with the workspace-installation hash baked into its color (e.g., `currentColor` on a host-controlled CSS variable derived from a per-install secret salt) — a value the LLM cannot know and therefore cannot reproduce in markdown. macOS auth-dialog precedent: the OS owns a visual primitive the app cannot fake. Same idea here. Concretely: the badge is a `<span>` with `aria-label="RIM system surface"` rendered with `bg-rim-accent text-rim-void` for visual prominence + the hashed micro-glyph that varies per install.
3. **DOMPurify config audit.** `MarkdownRenderer.tsx:59-62` already does the right things — explicit `ALLOWED_TAGS` (no `script`/`iframe`/`object`), explicit `ALLOWED_ATTR` (no `style`, no `on*`, no `data-*` except `data-user-id`). For this feature we ADD the following constraints (engineering, not UX, but flagging here so the contract is explicit):
   - `ALLOWED_ATTR` must NOT add `style` (prevents CSS injection that re-skins LLM output to look like the card).
   - No `data-*` attributes beyond the existing `data-user-id` allowlist (prevents LLM-controlled data attrs from selecting fake card chrome).
   - No `target="_blank"` href without `rel="noopener noreferrer"` enforced.
   - The `class` attribute is allowed today; engineering should consider an allowlist of class values OR a CSS scope (`.prose-rim *` selector tree) such that `rim-accent`, `rim-danger`, `rim-panel-soft` and other "system" tokens cannot apply when the class is set from inside markdown. Cheapest fix: namespace card classes (`rim-system-*`) and have CSS only resolve those classes inside the system-component tree, not inside `.prose-rim`.

The combined effect: even if an LLM emits markdown that visually approximates a card, it can't reproduce the system badge, can't apply the `rim-system-*` styles, can't inject inline JS, can't add `target="_blank"` without secure rel, and the user has a reliable visual anchor (the badge) for "this is from RIM, not from the model."

**Two engineering-time contracts the implementer MUST honor for the badge to stay trustworthy** (Widow reinforcement on r2):

- **Badge re-derivation on install ID rotation.** If the Stronghold install ID rotates, is replaced (reinstall), or is otherwise refreshed, the badge MUST re-render with a fresh hash on the same lifecycle event. A stale badge is a *false* trust anchor — worse than no badge — because users habituate to a glyph that's no longer install-bound.
- **Install ID is NOT exposable through any agent-callable command, ever.** Not via `state.get`, not via `workspace.*` introspection, not via plugin RPC, not via any future "system info" tool. If an attacker (via prompt injection or compromised plugin) can read the install ID through an `ai_callable` command, they can derive the badge hash and the spoofing defense collapses to zero. This is a one-line check at the command-registry level — any tool that *might* expose the install ID gets `ai_callable: false` and a bright comment explaining why.

This is the inline-card-vs-floating-modal divergence biting back. Inline is still better UX (§2.3.1 reasoning stands), but it puts trust UI next to untrusted content. The badge + the namespacing + the existing sanitizer is the cheap, layered fix.

### 3.6 Touch / mouse parity

RIM is desktop-first but Tauri webview accepts touch on touchscreen Windows laptops. The card works fine for touch as-is — buttons are 32px+ tall (meets 44px touch target with 8px padding combined). Three things to verify:

- `[Confirm and run]` button must be at least 44px tall on touch (currently spec'd at `py-2` = ~32px; bump to `py-2.5` = ~40px and let padding push to 44px). Tony will object that this looks weird in keyboard-only contexts; it doesn't, because the button proportions are still within Linear/Raycast norms.
- The `↳` source line should NOT be touch-interactive. Source info is static.
- Hover-to-expand truncated values needs a long-press equivalent on touch. Tap = expand inline. Double-tap = collapse.

---

## 4. Visual language — Skill Macro vs Macro vs Command

Today, `CommandPalette.tsx:17-28` uses an icon per source kind: `Terminal` (built-in), `Plug` (plugin), `User` (user macro), `Zap` (integration). Solid foundation. Two additions:

### 4.1 The "AI-callable" badge

For any command (built-in, plugin, user macro) where `ai_callable: true`, add a small **`✦`** glyph (sparkle) badge next to the source icon in the palette row. Same pattern as the `dangerous` chip but smaller and on the left. Example row layout:

```
[Terminal][✦]  Send message              chat · ⌘+Enter
[User][✦]      File YouTrack ticket      user · — 
[Plug]         List YouTrack tickets     youtrack · — 
```

The `✦` says "the agent can use this." Hovering shows tooltip `AI-callable Skill — also available in the agent overlay.`. Clicking the `✦` (with mouse) jumps to the agent overlay with this command pre-filled as a `/skill` reference (defer the slash-pre-fill to v2).

**Why this badge in the palette and not just in the agent?** Because users who learn the palette first should *discover* that the agent can call these too. Cross-surface advertising.

### 4.2 The "Skill Macro" identity (vs regular Macro)

Within the user's own commands list (Settings → AI Agent → Skill Macros), differentiate:

- **Macro** (no NL description, no `ai_callable`): `User` icon, no badge. "I made this for my keybind."
- **Skill Macro** (has NL description + `ai_callable: true`): `User` icon + `✦` badge + a one-line NL description preview under the title. "I made this for me AND the agent."

In the agent's transcript (the `SkillSuggestionCard`), the source line says `Skill Macro` (or `Built-in Skill`, `Plugin Skill`) — never just `Macro`. Within the agent surface, *everything is a Skill*; the macro vs built-in distinction only matters in the palette/settings context.

### 4.3 Capability surface visibility

Per Falcon's audit C and §3.1, the confirmation card shows `Capabilities used: plugin.youtrack.write`. In Settings → AI Agent → Skill Macros, each Skill row shows a tiny capabilities chip group (e.g., `[chat.write] [plugin.youtrack.write]`). This is mostly for power users / admins; render small (`text-[10px] text-rim-text-faint`), don't push other content out of view. Skip it on the palette row — too noisy.

---

## 5. Accessibility

RIM is keyboard-first. Accessibility is not a separate concern; it IS the primary design.

### 5.1 Keyboard map

The full keyboard surface for the agent + Skill flow. Memorize this.

| Context | Key | Action |
|---|---|---|
| Anywhere | `Ctrl+Shift+A` | Open agent overlay (existing) |
| Agent input (no pending card) | `Enter` | Submit prompt (existing) |
| Agent input (pending SkillSuggestionCard, focus in input) | `Enter` (with non-empty input) | **Submit a NEW prompt — supersedes the pending card.** First card collapses to `Cancelled (superseded by new prompt).`, second card appears below per §6.5 supersession. (Widow L4: be explicit so habituated users don't get confused state.) |
| Agent input (pending SkillSuggestionCard, focus in input) | `Enter` (with empty input) | No-op. Does NOT confirm. (Confirm always requires `Cmd/Ctrl+Enter` AND focus-aware target — never bare Enter from any context.) |
| Agent input (pending SkillSuggestionCard, focus in input) | `Cmd/Ctrl+Enter` | **Confirm and run** the most recent pending card (shortcut so user doesn't have to Tab into the card first). |
| Agent input | `Esc` (no pending card) | Close overlay (existing) |
| Agent input | `Esc` (with pending card) | **Cancel the most recent pending card; do NOT close overlay.** Second `Esc` closes overlay. (Two-step matches NAVIGATE/COMPOSE Esc-as-back-out semantics.) |
| Agent transcript with pending SkillSuggestionCard, focus IN card | `Cmd/Ctrl+Enter` | **Confirm and run** the Skill |
| Same | `Esc` | **Cancel** the suggestion (does NOT close overlay) |
| Same | `e` | Enter Edit Args mode |
| Same | `Tab` | Move focus to the Cancel/Edit/Confirm button group (rotates through) |
| Skill in Edit Args mode | `Tab` / `Shift+Tab` | Move between arg fields |
| Same | `Cmd/Ctrl+Enter` | Save edits + re-confirm |
| Same | `Esc` | Discard edits, return to read-only card state (a SECOND `Esc` cancels the suggestion) |
| Palette | `Tab` (defer to v2) | Filter chips |
| Palette row with `dangerous: true` | `Enter` | Opens `ConfirmCommandModal` (the centered shared modal) |
| `ConfirmCommandModal` | `Cmd/Ctrl+Enter` | Confirm |
| Same | `Esc` | Cancel (returns to palette with same selection) |

**The double-Esc pattern in Edit Args mode** matches how vim users think about Esc: first Esc exits insert mode (here: edit-args), second Esc exits the surface (here: cancels suggestion). This aligns with the saved memory note about NAVIGATE/COMPOSE — RIM's keyboard model treats Esc as "back out one layer," and we should be consistent.

### 5.2 Focus management

When the SkillSuggestionCard appears in the transcript:

- **Focus stays in the agent input by default** (so the user can keep typing if they want to ignore the suggestion, e.g., refine their prompt). The card is NOT auto-focused.
- A subtle visual highlight on the card (1px `border-rim-accent/40` pulse for 600ms via `focus-pulse` keyframe at `globals.css:74-77`) signals "new card." NOT a focus steal.
- Pressing `Cmd/Ctrl+Enter` from the input directly confirms the most recent pending card.
- Pressing `Tab` from the input moves focus into the most recent pending card's button group (Confirm focused, since it's the rightmost / primary).
- Multiple pending cards (e.g., agent proposed a multi-step plan): `Tab` cycles between cards; `Shift+Tab` reverses; within a card, `Tab` cycles the buttons.

### 5.3 Screen reader

- Card uses `role="region"` with `aria-labelledby` pointing to the title element.
- Title text is `<h3>` semantically (within the transcript's `<section>`); SR announces "Create YouTrack ticket, suggestion from RIM Agent."
- Each arg row uses a `<dl>` (definition list) — `<dt>` for the arg name, `<dd>` for the value, `<dd>` for the source line. SR reads naturally: "title: Login button broken on mobile, from selected message."
- The dangerous badge gets `aria-label="Marked dangerous: this action has external side effects"` — verbose but unambiguous.
- The capability chip gets `aria-label="Requires a permission your account holds"` for the success path. For the denied path, `aria-label="Permission denied — admin can grant access"`. Per §6.5 (Widow): we do not read out the capability ID to screen reader users either; same enumeration concern applies via assistive tech.
- When the card resolves: a polite `aria-live="polite"` announcement: "Skill Create YouTrack ticket completed. Created ticket FOO-123." Failure case: assertive: `aria-live="assertive"`.

### 5.4 Disclaimer + capability priming

Today's `AgentDisclaimerDialog.tsx` covers data-sharing-with-third-party. The new flow needs ONE additional first-run prompt: **"This agent can take actions on your behalf — including dangerous ones. You'll be asked to confirm each one."** Same dialog pattern, fires once per install. Don't fold it into the existing disclaimer; that one is about data egress. This one is about action authority. Two separate trust questions, two separate consents.

---

## 6. Edge Cases (the boring details that matter)

### 6.1 Wrong args — user fix journey

**Scenario:** AI extracted `assignee: @alice` but user meant `@alice-smith` (two Alices in workspace).

**Flow:**
1. User reads the card, spots the wrong assignee value.
2. Presses `e` (or clicks `[Edit args]`).
3. Card body morphs to a form: each arg row becomes `<label>` + `<input>` (or typed picker for UserId/ChannelId). Focus lands on the FIRST mis-extracted arg if confidence < 100% on any (heuristic, defer to v2 — for v1, focus on the first arg). If all args looked confident, focus the first arg field.
4. Type the correction. `Tab` to move on. `Cmd/Ctrl+Enter` to re-confirm.
5. The card collapses back to read-only with the new value highlighted in `text-rim-warm` for ~1s.

**Important:** Editing args does NOT re-prompt the LLM. The user's edit is taken as ground truth, the same `tool_use` call is replayed with new args. (No "AI is re-thinking based on your correction" round-trip — slow, expensive, uncertain.) If the user wants the AI to re-route entirely, they cancel and re-prompt.

### 6.2 Missing args — graceful prompt

**Scenario:** Skill Macro requires `priority` (no default), AI couldn't extract it from "create a ticket for this."

**Flow:**
1. The card renders normally, but the `priority` row reads:
   ```
   priority ........ ⚠ required, not provided
                    ↳ pick a value to continue
   ```
2. The `[Confirm and run]` button is **disabled** with a tooltip: "Fill in the missing args to continue."
3. Pressing `e` (or clicking the missing-arg row directly) jumps straight into Edit Args mode with focus on the missing field.
4. Once filled, button enables; `Cmd/Ctrl+Enter` confirms.

**Don't auto-prompt the LLM for the missing arg.** That creates a chatty, unpredictable surface. The user fixing it is faster and more accurate.

### 6.3 Long-running Skill — progress

For Skills that may take >2s (network calls, multi-step macros):

- Card collapses to a single-line running state with a determinate progress if we can compute it (multi-step macros: `Step 2 of 3: youtrack.create_ticket…`), indeterminate spinner otherwise.
- Add a `[Cancel]` action on the running card. (Today, `agentEngine.ts` supports `AbortController` per `AgentOverlay.tsx:168-169`; reuse the same signal for tool calls.)
- After 10s with no progress, change the message to `Still working…` with a subtle `text-rim-text-faint` styling — signals "yes, we know it's slow."
- After 30s, add a `[See server status]` link if we have a status endpoint (we don't yet; deferred). Otherwise just keep showing the spinner; user can Cancel.

### 6.4 Skill failure mid-execution

**Scenario:** Multi-step macro, step 2 of 3 fails (e.g., YouTrack returned 502).

**Card body becomes:**

```
✗ Step 2 of 3 failed: youtrack.create_ticket
   {error message from server, single line, max 200 chars}

   Step 1 ✓ Searched messages (4 found)
   Step 2 ✗ youtrack.create_ticket — 502 Bad Gateway
   Step 3 — Did not run

[Retry]  [Edit args]  [Show details]              [Dismiss]
```

- `[Retry]` re-runs from the failing step (NOT from step 1 — that wastes work and may cause duplicates; if the user wants to start over, that's `[Edit args]` → confirm).
- `[Show details]` expands an inline `<details>`-style block with full error payload (stack trace if any, request/response if logged). Reuses the `prose-rim` markdown styling at `globals.css:88-181` for error formatting consistency.
- `[Dismiss]` collapses the card to a one-line failed state in the transcript history.
- Failure is announced via `aria-live="assertive"`.

### 6.5 Other edges I want to flag

| Edge | Behavior |
|---|---|
| User cancels mid-execution | Backend should mark the in-flight step as cancelled in audit log. Card body: `Cancelled at step 2 of 3.` |
| Network drops during streaming | Card stays in "running" state indefinitely; surface the underlying connection error after 30s timeout (matches existing pattern). |
| Capability denied (G2 fix lands later) | Card body: `✗ Permission denied (an admin can grant access).` With `[Request access from admin]` link if we have admin DM channel. **Do NOT name the capability in the user-visible message** (Widow's review — naming `plugin.youtrack.write` etc. leaks workspace install schema and creates an enumeration surface for an attacker probing actions to learn which plugins/integrations are available). The exact missing capability MAY appear in the developer console / debug surface for support purposes, gated behind a "Show technical details" disclosure that defaults closed and is OFF in non-debug builds. The `[Request access from admin]` link can carry the capability ID in its target URL/payload so admins see it without exposing it in the user surface. |
| User has multiple workspaces, agent picks wrong one | The card's trust strip should show **workspace name** as a chip (e.g., `· in: acme-engineering`). Cheap, prevents catastrophic misfires. |
| Plugin uninstalled while card is pending | On confirm, surface `✗ Plugin "youtrack" is no longer installed.` Reload commands automatically; suggest the user re-issue the prompt. |
| Macro modified while card is pending (user edited it in another tab) | On confirm, surface `⚠ Skill Macro changed since suggested. Cancelled — please re-issue.` Don't silently run the new version. |
| Skill matched but user edits prompt + resubmits before confirming | First card collapses to `Cancelled (superseded by new prompt).` Second card appears below. |
| Multiple Skills proposed in one turn (LLM uses parallel tool calls) | Multiple cards stack vertically in the transcript, each with independent confirm/cancel. `[Confirm all]` supercard appears at the top IF all are Tier 2 or below. NEVER for Tier 3+. |

---

## 7. Intent Matching Feedback

When the agent decides which Skill to call, three confidence states:

### 7.1 High confidence — single match
- Single SkillSuggestionCard. Shown as designed in §2.3.

### 7.2 Low confidence — disambiguation
- A `SkillDisambiguationCard` renders instead. Same trust strip, but with multiple options:

```
┌─ I'm not sure what you mean — pick one: ──────────────┐
│  ⚡  Create YouTrack ticket                            │
│      Skill Macro · Plugin: YouTrack                   │
│      "make a youtrack ticket for this"                │
│                                                       │
│  ⚡  Create Linear issue                               │
│      Skill Macro · Plugin: Linear                     │
│      "create a linear issue for this"                 │
│                                                       │
│  ⚡  Send message                                      │
│      Built-in · #engineering                          │
│      Just chat about the bug, don't file              │
│                                                       │
│  [Cancel]  [None of these — keep talking]    [↑↓] [⏎] │
└───────────────────────────────────────────────────────┘
```

- Up to **3 options**. More than 3 = the AI is guessing badly; fall through to "no match."
- Each option highlights with `↑↓`. `Enter` picks the highlighted one and immediately renders its SkillSuggestionCard (chained, so the user still confirms args).
- **`[None of these — keep talking]` is critical.** It tells the agent "I rejected the matches; ask me what I meant" and lets the user free-type. The agent should respond with a clarifying question, not silently fail.

### 7.3 No match — fall-through
- Agent responds in the transcript: `I couldn't match that to a Skill. Want me to:` followed by inline action buttons:
  - `[Try as a chat message]` — agent treats the prompt as a vanilla LLM query, no tool use.
  - `[Search Skills]` — opens the palette filtered to AI Skills with the prompt as the search query.
  - `[Author a new Skill Macro]` — opens Settings → Skill Macros editor with the prompt pre-filled into the NL description field. (Closes the loop nicely: failed match becomes future success.)

### 7.4 Confidence calibration UI (optional, defer to v2)
- For users who want it, a `[?]` icon on the trust strip showing matching confidence (e.g., 0.87) and which sample trigger drove the match. Useful for power users and Skill Macro authors debugging their NL descriptions. Don't show by default.

### 7.5 Don't auto-execute, ever
The single most important rule of intent matching: **the agent never executes a Skill without an explicit confirmation gesture.** Even if confidence is 1.0. Even if the user has confirmed similar Skills 100 times. Even if it's Tier 0 (read-only) — Tier 0 doesn't need a card, but it still needs to be VISIBLE (logged in transcript) so the user can audit. Tier 2+ ALWAYS shows a card.

---

## 8. Anti-patterns (the things we MUST NOT do)

I'm putting this section because if Kuba reads only one section, this is the one that prevents disasters. Each is something I've seen in shipped products that nuked trust.

1. **Bare `Enter` confirms a dangerous action.** Already covered. Don't do it. Slack's "send" being `Enter` works because messages are recoverable; Skill Macros aren't.
2. **`window.confirm()` for anything.** Today's agent uses it (Falcon A.6, `agentEngine.ts:88-269`). It must die. Native confirm is unstyled, unfocusable trap, no args echo, no source attribution, no audit. The shared SkillSuggestionCard / ConfirmCommandModal replaces it.
3. **Hiding what args were extracted.** "I'll create a ticket" with no echo of title/assignee/priority is a black box. Echo every arg. Source-line every arg.
4. **Silent execution on "high confidence."** Confidence isn't a permission. The user's confirmation is the permission.
5. **A persistent `Always allow this` checkbox.** §3.5. Just don't.
6. **Modal trap.** The card must be cancelable from anywhere (`Esc` from input, `Esc` from card, `Esc` from edit-args). No state where the user is stuck waiting.
7. **Different visual treatment for the same action across surfaces.** If `youtrack.create_ticket` is dangerous in the palette, it's dangerous in the agent. Same red chip, same wording, same confirm gesture.
8. **Confirmation for read-only actions.** `list_channels` should not gate behind a card. Erodes trust by crying wolf.
9. **Localizing args to non-canonical forms before showing.** If the LLM passed `priority: "high"` (lowercase), don't render `priority: "High"` on the card unless that's literally what we'll send to the backend. Show what's being sent. Always.
10. **A "details" disclosure that hides important info.** If something is important enough to know before confirming (capabilities, dangerous flag, all args), it must be visible by default — not behind a `[show details]` toggle. The card should be a couple paragraphs tall, not 8 lines with a disclosure.
11. **Animating focus into the card.** Focus steal kills keyboard users. Card appears, focus stays in input. User decides whether to engage.
12. **Not showing the workspace.** §6.5. A multi-workspace user must see which workspace this Skill will run against on the card. Cheap, prevents disasters.
13. **Using the agent transcript itself for the confirmation question.** Some chat-based agents render the question as an assistant message ("Should I create the ticket? Y/N"). Bad — it puts the question in the transcript stream where it can be lost as the user types more, and there's no structured action button. The card pattern is clearly a UI element distinct from chat content.
14. **Error messages that don't say what failed.** `Failed to execute tool` is what `agentEngine.ts` does today (Falcon A.2). Replace with: which step, which command, what underlying error (but NOT capability IDs per §6.5).
15. **(r2, Widow reinforcement) Any agent-callable command MUST NOT expose the Stronghold install ID** (or any value used to derive the §3.5.1 system badge hash). Not `state.get`, not `workspace.*` introspection, not a future `system.info` tool, not a plugin capability. If an attacker reads the install ID through an `ai_callable: true` command, they derive the badge hash and the spoofing defense collapses. Rule: every `ai_callable: true` command gets a one-line sensitivity check at registry-time confirming it does not leak install ID or badge-derivation inputs. Bright comment on any command that even *touches* that surface.

---

## 9. Reference comparison

I went through three competitors. Each got something right; each got something wrong. We can steal selectively.

### 9.1 Slack AI Skills (the closest competitor)

**What they do well:**
- Skills are scoped to channels — clear surface boundaries.
- "Try a Skill" prompts in onboarding — discovery via demo.
- Clear separation of "ask AI" vs "use a Skill" buttons in the composer — the user knows when they're about to invoke an action.

**What they do poorly:**
- Args extraction is INVISIBLE. The user clicks a Skill button, it just runs. No "here's what I extracted." For Slack's read-mostly Skills (summarize a channel), this is fine; for action-taking Skills it would be terrifying.
- Confirmation is per-message-ephemeral (a Slack message that the AI sends to confirm). No structured card UI; just text.
- No keyboard story. Mouse-only feels right for Slack's persona, wrong for RIM's.

**What we steal:** Onboarding demo of a Skill. "Try a Skill" surfaced in the empty agent overlay state.

**What we DON'T steal:** Their args-as-magic model. Always echo args.

### 9.2 Raycast AI Commands

**What they do well:**
- AI Commands are first-class palette entries — one taxonomy, not two. Matches what we want via the `✦` badge.
- Args picking happens in the palette UI itself with typed inputs — no separate modal layer.
- Keyboard-first end-to-end. `Cmd+Enter` is the universal "confirm and run" in Raycast. **We adopt that exact convention.**
- Streaming output to the palette while AI works — feels alive.

**What they do poorly:**
- No built-in confirmation for dangerous actions (because Raycast AI Commands today don't really do dangerous stuff — they're mostly read/transform).
- Args picker doesn't show "where I got this from" — the trust strip / source-line pattern is ours to invent.

**What we steal:** `Cmd/Ctrl+Enter` confirm. Inline arg-picking. Streaming feedback.

### 9.3 Notion AI Agents

**What they do well:**
- Multi-step plan visualization — the agent shows you "I'm going to do A, then B, then C" before running. Useful for transparency.
- "Generate" vs "Apply" split — drafts a result, lets you review, then commits. Two-phase commit at the UI layer.

**What they do poorly:**
- Plans are presented as a single monolith — you can't approve A, deny B, approve C. You take the whole plan or nothing.
- The "Apply" button is sometimes too easy to hit (visual prominence inconsistent across page contexts).

**What we steal:** Multi-step plan visualization (one card per planned step, per §2.3 and §6.5 multiple-cards-stacked). Crucially, **per-step approval**, not whole-plan approval.

**What we DON'T steal:** Notion's "click here, magic happens" simplicity. Power users want to see the seams.

### 9.4 Things none of them do that we should

- **Source-line attribution** for every arg. I haven't seen this in production AI agents anywhere. It's our differentiator. It's the single thing that makes the user trust the AI.
- **Severity-tiered confirmation** (§3.3). Most agents have one confirm bar. We have five tiers. Maps to RIM's power-user persona.
- **Inline cards in the agent transcript with the same data shape as the palette modal.** Single contract, two surfaces. Falcon E.3 unifies this on the backend; we unify it in the data layer of the frontend.

---

## 10. What this spec deliberately does NOT cover

To keep the morning briefing tight and the v1 scope sane:

- **Skill marketplace / installable third-party Skills.** Defer. `workspace.open_marketplace` exists as a hook (Falcon B.6) but the marketplace UX is its own design.
- **Slash-commands inside the agent input** (`/youtrack`). Defer to v2; nice convenience, not a primary surface.
- **Voice intent input.** Out of scope.
- **Skill chaining language** (the agent constructing pipelines of skills). The backend already supports pipes (`CommandPalette.tsx:154-203`); but exposing pipe-construction as an agent capability is a v2+ design question.
- **Skill versioning / undo.** Some Skills should produce undo entries (e.g., `delete_message`). This is a backend question first; UX surface for "Undo last Skill" is straightforward (toast with undo CTA) but depends on backend audit support.
- **Per-Skill rate limits / quotas.** Black Widow's territory.
- **Skill sharing across users in a workspace.** Implied by `MacroDef.server_id` (Falcon C.2) but the share UI is its own design.

---

## 11. Open questions for Kuba (morning)

Status updates in r2: Tony confirmed agreement on Q1 and Q2 in his briefing message; Widow blessed Q2 explicitly. These are still listed for Kuba's final sign-off but now have the team-lead lean attached.

1. **Inline cards vs centered modal in the agent surface** (§2.3.1). My recommendation: inline. Tony agrees. Widow's M2 (§3.5.1) accepted the inline choice contingent on the unspoofable system-badge, which is now in the spec. **Lean: inline.** Awaiting Kuba.
2. **`Cmd/Ctrl+Enter` vs `Enter` for confirm in Tier 2 (Standard)** (§3.3). I'm proposing `Cmd/Ctrl+Enter` even for Tier 2 to make confirm-keybind consistent across tiers. Alternative: bare `Enter` for Tier 2 and Tier 3+ requires `Cmd/Ctrl+Enter`. The cost of that alternative is a foot-gun — users habituated to bare `Enter` for Tier 2 will hit it on Tier 3 by mistake. Recommendation: **uniform `Cmd/Ctrl+Enter` from Tier 2 up.** Tony agrees. Widow blessed.
3. **Naming**: "Skill" vs "AI-callable command" vs "Macro." I went with "Skill Macro" (the AI-routable subset) and "Skill" (the broader umbrella). Tony will probably want to weigh in. Don't think too hard about naming until we ship; rename is cheap.
4. **Tier 4 — Catastrophic.** Should we ship the type-to-confirm pattern in v1 even though no current command warrants it? My take: design for it, don't build the field until there's a Tier 4 command. Adds complexity without proven value. Tony agrees with defer.
5. **The first-run "agent can take actions" disclaimer** (§5.4). Adds one friction step on first agent open. Worth it for the trust posture; but if we're optimizing for time-to-value, we could fold it into the existing data-sharing disclaimer. Recommendation: separate, because they're different consents.
6. **(NEW in r2) Sensitive-arg masking heuristic — false positive tolerance.** §3.4 now masks aggressively (name patterns + value-shape patterns + provider key prefixes). False positives = innocuous values get a one-click reveal action. False negatives = real secrets render in plaintext. Recommendation: **bias to false positives, expose a "show all values" override on the card for the 1% case where the user explicitly wants everything plaintext (e.g., they're authoring a Skill Macro and want to verify the args picker output).**

---

## 12. Component sketch — what gets built (UX boundary, not engineering boundary)

For Tony's planning, here's the surface inventory. Engineering may collapse or split these — this is the user-facing decomposition.

| New / Extend | Component (proposed) | Lives next to | Purpose |
|---|---|---|---|
| **NEW** | `SkillSuggestionCard.tsx` | `agent/components/` | The inline card in the agent transcript |
| **NEW** | `SkillDisambiguationCard.tsx` | `agent/components/` | The "pick one of these" card |
| **NEW** | `ConfirmCommandModal.tsx` | `shared/ui/` | Centered modal for palette-path dangerous commands; shares data shape with SkillSuggestionCard |
| **NEW** | `ArgSourceLine.tsx` | `agent/components/` | Tiny "↳ from selected message" subline; reused inside both card and modal |
| **NEW** | `SkillMacroSettings.tsx` | `commands/components/` | Settings tab that extends `UserCommandSettings.tsx` for AI-routable macros |
| **NEW** | `AgentActionDisclaimerDialog.tsx` | `agent/components/` | First-run disclaimer for "agent can act" (separate from data-sharing one) |
| **EXTEND** | `CommandPalette.tsx:307-317` | — | Add filter chips above the input; add `✦` badge to AI-callable rows |
| **EXTEND** | `AgentOverlay.tsx:304-327` | — | Render SkillSuggestionCards in the transcript flow |
| **EXTEND** | `AgentOverlay.tsx:228-236` | — | Show new disclaimer alongside existing one |
| **REPLACE** | `agentEngine.ts` confirm path (per Falcon A.6) | — | Replace `window.confirm()` with the SkillSuggestionCard rendering |

That's it. ~6 new components, 3 extensions, 1 replacement. Tight scope.

---

## 13. Sanity check — does this fit RIM?

Before signing off, the keyboard-first, power-user, desktop-first lens:

- **Keyboard-first:** Every flow operable via keyboard. Confirm is `Cmd/Ctrl+Enter`. Cancel is `Esc`. Edit is `e`. Pick from disambig is `↑↓ Enter`. Yes.
- **Power user:** Args are visible, sourced, editable. Capabilities visible. Severity tiers exposed. Skill Macro authoring is two new fields. Yes.
- **Desktop-first:** Inline cards work great in the desktop overlay. Touch parity is graceful but not optimized. Yes.
- **Inspirations:** Linear's keyboard ergonomics (`Cmd+K`-ish palette), Raycast's `Cmd+Enter` and inline arg picking, Superhuman's discipline about confirm vs send, Obsidian's command palette. We're fitting that lineage.
- **Speed:** Card render is local React (TanStack Query hits already-cached commands). Confirm gesture → backend mutation is one round-trip. < 100ms perceived for the card surface. Tool execution is whatever the backend / plugin takes; that's the agent's existing behavior.

Looks like RIM. Signed, Scott.

---

## 14. Revision history

### r2 — 2026-04-22 (post Black Widow security review)

Black Widow's review of the spec (`rim-server/docs/security/ai-reframe-review-2026-04-22.md`) blessed the overall design but flagged three UX-side fixes plus one keyboard amplification. All four are now in the spec:

| Widow finding | Severity | Where it lives in r2 | What changed |
|---|---|---|---|
| **M2 — Confirmation card MUST be unspoofable from LLM output** | Medium | New §3.5.1 | Added explicit constraints: card rendered as a sibling of message bubbles (not inside `MarkdownRenderer`), unforgeable system badge with per-install hashed glyph, DOMPurify config audit (the `MarkdownRenderer.tsx:59-62` allowlist is the right shape; r2 spells out additional `style`/`data-*` constraints to keep). Closes the "LLM emits markdown that mimics the card" attack surface. |
| **§3.4 sensitive-arg masking — extend the regex** | Medium | §3.4 (rewritten bullet) | Two-axis detection: name patterns now include `credential\|auth\|api_key\|bearer\|cookie\|session`; value-shape detection added for JWT shape, high-entropy base64, and provider-key prefixes (`sk-`, `xoxb-`, `ghp_`, `ya29.`, `AKIA`, `glpat-`). Reveal action is per-arg and audited. Server-side `sensitive: true` flag (Nick's call) takes precedence when present. |
| **§6.5 capability-denied surface — must not name the capability** | Medium | §6.5 (rewritten row) + §5.3 (SR aria-label rewritten) | User-visible message no longer leaks the capability ID (enumeration surface). The `[Request access from admin]` link can carry it for admins; debug surface gated behind a "Show technical details" disclosure that defaults closed. Screen reader announcements are similarly scrubbed. |
| **L4 — bare-Enter handling with pending card MUST be explicit** | Low | §5.1 (5 new rows) | Keyboard map now spells out the four `Enter`/`Cmd-Enter`/`Esc` combinations across "input focused" × "pending card" × "card focused" states. No-op when input is empty + card is pending. Bare `Enter` with non-empty input always supersedes (matches §6.5). |

**Things I held the line on (Widow agreed):**

- §3.5 — no "Always allow" in v1. Widow flagged Fury's competing "Confirm + remember" button as contradicting our spec, recommended Fury drop it. r2 spec wins.
- §3.3 — `Cmd/Ctrl+Enter` from Tier 2 up. Widow blessed.
- §8 anti-patterns — all 14 stand. Widow specifically called out §8.4 (no silent execution on high confidence) and §8.13 (no chat-form confirmation question).
- §2.3.1 inline-vs-modal — inline survived, contingent on §3.5.1 spoofing defense.

**Things added without prompting** (small clarifications surfaced while editing):

- §11 Q6 added: false-positive vs false-negative tradeoff for sensitive-arg masking (lean toward FP with a card-level "show all values" override).
- §11 — added "lean: X" markers to questions where Tony or Widow already weighed in, so Kuba sees current consensus, not just open-ended choices.

**Cross-team flags for security review (and Widow has these already):**

- Real masking enforcement requires a server-side `sensitive: true` flag on `CommandArgumentDto` (§3.4 closing note). UX heuristic alone is defense-in-depth, not enforcement. Kicking back to Nick.
- The system-badge per-install hash glyph (§3.5.1) needs an actual implementation choice — engineering call. Could be derived from the Stronghold installation ID (per `keyStore.ts` per-install password pattern from Falcon A.3).
- Audit-log of "user revealed sensitive arg" entries (§3.4) requires a backend audit-log surface. Falcon G7 fix territory.

### r2.1 — 2026-04-22 (Widow's bless-and-reinforce pass)

Widow read r2 end-to-end, blessed all four fixes, and sent three engineering-time reinforcements that are now in the spec:

| Widow reinforcement | Where it landed |
|---|---|
| **Badge re-derivation on Stronghold install ID rotation** — stale badge = false trust anchor | §3.5.1 (new "Two engineering-time contracts" block) |
| **Install ID must NOT be exposed through any `ai_callable` command** — spoofing defense depends on it | §3.5.1 + new anti-pattern §8.15 |
| **Audit-log structured field `revealed_arg_name` (NOT value)** for the sensitive-arg reveal event — sensitivity classifier defined once, consumed by UX mask AND audit sanitizer | §3.4 (appended contract line) |

No functional design changes — these are hard contracts the implementer needs to honor for the r2 defenses to remain sound. Called out explicitly so engineering can't miss them at Phase 4/5 time.

### r1 — 2026-04-22

Initial spec, written before Widow's review. Core structure stands; r2 patches the spoofing, leak, and masking-extension holes she found.

---

*"Look, I went from prison to Avenger to UX architect. Life is weird. But I know one thing: a button you can't trust is a button people stop pressing. Don't ship a button people stop pressing." — Ant-Man, 2026-04-22*
