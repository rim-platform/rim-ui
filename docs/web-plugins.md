# Web plugins

A `WebSandboxed` plugin is a bundle (`rim-plugin.json`, one self-contained ES module,
optional panels) that runs in a sandboxed iframe of the app instead of a local process.
The same bundle runs in the web app and in the desktop app. The contract is
`../rim-server/docs/specs/web-plugins-v1.md`; the messages are protocol v1's
(`protocol/plugin-protocol-v1.schema.json`), carried as JSON text over a `MessagePort`.

## What lives where

| Concern | Where |
|---|---|
| Frame shell: the static page every plugin frame and panel frame loads, its baseline policy, the per-plugin policy, the entry import, panel rendering | `public/plugin-frame/v1/index.html`, `shell.js` |
| Serving the shell | the web app's own origin at `/plugin-frame/v1/`; the desktop at `rim-plugin://shell/v1/` (`src-tauri/src/plugin_host/plugin_protocol.rs`, `src-tauri/src/lib.rs`); nginx in the `Dockerfile` sends the shell's baseline policy for `/plugin-frame/` instead of the app's. Frames load `shell.js` as a CORS request (`crossorigin`), so nginx and the Vite servers (`vite.config.ts`) send `Access-Control-Allow-Origin: *` for `/plugin-frame/`, and the desktop scheme for `shell.js` alone; the baseline lists `rim-plugin://shell` in `script-src` because WebKit does not match a sandboxed frame's custom-scheme origin to `'self'` |
| Manifest rules | `src-tauri/src/plugin_host/manifest.rs`, `validation.rs`; the TypeScript port in the SDK, `sdk/plugin-sdk/src/manifestRules.ts`, which the web app imports; shared vectors `protocol/manifest-vectors.json` |
| `.rimbundle` reading, writing, unpacking | `src-tauri/src/plugin_host/bundle.rs`; `src/features/plugins/web/bundle.ts`; the SDK's writer `sdk/plugin-sdk/src/bundle.ts` |
| The host: frames, the JSON-RPC session, gates, limits, heartbeats, safe start | `src/features/plugins/web/webPluginHost.ts`, `pluginSession.ts`, `rpc.ts`, `webPluginEnvironment.ts` (the DOM side) |
| Panel state | `src/features/plugins/web/webPanelRelay.ts`; panels render in `components/PluginFrame.tsx` (through `WebPluginPanel.tsx`) and use the panel bridge in `runtime/pluginBridge.ts` |
| Installs | desktop: the Rust `PluginStateStore` and `~/.rim/plugins/<id>/`, through `pluginServices.ts`; web: IndexedDB `rim-plugins` (`browserPluginStore.ts`) |
| `rim.storage.*` | desktop: `src-tauri/src/plugin_host/storage.rs` (app data directory); web: the `storage` store of `rim-plugins` |
| `rim.chat.*`, the client message service | `src/features/plugins/chat/`, shared with local processes, which the Rust broker relays to it; see `docs/plugin-chat-methods.md` |
| Grant history and encrypted reads | desktop: the `audit` of the Rust `PluginStateStore`; web: the install record's `audit`; shown by `components/PluginAuditPanel.tsx` |
| Starting and stopping frames | `useWebPluginRuntime.ts`, mounted in `AppShell`; principals in `api/usePluginPrincipalSync.ts` |
| Install from link, Settings, consent text, panel chrome | `components/InstallFromLink.tsx`, `PluginSettingsPage.tsx`, `PluginCapabilityPrompt.tsx`, `PluginSlotContainer.tsx`, `pluginTrust.ts` |
| SDK transports and browser build | `sdk/plugin-sdk/src/transport.ts`, `index.browser.ts`, `scripts/bundle-plugin.mjs`, `scripts/browser-build.mjs`; the npm package `@rim-platform/plugin-sdk` ships them built |
| Showcase | [`rim-platform/plugin-github-prs`](https://github.com/rim-platform/plugin-github-prs), a repository of its own |

The runtime capability `webPlugins` is on for the desktop and the web; `pluginHost` keeps
meaning local processes, so the web shows local-process entries as "Needs the desktop
app". Commands of an installed web plugin route to the web host (`commandDispatcher.ts`,
and `agent/tools/loader.ts` for the agent, after the Rust host's AI consent check on the
desktop); everything else goes to the Rust host as before.

