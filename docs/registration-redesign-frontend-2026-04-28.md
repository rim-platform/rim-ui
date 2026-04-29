# Registration Redesign — Frontend Specification

**Author:** Vision (Frontend / UX Architect)
**Date:** 2026-04-28
**Status:** r2 — contract reconciled with iron-man's backend spec; product decisions locked by Jakub
**Changelog (r2):** Renamed to `registrationMode` enum (was `openRegistration` boolean) and `signupWithInvite` mutation (was `acceptInvite`). Collapsed invite errors from 3 codes to 2 (`INVALID_TOKEN`, `EXPIRED_TOKEN`). Instance-invite admin UI dropped (CLI-only this phase). Empty-state copy and optional `displayName` locked.
**Scope:** UI/UX + routing + state for the multi-tenant invite-only registration model. No backend implementation.
**Drives:** spider-man's implementation pass.
**Supersedes:** the legacy `AuthGate` "Login | Bootstrap" tabbed surface and the speculative TODO in `JoinPage.tsx::JoinWithRegistration`.

---

## 0. TL;DR

Three things change visibly:

1. **`/login` becomes login-only.** No bootstrap tab, no signup form. A small line of copy points users at "ask your admin for an invite." The `AuthGate` component is split: `LoginForm` survives at `/login`, `BootstrapForm` is deleted from the UI (CLI takes over bootstrap and emits a `/join/:token` URL).
2. **`/join/:token` does the actual account creation.** Same route handles workspace invites and instance invites — backend distinguishes; frontend renders a token-aware copy variant.
3. **An empty-workspace state** lands users who finished an instance-invite signup. Reuses `CreateWorkspaceDialog`. Implemented as a state branch on `<AppShell>` (the existing `WorkspaceSelector` already has the empty case at line 33-42 — we promote it from a passive message to an actionable surface).

A fourth conditional: when the server reports `registrationMode === "OPEN"`, a "Create account" link appears on `/login` pointing to `/join` (no token). In `INVITE_ONLY` mode, `/join` 404s.

The `registrationMode` enum is exposed via a new top-level `registrationMode` GraphQL query (originally specced as `serverConfig.registrationMode`; see §8.2 for the supersedure), fetched once at app boot, cached in TanStack Query, surfaced via a thin hook (`useServerConfig`) that wraps the scalar in a forward-compatible `ServerConfig` shape on the JS side. The hook keeps its broad name on purpose — server config will likely grow other fields (password policy, branding, feature flags); a narrower `useRegistrationMode` would force a rename later. It does **not** become a runtime capability — runtime capabilities are device/platform facts (Tauri vs web), not server policy. Mixing them muddies the abstraction.

---

## 1. Glossary

| Term | Meaning |
|---|---|
| **Workspace invite** | An invite token bound to a specific workspace (server). Backend's existing `JoinServerByInvite` mutation. After acceptance, the user is a member of that workspace. |
| **Instance invite** | An invite token NOT bound to a workspace — admits the user to the RIM instance with zero workspace memberships. Used for: bootstrap flow, instance-admin onboarding, "create your own workspace" handoffs. |
| **Token type** | `WORKSPACE`, `INSTANCE`, or `BOOTSTRAP` — discriminator returned by the backend's token preview query. Frontend reads, never writes. (Originally specced as `WORKSPACE | INSTANCE`; backend split out `BOOTSTRAP` as its own variant — see §8.2.) |
| **`registrationMode`** | Server-side enum (`OPEN | INVITE_ONLY`). When `OPEN`, `/join` (no token) accepts registrations; rate-limited by backend. |
| **Empty-workspace state** | The UI shown when the user has a session but `myServers().length === 0`. Promotes `CreateWorkspaceDialog` to the foreground. |
| **Bootstrap user** | The first instance owner. Receives a one-time signed link from the operator's CLI. The backend now distinguishes bootstrap tokens (`tokenType === BOOTSTRAP`) from instance invites (`tokenType === INSTANCE`); the FE shares the same `JoinForm` UI copy across both ("Create your RIM account") and only branches on the mutation input field — see §8.2. |

---

## 2. Routing changes

### 2.1 `AppRouter.tsx` diff (current state vs. target)

Current `AppRouter.tsx`:

```
/join/:token         → JoinPage
/forgot-password     → ForgotPasswordPage
/reset-password/:token → ResetPasswordPage
*                    → AppShell  (which gates on session via AuthGate)
```

Target `AppRouter.tsx`:

```
/login               → LoginPage             (NEW — extracted from AuthGate.LoginForm)
/join/:token         → JoinPage              (REWRITTEN — see §4)
/join                → OpenJoinPage          (NEW — only renders if registrationMode === OPEN; else 404)
/forgot-password     → ForgotPasswordPage    (unchanged)
/reset-password/:token → ResetPasswordPage   (unchanged)
*                    → AppShell              (unchanged — but AuthGate behavior changes)
```

