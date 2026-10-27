# Installing RIM

The RIM desktop app is published for Linux and Windows on the
[releases page](https://github.com/rim-platform/rim-ui/releases). On macOS it is built from
source for now. Every release signs in to the public relay `relay.rim-platform.org` unless you
choose another server at sign-in ([Use another server](#use-another-server)).

## Downloads

Each release lists one file per package format. `<version>` is the release, such as `0.0.1`.

| File | Platform | What it is |
|---|---|---|
| `RIM_<version>_amd64.deb` | Debian, Ubuntu and derivatives | A package for `apt`; it pulls in the libraries the app needs. |
| `RIM-<version>-1.x86_64.rpm` | Fedora, openSUSE, RHEL and derivatives | A package for `dnf` or `zypper`; it pulls in the libraries the app needs. |
| `RIM_<version>_amd64.AppImage` | Any x86-64 Linux | One self-contained file: make it executable and run it. |
| `RIM_<version>_x64-setup.exe` | Windows 10 and 11 | The installer for one user, with no administrator rights needed. |
| `RIM_<version>_x64_en-US.msi` | Windows 10 and 11 | A Windows Installer package for managed installs (Group Policy, Intune, `msiexec`). |
| `SHA256SUMS`, `SHA256SUMS.sigstore.json` | All | The checksums of every file above and their cosign signature ([Verify a download](#verify-a-download)). |
| `THIRD-PARTY-LICENSES.txt` | All | The licence notices of the open-source software RIM includes. |

### Linux

Install the package for your distribution:

```sh
sudo apt install ./RIM_<version>_amd64.deb      # Debian, Ubuntu
sudo dnf install ./RIM-<version>-1.x86_64.rpm   # Fedora
```

Or run the AppImage:

```sh
chmod +x RIM_<version>_amd64.AppImage
./RIM_<version>_amd64.AppImage
```

What the app needs at run time:

- **glibc 2.34 or newer**, as on Debian 12, Ubuntu 22.04 and newer releases.
- **WebKitGTK 4.1**, the web engine that draws the app (`libwebkit2gtk-4.1-0` on Debian and
  Ubuntu, `webkit2gtk4.1` on Fedora). The packages install it; the AppImage carries it.
- **A Secret Service**, the desktop keyring: GNOME Keyring, KWallet or KeePassXC, running and
  unlocked in your session. The app keeps the key of its secret vault there, and the vault holds
  your device key and the other keys of this computer. Without one, signing in with a key,
  the encrypted message cache and opening offline fail with an error that says so. GNOME and
  KDE desktops run one by default; on a minimal window manager, start `gnome-keyring-daemon` or
  KeePassXC's Secret Service integration.
- **FUSE 2**, for the AppImage only (`libfuse2` on Debian and Ubuntu up to 22.04, `libfuse2t64`
  on Ubuntu 24.04, `fuse-libs` on Fedora). Without it the AppImage stops with a message about
  FUSE; `./RIM_<version>_amd64.AppImage --appimage-extract-and-run` runs it without.

### Windows

Run `RIM_<version>_x64-setup.exe`. It installs RIM for your user and adds it to the Start menu.
Windows 10 and 11 already have the WebView2 runtime the app draws with; the installer fetches it
when it is missing.

The installers are not code-signed, and no signing is planned for 0.0.x releases. Microsoft
Defender SmartScreen therefore shows "Windows protected your PC" when you run the installer:
choose **More info**, then **Run anyway**. SmartScreen judges unsigned software file by file, so
every new version prompts again. You can still check that a download is the one this repository
built, with `SHA256SUMS`, cosign and the GitHub attestation ([Verify a
download](#verify-a-download)); each release's notes carry the commands too.

The `.msi` installs RIM for every user of the computer and is meant for administrators who
deploy software centrally, for example:

```bat
msiexec /i RIM_<version>_x64_en-US.msi /qn
```

### macOS

There is no macOS download until signed and notarized builds exist. Build the app from source
([Build from source](#build-from-source)); an app you build runs on the Mac that built it.

## Verify a download

Download `SHA256SUMS` and `SHA256SUMS.sigstore.json` next to the files you downloaded.
`SHA256SUMS` lists the checksum of every installer and of `THIRD-PARTY-LICENSES.txt`.

First check that `SHA256SUMS` was signed by this repository's release workflow for the tag you
downloaded. It is signed with [cosign](https://docs.sigstore.dev/), without a long-lived key:

```sh
cosign verify-blob SHA256SUMS \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity "https://github.com/rim-platform/rim-ui/.github/workflows/release.yaml@refs/tags/v<version>" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Then check your files against it:

```sh
sha256sum --check --ignore-missing SHA256SUMS       # Linux
shasum -a 256 --check --ignore-missing SHA256SUMS   # macOS
```

On Windows, compare the output of `Get-FileHash RIM_<version>_x64-setup.exe` (PowerShell) with
the line for that file in `SHA256SUMS`.

Each file `SHA256SUMS` lists also carries a GitHub build provenance attestation, which the
GitHub CLI checks against this repository:

```sh
gh attestation verify RIM_<version>_amd64.AppImage --repo rim-platform/rim-ui
```

The `.sig` file next to each installer is the in-app updater's signature; the app checks it
itself, and you do not need it.

## Where the app keeps its data

The app's identifier is `com.rim.rim-ui`; its folders are named after it.

| What | Linux | macOS | Windows |
|---|---|---|---|
| App data: the secret vault `secrets.vault`, the encrypted message cache `message-cache/`, history archive settings `history-archive/`, plugin state `plugin_state.json`, data that plugins store `plugin_storage/<plugin_id>/` | `~/.local/share/com.rim.rim-ui/` | `~/Library/Application Support/com.rim.rim-ui/` | `%APPDATA%\com.rim.rim-ui\` |
| The vault key, one entry in the OS credential store | Secret Service, service `com.rim.rim-ui`, user `vault-key-v1` | Keychain, service `com.rim.rim-ui`, account `vault-key-v1` | Credential Manager, Windows Credentials, `vault-key-v1.com.rim.rim-ui` |
| Web engine storage and caches (settings kept per device, such as the chosen server) | `~/.local/share/com.rim.rim-ui/`, `~/.cache/com.rim.rim-ui/` | `~/Library/WebKit/com.rim.rim-ui/`, `~/Library/Caches/com.rim.rim-ui/` | `%LOCALAPPDATA%\com.rim.rim-ui\` |
| Installed plugins, local process and sandboxed, one folder `<plugin_id>/` each | `~/.rim/plugins/` | `~/.rim/plugins/` | `%USERPROFILE%\.rim\plugins\` |

The vault and its key belong together: the vault does not open without the key, and the key is
of no use without the vault. `secret-vault.md` describes both.

## Logs

The desktop app writes `rim.log` in its log folder. Settings > About has **Open log folder**.

| Linux | macOS | Windows |
|---|---|---|
| `~/.local/share/com.rim.rim-ui/logs/` | `~/Library/Logs/com.rim.rim-ui/` | `%LOCALAPPDATA%\com.rim.rim-ui\logs\` |

- The file grows to 2 MB, then moves aside as `rim_<date-time>.log`; the four newest of those
  are kept and older ones deleted.
- It holds the app's info, warning and error messages, such as local plugins starting and
  stopping and what failed, and the warnings and errors of its web view. It holds no message text, keys, passwords or tokens: errors are kept by kind
  and short message, web addresses lose their query, long token-like strings are replaced with
  `[redacted]`, and a plugin's own output is withheld.
- The default level is info. For a bug report that needs more, set the environment variable
  `RIM_LOG=debug` and start the app from that shell, for example
  `RIM_LOG=debug ./RIM_<version>_amd64.AppImage`. It raises the app's own messages only, not
  those of the libraries it uses.

In the web app, the browser's developer console (F12) shows the client's errors.

## Remove the app

1. Uninstall it:
   - `.deb`: `sudo apt remove rim`.
   - `.rpm`: `sudo dnf remove rim`.
   - AppImage: delete the file.
   - Windows: Settings > Apps > Installed apps, RIM, Uninstall. An `.msi` install is removed
     the same way or with `msiexec /x RIM_<version>_x64_en-US.msi`.
2. Uninstalling leaves your data in place, so a reinstall picks up where you left off. To remove
   it too, delete the folders under [Where the app keeps its data](#where-the-app-keeps-its-data)
   and the log folder ([Logs](#logs)), and the `vault-key-v1` entry from the credential store
   (Seahorse or KWalletManager on Linux, Keychain Access on macOS, Credential Manager on
   Windows).

Deleting the data removes this computer's device key and its keys for encrypted conversations.
Keep your recovery kit, or another device linked to your account, before you do.

## Updates

The app checks the releases page for a new version at launch and every 24 hours while it runs.
When there is one, a notice opens Settings > About, which shows the version and its release
notes, downloads it on request and installs it after **Restart to update**. Nothing is installed
without that confirmation. Settings > About also has **Check for updates**.

Each update is signed, and the app installs only an update whose signature matches the key built
into it. Every Linux and Windows install updates in place this way. A `.deb` or `.rpm` install
asks for an administrator password to install the new package. On Windows, the unsigned
installer of each new version meets SmartScreen again ([Windows](#windows)).

## Build from source

Every platform needs Node.js 24, Rust stable (from [rustup](https://rustup.rs/)) and
[cargo-about](https://github.com/EmbarkStudios/cargo-about), which writes the licence notices a
release build bundles:

```sh
cargo install cargo-about --locked --features cli
```

Platform prerequisites:

- **Linux**: the WebKitGTK, OpenSSL and D-Bus development packages. On Debian or Ubuntu:
  ```sh
  sudo apt-get install libwebkit2gtk-4.1-dev libssl-dev libdbus-1-dev pkg-config \
    libayatana-appindicator3-dev librsvg2-dev libxdo-dev
  ```
  The README lists the Fedora packages.
- **Windows**: the Microsoft C++ Build Tools ("Desktop development with C++") and the WebView2
  runtime, which Windows 10 and 11 already have.
- **macOS**: the Xcode Command Line Tools (`xcode-select --install`).

Then, in a checkout of this repository:

```sh
npm ci
npm run licenses
VITE_GRAPHQL_ENDPOINT=https://relay.rim-platform.org/api npm run tauri build
```

`VITE_GRAPHQL_ENDPOINT` is the server the app starts with; without it the app expects one at
`http://localhost:8080/api`. Either way, Use another server at sign-in moves it later. A release
build stops with an error when `npm run licenses` has not run.

The bundles land in `src-tauri/target/release/bundle/`: `deb/`, `rpm/` and `appimage/` on
Linux, `nsis/` and `msi/` on Windows, `macos/RIM.app` and `dmg/` on macOS.

On macOS the app you build is signed ad hoc and carries no quarantine flag, so it opens on the
Mac that built it: copy `RIM.app` to `/Applications`. It cannot be handed to another Mac, where
Gatekeeper refuses an app that is not signed with a Developer ID and notarized. That needs the
signed builds that do not exist yet.

The release pipeline also configures the updater (`updater.md`); a build of your own leaves it
off, and Settings > About says updates are not configured.

## Use another server

A self-hosted server works with the same app. On the sign-in page, under the form, the app names
the server it uses. Choose **Use another server**, enter the server's address, such as
`https://rim.example.org`, and choose **Check server**. The app asks that server for its version
and shows it, and says "This server is full" when it takes no new accounts (its accounts still
sign in); **Use this server** then moves the app to it and reloads.

- The address must use `https://`. Plain `http://` is accepted only for `localhost` and
  `127.0.0.1`, for a server on the same computer.
- The app talks to the server's GraphQL endpoint at `<address>/api`. If yours is mounted
  elsewhere, enter the full endpoint, such as `https://example.org/rim/api`.
- **Back to the default server** returns to the server the release was built with.
- The choice is kept on this computer only. The web app has no such field: it always uses the
  server that serves it.

A server accepts the desktop app's requests without extra configuration (rim-server's
`docs/self-hosting.md`).
