# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

The RIM client, a programmable communication workspace rather than another chat app:
commands, keybinds, macros and plugins are the product, chat is the communication layer. One
React 19 frontend bundled with Vite ships as the Tauri 2 desktop app and as the web app a RIM
server deployment serves.

## Build & Dev Commands

All frontend commands from repo root. Rust commands from `src-tauri/`.

```bash
npm install                  # Install dependencies
npm run dev                  # Vite dev server (port 1420)
npm run build                # TypeScript check + Vite build (primary frontend validation)
npm run codegen              # Generate GraphQL types from schema.graphql (see below)
npm run build:wasm           # Rebuild the web app's MLS module (docs/e2ee-web.md); commit the result
#   Required after ANY change under src-tauri/crates/rim_mls or rim_mls_wasm, test files included:
#   src/features/e2ee/wasm/source.json hashes the crate sources and wasmArtifact.test.ts fails
#   until the module is rebuilt and committed, so such a change also needs the web gates (npm test).
npm run test:wasm            # rim_mls and its wasm facade in headless Chromium (needs chromedriver)
npm run skew:check -- <ref>  # Operations a server built from <ref> would refuse (docs/version-skew.md)
npm run tauri dev            # Full Tauri dev (starts Vite automatically)
npm run tauri build          # Production desktop build

# Rust (from src-tauri/)
cargo check
cargo test                              # Primary Rust validation
cargo fmt --check                       # Formatting check
cargo clippy --all-targets --all-features -- -D warnings  # Lint
cargo test test_name -- --exact         # Single test
```

Frontend gates: `npm run build` (TypeScript check + Vite build), `npm test` (Vitest), `npm run lint` (ESLint flat config — 0 errors required, warnings OK), `npm run format:check` (Prettier). See `docs/eslint-prettier.md` for the lint/format setup and `npm run lint:fix` / `npm run format` for local auto-fixing.

## Architecture

**Stack:** React 19 + TypeScript strict + Vite 8 + Tailwind CSS v4 + Tauri 2 (Rust)

**State management:**
- **Zustand** for client UI state (auth session, shell navigation, thread visibility, unread counts, presence)
- **TanStack Query** for server state (conversations, messages, threads) with automatic cache invalidation
- **React Context** for runtime capabilities (platform detection: desktop vs web)

**API layer:** GraphQL via `graphql-request` with HTTP/2 parallel queries (no batching). Shared fragments in `src/graphql/fragments/`. Backend uses nested resolvers + DataLoader — frontend requests `msg.author { ... }` directly, no manual joining.

**Feature-driven layout in `src/features/`:** Each feature (auth, conversations, messages, threads, agent, commands, notifications, presence, plugins, lenses, pipelines) follows `api/` → hooks, `components/` → React, `state/` → Zustand stores.

**Shell (`src/shell/`):** AppShell is the main layout — workspace rail, side rail, tool panel, main surface, optional docked thread pane.

**Runtime capabilities (`src/core/runtime/`):** Platform detection drives which UI surfaces render. Desktop gets full capabilities (thread pane, plugins, keybinds, AI agent, notifications); web gets a reduced set.

**Shared UI (`src/shared/ui/`):** Button, Dialog, DropdownMenu, EmojiPicker, HoverTooltip, Avatar, UserHoverCard, MarkdownRenderer, Toast system, WindowControls.

**Environment:** `VITE_GRAPHQL_ENDPOINT` for the API URL (default `http://localhost:8080/api`). See `.env.example`.

## Key Conventions

- TypeScript `strict: true` — no `any`, no unused locals/params, no switch fallthrough
- Relative imports only (no path aliases configured)
- Semicolons, double quotes
- Tailwind with custom `rim-*` design tokens (defined in `src/styles/globals.css`): `rim-void`, `rim-panel`, `rim-panel-soft`, `rim-accent`, `rim-text`, `rim-line`, `rim-text-muted`, `rim-text-faint`, `rim-danger`, `rim-warm`, `rim-success`
- Dark theme only (`color-scheme: dark`)
- Rust: standard `rustfmt`, `snake_case`, small Tauri commands returning `Result`
- **GraphQL fragments** for shared field selections — `src/graphql/fragments/`
- **Nested resolvers** — always request `author { ... }` on messages, never join manually
- **No batching** — HTTP/2 handles parallelism, each query stays independent
- **Secrets in the secret vault** (`src-tauri/src/secret_store.rs`: an encrypted file keyed from the OS credential store, see `docs/secret-vault.md`), never localStorage
- **DOMPurify** on all user-generated HTML (markdown rendering)
- **Design tokens everywhere** — no hardcoded colors (text-red-400, bg-white, etc.)
- **Shared Avatar component** — never duplicate avatar rendering logic

