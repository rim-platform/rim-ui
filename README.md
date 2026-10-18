# RIM client

RIM is a programmable communication workspace. Chat is the medium; the product is what people
build on top of it: a command palette over every action, keybinds for anything, macros that
chain commands, pipelines that react to events, plugins that add panels and commands, and a
bring-your-own-model AI agent that acts through the same commands behind a human confirmation.
A person is a key pair rather than an account on one server, and DMs and private groups are
end-to-end encrypted. The product vision and the server live in the separate `rim-server`
repository.

## Download

Get the desktop app from the [latest release](https://github.com/rim-platform/rim-ui/releases/latest):

- **Linux**: `.deb` for Debian and Ubuntu, `.rpm` for Fedora and openSUSE, or the `.AppImage`
  for any distribution.
- **Windows**: the `-setup.exe` installer, or the `.msi` for managed installs.
- **macOS**: build it from source until signed builds exist.

It signs in to the public relay, or to your own server with "Use another server" at sign-in.
`docs/install.md` covers what each file is, what Linux needs at run time, the Windows SmartScreen
warning, how to verify a download, where the app keeps its data, and building from source.

## About this repository

This repository is the client, in two builds from one React 19 and TypeScript code base:

- **The desktop app**, a Tauri 2 shell around the React app, for Linux, macOS and Windows. It
  holds the identity key, runs local plugin processes, keeps an encrypted message cache and opens
  offline.
- **The web app**, the same React app as static files, which a RIM server deployment serves on
  its own domain. It signs in with a password or as a linked device of a desktop app, and runs
  web plugins. It has no identity key, no local plugin processes, no AI agent and no updater.

## What is in it

- **Command palette.** A fuzzy launcher over every built-in, user, macro and plugin command,
  with typed arguments, piping one command's output into the next with `|`, and confirmations
  for dangerous commands.
- **Keybinds and the Vim profile.** Context-aware keybinds with server-stored layers and
  device-local overrides, three built-in profiles (Minimal, Vim, Mouse-friendly), and profile
  export and import (`docs/keyboard.md`).
- **Macros and pipelines.** Macros chain commands, and the macro builder can draft one with the
  AI agent; pipelines are server-side rules that run commands when events happen. Channel lenses
  filter a timeline, and workspace state is a key-value store commands can read and write.
- **Plugins.** Local process plugins (`DesktopLocalProcess`) run on the desktop under the plugin
  host, with capability prompts and a trust-on-first-use bundle fingerprint. Web plugins
  (`WebSandboxed`) run in a sandboxed frame on the desktop and the web. A workspace can keep a
  registry of plugins whose manifests their publisher signed (`docs/web-plugins.md`,
  `docs/workspace-plugins.md`, `docs/plugin-chat-methods.md`).
- **Key identity and device linking.** The desktop app enrolls an identity key, signs in with a
  certified device key, recovers the account with a recovery kit, and links other computers or
  a browser with a code (`docs/device-linking-desktop.md`, `docs/web-linked-device.md`,
  `docs/identity-key-backup.md`).
- **Encrypted DMs and groups.** MLS through OpenMLS, in Rust on the desktop and compiled to
  WebAssembly in the web app; channels stay plaintext (`docs/e2ee-desktop.md`,
  `docs/e2ee-web.md`, `docs/rim-mls.md`).
- **Relays.** The app talks only to its own server and reaches DMs, groups and workspaces homed
  elsewhere through it, with a request inbox for messages from strangers
  (`docs/relay-client.md`).
- **Local message cache and history archive.** The desktop app keeps opened conversations in an
  encrypted SQLCipher database with local search, and can export history to an encrypted archive
  in a folder, Google Drive, Dropbox, OneDrive, S3-compatible storage or a backup endpoint the
  user runs (`docs/local-message-cache.md`, `docs/specs/history-archive-v1.md`).
- **AI agent.** Desktop only. The user brings an Anthropic or OpenAI key, kept in the secret
  vault; the agent calls the server's AI-callable commands and every dangerous call waits for
  the user's confirmation. It works in encrypted conversations only where the user switches it
  on.
- **Updater.** The desktop app can update itself with Tauri's signed updater. It ships dormant
  and is configured per release build (`docs/updater.md`).
- **The rest of chat.** Threads, replies, reactions, pins, mentions, attachments, link previews,
  custom emoji, full-text search, presence and typing, notification rules and an inbox,
  moderation and the workspace audit log.

## Quickstart

Prerequisites: Node.js 22 and a RIM server. Start one from `rim-server` (its README has the
quickstart); by default the client expects the GraphQL endpoint at `http://localhost:8080/api`.

```sh
npm ci
```

**Desktop.** Also needs Rust (stable) and, on Linux, the libraries below.

```sh
npm run tauri dev            # the desktop app with hot reload
npm run tauri build          # installers for this platform
```

**Web.** The Vite dev server serves the web app on port 1420. A server reached from that origin
needs `RIM_CORS_ALLOWED_ORIGIN=http://localhost:1420`.

```sh
npm run dev
```

`VITE_GRAPHQL_ENDPOINT` sets the server, at build time, for both builds (`.env.example`). For a
deployment, `Dockerfile` builds the web app into an nginx image; `rim-server`'s
`deploy/compose.yml` builds it from a checkout of this repository and serves it on the server's
domain with the endpoint `/api`.

### Linux build dependencies

Tauri's WebKitGTK stack, OpenSSL for the encrypted message cache, and libdbus for the desktop
keyring. On Debian or Ubuntu:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libssl-dev libdbus-1-dev pkg-config \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev
```

On Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel openssl-devel dbus-devel pkgconf-pkg-config \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel
```

At run time the app keeps its secrets (the message cache key, history archive keys, the offline
session record, device keys, AI provider keys) in an encrypted file whose key is in the desktop
keyring service, the Secret Service provided by GNOME Keyring, KWallet or KeePassXC
(`docs/secret-vault.md`). Without one running in the session, saving an AI key fails and the
local message cache stays off, each with an error that says so, and the app cannot open
offline.

## Build configuration

A build needs no secrets. The optional services below are compiled in from environment
variables; a build without them does not offer that service. No client id, secret or key is
committed to this repository.

| Variable | Read by | Effect |
|---|---|---|
| `VITE_GRAPHQL_ENDPOINT` | Vite | The server's GraphQL endpoint (default `http://localhost:8080/api`) |
| `RIM_GOOGLE_CLIENT_ID`, `RIM_GOOGLE_CLIENT_SECRET` | `src-tauri` | History archive in Google Drive |
| `RIM_DROPBOX_APP_KEY` | `src-tauri` | History archive in Dropbox |
| `RIM_DROPBOX_REDIRECT_PORT` | `src-tauri` | Dropbox sign-in port (default `53241`) |
| `RIM_MICROSOFT_CLIENT_ID` | `src-tauri` | History archive in OneDrive |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `tauri build` | Signs updater artifacts |

The `RIM_*` variables are read when the Rust side is compiled (`npm run tauri build`) and again
at start-up, so a development run can set them in the shell before `npm run tauri dev`. The
updater also needs its public key and endpoints in `src-tauri/updater.json`, which is committed
empty; `docs/updater.md` explains the key pair and `latest.json`.

### History archive in Google Drive, Dropbox or OneDrive

Settings > History can keep the encrypted history archive in the user's own Google Drive,
Dropbox or OneDrive, besides a folder on disk. The app talks to those APIs directly; no RIM
server is involved. Signing in needs an OAuth client of your own.

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

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), App registrations,
   register an app for **accounts in any organizational directory and personal Microsoft
   accounts**.
