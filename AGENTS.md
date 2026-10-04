# AGENTS.md

This file guides coding agents working in `/home/kuba/RustroverProjects/rim-ui`.

## Project Overview

- This repository is the Tauri desktop client for RIM.
- RIM is a programmable communication workspace, not another chat app.
- Chat is the communication layer; commands, keybinds, macros, and plugins are the product.
- This repo is the desktop runtime that hosts the command palette, keybind engine,
  plugin system, and communication surfaces.
- The web UI lives in `src/` and is bundled with Vite.
- The native shell and command backend live in `src-tauri/` and are built with Rust.
- Tauri connects the frontend and backend through `invoke(...)` calls.

## Product Direction

- RIM is a programmable communication workspace. Chat is the medium; commands, keybinds,
  macros, and plugins are the product. See `../rim-server/docs/vision.md` for the full
  product vision.
- The desktop client hosts the command palette, keybind engine, plugin runtime, and
  communication surfaces. It is not a thin chat frontend.
- The long-term UX is keyboard-first and desktop-first. The user should be able to do
  everything without a mouse.
- The backend in `../rim-server` is the source of truth for product direction, command
  contracts, messaging semantics, keybind rules, plugin architecture, and
  capability/security expectations.

## Client Responsibilities

- Own desktop-local UI state such as focus, selection, active panel, open routes, temporary command state, and similar runtime concerns.
- Own runtime-local behaviors such as device-local keybind handling and final client-side keybind precedence.
- Own command palette, context-action surfaces, and keyboard-first interaction patterns.
- Own local plugin-host UX such as install/enable/disable flows, capability prompts, trust indicators, and plugin panel surfaces.
- Keep shared persisted state on the backend unless there is a clear runtime-local reason not to.
- Treat this app as the desktop host for RIM workflows, not as a generic Tauri starter.

## Cross-Repo Source Of Truth

Agents working on non-trivial product work should read the relevant docs in `../rim-server` before making major UI/runtime decisions.

- `../rim-server/README.md` explains the high-level product and backend workspace.
- `../rim-server/ROADMAP.md` explains the implementation phases and product priorities.
- `../rim-server/docs/architecture.md` explains backend-vs-client ownership and extensibility boundaries.
- `../rim-server/docs/ui.md` explains the intended desktop shell, layout direction, and performance requirements.
- `../rim-server/docs/messaging.md` explains messaging, threads, attachments, and permalink semantics.
- `../rim-server/docs/pagination.md` explains cursor-pagination rules that should shape list and infinite-scroll UI.
- `../rim-server/docs/command_model.md` explains the command system contract.
- `../rim-server/docs/context_model.md` explains typed runtime context.
- `../rim-server/docs/keybind_model.md` explains keybind scopes, precedence, and runtime behavior.
- `../rim-server/docs/plugin_model.md`, `../rim-server/docs/local_plugin_host.md`, and `../rim-server/docs/capability_security_model.md` explain the plugin-host and capability model.

## Repository Layout

- `src/main.tsx` bootstraps React.
- `src/App.tsx` currently contains the main UI and Tauri command call.
- `src/App.css` contains the current component styling.
- `src-tauri/src/main.rs` is the Rust binary entry point.
- `src-tauri/src/lib.rs` contains the Tauri app builder and commands.
- `src-tauri/tauri.conf.json` wires frontend build/dev commands into Tauri.
- `package.json` defines the frontend scripts.
- `tsconfig.json` defines TypeScript strictness rules.

## Intended UI Architecture

- The expected desktop shape is a side rail, one active tool panel, and a main chat workspace.
- The chat workspace is expected to grow toward workspace selection, conversation list, message view, thread view, and composer.
- Commands, keybinds, and context actions should feel like first-class product surfaces, not bolted-on utilities.
- Heavy routes and plugin surfaces should be lazy-loaded when possible.
- Long, unbounded lists such as messages, threads, or large conversation lists should be designed with virtualization in mind.

## Tooling Status

- Package manager in use is `npm` because the repo contains `package-lock.json`.
- Frontend build tool is Vite.
- Frontend language is TypeScript with `strict: true`.
- There is currently no configured JS/TS test runner.
- There is currently no configured frontend lint script.
- There is currently no repo-level Prettier, ESLint, Biome, or EditorConfig file.
- There is currently no `rustfmt.toml` or `clippy.toml` override in the repo.

## Build And Run Commands

Run frontend commands from the repository root unless noted otherwise.

- Install dependencies: `npm install`
- Start frontend dev server only: `npm run dev`
- Build frontend only: `npm run build`
- Generate GraphQL client types: `npm run codegen`
- Preview built frontend: `npm run preview`
- Start Tauri development app: `npm run tauri dev`
- Build Tauri desktop app: `npm run tauri build`