### 2.2 `AppShell` redirect behavior

Today `AppShell` renders `<AuthGate>` inline when there is no session. After this change, `AppShell` redirects to `/login` instead. Reasoning:

- `/login` becomes a real, addressable URL — bookmarkable, deep-linkable, screenshot-friendly.
- A session-less user landing on `/messages/foo` should be sent to `/login?return_to=/messages/foo` and bounced back after auth. Today the inline `AuthGate` strips this context.
- Web build compatibility: deep-link return-to is a feature web users will expect (desktop is more forgiving). Designing it in now is cheaper than retrofitting.

`AuthGate` becomes a thin redirect shim (`useEffect → navigate("/login", { state: { returnTo } })`) and is eventually deleted once `AppShell`'s gate inlines the redirect. Spider-man should land both in the same PR — leaving a vestigial `AuthGate` is worse than deleting it.

### 2.3 `/welcome` — rejected

I considered a dedicated `/welcome` route for the empty-workspace state. Rejected: it splits the post-auth landing across two routes, complicates back-button behavior ("back from welcome goes where?"), and forces a redirect dance every time `myServers` flips between empty and non-empty. The state branch on `AppShell` (already mostly there in `WorkspaceSelector`) is cleaner.

---

## 3. `/login` — `LoginPage` component

### 3.1 What it renders

```
┌──────────────────────────────────────┐
│              RIM                     │
│      Sign in to your workspace       │
│                                      │
│      [● Backend reachable]           │  ← reused HealthIndicator
│                                      │
│  ┌────────────────────────────────┐  │
│  │ USERNAME                       │  │
│  │ [_________________________]    │  │
│  │                                │  │
│  │ PASSWORD                       │  │
│  │ [_________________________]    │  │
│  │                                │  │
│  │       [ Log in ]               │  │
│  │                                │  │
│  │       Forgot password?         │  │
│  └────────────────────────────────┘  │
│                                      │
│  No account? Ask your workspace      │  ← invite-only mode
│  admin for an invite.                │
│                                      │
│  ─── OR ───                          │  ← only if registrationMode === OPEN
│  [ Create account ]                  │  ← only if registrationMode === OPEN
└──────────────────────────────────────┘
```

### 3.2 Behavior

- **Mount:** if a session is already restored (via `useSessionHydration`), navigate to `/` immediately. Don't render the form.
- **Submit:** call `useLoginMutation` with `{ username, password }`, set session on success, navigate to `state.returnTo ?? "/"`.
- **Bootstrap mode is gone.** No tab strip. The `BootstrapForm` component and `useBootstrapMutation` are removed from the UI. `useBootstrapMutation` (the hook) stays — the CLI may call it via the same GraphQL mutation, so the API layer remains.

### 3.3 Empty-state copy

**Invite-only mode (default) — LOCKED by Jakub:**

> No account? Ask your workspace admin for an invite.

Plain text, `text-xs text-rim-text-muted`, centered below the form card. Not a button — there's nowhere to go in invite-only mode and a fake link is worse than no link. This exact string is the contract; tests assert against it.

**Open mode (`registrationMode === "OPEN"`):**

Replace the line above with a horizontal divider (`─── OR ───`) and a secondary button styled as a `<Link>` to `/join`. Copy: `Create account`. Use the existing button styles from `Button.tsx` — secondary variant.

### 3.4 Component breakdown

- `src/features/auth/components/LoginPage.tsx` — NEW. Top-level route component.
- `src/features/auth/components/LoginForm.tsx` — NEW. Extracted from `AuthGate.LoginForm`. Same logic, no tab parent.
- `src/features/auth/components/HealthIndicator.tsx` — NEW (extract). Currently duplicated in `AuthGate.tsx` and `JoinPage.tsx`. Promote to a shared component while we're touching the area.
- `src/features/auth/components/AuthGate.tsx` — DELETE. Its only remaining job is the redirect to `/login`, which inlines into `AppShell`.

`LoginPage` is the only component reachable directly from the route. `LoginForm` and `HealthIndicator` are subcomponents.

---

## 4. `/join/:token` — `JoinPage` (rewritten)

### 4.1 Flow

