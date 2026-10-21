# Documentation

The product contracts this client implements (the command, keybind, context, plugin and
capability models, and the specifications for key identity, device linking, encryption and
server-to-server) live in `rim-server`'s `docs/`. The pages here say how the client implements
them.

## The app

- `getting-started.md`: from a fresh install to a first conversation: the account and its
  recovery kit, the first workspace, channels, DMs and requests, the shell, and a second device.
- `commands-and-automation.md`: commands and their sensitivity, the command palette, keybinds,
  user commands and macros, pipelines, workspace state and how the AI agent runs commands.
- `ai-agent.md`: the AI agent on the desktop: setting up a provider and key, using it, what it
  may run, its confirmations, encrypted conversations, privacy and troubleshooting.
- `install.md`: downloads, run-time needs, verifying a download, where the app keeps its data,
  updates, building from source and using another server.
- `ui-shell.md`: the shell layout: workspace rail, side rail, tool panel, main surface, thread
  pane.
- `keyboard.md`: how a key is resolved, keybind profiles and the Vim layer.
- `search-ui.md`: the search overlay, server search and the desktop's local search.
- `error-boundaries.md`: the three tiers of React error boundary and their reset keys.
- `version-skew.md`: which operations an older server refuses, and `npm run skew:check`.
- `updater.md`: in-app updates, the signing key and `latest.json`.
- `eslint-prettier.md`: the lint and format gates.
- `branding.md`: where the logo, favicon, splash and app icons come from.

## Identity and encryption

- `device-linking-desktop.md`: linking a computer with a code, on the desktop.
- `web-linked-device.md`: the web app as a linked device.
- `identity-key-backup.md`: the identity key's copy in the history archive.
- `e2ee-desktop.md`: encrypted DMs and groups on the desktop.
- `e2ee-web.md`: encrypted DMs and groups in the web app.
- `rim-mls.md`: the `rim_mls` crate, the MLS engine both builds use.
- `relay-client.md`: reaching DMs, groups and workspaces on other servers through the relay.

## Storage on the device

- `secret-vault.md`: the encrypted file that holds the desktop app's secrets.
- `local-message-cache.md`: the encrypted message cache, local search and the archive's source.

## Plugins

- `plugins.md`: the official plugins, and installing, using, trusting and removing a plugin, for
  the person using the app.
- `plugin-tutorial.md`: your first plugin, from the template to a workspace registry.
- `plugin-manifest.md`: every field of `rim-plugin.json`, its rules and errors, and the content
  hash.
- `web-plugins.md`: sandboxed web plugins on the desktop and the web.
- `workspace-plugins.md`: workspace plugin registries and signed manifests.
- `plugin-chat-methods.md`: the `rim.chat.*` methods a plugin reads and posts messages with.
- `release-sdk.md`: releasing the plugin SDK to npm with its own tag, and setting that up.

The plugin protocol itself is `../protocol/plugin-protocol-v1.schema.json`, and the SDK is
`../sdk/plugin-sdk/README.md`.

## Specifications

Normative, versioned formats in `specs/`:

- `specs/history-archive-v1.md`: the encrypted history archive format.
- `specs/backup-endpoint-v1.md`: the protocol of a backup endpoint a user runs.
- `specs/backup-endpoint-reference.py`: a complete backup endpoint in one Python file.

## Releasing

A release is the tag `v<version>`, cut by the maintainer as rim-server's
`docs/operations/release-checklist.md` lists, with rim-server at the same version. In this
repository:

1. The release pull request runs `npm run version:set -- <version>`, which writes the version to
   `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` and
   turns `Unreleased` in `CHANGELOG.md` into the version's section. `npm run version:check`, also
   run in CI, fails when those files disagree.
2. Pushing the tag starts `.github/workflows/release.yaml`. After the maintainer approves it in
   the `release` environment, it publishes the web image and builds the Linux and Windows
   installers, then publishes the GitHub release with the changelog section, the installers,
   the updater's `latest.json`, `THIRD-PARTY-LICENSES.txt`, a cosign-signed `SHA256SUMS` and
   build provenance attestations.

The plugin SDK is released on its own, with the tag `plugin-sdk-v<version>`
(`release-sdk.md`); an app release publishes no SDK.

`updater.md` says what the release needs configured (the updater key, its variables and
secrets) and how to roll an update back.
