# In-app updates

The desktop app can check for, download and install new versions of itself with Tauri's updater
plugin. It ships dormant: `src-tauri/updater.json` is committed empty, and an app built from it
never contacts an update server. Settings → About then says "Updates are not configured in this
build".

## How it works

- `src-tauri/updater.json` is compiled into the binary (`src-tauri/src/updater.rs`). At startup
  the app reads it; with a public key and at least one endpoint it registers the updater and
  process plugins and hands them the endpoints and key. `tauri.conf.json` carries no updater
  configuration; a release build passes the public key to the bundler in a config overlay (see
  "Releases"), and the app replaces it at startup with what `updater.json` says.
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
repository. The maintainer holds the key pair and keeps an offline backup of the private key and
its password. Losing the private key means installed apps can no longer be updated.

The release workflow reads the key from these settings of the GitHub repository:

| Name | Kind | Value |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | secret of the `release` environment | the contents of `rim-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret of the `release` environment | its password |
| `UPDATER_PUBKEY` | repository variable | the contents of `rim-updater.key.pub` |
| `UPDATER_ENDPOINT` | repository variable | `https://github.com/rim-platform/rim-ui/releases/latest/download/latest.json` |
| `RELEASE_GRAPHQL_ENDPOINT` | repository variable | the public relay's API, such as `https://relay.rim-platform.org/api` |

A desktop build fails at its first step when any of them is empty: a release without updates is
not published. It fails there too while the repository is private, because build provenance
attestations and `releases/latest/download`, the updater's endpoint, need it public. The bundler also refuses a private key that does not match `UPDATER_PUBKEY`.

## `updater.json`

```json
{
  "endpoints": ["https://github.com/rim-platform/rim-ui/releases/latest/download/latest.json"],
  "pubkey": "<the contents of rim-updater.key.pub>"
}
```

- `pubkey`: the whole contents of the `.pub` file, as one string.
- `endpoints`: one or more HTTPS URLs, tried in order until one answers. The plugin replaces
  `{{target}}` (`linux`, `windows`, `darwin`), `{{arch}}` (`x86_64`, `aarch64`, ...),
  `{{current_version}}` and `{{bundle_type}}` in them. A static `latest.json` that lists every
  platform needs none of them, and the release's `latest.json` is one.

The file is read at compile time. The release workflow writes it from `UPDATER_ENDPOINT` and
`UPDATER_PUBKEY` before `tauri build`; the committed file stays empty, so development builds
never contact an update host.

## Releases

Updates are hosted on this repository's GitHub releases. `releases/latest/download/latest.json`
always answers with the `latest.json` of the newest release that is neither a draft nor a
pre-release. For a tag `v<version>`, `.github/workflows/release.yaml`:

1. Builds the installers on Linux x86_64 (in Debian Bookworm) and Windows x86_64, with
   `updater.json` filled in and the updater signatures on:

   ```sh
   npm run tauri build -- --config src-tauri/tauri.release.conf.json --config overlay.json
   ```

   where `overlay.json` is
   `{"bundle":{"createUpdaterArtifacts":true},"plugins":{"updater":{"pubkey":"<UPDATER_PUBKEY>"}}}`.
   The flag stays out of `tauri.conf.json` because it makes every build require the private key.
   Next to each bundle the build writes a `.sig` file: the AppImage, the `.deb` and the `.rpm`
   on Linux, the NSIS `-setup.exe` and the `.msi` on Windows. Bundle file names start with the
   product name, `RIM`: `RIM_<version>_amd64.AppImage`, `RIM_<version>_amd64.deb`,
   `RIM-<version>-1.x86_64.rpm`, `RIM_<version>_x64-setup.exe` and
   `RIM_<version>_x64_en-US.msi`. Before the build, `npm run licenses` writes the third-party
   licence notices the app bundles, `src-tauri/resources/THIRD-PARTY-LICENSES.txt`.

   `src-tauri/tauri.release.conf.json` replaces the development content security policy. Its
   `connect-src` allows any `https:` and `wss:` origin, and `http:` and `ws:` on `localhost` and
   `127.0.0.1`, because the installed app talks to whichever server the person signs in to,
   including one running on their own machine.