2. Under Authentication, add the platform **Mobile and desktop applications** with the redirect
   URI `http://localhost/callback` (Microsoft ignores the port of a `localhost` redirect, so the
   app's one-shot port is accepted), and set **Allow public client flows** to yes.
3. Under API permissions, add the Microsoft Graph delegated permissions
   `Files.ReadWrite.AppFolder`, `User.Read` and `offline_access`. The archive lives in
   `Apps/<app name>/` in the user's OneDrive, and the app sees nothing else.
4. Set the **Application (client) ID** as `RIM_MICROSOFT_CLIENT_ID`. No client secret is used.

Stopping backups on a device forgets its sign-in. RIM revokes a Dropbox sign-in too, but not a
Google one: Google revokes an app's access on every device at once, so the user removes RIM under
Google account settings, Security, Third-party apps with account access, when they want that.
Microsoft has no way to revoke one device's sign-in; the user removes RIM's access under their
Microsoft account's privacy settings (apps and services), or My Apps for a work account.

An archive belongs to the OAuth client that wrote it: a build with a different Google client id
sees a different `appDataFolder`, a different Dropbox app a different `Apps/` folder, and a
different Microsoft app a different OneDrive app folder.

### History archive in S3-compatible storage or on your own server

These need no build configuration and are always offered.

- **S3-compatible storage** keeps the archive in a bucket of Amazon S3, Cloudflare R2,
  Backblaze B2, MinIO, Garage or any other S3-compatible storage, under a prefix. The user types
  the endpoint, region, bucket, prefix and an access key. Give that key `s3:GetObject`,
  `s3:PutObject` and `s3:ListBucket` on the bucket or prefix (and `s3:DeleteObject` to let the
  setup check remove its probe), nothing more.
- **Your own server** keeps the archive on a service the user runs: one URL answering `GET` and
  `POST`, specified in `docs/specs/backup-endpoint-v1.md`. `docs/specs/backup-endpoint-reference.py`
  is a complete service in one Python file (standard library only) that stores the files under
  a directory:

  ```sh
  python3 docs/specs/backup-endpoint-reference.py --dir ~/rim-backup --bearer <token>
  ```

## Development

```sh
npm run lint                 # ESLint, 0 errors required
npm run format:check         # Prettier
npm run build                # TypeScript check and Vite build
npm test                     # Vitest
npm run sdk:typecheck        # the plugin SDK and the TypeScript example plugins
npm run sdk:smoke            # the SDK's npm tarball, installed into a copy of the template

# The Tauri side and the MLS crates, from src-tauri/
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

`npm run codegen` regenerates the GraphQL types from `schema.graphql`, which is exported from a
running server. `npm run build:wasm` rebuilds the web app's MLS module after a change to the
Rust MLS crates, and `npm run skew:check` lists the operations an older server would refuse
(`docs/version-skew.md`). `CLAUDE.md` has the architecture and the conventions;
`CONTRIBUTING.md` has the rules for a pull request.

## Plugins

`sdk/plugin-sdk` is the TypeScript SDK for plugin protocol v1, whose frozen wire contract is
`protocol/plugin-protocol-v1.schema.json`. `plugins/` holds examples:

- `plugins/hello-world`: the reference local process plugin, in Python with no dependencies.
- `plugins/template-ts`: a starting point for a TypeScript plugin.

Two plugins the project publishes live in repositories of their own, each with the built
plugin at its root so the desktop installs it from its git URL:

- [`plugin-k8s-pods`](https://github.com/rim-platform/plugin-k8s-pods): lists a Kubernetes
  namespace's pods and restarts one after confirmation.
- [`plugin-github-prs`](https://github.com/rim-platform/plugin-github-prs): a web plugin
  listing the open pull requests of public GitHub repositories.

## Documentation

`docs/README.md` lists every document in `docs/`. The product contracts the client implements,
such as the command, keybind, context, plugin and capability models and the specifications for
key identity, device linking, encryption and server-to-server, are in `rim-server`'s `docs/`.

## Security

Report a vulnerability privately, as `SECURITY.md` describes, never in a public issue.

## License

Apache License 2.0, see `LICENSE` and `NOTICE`. The license does not cover the RIM name, so
forks should use a different name. To contribute, see `CONTRIBUTING.md`.