Run Rust commands from `src-tauri/`.

- Check Rust crate: `cargo check`
- Build Rust crate: `cargo build`
- Run Rust tests: `cargo test`
- Format Rust code: `cargo fmt`
- Verify Rust formatting: `cargo fmt --check`
- Run Rust lints: `cargo clippy --all-targets --all-features -- -D warnings`

## Test Commands

Current state:

- There are no committed frontend tests yet.
- There are no `npm test`, `vitest`, `jest`, or `playwright` scripts yet.
- Testing support currently exists only through Rust's standard `cargo test` workflow.
- GraphQL client code generation is available through `npm run codegen` and requires a reachable schema endpoint.

Recommended validation before finishing a change:

- Frontend-only change: `npm run build`
- Rust-only change: `cargo test` from `src-tauri/`
- Cross-stack or Tauri integration change: `npm run build` and `cargo test`, then `npm run tauri dev` for manual verification if needed
- UX-heavy or runtime-behavior changes: validate `npm run tauri dev` manually when practical, especially if keyboard handling, focus behavior, or host/plugin flows changed

## Running A Single Test

For Rust tests, run commands from `src-tauri/`.

- Run one test by substring match: `cargo test greet`
- Run one exact test: `cargo test module_name::test_name -- --exact`
- Run one exact test and show output: `cargo test module_name::test_name -- --exact --nocapture`
- Run tests from one integration test file: `cargo test --test file_stem`
- Run a single integration test in one file: `cargo test --test file_stem test_name`
- Run a single library test target: `cargo test --lib test_name`

There is no frontend single-test command because no frontend test framework is installed.
If you add Vitest or another runner, update this file in the same change.

## Commands Agents Should Prefer

- Use `npm run build` as the default frontend verification command.
- Use `cargo test` as the default Rust verification command.
- Use `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` when touching substantial Rust code.
- Use `npm run tauri dev` for manual end-to-end verification when changing the UI-to-Rust boundary.
- When changing product contracts, verify the corresponding `../rim-server/docs/*.md` document first instead of inventing local behavior.

## Frontend Code Style

- Follow the existing TypeScript + React functional component style.
- Prefer small components and focused functions over large monolithic files.
- Keep side effects explicit and localized.
- Prefer `async`/`await` over chained promises.
- Keep UI state close to the component that owns it unless reuse requires lifting state.
- Prefer modeling product concepts explicitly with types rather than loosely passing unstructured objects through the UI.

## TypeScript Rules

- Preserve `strict` TypeScript compatibility.
- Do not introduce `any` unless there is no practical alternative.
- Prefer explicit types when inference is unclear or when crossing app boundaries.
- Keep `noUnusedLocals` and `noUnusedParameters` clean; remove dead code instead of suppressing warnings.
- Do not rely on fallthrough in `switch`; `tsconfig.json` disallows it.
- Prefer narrow types and unions over broad escape hatches.
- Use type assertions sparingly and only when runtime shape is known.

## React Conventions

- Use `PascalCase` for component names.
- Use `camelCase` for functions, variables, props, and hooks.
- Name event handlers with `handle...` when they are passed as callbacks.
- Keep form state controlled or clearly intentionally uncontrolled.
- Keep JSX readable; extract repeated or complex blocks into helpers or components.
- Import CSS from the component entry that owns it.
- Prefer separating product-shell pieces into focused components once the app grows beyond the scaffold.

## Import Conventions

- Group imports with external packages first, then local modules/assets/styles.
- Keep one import per line when the list is short and readability is better.
- Use relative imports consistently because no path alias is configured.
- Avoid unused imports; the repo is configured to fail on unused locals/params in TS.
- Keep asset imports near the component that uses them.

## Formatting Conventions

- Match the existing style: semicolons, double quotes, and concise TS/TSX formatting.
- Preserve the current indentation style used by the file.
- Keep files ASCII unless a file already requires non-ASCII content.
- Avoid adding comments unless they clarify non-obvious behavior.
- Favor straightforward code over decorative abstractions.

## CSS And UI Guidance

- Preserve the existing styling approach unless you are intentionally introducing a stronger pattern.
- Keep selectors simple and component-oriented.
- Prefer readable class names over deeply nested selectors.
- Test layout changes in both desktop and smaller viewport sizes.
- Be careful with color-scheme behavior because `src/App.css` already has dark-mode-specific rules.
- Favor desktop-focused interaction quality, but keep the layout resilient to smaller windows.
- Avoid introducing heavy UI frameworks unless there is a clear product need; the product direction prefers a lightweight desktop client.

## Product Modeling Guidance

