# Workspace plugins

Each workspace keeps a registry of plugins it recommends or requires. An entry pins one
exact version through a statement its publisher signed with their identity key: the exact
`rim-plugin.json`, and either a bundle's SHA-256 and size or a git commit and the SHA-256 of
its tree. Every client verifies the statement against the publisher's key log before it
offers the plugin; the server is never trusted for the signature. The contract is
`../rim-server/docs/specs/workspace-plugins-v1.md`; bundles are those of
[web plugins](web-plugins.md).

## What lives where

| Concern | Where |
|---|---|
| Statement rules and verification | desktop: `src-tauri/src/key_identity/plugin_manifest.rs` (`key_identity_verify_plugin_manifest`); web: `src/features/key-identity/browser/pluginManifest.ts`; both behind `verifyPluginManifest` in `key-identity/api/keyBackend.ts` |
| Signing (desktop only, the key never reaches the webview) | `KeyIdentityState::sign_plugin_manifest`, command `key_identity_sign_plugin_manifest` |
| What a publisher signs: a git checkout's origin, `HEAD` and tree hash, or a bundle of the installed folder, or a picked `.rimbundle`; writing a `.rimsig.json` | `src-tauri/src/plugin_host/registry.rs` (`plugin_signing_source`, `plugin_pick_signing_bundle`, `plugin_export_signature`) |
| Installing a git source at its commit, after checking the tree hash and the manifest | `plugin_install_registry_git` in `registry.rs` |
| Installing a bundle source (with the signed manifest checked and, for an update, the approvals kept) | `plugin_install_bundle` on the desktop, `browserPluginStore.installBundle` on the web |
| The registry API: `workspacePlugins`, the three mutations, bundle uploads | `src/features/plugins/registry/api.ts` |
| Verifying an entry (steps 1 to 5) | `registry/verify.ts` |
| Badge, palette line, install state, update rules | `registry/model.ts` |
| Install, stop, remove, keep as local | `registry/installer.ts` |
| Following the registry: updates and removals | `registry/sync.ts`, run by `components/RegistryHost.tsx` (mounted in `AppShell`) |
| The palette's "Workspace plugins" source | `registry/palette.ts`, merged in `CommandPalette.tsx` |
| Dialogs | `components/RegistryInstallDialog.tsx`, `RequiredPluginsDialog.tsx`, `UpdatePromptDialog.tsx`, `RemovedPluginDialog.tsx`, `SignAndPublishDialog.tsx`, `AddFromFilesDialog.tsx` |
| Settings | Settings > Plugins: "Sign and publish…" on each plugin, and the workspace's required plugins not installed (`RegistryNotes.tsx`); Workspace settings > Plugins for Owners and Moderators (`WorkspacePluginSettings.tsx`) |
| Refetching | `WorkspacePluginChanged` in `src/core/events/useWorkspaceEvents.ts` |

## Verification

Before anything is offered, installed or updated:

1. The statement's fields: type, version 2, size, no unknown or duplicate fields (the
   browser scans for duplicates itself, since `JSON.parse` keeps the last).
2. The publisher's key log: `keyLog(principalId)` from the workspace's server, or the log
   the entry keeps when the publisher is not enrolled there. It replays from the inception
   to the statement's `principalId`.
3. `keySeq` is an entry of that log and its identity key signed the statement. A later
   recovery rotation leaves the signature valid but withdraws the statement: an installed
   copy keeps running and says "The publisher recovered their key: ask for a re-signed
   version"; nothing new is installed from it.
4. The manifest passes this host's rules, and the entry's columns say what the statement
   says.
5. The bundle, fetched before any consent, has the signed size and SHA-256 and a
   byte-identical `rim-plugin.json`. The workspace server's copy is fetched with the
   session; a bundle on another host only over `https://`, without credentials, and on the
   desktop through the host's `plugin_fetch_bundle` with the signed SHA-256 as its pin. A git
   source is checked by the desktop right after its checkout, before any post-install step.

## Signing and publishing

On a desktop that holds the account's identity key (Settings > Security shows it), Settings
> Plugins offers "Sign and publish…" on each installed plugin:

- A local-process plugin installed from git is signed as a git source: the checkout's
  `origin` URL (`https://` or `ssh://`), `HEAD` and its tree hash. Anything else is bundled
  from its installed folder with the SDK bundler's rules. For a web plugin that bundle is
  `rim-plugin.json`, the entrypoint and `panels/`, and the rest of a checkout it came from
  (sources, `package.json`, a README) is ignored, so it hashes as the plugin's `.rimbundle`
  does. A bundle past 256 files or 8 MiB is refused, and "Sign another .rimbundle…" signs a bundle built with
  `npm run plugin:bundle -- <dir>` instead. The dialog shows the plugin id, version, kind,
  SHA-256 and size, to compare with what `rim-plugin-bundle` printed.
- The publisher name defaults to the profile card's display name. It is self-asserted: other
  members see the workspace's name for the publisher only when a member of the workspace has the
  publisher's principal id (`ServerMember.principalId`).
- An Owner or Moderator of the current workspace picks a status and publishes: the bundle is
  uploaded to `POST /api/plugin-bundles/<serverId>`, then the entry is added, or updated after
  "Replaces 0.1.0 signed by Ada". Anyone can export
  `<plugin_id>-<version>.rimsig.json` (`{"format":"rim-plugin-signature","v":1,"statement":…,
  "publisherKeyLog":[…]}`), saved with the built bundle into a folder they choose.

Workspace settings > Plugins > "Add from files" (desktop and web) takes a `.rimsig.json` and,
for a bundle source, its `.rimbundle`, verifies both and adds the entry. The same page sets
each entry's status, replaces its statement from files, and removes it.

## Installing and following the registry

- The palette's "Workspace plugins" lists the entries not installed, or installed at another
  statement, as `Install Hello Web — Recommended by Acme · signed by Ada (rimp1_txDLbnip)`.
  The web app lists local-process entries as "Needs the desktop app"; an entry that fails
  verification is listed with the reason. Neither can be chosen.
- Choosing an entry opens the install dialog: the badge (the whole principal id on hover and
  copy), the status, the source, the kind of plugin, and whether a copy is installed from
  another workspace (switching verifies it again), by another publisher, or unsigned
  ("Replace with Acme's signed version"). The permission prompt follows the install; a git
  source's post-install steps ask for consent as for any git install. The install record
  keeps `{ kind: "registry", endpoint, serverId, pluginId, statementSha256,
  publisherPrincipalId }`.
- When a workspace opens, its required plugins this device can install and has not are
  offered in one dialog. "Not now" is remembered per server, plugin id and statement hash, so
  the dialog comes back only for a new statement.
- On workspace open and on `WorkspacePluginChanged`, each registry install is compared with
  its entry. A verified new statement installs at once when it keeps the runtime kind and the
  publisher, asks for no capability the installed copy did not ask for or the person did not
  approve, adds no AI-callable command beyond those already there or consented, and, with
  `network.fetch` approved, lists the same `network_origins` in any order; the person sees
  "Updated Hello Web to 0.2.0" and keeps their approvals. Anything else, or a git update that
  needs post-install steps, waits behind a prompt that shows what is new. A failed update keeps
  the old copy.
- When an entry disappears, its plugin is stopped and turned off first, then the person
  chooses "Remove" (uninstall and delete its storage) or "Keep" (a local install with no
  registry source and no updates).

## Trying it with two accounts

1. Run the server from `rim-server` `master` and the app (`npm run tauri dev`). Account A
   owns a workspace and has a key identity on this desktop (Settings > Security); account
   B is a member, in the web app (`npm run dev`) or a second desktop profile.
2. As A, build a web plugin: in a clone of
   [`plugin-github-prs`](https://github.com/rim-platform/plugin-github-prs), `npm ci` and
   `npm run bundle`, and install it (Settings > Plugins > Install from link, or from the
   folder).
3. As A, "Sign and publish…" it, status Required, Publish.
4. As B, open the workspace: the required plugins dialog lists it with "Signed by A ·
   rimp1_…". Review and install, approve its permissions, run a command from the palette.
5. As A, publish a new version with no new permissions: B's copy updates on its own with a
   toast. Publish one asking for a new permission: B gets the update prompt instead.
6. As A, remove it in Workspace settings > Plugins: B's copy stops and B is asked to remove
   or keep it.
7. For the export path, sign as B (if B holds a key identity on a desktop): B is not a
   moderator, so the dialog exports a `.rimsig.json`, which A adds with "Add from files".
