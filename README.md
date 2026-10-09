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

## History archive in Google Drive or Dropbox

Settings > History can keep the encrypted history archive (`docs/specs/history-archive-v1.md`)
in the user's own Google Drive or Dropbox, besides a folder on disk. The app talks to those APIs
directly; no RIM server is involved. Signing in needs an OAuth client of your own, given to the
build as environment variables. A build without them simply does not offer that service. No
client id or secret is committed to this repository.

| Variable | Service | Needed |
|---|---|---|
| `RIM_GOOGLE_CLIENT_ID` | Google Drive | yes, for Drive |
| `RIM_GOOGLE_CLIENT_SECRET` | Google Drive | yes, for Drive (see below) |
| `RIM_DROPBOX_APP_KEY` | Dropbox | yes, for Dropbox |
| `RIM_DROPBOX_REDIRECT_PORT` | Dropbox | no; default `53241` |

They are read when the Rust side is compiled (`npm run tauri build`), and again at start-up,
so a development run can set them in the shell before `npm run tauri dev`.

**Google Drive**

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable
   the **Google Drive API** for it.
2. Configure the OAuth consent screen (External) and add the scope
   `https://www.googleapis.com/auth/drive.appdata`. It only reaches the app's hidden
   `appDataFolder`, never the user's other files. While the app is in "Testing", only listed
   test users can sign in and Google expires their sign-in after 7 days; publish it for
   lasting sign-ins.
3. Under Credentials, create an **OAuth client ID** of type **Desktop app**. Set its client id
   and client secret as `RIM_GOOGLE_CLIENT_ID` and `RIM_GOOGLE_CLIENT_SECRET`. Google treats a
   desktop client's secret as not confidential (it ships inside the app), but its token endpoint
   still asks for it. Keep it out of the repository anyway.

Sign-in redirects to `http://127.0.0.1:<any free port>/callback`, which desktop clients accept
without registering it.

**Dropbox**

1. At [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps), create an app with
   **Scoped access** and **App folder** access. The archive lives in `Apps/<app name>/` in the
   user's Dropbox, and the app sees nothing else.
2. On the Permissions tab, enable `files.metadata.read`, `files.content.read`,
   `files.content.write` and `account_info.read`.
3. On the Settings tab, add the redirect URI `http://localhost:53241/callback` (or your
   `RIM_DROPBOX_REDIRECT_PORT`), and allow public clients (PKCE). Set the **App key** as
   `RIM_DROPBOX_APP_KEY`. The app secret is not used.

Stopping backups on a device forgets its sign-in. RIM revokes a Dropbox sign-in too, but not a
Google one: Google revokes an app's access on every device at once, so the user removes RIM under
Google account settings, Security, Third-party apps with account access, when they want that.

An archive belongs to the OAuth client that wrote it: a build with a different Google client id
sees a different `appDataFolder`, and a different Dropbox app a different `Apps/` folder.

## Architecture

See `AGENTS.md` for detailed architecture, conventions, and agent guidance.

## Product Direction

The backend repository (`../rim-server`) is the source of truth for product contracts:

- `../rim-server/docs/vision.md` — product vision and positioning
- `../rim-server/ROADMAP.md` — implementation phases
- `../rim-server/docs/command_model.md` — command system contract
- `../rim-server/docs/keybind_model.md` — keybind system contract
- `../rim-server/docs/plugin_model.md` — plugin system contract
