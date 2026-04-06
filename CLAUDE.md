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
npm run codegen              # Generate GraphQL types (needs backend at localhost:8080)
npm run tauri dev            # Full Tauri dev (starts Vite automatically)
npm run tauri build          # Production desktop build

# Rust (from src-tauri/)
cargo check
cargo test                              # Primary Rust validation
cargo fmt --check                       # Formatting check
cargo clippy --all-targets --all-features -- -D warnings  # Lint
cargo test test_name -- --exact         # Single test
```

**No frontend test runner, linter, or formatter is configured yet.** Use `npm run build` as the frontend verification gate.

## Architecture

**Stack:** React 19 + TypeScript strict + Vite 7 + Tailwind CSS v4 + Tauri 2 (Rust)

**State management:**
- **Zustand** for client UI state (auth session, shell navigation, thread visibility, unread counts, presence)
- **TanStack Query** for server state (conversations, messages, threads) with automatic cache invalidation
- **React Context** for runtime capabilities (platform detection: desktop vs web)

**API layer:** GraphQL via `graphql-request` with HTTP/2 parallel queries (no batching). Shared fragments in `src/graphql/fragments/`. Backend uses nested resolvers + DataLoader — frontend requests `msg.author { ... }` directly, no manual joining.

**Feature-driven layout in `src/features/`:** Each feature (auth, conversations, messages, threads, agent, commands, notifications, presence, plugins) follows `api/` → hooks, `components/` → React, `state/` → Zustand stores.

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
- **Secrets in Stronghold** (Tauri plugin), never localStorage
- **DOMPurify** on all user-generated HTML (markdown rendering)
- **Design tokens everywhere** — no hardcoded colors (text-red-400, bg-white, etc.)
- **Shared Avatar component** — never duplicate avatar rendering logic

## Cross-Repo Context

Product contracts, messaging semantics, command/keybind/plugin models, and capability security are defined in `../rim-server/docs/`. Read the relevant doc before inventing client-side behavior.

**CRITICAL:** Before adding new fields to GraphQL queries, verify they exist in the backend schema (`rim_api/src/types.rs`). Frontend requesting non-existent fields causes silent query failures.

## Also Read

- `AGENTS.md` in this repo has detailed product direction, naming guidance, security/trust UX expectations, and agent workflow rules.
- `.claude/status.md` has current feature status and architectural decisions.