2. Creates the GitHub release as a draft and writes `latest.json` with
   `scripts/release-assets.mjs`:

   ```json
   {
     "version": "0.0.2",
     "notes": "https://github.com/rim-platform/rim-ui/releases/tag/v0.0.2",
     "pub_date": "2026-11-01T12:00:00Z",
     "platforms": {
       "linux-x86_64": { "signature": "<the .AppImage.sig>", "url": "https://github.com/rim-platform/rim-ui/releases/download/v0.0.2/RIM_0.0.2_amd64.AppImage" },
       "linux-x86_64-appimage": { "signature": "<the .AppImage.sig>", "url": ".../RIM_0.0.2_amd64.AppImage" },
       "linux-x86_64-deb": { "signature": "<the .deb.sig>", "url": ".../RIM_0.0.2_amd64.deb" },
       "linux-x86_64-rpm": { "signature": "<the .rpm.sig>", "url": ".../RIM-0.0.2-1.x86_64.rpm" },
       "windows-x86_64": { "signature": "<the -setup.exe.sig>", "url": ".../RIM_0.0.2_x64-setup.exe" },
       "windows-x86_64-nsis": { "signature": "<the -setup.exe.sig>", "url": ".../RIM_0.0.2_x64-setup.exe" },
       "windows-x86_64-msi": { "signature": "<the .msi.sig>", "url": ".../RIM_0.0.2_x64_en-US.msi" }
     }
   }
   ```

   An installed app looks up `<os>-<arch>-<bundle type>` first, so an app installed from the
   `.deb` updates with the next `.deb`, and falls back to `<os>-<arch>`. `signature` is the text
   of the `.sig` file, not a URL to it. `version` must be a semver greater than the installed
   one, or the app reports no update.
3. Writes `SHA256SUMS` over the installers and `THIRD-PARTY-LICENSES.txt`, signs it with
   cosign keyless into `SHA256SUMS.sigstore.json`, attests build provenance for every file it
   lists, uploads everything to the draft and publishes it. Until then the draft is invisible to
   `releases/latest`, so no app sees a release whose files are not all there. The web app's
   About page links to `releases/latest/download/THIRD-PARTY-LICENSES.txt`.

A release's files are checked, next to the downloaded files, with:

```sh
v=<version>
cosign verify-blob SHA256SUMS --bundle SHA256SUMS.sigstore.json \
  --certificate-identity https://github.com/rim-platform/rim-ui/.github/workflows/release.yaml@refs/tags/v$v \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify <bundle> --repo rim-platform/rim-ui
```

### By hand

When the workflow cannot run, the same build works on a machine of each platform with the key
in the environment:

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/rim-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...
echo "{\"bundle\":{\"createUpdaterArtifacts\":true},\"plugins\":{\"updater\":{\"pubkey\":\"$(cat ~/.tauri/rim-updater.key.pub)\"}}}" > /tmp/overlay.json
npm run tauri build -- --config src-tauri/tauri.release.conf.json --config /tmp/overlay.json
```

with `updater.json` filled in as above and `npm run licenses` run first. Put every bundle, `.sig`
and `THIRD-PARTY-LICENSES.txt` in one directory, run
`node scripts/release-assets.mjs <dir> <version> rim-platform/rim-ui` for `latest.json` and
`SHA256SUMS`, attach them all to a draft release, and publish it last.

### Rolling an update back

Marking a release as a pre-release (or deleting it) moves `releases/latest/download` back to the
previous release, so apps that have not updated yet stop being offered it. Apps that already
updated stay on it: the updater only installs a greater version, so the fix goes out as the next
patch release.

## Operating system signing

The updater signature does not replace code signing by the operating system:

- Windows: the installers are not Authenticode-signed yet, so SmartScreen shows an unknown
  publisher; the release notes tell people to choose More info, then Run anyway.
- macOS: there is no macOS build yet. It needs a Developer ID certificate and notarization, or
  Gatekeeper blocks the downloaded app; the release workflow's matrix says what a macOS leg
  adds.

## Before shipping a new client

Run `npm run skew:check` (see `docs/version-skew.md`) to see which operations an older server
would refuse.
