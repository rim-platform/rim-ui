# In-app updates

The desktop app can check for, download and install new versions of itself with Tauri's updater
plugin. It ships dormant: `src-tauri/updater.json` is committed empty, and an app built from it
never contacts an update server. Settings → About then says "Updates are not configured in this
build".

## How it works

- `src-tauri/updater.json` is compiled into the binary (`src-tauri/src/updater.rs`). At startup
  the app reads it; with a public key and at least one endpoint it registers the updater and
  process plugins and hands them the endpoints and key. `tauri.conf.json` carries no updater
  configuration.
- With an empty `pubkey` neither plugin is registered and the `updater_status` command reports
  `{"configured": false}`. A key without endpoints, an endpoint that is not a URL or an unknown
  field is logged as a warning and treated the same way, so a bad file never stops the app.
- When configured, the app checks once at launch and every 24 hours while it runs. A new version
  raises a toast that opens Settings → About, where the user sees the version and release notes,
  downloads it with a progress bar and confirms "Restart to update". Nothing is installed before
  that confirmation.
- The main window's capability (`src-tauri/capabilities/default.json`) grants `updater:default`
  (check, download, install) and `process:allow-restart`. Nothing else may call them.
- The web build has no updater: the runtime capability `updater` is off there and the About page
  shows only the version.

## The signing key

Every update is signed with a minisign key, and the app refuses an update whose signature does
not verify against the public key in `updater.json`. This signature is the updater's own; it is
not the operating system's code signing (see below).

Generate the key pair once, on a trusted machine:

```sh
npm run tauri signer generate -- -w ~/.tauri/rim-updater.key
```

It asks for a password and writes `~/.tauri/rim-updater.key` (private) and
`~/.tauri/rim-updater.key.pub` (public). The private key and its password never go into this
repository: they belong in the release pipeline's secret store as `TAURI_SIGNING_PRIVATE_KEY`
(the file's contents or its path) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Losing the private
key means installed apps can no longer be updated, so keep a backup next to the other release
secrets.

Where those secrets live: FILL (release pipeline and secret store not decided yet).

## `updater.json`

```json
{
  "endpoints": ["https://FILL-update-host/rim/{{target}}/{{arch}}/latest.json"],
  "pubkey": "<the contents of rim-updater.key.pub>"
}
```

- `pubkey`: the whole contents of the `.pub` file, as one string.
- `endpoints`: one or more HTTPS URLs, tried in order until one answers. The plugin replaces
  `{{target}}` (`linux`, `windows`, `darwin`), `{{arch}}` (`x86_64`, `aarch64`, ...),
  `{{current_version}}` and `{{bundle_type}}` in them. A static `latest.json` that lists every
  platform needs none of them.

The file is read at compile time, so a release build fills it in before `tauri build` (or the
release branch commits it). Development builds keep it empty.

## Producing `latest.json`

1. Build with updater artifacts on and the private key in the environment. The flag stays out of
   `tauri.conf.json` because it makes every build require the key, so the release build passes
   it as a config overlay:

   ```sh
   export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/rim-updater.key
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...
   npm run tauri build -- --config src-tauri/tauri.release.conf.json \
     --config '{"bundle":{"createUpdaterArtifacts":true}}'
   ```

   Next to each bundle the build writes a `.sig` file: the AppImage on Linux, the `.app.tar.gz`
   on macOS, the NSIS `-setup.exe` and the `.msi` on Windows.

2. Upload the bundles and write `latest.json` next to them:

   ```json
   {
     "version": "0.2.0",
     "notes": "What changed, shown in Settings → About.",
     "pub_date": "2026-11-01T12:00:00Z",
     "platforms": {
       "linux-x86_64": { "signature": "<contents of the .AppImage.sig>", "url": "https://FILL-update-host/rim/0.2.0/rim-ui_0.2.0_amd64.AppImage" },
       "darwin-aarch64": { "signature": "<contents of the .app.tar.gz.sig>", "url": "https://FILL-update-host/rim/0.2.0/rim-ui_aarch64.app.tar.gz" },
       "windows-x86_64": { "signature": "<contents of the -setup.exe.sig>", "url": "https://FILL-update-host/rim/0.2.0/rim-ui_0.2.0_x64-setup.exe" }
     }
   }
   ```

   `signature` is the text of the `.sig` file, not a URL to it. `version` must be a semver
   greater than the installed one, or the app reports no update.

3. Publish `latest.json` last, once every file it points to is reachable.

Where the bundles and `latest.json` are hosted: FILL (hosting not decided yet). Generating
`latest.json` in CI is a follow-up for the release pipeline.

## Operating system signing

The updater signature does not replace code signing by the operating system, which is a
separate, still open step:

- macOS: a Developer ID certificate and notarization, or Gatekeeper blocks the downloaded app.
- Windows: an Authenticode certificate, or SmartScreen warns on the installer.

Both need the organisation's certificates: FILL.

## Before shipping a new client

Run `npm run skew:check` (see `docs/version-skew.md`) to see which operations an older server
would refuse.