- Keep product terminology aligned with the server docs: prefer `workspace` in user-facing/product discussions even if some backend identifiers still use `server` internally.
- Treat commands as the shared execution unit across command palette, keybinds, context actions, plugins, and future automations.
- Do not encode workflow logic inside keybind handlers; keybinds should trigger commands.
- Treat context as typed runtime state such as selected text, selected message, current conversation, focused surface, and active panel.
- Keep arguments and context separate concepts in UI and local runtime code.
- Design for trust boundaries from the start: built-in behavior, user-defined behavior, plugin behavior, and integration behavior should remain visible.

## Messaging And Pagination Guidance

- Threads are anchored to a root timeline message; the root remains in the main timeline while thread replies live in the thread view.
- Message and thread UIs should respect the backend's pagination and ordering semantics instead of assuming offset/page-number pagination.
- Cursor-based pagination should shape list fetching and infinite-scroll state.
- Attachment handling and message references/permalinks should stay consistent with the backend contract in `../rim-server/docs/messaging.md`.

## Commands, Keybinds, And Plugin Guidance

- Keep the command palette, context actions, and keybind UX aligned with the contracts in `../rim-server/docs/command_model.md`, `../rim-server/docs/context_model.md`, and `../rim-server/docs/keybind_model.md`.
- Device-local keybinds belong in this client/runtime layer; persisted shared keybind layers belong to the backend.
- Prefer command metadata and typed context over hardcoded one-off shortcuts.
- Plugins should extend shared systems rather than introduce parallel command or keybind models.
- Plugin panels, commands, and context actions should be capability-aware and trust-aware in the UI.

## Rust Code Style

- Follow standard `rustfmt` formatting.
- Use `snake_case` for functions, variables, and module names.
- Keep Tauri command functions small and serialization-friendly.
- Prefer returning `Result<_, _>` from commands when failures are possible.
- Avoid `unwrap()` and `expect()` in request-handling paths unless a crash is truly intended.
- Keep `main.rs` minimal and put app setup logic in `lib.rs`.

## Error Handling

- Do not swallow errors silently.
- In the frontend, surface failures in UI state or log them intentionally during development.
- In Rust, prefer typed errors or stringified user-facing errors over panics for command failures.
- Add context to error paths when it helps debugging.
- Fail early on invalid inputs instead of propagating ambiguous state.
- For security- or capability-sensitive flows, fail clearly and visibly rather than degrading into hidden no-ops.

## Security And Trust UX

- Treat capabilities, trust boundaries, and dangerous local actions as first-class UI concerns.
- Dangerous behaviors such as local process execution, filesystem access, or broad outbound network access should be explicit in the UI.
- Capability prompts should be understandable and specific about what is being granted.
- Plugin or command origin should stay visible when it materially affects trust.
- Do not hide whether an action is built-in, plugin-provided, integration-provided, or user-defined if that distinction matters for user safety.

## Naming Guidance

- Components/types/interfaces/enums: `PascalCase`
- Functions/variables/props/state/hooks: `camelCase`
- Constants: `UPPER_SNAKE_CASE` only when they are true constants shared as constants
- Rust functions/modules/files: `snake_case`
- Test names should describe behavior, not implementation details.

## Agent Workflow Expectations

- Read the relevant file before editing it.
- Read the relevant `../rim-server` docs before changing product behavior or inventing client-side contracts.
- Make the smallest reasonable change that solves the task.
- Do not add new dependencies unless they clearly improve the requested outcome.
- Do not invent scripts that are not present in `package.json`.
- If you add a tool such as ESLint, Prettier, or Vitest, also add scripts and document them here.
- Respect existing user changes in the worktree; do not revert unrelated modifications.
- Do not treat temporary scaffold code as product direction; prefer the cross-repo docs over starter-template assumptions.

## Tauri-Specific Notes

- Frontend dev is expected on port `1420` via Vite.
- Tauri HMR is configured around `TAURI_DEV_HOST` in `vite.config.ts`.
- `src-tauri/tauri.conf.json` runs `npm run dev` before Tauri dev and `npm run build` before Tauri build.
- Changes to command names or payload shapes must be updated on both sides of the `invoke(...)` boundary.
- Keep `src-tauri/` focused on desktop-shell and host concerns; avoid letting it become a second product-backend without a clear reason.

## Rules Files Check

- No `.cursorrules` file was found.
- No `.cursor/rules/` directory content was found.
- No `.github/copilot-instructions.md` file was found.
- Because no Cursor or Copilot instruction files exist, this `AGENTS.md` is the primary agent guidance document.

## When Updating This File

- Keep commands accurate to the current repo state.
- Prefer facts inferred from committed config over aspirational guidance.
- Add single-test instructions whenever a new test runner is introduced.
- Update style guidance if the repo adopts formatter or lint config files.