1. Mount: extract `token` from `useParams`. If missing → render `InvalidTokenState` (this currently exists; keep it).
2. Call `usePreviewInviteToken(token)` (NEW hook) — backend returns `{ tokenType, workspaceName?, workspaceId?, isValid }` or a typed error code.
3. While loading: render skeleton (existing "Restoring session..." pattern works fine; reuse).
4. On error: render `InvalidTokenState` with copy keyed on the error code (see §4.4).
5. On success: render `JoinForm` (NEW) with token-aware copy:
   - `tokenType === "WORKSPACE"`: header "You're joining **{workspaceName}**". Form title "Create your account."
   - `tokenType === "INSTANCE"`: header "Create your RIM account." No workspace mention.
   - `tokenType === "BOOTSTRAP"`: same UI copy as INSTANCE ("Create your RIM account"). The split is at the mutation-input layer only — `buildInput()` routes BOOTSTRAP tokens via the `bootstrapToken` field and INSTANCE tokens via `instanceInviteToken`. Verified in `src/features/auth/components/JoinForm.tsx::headerCopy()` and `buildInput()`.
6. Submit: call `useSignupWithInviteMutation(token, { email, password, displayName })` — see §8 for contract details. On success, the response includes `{ userId, joinedWorkspaceId? }`.
7. Post-signup navigate:
   - If `joinedWorkspaceId` is present (workspace invite): set workspace, navigate to `/`.
   - If absent (instance invite): navigate to `/`. `AppShell` sees `myServers === []` and renders the empty-workspace state.

### 4.2 Form fields (LOCKED by Jakub)

- **Email** — required. Backend enforces uniqueness; frontend shows inline error on backend rejection.
- **Password** — required. Frontend shows minimum length hint (8 chars, pulled from `serverConfig`-style policy if backend exposes it; otherwise hardcoded with a `// TODO sync with iron-man` comment — flag in §8 contract assumptions).
- **Display name** — optional, ships at signup. ~~Defaults to email-localpart server-side if blank.~~ **SUPERSEDED — see §13b:** server-side fallback is `username`, not email-localpart. Locked: the field is in the form, marked optional, no deferred-to-settings branch.

### 4.3 Already-authenticated case

The current `JoinPage` has a `JoinAuthenticated` branch — if the user is already logged in and clicks an invite link, they get a "Join workspace" button instead of a registration form. **Keep this behavior.** It's correct for the case where an existing user receives an invite to a second workspace. The branch only applies to `WORKSPACE` tokens. Both `INSTANCE` and `BOOTSTRAP` tokens against an authenticated user are nonsensical — show an error: "You already have a RIM account; instance invites are only for new users." (Verified in `JoinAuthenticated.tsx`: the `BOOTSTRAP || INSTANCE` branch renders the same error copy.)

### 4.4 Error states

Iron-man's contract returns two codes (collapsed from the three I originally assumed). `INVALID_TOKEN` covers missing, consumed, and revoked indistinguishably; `EXPIRED_TOKEN` is broken out because expiry is not exploitable info.

| Backend code | Frontend copy |
|---|---|
| `INVALID_TOKEN` | "This invite link is no longer valid. Ask your admin for a fresh invite." |
| `EXPIRED_TOKEN` | "This invite has expired. Ask your admin for a fresh invite." |
| Network/unknown | "Couldn't load invite. Check your connection and refresh." (with a retry button) |

`InvalidTokenState` accepts a `code: "INVALID_TOKEN" | "EXPIRED_TOKEN" | "NETWORK"` discriminator and renders the matching copy. No `REVOKED` or `INVALID_OR_CONSUMED` branches — those got rolled into `INVALID_TOKEN` server-side.

### 4.5 Component breakdown

- `src/features/auth/components/JoinPage.tsx` — REWRITTEN. Orchestrator: token preview, branch on auth/token-type/error.
- `src/features/auth/components/JoinForm.tsx` — NEW. The actual signup form (workspace-or-instance variant via prop).
- `src/features/auth/components/InvalidTokenState.tsx` — NEW (extract). Currently inline in `JoinPage`.
- `src/features/auth/components/JoinAuthenticated.tsx` — EXTRACT from current `JoinPage`. Logic unchanged.
- `src/features/auth/api/usePreviewInviteToken.ts` — NEW hook. Wraps a query to the backend's preview endpoint. The shape did diverge — see §8.2 item 2 for the BOOTSTRAP variant addition.
- `src/features/auth/api/useSignupWithInviteMutation.ts` — NEW hook. Wraps the `signupWithInvite` mutation.

---

## 5. `/join` (no token) — `OpenJoinPage`

### 5.1 Behavior

1. On mount, read `useServerConfig()`.
2. If `registrationMode === "INVITE_ONLY"` (or undefined while loading): render the route's **404/forbidden** state — "Registration is invite-only on this RIM instance." Redirect to `/login` after 3 seconds via `setTimeout` + cancelable cleanup.
3. If `registrationMode === "OPEN"`: render `JoinForm` with `tokenType = "OPEN"` variant. Copy: "Create your RIM account." No workspace context.
4. Submit: same `useSignupWithInviteMutation` but with `token = null`. Backend rate-limits.
5. Post-signup: navigate to `/`. Empty-workspace state takes over.