## Cross-Repo Context

Product contracts, messaging semantics, command/keybind/plugin models, and capability security are defined in `../rim-server/docs/`. Read the relevant doc before inventing client-side behavior.

## GraphQL Type Generation (CRITICAL)

**NEVER hand-write GraphQL enum values, input types, or schema types.** Use the generated
types from `src/core/graphql/generated/schema-types.ts` instead. Hand-written types cause
silent bugs when enum casing or field names differ from the backend (e.g., `HASLINKS` vs `HAS_LINKS`).

### Workflow

1. If the backend schema changed, export a fresh SDL:
   ```bash
   curl -s http://localhost:8080/api/sdl > schema.graphql
   ```
2. Regenerate types:
   ```bash
   npm run codegen
   ```
3. Import generated types in your code:
   ```typescript
   import { CommandSensitivity, FilterField } from "../../../core/graphql/generated/schema-types";
   ```

### Rules

- **Enums**: ALWAYS import from `schema-types.ts`. Backend uses SCREAMING_SNAKE convention
  (e.g., `HAS_LINKS`, `DESKTOP_LOCAL`, `MESSAGE_LIST`). Never guess the casing.
- **Input types**: Generated as `CreateChannelLensInput`, `ExecuteCommandInput`, etc.
  Use them for mutation variable typing.
- **Object types**: Generated as `ChannelLens`, `Command`, etc.
  Use for query result typing.
- **GraphQL queries/mutations**: Still written as `gql` tagged templates in `api/*.ts` files.
  Only the TypeScript types are generated, not the queries themselves.
- **Fragments**: Still hand-written in `src/graphql/fragments/`. These define field selections.
- **After adding backend types**: Always re-export SDL + run codegen before writing frontend code.

### Files

- `schema.graphql` — SDL schema file (source of truth, exported from backend)
- `codegen.mjs` — codegen configuration
- `src/core/graphql/generated/schema-types.ts` — generated types (DO NOT EDIT)

**ALSO CRITICAL:** Before adding new fields to GraphQL queries, verify they exist in the
backend schema. Check `schema.graphql` or the per-domain modules under `rim_api/src/types/`
(e.g. `rim_api/src/types/conversation.rs`). Frontend requesting non-existent fields causes
silent query failures.

## Code Review

Every code change is reviewed by the session that coordinates the work, not by a separate
review agent: it reads the whole diff, fixes what it finds, checks the implementer's gate
output (build, vitest, lint, format, and the Tauri fmt/clippy/test set), and only then opens
and merges the PR. Subagents implement and run the gates; they never spawn reviewers.

Review covers: React 19 patterns, TypeScript strict compliance, component separation of concerns, GraphQL query/schema alignment, import consistency, copy-paste detection.

Comments say what the item is and does, what it accepts and what it returns: TSDoc with a summary
sentence and `@param`/`@returns` where they add something, rustdoc with `# Errors` and `# Panics`.
No history, no pointers to docs, specs or plans, no plan, ticket, PR or finding ids, no personas,
no TODOs, no "we" voice; a test may name the spec appendix its vectors come from.
`src/test/commentLint.test.ts` enforces this in `npm test`. Commit messages: a plain imperative
first line (≤ 72 chars) and a body that says why; no trailers (no `Co-Authored-By`).

## Product and Trust Guidance

- Commands are the shared execution unit of the palette, keybinds, context actions, macros,
  plugins and the AI agent. Keybind handlers trigger commands and hold no workflow logic of
  their own; plugins extend the shared command and keybind systems rather than adding parallel
  ones.
- Context (selected message, current conversation, focused surface) is typed runtime state, kept
  apart from command arguments.
- Device-local keybinds and UI state belong to this client; shared persisted state (keybind
  layers, macros, pipelines, workspace state) belongs to the server.
- Use "workspace" in user-facing copy, even where a server identifier still says "server".
- Capabilities and trust boundaries are first-class UI. Local process execution, filesystem
  access and outbound network access are explicit in the UI; capability prompts say exactly what
  is granted; whether an action is built-in, user-defined, plugin-provided or AI-proposed stays
  visible when it matters for safety. Security-sensitive flows fail visibly, never as a silent
  no-op.
- Message and thread lists follow the server's cursor pagination and ordering, never offsets.