## How a plugin runs

1. The host creates a hidden `<iframe sandbox="allow-scripts">` (no referrer, no powerful
   feature, `credentialless`) that loads the frame shell.
2. On the frame's first `load`, the host posts `rim.frame.init` with the manifest text,
   the granted origins and the verified entry module, and transfers one end of a
   `MessageChannel`. A second `load` means the plugin navigated its frame: the frame is
   removed and not started again.
3. The shell appends a second `<meta>` policy (`connect-src` and `img-src` limited to the
   granted origins, or `'none'`), defines `rimPluginPort` and `rimPluginManifest`, and
   imports the entry from a `blob:` URL. A failed import comes back as `rim.frame.error`.
4. The host sends `rim.handshake` (10 seconds, counted from the init), then commands,
   heartbeats (every 30 s, none while the page is hidden, two misses remove the frame) and
   principal notices. Stopping sends `rim.shutdown`, answers the plugin for one more
   second, then removes the frame.

A panel frame loads the same shell with `kind: "panel"` and the files under
`panels/<id>/`; the shell renders `index.html`, then posts `rim.frame.ready` so the host
sends the theme and the stored panel state. From then on it speaks the existing panel
bridge. A local-process plugin's panel loads the same way: the desktop host reads
`~/.rim/plugins/<id>/panels/<panel>/` of an enabled plugin that declares the panel
(`plugin_panel_files`, with the path checks of `plugin_protocol.rs`) and `PluginPanel.tsx`
hands the files to the shell, loaded as `rim-plugin://shell/v1/local-panel.html`: the same
page, sent with a policy header (`LOCAL_PANEL_POLICY`) that allows no network, no workers
and no WebAssembly, since such a panel reaches the network only through its plugin's
process. Panel frames get their files after the shell's `rim.frame.hello`, once per frame. Only files
`index.html` names (scripts, stylesheets, icons, images, media) are mapped to the panel's
own files; a URL a script builds at run time, a stylesheet's `url()` or `@import`, or a
module's relative `import` does not reach them.

Before starting a plugin the host sets a `starting` marker and clears it after the
handshake. A plugin whose marker is still set when the app loads (the page died starting
it) is not started; Settings says so, and turning it off and on clears it.

## Build and try the showcase

The showcase lives in [`rim-platform/plugin-github-prs`](https://github.com/rim-platform/plugin-github-prs),
which holds the built plugin at its root:

```sh
git clone https://github.com/rim-platform/plugin-github-prs.git && cd plugin-github-prs
npm ci
npm run bundle
# bundled chat.rim.github-prs into dist/chat.rim.github-prs and dist/chat.rim.github-prs-<version>.rimbundle
# sha256 <hex>  size <bytes>
```

**Desktop.** `npm run tauri dev`, then Settings → Plugins → Install from local folder and
pick `dist/chat.rim.github-prs` of that clone. Approve both permissions, enable it, and
open **Pull requests** from the side rail's Plugins menu, or with **Open Pull requests** in the
command palette.

**Web.** Serve the bundle with CORS, for example from the clone's `dist` folder:

```sh
npx http-server dist --cors -S -C cert.pem -K key.pem   # any https server with Access-Control-Allow-Origin: *
npm run dev                                             # in rim-ui
```

Sign in, open Settings → Plugins → Install from link and paste
`https://<host>/chat.rim.github-prs-<version>.rimbundle#sha256=<the printed hash>`. The
bundle is fetched without credentials, must hash to the link's value, and must pass the
manifest rules before the permission prompt opens. Installs from a workspace's plugin
registry come with that registry; the install record already keeps their shape
(`{ kind: "registry", … }`).

The plugin talks to GitHub without a token (60 requests an hour per IP address). It starts
with two repositories; add one or two more, not ten, while trying it.

## Manual checks

Do these in Chromium, Firefox and the Tauri webview (WebKitGTK on Linux, WebView2 on
Windows, WKWebView on macOS). jsdom cannot load blob: modules or enforce CSP, so only a
real browser shows them.

1. **The showcase end to end.** From a folder on the desktop and from a link on the web:
   the panel lists pull requests with avatars, Refresh honours the 2-minute floor, and
   reloading the page keeps the repositories (the store).
2. **CSP blocks unlisted origins.** In the plugin frame's devtools console (pick the
   `Plugin: GitHub Pull Requests` frame), run `fetch("https://example.com")`: it must fail
   with a Content Security Policy error. `fetch("https://api.github.com")` works.
   Revoke `network.fetch` (disable, re-approve without it) and the GitHub fetch fails too.