### 5.2 Component reuse

Reuse `JoinForm` from §4.5. Add an `"OPEN"` variant to its prop union — handles the no-token case. This avoids a parallel form component for the same fields.

---

## 6. Empty-workspace state

### 6.1 Where it lives

State branch on `AppShell` — the existing `WorkspaceSelector` already handles the empty case at lines 33-42 (currently a passive "you don't belong to any workspaces yet" message). Promote it to an actionable surface.

```
┌──────────────────────────────────────┐
│              Welcome to RIM          │
│                                      │
│  You don't belong to any             │
│  workspaces yet.                     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Create your first workspace   │  │
│  │                                │  │
│  │  [ + Create workspace ]        │  │
│  └────────────────────────────────┘  │
│                                      │
│  Or ask a teammate to invite you.    │
└──────────────────────────────────────┘
```

### 6.2 Component

- `src/features/workspaces/components/EmptyWorkspaceState.tsx` — NEW.
- Triggers `CreateWorkspaceDialog` (existing) on button click.
- After dialog `onSuccess` → `setWorkspaceId(newId)` → `AppShell` re-renders into `WorkspaceShell`.
- `WorkspaceSelector.tsx` lines 33-42: replace the inline empty-state JSX with `<EmptyWorkspaceState />`.

### 6.3 Why not a new route

Restated from §2.3: state branches on `AppShell` keep navigation predictable and avoid redirect storms when membership flips. The cost is one more conditional in `AppShell`; the benefit is one less route, one less redirect rule, one less failure mode.

---

## 7. State and capability handling

### 7.1 The `registrationMode` enum

**Lives in:** TanStack Query, fetched via a new `useServerConfig()` hook. Hook name kept broad so the same hook can surface future server-driven config (password policy, branding) without a rename.

**Why not Zustand:** server-driven config that the server controls and may change is React Query's lane. Zustand is for client UI state we own (auth session, shell layout, unread counts). Putting a server-driven flag in Zustand mixes the two.

**Why not runtime capability:** runtime capabilities (`useRuntime()`, `src/core/runtime/`) are platform/device facts — desktop vs web vs mobile. They're synchronous, computed once at boot from `window` properties, and never change at runtime. `registrationMode` is server policy, asynchronous, can change between sessions, and is per-instance not per-device. Conflating the two would force `useRuntime` to become async and would couple platform detection to server fetch — both bad.

**Caching:** `staleTime: Infinity` (or `5 * 60_000` to allow eventual reflection of admin toggles without a hard refresh). Refetched on window focus once per session is fine. No need for subscriptions.

**Loading state:** during the initial fetch, `useServerConfig()` returns `{ data: undefined, isPending: true }`. UI consumers (only `LoginPage` and `OpenJoinPage`) treat undefined as "assume `INVITE_ONLY`" — the safer default. So a slow `serverConfig` query never accidentally shows a "Create account" link to a user on an invite-only instance.

### 7.2 New file

`src/features/auth/api/useServerConfig.ts` — hook + GraphQL query. See §8 for query shape.

### 7.3 The auth session itself

Unchanged. `useAuthStore` remains the source of truth for `{ userId }`. `useSessionHydration` still hits `me` on mount. No changes.

---

## 8. GraphQL operations

### 8.1 Operations the frontend will call

| Operation | Name | Used by | Status |
|---|---|---|---|
| Query | `registrationMode` (top-level; FE wraps as `ServerConfig`) | `useServerConfig` | SHIPPED — see §8.2 item 1 supersedure |
| Query | `previewInviteToken(token)` | `usePreviewInviteToken` | NEW — Fury pushing iron-man to add this in parallel |
| Mutation | `signupWithInvite(input)` | `useSignupWithInviteMutation` | NEW — iron-man shipped this name (was `acceptInvite` in r1) |
| Mutation | `login` | `useLoginMutation` | EXISTS, no change |
| Mutation | `joinServerByInvite` | `useJoinServerMutation` | EXISTS, no change (still used by `JoinAuthenticated`) |
| Query | `myServers` | `useMyServers` | EXISTS, no change (drives empty-state branch) |

### 8.2 Contract (reconciled with iron-man's r1 backend spec)

