# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Tauri 2 desktop client for RIM — a programmable communication workspace, not another
chat app. Commands, keybinds, macros, and plugins are the product; chat is the
communication layer. React 19 frontend bundled with Vite, minimal Rust backend shell.

## Build & Dev Commands

All frontend commands from repo root. Rust commands from `src-tauri/`.

```bash
npm install                  # Install dependencies
npm run dev                  # Vite dev server (port 1420)
npm run build                # TypeScript check + Vite build (primary frontend validation)
npm run codegen              # Generate GraphQL types from schema.graphql (see below)
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

**Stack:** React 19 + TypeScript strict + Vite 7 + Tailwind CSS v4 + Tauri 2 (Rust)

**State management:**
- **Zustand** for client UI state (auth session, shell navigation, thread visibility, unread counts, presence)
- **TanStack Query** for server state (conversations, messages, threads) with automatic cache invalidation
- **React Context** for runtime capabilities (platform detection: desktop vs web)

**API layer:** GraphQL via `graphql-request` with HTTP/2 parallel queries (no batching). Shared fragments in `src/graphql/fragments/`. Backend uses nested resolvers + DataLoader — frontend requests `msg.author { ... }` directly, no manual joining.

**Feature-driven layout in `src/features/`:** Each feature (auth, conversations, messages, threads, agent, commands, notifications, presence, plugins, incidents, oncall) follows `api/` → hooks, `components/` → React, `state/` → Zustand stores.

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
- **Secrets in the OS keyring** through `src-tauri/src/secret_store.rs`, never localStorage
- **DOMPurify** on all user-generated HTML (markdown rendering)
- **Design tokens everywhere** — no hardcoded colors (text-red-400, bg-white, etc.)
- **Shared Avatar component** — never duplicate avatar rendering logic

## Cross-Repo Context

Product contracts, messaging semantics, command/keybind/plugin models, and capability security are defined in `../rim-server/docs/`. Read the relevant doc before inventing client-side behavior.

## GraphQL Type Generation (CRITICAL)

**NEVER hand-write GraphQL enum values, input types, or schema types.** Use the generated
types from `src/core/graphql/generated/schema-types.ts` instead. Hand-written types cause
silent bugs when enum casing or field names differ from the backend (e.g., `SEV2` vs `SEV_2`).

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
   import { IncidentSeverityGql, FilterField, SkillTier } from "../../../core/graphql/generated/schema-types";
   ```

### Rules

- **Enums**: ALWAYS import from `schema-types.ts`. Backend uses SCREAMING_SNAKE convention
  (e.g., `SEV_1`, `ACTION_ITEM`, `HAS_LINKS`). Never guess the casing.
- **Input types**: Generated as `CreateChannelLensInput`, `StartIncidentInput`, etc.
  Use them for mutation variable typing.
- **Object types**: Generated as `IncidentGql`, `ChannelLens`, `SkillProfileGql`, etc.
  Use for query result typing.
- **GraphQL queries/mutations**: Still written as `gql` tagged templates in `api/*.ts` files.
  Only the TypeScript types are generated, not the queries themselves.
- **Fragments**: Still hand-written in `src/graphql/fragments/`. These define field selections.
- **After adding backend types**: Always re-export SDL + run codegen before writing frontend code.

### Files

- `schema.graphql` — SDL schema file (source of truth, exported from backend)
- `codegen.mjs` — codegen configuration
- `src/core/graphql/generated/schema-types.ts` — generated types (DO NOT EDIT)
- `src/core/graphql/generated/sdk.ts` — DEAD CODE, do not use (legacy, pending removal)

**ALSO CRITICAL:** Before adding new fields to GraphQL queries, verify they exist in the
backend schema. Check `schema.graphql` or the per-domain modules under `rim_api/src/types/`
(e.g. `rim_api/src/types/conversation.rs`). Frontend requesting non-existent fields causes
silent query failures.

## Code Review (MANDATORY)

Every code change (fix, feature, refactor) MUST be reviewed by the Hawkeye agent (code-reviewer) before being reported as done. No exceptions.

Review covers: React 19 patterns, TypeScript strict compliance, component separation of concerns, GraphQL query/schema alignment, import consistency, copy-paste detection. BLOCK findings must be fixed before shipping.

## Also Read

- `AGENTS.md` in this repo has detailed product direction, naming guidance, security/trust UX expectations, and agent workflow rules.
- `.claude/status.md` has current feature status and architectural decisions.
