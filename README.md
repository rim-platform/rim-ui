# RIM — Desktop Client

Tauri 2 desktop client for RIM — a programmable communication workspace.

This is the desktop runtime that hosts the command palette, keybind engine, plugin
system, and communication surfaces. Built with React 19 + TypeScript + Vite + Tailwind
CSS v4 on top of Tauri 2 (Rust).

## What This App Does

- Hosts the keyboard-first communication UI (conversations, messages, threads).
- Runs the command palette — fuzzy-searchable launcher for all app and plugin actions.
- Manages user-defined keybinds with context-aware dispatch.
- Executes chainable macro commands.
- Hosts client-side plugins (panels, commands, context actions, local behaviors).
- Connects to the RIM backend via GraphQL for persisted state.

## Quick Start

```sh
npm install
npm run tauri dev
```

Requires the RIM backend running at `localhost:8080`. See `../rim-server/README.md`.

## Commands

```sh
npm install                  # Install dependencies
npm run dev                  # Vite dev server only (port 1420)
npm run build                # TypeScript check + Vite production build
npm run codegen              # Generate GraphQL types (needs backend running)
npm run tauri dev            # Full Tauri desktop dev
npm run tauri build          # Production desktop build
```

## Architecture

See `AGENTS.md` for detailed architecture, conventions, and agent guidance.

## Product Direction

The backend repository (`../rim-server`) is the source of truth for product contracts:

- `../rim-server/docs/vision.md` — product vision and positioning
- `../rim-server/ROADMAP.md` — implementation phases
- `../rim-server/docs/command_model.md` — command system contract
- `../rim-server/docs/keybind_model.md` — keybind system contract
- `../rim-server/docs/plugin_model.md` — plugin system contract
