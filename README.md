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

### Linux build dependencies

Tauri's WebKitGTK stack, OpenSSL for the encrypted message cache, and libdbus for the desktop
keyring. On Debian or Ubuntu:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libssl-dev libdbus-1-dev pkg-config \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev
```

On Fedora: `webkit2gtk4.1-devel openssl-devel dbus-devel pkgconf-pkg-config libappindicator-gtk3-devel librsvg2-devel libxdo-devel`.

At run time the app keeps its secrets (the message cache key, history archive keys, the offline
session record, device keys, AI provider keys) in an encrypted file whose key is in the desktop
keyring service, the Secret Service provided by GNOME Keyring, KWallet or KeePassXC (see
`docs/secret-vault.md`). Without one running in the session, saving an AI key fails and the
local message cache stays off, each with an error that says so, and the app cannot open
offline.

## Commands

```sh
npm install                  # Install dependencies
npm run dev                  # Vite dev server only (port 1420)
npm run build                # TypeScript check + Vite production build
npm run codegen              # Generate GraphQL types (needs backend running)
npm run tauri dev            # Full Tauri desktop dev
npm run tauri build          # Production desktop build
```

## History archive in Google Drive, Dropbox or OneDrive

Settings > History can keep the encrypted history archive (`docs/specs/history-archive-v1.md`)
in the user's own Google Drive, Dropbox or OneDrive, besides a folder on disk. The app talks to those APIs
directly; no RIM server is involved. Signing in needs an OAuth client of your own, given to the
build as environment variables. A build without them simply does not offer that service. No
client id or secret is committed to this repository.

| Variable | Service | Needed |
|---|---|---|
| `RIM_GOOGLE_CLIENT_ID` | Google Drive | yes, for Drive |
| `RIM_GOOGLE_CLIENT_SECRET` | Google Drive | yes, for Drive (see below) |
| `RIM_DROPBOX_APP_KEY` | Dropbox | yes, for Dropbox |
| `RIM_DROPBOX_REDIRECT_PORT` | Dropbox | no; default `53241` |
| `RIM_MICROSOFT_CLIENT_ID` | OneDrive | yes, for OneDrive |

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

**OneDrive**

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), App registrations, register
   an app for **accounts in any organizational directory and personal Microsoft accounts**.
2. Under Authentication, add the platform **Mobile and desktop applications** with the redirect
   URI `http://localhost/callback` (Microsoft ignores the port of a `localhost` redirect, so the
   app's one-shot port is accepted), and set **Allow public client flows** to yes.
3. Under API permissions, add the Microsoft Graph delegated permissions `Files.ReadWrite.AppFolder`,
   `User.Read` and `offline_access`. The archive lives in `Apps/<app name>/` in the user's
   OneDrive, and the app sees nothing else.
4. Set the **Application (client) ID** as `RIM_MICROSOFT_CLIENT_ID`. No client secret is used.

Stopping backups on a device forgets its sign-in. RIM revokes a Dropbox sign-in too, but not a
Google one: Google revokes an app's access on every device at once, so the user removes RIM under
Google account settings, Security, Third-party apps with account access, when they want that.
Microsoft has no way to revoke one device's sign-in; the user removes RIM's access under their
Microsoft account's privacy settings (apps and services), or My Apps for a work account.

An archive belongs to the OAuth client that wrote it: a build with a different Google client id
sees a different `appDataFolder`, a different Dropbox app a different `Apps/` folder, and a
different Microsoft app a different OneDrive app folder.

## History archive in S3-compatible storage

Settings > History, "S3-compatible storage", keeps the archive in a bucket of Amazon S3,
Cloudflare R2, Backblaze B2, MinIO, Garage or any other S3-compatible storage, under a prefix.
It needs no build configuration and is always offered; the user types the endpoint, region,
bucket, prefix and an access key. Give that key `s3:GetObject`, `s3:PutObject` and
`s3:ListBucket` on the bucket or prefix (and `s3:DeleteObject` to let the setup check remove its
probe), nothing more.

## History archive on your own server

Settings > History, "Your own server", keeps the archive on a service the user runs: one URL
answering `GET` and `POST`, specified in `docs/specs/backup-endpoint-v1.md`. It needs no build
configuration and is always offered. `docs/specs/backup-endpoint-reference.py` is a complete
service in one Python file (standard library only) that stores the files under a directory:

```sh
python3 docs/specs/backup-endpoint-reference.py --dir ~/rim-backup --bearer <token>
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

## License

Apache License 2.0, see `LICENSE` and `NOTICE`. The license does not cover the RIM name, so
forks should use a different name. To contribute, see `CONTRIBUTING.md`.