3. **Navigation removes the frame.** In the same console run
   `location.href = "https://example.com"`: the frame disappears from the DOM and Settings
   shows "the plugin navigated its frame". It does not come back until you turn the
   plugin off and on.
4. **Panels cannot pop dialogs.** In the panel frame's console run `alert("x")`: nothing
   appears (`allow-modals` is not granted).
5. **No RIM session.** In the plugin frame's console, `document.cookie` is empty and a
   `fetch` to the RIM API origin fails (not in the policy; refused at install if listed).
6. **Inert while a dialog is open.** Run a dangerous command from the palette with a web
   panel open: the panel cannot be clicked or focused while the confirmation is shown.
7. **Heartbeats.** Pause the plugin frame in the debugger for more than a minute: the
   host removes it as "not responding" (only where the browser gives the frame its own
   process; in WebKit-based webviews a busy frame freezes the app instead, and safe start
   keeps it from starting again after a reload).
8. **Sign-out on the web.** Signing out removes every plugin frame; signing in again
   starts the plugins that account enabled.

## Host methods

| Method | Capability | Notes |
|---|---|---|
| `rim.log` | none | 120 lines a minute |
| `rim.ui.update_panel` | `ui.panel` | Routed, not frozen |
| `rim.storage.get`, `rim.storage.set` | none | Routed, not frozen; 120 calls a minute |
| `rim.chat.list_messages`, `get_message`, `search_messages` | `chat.read` (+ `chat.read.encrypted` in encrypted DMs and groups) | Routed, not frozen; `docs/plugin-chat-methods.md`. Reads come from the browser's encrypted store once it is set up as a linked device (`e2ee-web.md`, "Plugins"); otherwise `INTERNAL_ERROR` with `data.reason: "noCache"` |
| `rim.chat.post_message` | `chat.write` (+ `chat.write.encrypted`) | Routed, not frozen; encrypted conversations only from a browser set up as a linked device (`e2ee-web.md`), otherwise `noEncryption` |
| `rim.events.subscribe`, `rim.process.*`, `rim.fs.*`, `rim.network.*` | `events.read`, `local.process`, `fs.*`, `network` | `CAPABILITY_DENIED`: no web plugin can hold them |

`chat.read`, `chat.write` and their encrypted forms are prompted for both kinds of plugin, each
on its own line; an encrypted one is refused at install without its plain one. Revoking any
capability (Settings > Plugins > Activity) stops the plugin.

## Limits

8 MiB and 256 files per bundle; 4 MiB per port message; 600 plugin messages a minute
(requests over it get `RATE_LIMITED`, more than 1,200 stop the plugin); 120 calls a minute
per capability and for `rim.storage.*`; 120 `rim.log` lines a minute; 1 MiB of storage per
plugin, account and device; 1 MiB of panel state per plugin; 600 panel bridge messages a
minute per panel frame; 16 `network_origins`.