1. **`serverConfig` query shape.** **SUPERSEDED (Hawkeye SD2) — backend shipped a top-level `registrationMode` query, not a nested `serverConfig` wrapper.** Actual shape:
   ```graphql
   enum RegistrationMode { OPEN INVITE_ONLY }
   type Query { registrationMode: RegistrationMode! }
   ```
   The frontend `useServerConfig` hook (`src/features/auth/api/useServerConfig.ts`) issues `query RegistrationMode { registrationMode }` and wraps the scalar in a `ServerConfig` shape on the JS side: `{ registrationMode }`. Rationale: simpler GraphQL surface today (one scalar field, no wrapper type), while the FE keeps its own `ServerConfig` interface internally for forward-compat — when the server later grows additional config fields (password policy, branding, feature flags), they slot into the existing JS shape and the hook signature stays stable. Frontend imports `RegistrationMode` from `schema-types.ts` after `npm run codegen` — never hand-write the enum values.

2. **`previewInviteToken` query shape.** Assumed (Fury is pushing iron-man to add this in parallel; not in iron-man's r1 backend spec yet):
   ```graphql
   type InvitePreview {
     tokenType: InviteTokenType!  # WORKSPACE | INSTANCE | BOOTSTRAP
     workspaceId: ID
     workspaceName: String
   }
   enum InviteTokenType { WORKSPACE | INSTANCE | BOOTSTRAP }
   type Query { previewInviteToken(token: String!): InvitePreview! }
   ```
   **Update:** the shipped backend split `BOOTSTRAP` out as its own enum variant (originally folded under `INSTANCE`). Frontend `JoinForm` shares one copy variant across `BOOTSTRAP` and `INSTANCE`; the split is observable only in `buildInput()` (token routing field) and in `JoinAuthenticated`'s error-vs-join branch. Errors come back as typed GraphQL errors with extensions: `{ code: "INVALID_TOKEN" | "EXPIRED_TOKEN" }`. If iron-man's eventual shape diverges further, Fury sends a follow-up; don't guess.

3. **`signupWithInvite` mutation shape.** Reconciled:
   ```graphql
   input SignupWithInviteInput {
     token: String          # null for OPEN registration
     email: String!
     password: String!
     displayName: String    # optional, defaults to email-localpart
   }
   type SignupWithInviteResult {
     userId: ID!
     joinedWorkspaceId: ID  # null for instance invites
   }
   type Mutation { signupWithInvite(input: SignupWithInviteInput!): SignupWithInviteResult! }
   ```
   Sets the session cookie on success (same pattern as `login`).

4. **Bootstrap mutation lifecycle.** `bootstrap` mutation stays in the SDL but is called only by the CLI now — never by the UI. `useBootstrapMutation` (the hook) is not deleted in this PR; flag for a follow-up after iron-man's diff lands and we're sure no other surface uses it.

5. **Password policy.** Backend enforces password rules and surfaces them as field errors on `signupWithInvite`. Frontend shows a hardcoded "8 char minimum" hint with a `// TODO` until iron-man adds a `passwordPolicy` field to `serverConfig`.

6. **Instance-invite admin surface.** LOCKED OUT OF SCOPE this phase. No frontend wraps `createInstanceInvite` / `revokeInstanceInvite` / `listInstanceInvites`. Operators generate instance invites via the `rim_server` CLI and hand the resulting `/join/:token` URL out-of-band. Workspace-invite admin (already shipping via existing surfaces) is unaffected. See §12.

### 8.3 Codegen

After iron-man ships the SDL diff, run:

```
curl -s http://localhost:8080/api/sdl > schema.graphql
npm run codegen
```

Frontend hooks must use generated input types (`SignupWithInviteInput`, `InviteTokenType`, `RegistrationMode`) per the CLAUDE.md rule. Spider-man must NOT hand-write the enum values for `tokenType` or `registrationMode`.

---

## 9. Tests required

Spider-man writes both tests AND docs for every new component and hook. No exceptions. The build is green or it goes back. Test count target: **16 new tests** across 8 new files.

### 9.1 Component tests

`LoginPage.test.tsx` (NEW):
1. Renders the login form, no signup affordances.
2. Renders the invite-only empty-state copy when `registrationMode === "INVITE_ONLY"`. **Asserts the exact locked string:** `"No account? Ask your workspace admin for an invite."`
3. Renders the "Create account" link when `registrationMode === "OPEN"`, link points to `/join`.
4. Hides the "Create account" link while `registrationMode` is loading (`undefined`) — defaults to invite-only safety.
5. Submits with username + password, calls `useLoginMutation`, navigates on success.
6. Forgot-password link renders.

`JoinPage.test.tsx` (REWRITE — current file exists for the old shape):
7. Workspace-token happy path: preview returns `WORKSPACE`, form shows workspace name, signup mutation called with token, navigates to `/` with workspace selected.
8. Instance-token happy path: preview returns `INSTANCE`, form shows generic copy, signup mutation called, navigates to `/` (empty-workspace state takes over — assert `setWorkspaceId` not called).
9. Invalid token: preview errors with `INVALID_TOKEN`, renders `InvalidTokenState` with the matching copy. (Asserting copy by code, not by string match — copy may be tweaked.)
10. Expired token: preview errors with `EXPIRED_TOKEN`, renders the expired-specific copy.
11. Already-authenticated user with workspace token: renders `JoinAuthenticated`.
12. **Optional displayName:** form submits successfully when `displayName` is left blank — mutation called with `displayName: undefined` (or omitted). Asserts the field is not marked `required` in the DOM.

`OpenJoinPage.test.tsx` (NEW):
13. Renders the form when `registrationMode === "OPEN"`.
14. Renders 404 + redirect when `registrationMode === "INVITE_ONLY"`.

`EmptyWorkspaceState.test.tsx` (NEW):
15. Renders create button; clicking it opens `CreateWorkspaceDialog`.

`AppRouter.test.tsx` (NEW or extended):
16. `/login`, `/join/:token`, `/join`, and `/forgot-password` resolve to the right components. Use `MemoryRouter` per the existing pattern in `AuthGate.test.tsx`.

### 9.2 Hook tests

(In addition to the 15 above — these are smaller and grouped per file.)

`useServerConfig.test.ts`:
- Returns `data.registrationMode === "OPEN"` when the GraphQL response says so.
- Returns `data.registrationMode === "INVITE_ONLY"` for the invite-only response.
- Returns `undefined` while loading; never throws into the consumer.
- Mock `graphqlClient` per the existing pattern in `useAuthStore.test.ts`.

`usePreviewInviteToken.test.ts`:
- Returns `{ tokenType, workspaceName }` on success.
- Surfaces `INVALID_TOKEN` and `EXPIRED_TOKEN` codes via `error.extensions.code`.

`useSignupWithInviteMutation.test.ts`:
- Calls the mutation with the right input (including optional `displayName` omitted).
- Returns `{ userId, joinedWorkspaceId }` on success.

### 9.3 Existing tests to update

- `AuthGate.test.tsx`: DELETE (component is gone). Spider-man should confirm with a grep that no other test imports `AuthGate`.
- Any test mocking `useBootstrapMutation` for UI scenarios: re-evaluate, likely delete the bootstrap-mode assertions.

### 9.4 Docs to write

Each new component gets a JSDoc block at the top of the file describing its role, route, and prop contract. Each new hook gets a JSDoc block describing the GraphQL operation it wraps and the return shape. The `useSessionHydration` block is a good template (`src/features/auth/api/useSessionHydration.ts:19-26`).

In addition: spider-man updates `docs/ui-shell.md` with a one-paragraph note on the new `/login` and `/join` routes if the doc describes routing.

---

## 10. Open questions for Jakub

Both r1 questions are now LOCKED by Jakub:

1. **Empty-state copy on `/login` (invite-only).** LOCKED: *"No account? Ask your workspace admin for an invite."* Tested as exact string in §9.1.
2. **Display name field on `/join`.** LOCKED: optional, ships at signup, server-side default to email-localpart.

No outstanding questions blocking spider-man. `previewInviteToken` shipped with the BOOTSTRAP/INSTANCE/WORKSPACE three-variant enum; see §8.2 item 2.

---

## 11. Web-build compatibility

This is a hard rule from Fury and a hard rule from CLAUDE.md. Audit:

| Concern | Status |
|---|---|
| Routing | `react-router-dom` `BrowserRouter` works in both — no Tauri-specific routing. |
| Forms | Plain React + `useState`. No Tauri APIs. |
| GraphQL | `graphqlClient` already abstracts transport. Same on both. |
| Session storage | Backend cookie + `me` query. Works in both. **Note:** today's `useSessionHydration` relies on the backend setting an httpOnly cookie. In Tauri, this is the webview cookie store. In a future web build, it's the browser cookie store. Same shape, no abstraction needed. |
| `HealthIndicator` | Uses `useHealthCheck` which uses GraphQL. Cross-platform. |
| `WindowControls` / title bar | NOT used on these auth screens. Good. The `TitleBar` in `AppShell` is gated on `capabilities.customTitleBar` — auth screens don't render it. Already cross-platform. |

**No place in this spec requires a Tauri-only API.** The runtime capability layer correctly stays out of the auth flow.

One genuinely hard area I want to flag for future reference (NOT this spec's scope): the `/join/:token` deep link in a web build needs to handle the case where the user clicks an invite email link in a browser tab while the Tauri desktop app is also open. That's a deep-link handoff problem (fairly common: Slack, Linear, etc.). Out of scope today; flag if Fury wants a separate spec.

---

## 12. Out of scope (per Fury)

- Backend implementation (iron-man).
- Email verification UI (deferred).
- SAML / OIDC flows.
- Plugin-related onboarding.
- Deep-link handoff between web and desktop builds (see §11).
- Password policy UI beyond the inline minimum-length hint.
- "Resend invite" admin surface (different feature).
- **Instance-invite admin UI (this phase, locked by Jakub).** No GraphQL admin mutations wrapped, no list/create/revoke surfaces. Operators use `rim_server` CLI to mint instance invites and hand the `/join/:token` URL out-of-band. The `/join/:token` flow itself is in scope and handles instance tokens normally; only the admin-facing management UI is out. Workspace-invite admin is unaffected.

If something in here grows mid-implementation, spider-man stops and pings me before drifting.

---

## 13. Hard rules (restated for spider-man)

1. Every new component AND hook gets tests AND docs. The build gate (`npm run build && npm test`) must be green before "done."
2. No `git commit`, no `git push`, no `git merge`. Specs and code only.
3. No hand-written GraphQL enums. Run `npm run codegen` after iron-man ships SDL.
4. No Tauri-only assumptions. Every component in this spec must work in a future web build with no rewrites.
5. Hawkeye review is mandatory before reporting done — per CLAUDE.md.
6. If anything in this spec is ambiguous, ping me. Do not guess.

---

## 14. Component summary (handoff manifest)

**NEW files spider-man creates:**
- `src/features/auth/components/LoginPage.tsx`
- `src/features/auth/components/LoginForm.tsx`
- `src/features/auth/components/HealthIndicator.tsx`
- `src/features/auth/components/JoinForm.tsx`
- `src/features/auth/components/JoinAuthenticated.tsx` (extracted from current `JoinPage`)
- `src/features/auth/components/InvalidTokenState.tsx` (extracted from current `JoinPage`)
- `src/features/auth/components/OpenJoinPage.tsx`
- `src/features/workspaces/components/EmptyWorkspaceState.tsx`
- `src/features/auth/api/useServerConfig.ts`
- `src/features/auth/api/usePreviewInviteToken.ts`
- `src/features/auth/api/useSignupWithInviteMutation.ts`
- `src/features/auth/components/LoginPage.test.tsx`
- `src/features/auth/components/OpenJoinPage.test.tsx`
- `src/features/workspaces/components/EmptyWorkspaceState.test.tsx`
- `src/features/auth/api/useServerConfig.test.ts`
- `src/features/auth/api/usePreviewInviteToken.test.ts`
- `src/features/auth/api/useSignupWithInviteMutation.test.ts`
- `src/app/router/AppRouter.test.tsx` (or extend if exists)

**MODIFIED files:**
- `src/app/router/AppRouter.tsx` — new routes per §2.1.
- `src/shell/layouts/AppShell.tsx` — replace inline `<AuthGate>` with redirect to `/login`.
- `src/features/auth/components/JoinPage.tsx` — rewritten per §4.
- `src/features/auth/components/JoinPage.test.tsx` — rewritten per §9.1.
- `src/features/workspaces/components/WorkspaceSelector.tsx` — empty branch delegates to `EmptyWorkspaceState`.

**DELETED files:**
- `src/features/auth/components/AuthGate.tsx`
- `src/features/auth/components/AuthGate.test.tsx`

**Net delta:** +18 files, ~5 modified, 2 deleted. Test count: 16 new component tests, ~7 new hook test cases.

---

*"A login screen is the front door. We've been hanging two doors on the same hinge for a year. Time to pick one."*
— Vision

---

## Amendment 2026-04-28b — email + displayName at signup

Backend (iron-man, specced not yet implemented) extends `SignupWithInviteInput` with a required `email` and an optional `displayName`. Scoped to `signupWithInvite` ONLY — `acceptInvite` is untouched (Jakub's call: that mutation runs against an authenticated principal, no UX change needed). This amendment updates §4 (`JoinForm`), §8 (contract), and §9 (test floor) to match.

### A. Contract delta (supersedes §8.2 item 3)

```graphql
input SignupWithInviteInput {
  token: String          # null for OPEN registration
  email: String!         # NEW — required; trimmed + lowercased server-side; case-insensitive unique
  password: String!
  displayName: String    # NEW shape — optional, 1–80 chars when present, trimmed; blank/absent → falls back to username server-side
}
```

Note the displayName fallback changed: it is now **username**, not email-localpart. Update §4.2 mental model accordingly. New typed GraphQL error code: `EMAIL_TAKEN`.

**Display fallback (ruling 2026-04-28, Jakub):** when `displayName` is omitted or empty after trim, the user's display name is set server-side to their `username`. (This supersedes §4.2 r2 which referenced email-localpart fallback — that section was written before email was added to the signup input. Iron-man marking §4.2 r2 as superseded in the backend spec in parallel.)

### B. JoinForm field additions (§4.2)

Two new fields land in `JoinForm.tsx` (used by both `/join/:token` and `/join` no-token variants — `OpenJoinPage` reuses):

| Field | Required | Constraints | Locked copy |
|---|---|---|---|
| `email` | Yes | 1–254 chars, regex `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$` | label `"Email"`, placeholder `"you@example.com"` |
| `displayName` | No | trim; 1–80 chars when non-empty after trim | label `"Display name (optional)"`, helper `"If left blank, your username will be shown."` |

Client-side rules:

- **Email validation mirrors the backend regex.** Show inline error before submit; do not rely on the server alone for UX. Same regex literal in `JoinForm.tsx` and the test fixture — pull into a single `EMAIL_REGEX` constant in the form file so test imports stay tight.
- **Email is trimmed client-side too** (defensive — server also trims). Lowercase normalization stays server-side; do not lowercase the user's input in the field itself (visual lying is worse than a redundant round-trip).
- **`displayName` empty ⇒ omitted from the request payload.** Not sent as `""`. The mutation input type makes the field optional; pass `undefined` so it's elided from the GraphQL variables. This is a contract assertion — see test (d) below.
- **`displayName` trim happens before send.** Whitespace-only input is treated as empty and omitted.

The pre-existing "displayName optional" decision in §4.2 is preserved — only the server-side fallback target changes (username, not email-localpart). The §9.1 test 12 assertion ("mutation called with `displayName: undefined` (or omitted)") still holds.

### C. Error code map addition (§4.4)

Append to the error table — same map that holds `INVALID_TOKEN` / `EXPIRED_TOKEN`:

| Backend code | Frontend copy | Surface |
|---|---|---|
| `EMAIL_TAKEN` | "This email is already in use. Try logging in instead." | Inline field error on the email input in `JoinForm`, not a top-level toast. |

Surfaces inline next to the email field (matching the pattern other field-level mutation errors will use). Not in `InvalidTokenState` — that component is for token-preview failures, not signup-submit failures. Spider-man: extend `JoinForm`'s error mapping, don't push this into `InvalidTokenState`.

### D. Test floor additions (§9.1)

Four new tests on `JoinPage.test.tsx` / `JoinForm.test.tsx` (whichever level the form logic lands at — spider-man's call, but the assertions live with the form component):

17. **Malformed email rejected client-side.** Type `"not-an-email"`, submit; mutation is NOT called; inline error renders next to the email field. Asserts the regex is wired in.
18. **`EMAIL_TAKEN` from server surfaces inline.** Mock the mutation to reject with extension code `EMAIL_TAKEN`; assert the exact locked copy `"This email is already in use. Try logging in instead."` renders next to the email field.
19. **`displayName` trimming.** Type `"  Alice  "`; on submit, mutation called with `displayName: "Alice"`.
20. **`displayName` empty ⇒ omitted from payload.** Leave the field blank (or whitespace-only); on submit, mutation called with the `displayName` key absent or `undefined` — NOT `""`. Use a Jest matcher that distinguishes `{ displayName: undefined }` from `{}` only if the GraphQL client serializes them differently; otherwise assert `displayName` is not in the variables object.

### E. Test count update (§9 + §14)

Previous floor: **16 new component tests** + ~7 hook tests. New floor: **20 new component tests** + ~7 hook tests. The §14 "Net delta" line and §9 preamble both bump from 16 to 20.

### F. Hooks

No new hooks. `useSignupWithInviteMutation` consumes the regenerated `SignupWithInviteInput` after `npm run codegen` runs against iron-man's updated SDL. Spider-man: do NOT hand-write `email` / `displayName` into a local input type — wait for codegen, import the generated `SignupWithInviteInput`, fail loudly if the field shape mismatches.

### G. Out of scope for this amendment

- `acceptInvite` mutation (untouched per Jakub).
- Email verification flow (still deferred per §12).
- "Did you mean..." email typo suggestion UX.
- Display-name uniqueness checks (none — usernames remain the unique handle).

### H. Locked copy index (consolidated)

| Surface | String |
|---|---|
| Email label | `"Email"` |
| Email placeholder | `"you@example.com"` |
| DisplayName label | `"Display name (optional)"` |
| DisplayName helper | `"If left blank, your username will be shown."` |
| `EMAIL_TAKEN` error | `"This email is already in use. Try logging in instead."` |

These are contract strings — tests assert against them verbatim, same convention as the §3.3 invite-only empty-state copy.

— Vision
