# @rim-platform/plugin-sdk

Write a RIM plugin in TypeScript. A plugin is either a local process the RIM desktop
app starts and talks to over stdio (`DesktopLocalProcess`), or a bundle that runs in a
sandboxed frame of the app, on the desktop and on the web, and talks over a
`MessagePort` (`WebSandboxed`). The SDK speaks
[plugin protocol v1](../../protocol/plugin-protocol-v1.schema.json) for you over either
transport: the handshake and version negotiation, heartbeats, the dangerous-command
gate, errors and shutdown.

The SDK is developed in rim-ui and published to npm from rim-ui's releases; it keeps a
version of its own. Start from [`plugins/template-ts`](../../plugins/template-ts), which
uses it.

## Install

```sh
npm install --save-dev @rim-platform/plugin-sdk esbuild
```

The package ships JavaScript and type declarations, the in-memory test host
(`@rim-platform/plugin-sdk/testing`) and the bundler (`npx rim-plugin-bundle`). esbuild is
an optional peer dependency that only the bundler needs.

## Requirements

- Node 22.18 or newer. It runs `.ts` files as they are, so a plugin needs no build step
  while you work on it: `node main.ts` runs it with the SDK from `node_modules`.
- esbuild, only to bundle a plugin for installing (see below).

## Two transports, one API

`run()` picks the transport itself:

- in a WebSandboxed plugin's frame, where the frame shell has set
  `globalThis.rimPluginPort`, it talks over that port (one JSON text per message) and
  checks the plugin against the manifest text in `globalThis.rimPluginManifest`;
- anywhere else it talks over the process's stdio, in length-prefixed frames, and
  reads `rim-plugin.json` from the working directory.

`RunOptions.transport` overrides both. A transport is
`{ messages: AsyncIterable<string>; send(text): void; close(): void }`;
`stdioTransport()` and `portTransport(port)` are the two the SDK ships.

The package has a `browser` export condition, `dist/index.browser.js`, with the same API
and no `node:` imports; `rim-plugin-bundle` uses it for WebSandboxed plugins. A web
plugin gets no Node APIs and no filesystem: it reaches the network only at the origins
its manifest lists in `network_origins`, once the user approves `network.fetch`.

## A plugin in one file

```ts
#!/usr/bin/env node
import { definePlugin, PluginError } from "@rim-platform/plugin-sdk";

await definePlugin({
  id: "dev.example.pods", // plugin_id in rim-plugin.json
  commands: {
    list_pods: {
      async run({ args, invoker, host }) {
        host.log.info(`listing pods for ${invoker?.displayName ?? "nobody"}`);
        return { payload: await listPods(args.namespace), message: "3 pods" };
      },
    },
    restart_pod: {
      dangerous: true, // must match "dangerous": true in rim-plugin.json
      async run({ args }) {
        if (typeof args.pod !== "string") throw new PluginError("pod is required");
        await restart(args.pod);
      },
    },
  },
}).run();
```

The entrypoint in `rim-plugin.json` points at this file, and the file must be
executable (`chmod +x`), because the host runs it directly through its `#!` line.

## What the SDK guarantees

- **Commands.** Each key in `commands` is a command id from `rim-plugin.json`. `run`
  gets a frozen context: `args`, `invoker`, `initiator` (`"user"` or `"agent"`),
  `confirmed` and `host`. Return `{ payload, message }` or nothing. Unknown command
  ids are answered with `INVALID_PARAMS`.
- **Dangerous commands.** Mark a command `dangerous: true` here and in the manifest.
  The host asks the user to confirm every run and never lets the AI agent run one. The
  SDK also refuses, without calling `run`, any run that is not confirmed by the user
  (`PLUGIN_ERROR` with `data: { reason: "confirmation_required" }`). Nothing in the
  SDK lets a plugin set `confirmed` itself. If the manifest marks a command dangerous
  and the code does not, the SDK treats it as dangerous.
- **People.** The signed-in user and a command's invoker are `{ principalId,
displayName }` and nothing else. `principalId` is an opaque `PrincipalId`: store it
  and compare it, never parse it. Ids starting `rimp0_` are provisional and are
  replaced once, when the person enrolls a key identity, so keep stored ids somewhere
  you can rewrite. `onPrincipalChanged` runs when the user signs in, out or switches,
  or their id switches; `onPrincipalsRemapped` gets every `{ from, to }` switch the host
  knows, after every handshake, so apply it idempotently.
- **Errors.** Throw `PluginError(message, { code, data })` to choose the JSON-RPC
  error; anything else thrown becomes `PLUGIN_ERROR` with its message. `ErrorCode`
  lists the protocol's codes.
- **Compatibility.** The SDK ignores fields and notifications it does not know,
  answers unknown requests with `METHOD_NOT_FOUND`, and answers a host that speaks no
  version it knows with `accepted: false`, naming the version it speaks.
- **Manifest check.** On start the SDK reads `rim-plugin.json` from the working
  directory (the plugin directory, when the host starts it). It refuses the handshake
  when the manifest names another plugin, and logs commands that are in one place but
  not the other.
- **Shutdown.** On `rim.shutdown` or when stdin closes, the SDK runs `onShutdown` and
  exits. The host kills a plugin that is still running about a second later.

## Logging

stdout carries protocol frames, so the SDK sends `console.log` and friends to stderr,
which the host passes through. `host.log.info(...)` (and `debug`, `warn`, `error`)
writes to the RIM log with the plugin id in front. Never write to `process.stdout`
yourself.

## The host

`onReady(host)` runs after the handshake, and every command context has `host`:

| Field                 | Meaning                                                      |
| --------------------- | ------------------------------------------------------------ |
| `pluginId`            | The id the host started the plugin under.                    |
| `hostVersion`         | The RIM app's version.                                       |
| `protocolVersion`     | The version this connection speaks (1).                      |
| `grantedCapabilities` | What the user approved when the plugin started.              |
| `principal`           | The signed-in user right now, or `null`.                     |
| `log`                 | Lines for the RIM log.                                       |
| `panels`              | Panel state, below.                                          |
| `storage`             | A WebSandboxed plugin's small store, below.                  |
| `chat`                | The person's messages, below.                                |

### Panels (experimental)

`host.panels.set(panelId, state)` replaces a panel's state and
`host.panels.patch(panelId, partial)` merges top-level keys into it. Both send
`rim.ui.update_panel`, which the host routes but protocol v1 has not frozen yet, so
the shape may still change. The plugin needs `"ui.panel"` in its manifest
`capabilities`, approved by the user; otherwise the call rejects with a
`HostRequestError` whose `code` is `CAPABILITY_DENIED`. A panel id the manifest does
not declare is rejected before anything is sent.

### Storage (experimental, WebSandboxed)

A web plugin's frame has an opaque origin, so no `localStorage` or IndexedDB of its
own. `await host.storage.get(key)` answers the stored JSON value or `null`;
`await host.storage.set(key, value)` stores it, and `null` deletes the key. The host
keeps 1 MiB per plugin, signed-in account and device, unencrypted: never keep tokens
in it. Keys are 1 to 128 characters of `A-Z a-z 0-9 . _ -`; a set past the quota
rejects with `INVALID_PARAMS` and `data: { reason: "quota" }`, and with nobody signed
in both reject with `INVALID_PARAMS`. `rim.storage.*` is not frozen in v1. A
local-process host answers both with `METHOD_NOT_FOUND`: a process has its own files.

### Chat (experimental)

`host.chat` reads and posts the person's messages through the app's message service, the
same for both kinds of plugin ([the method reference](../../docs/plugin-chat-methods.md)):

```ts
const { messages, hasOlder } = await host.chat.listMessages(conversationId, { limit: 50 });
const message = await host.chat.getMessage(messageId); // or null
const hits = await host.chat.searchMessages("deploy", { conversationId });
const { id } = await host.chat.postMessage(conversationId, "on it", { threadId });
```

A message is `{ id, conversationId, threadId, author, text, sentAt, editedAt, encrypted,
attachments }`, with `author` a `Principal` and attachments as name, type and size only.
Reads come from what the person's device stores. The calls need `"chat.read"` or
`"chat.write"` approved, and in an encrypted DM or group also `"chat.read.encrypted"` or
`"chat.write.encrypted"` (a manifest asking for an encrypted one must ask for the plain one
too); otherwise they reject with `CAPABILITY_DENIED`. `rim.chat.*` is routed by both hosts
but not frozen in v1, so the shapes may still change.

## Testing without the app

`@rim-platform/plugin-sdk/testing` runs a plugin against an in-memory host. Like the app, it
refuses `host.panels` calls with `CAPABILITY_DENIED` unless `grantedCapabilities`
includes `"ui.panel"` (and `host.chat` calls without `"chat.read"` or `"chat.write"`),
and `onRequest` answers the rest:

```ts
import { startTestHost } from "@rim-platform/plugin-sdk/testing";

const host = startTestHost(createPlugin(), { manifestPath: "rim-plugin.json" });
await host.handshake();
expect(await host.execute("greet")).toEqual({ result: { payload: "Hello, Test User!" } });
expect((await host.execute("restart_pod", { pod: "web-1" })).error?.code).toBe(-32002);
await host.execute("restart_pod", { pod: "web-1" }, { confirmed: true });
await host.shutdown();
```

`startTestHost(plugin, { transport: "port" })` runs the plugin over a Node
`MessageChannel`, as a web plugin's frame does, with the same assertions. `onRequest`
can answer `rim.storage.get` and `rim.storage.set` to test a plugin's store, and the
`rim.chat.*` calls, which the test host refuses with `CAPABILITY_DENIED` unless
`grantedCapabilities` has `"chat.read"` (or `"chat.write"` for posting).

`validateManifest` checks a manifest by the rules the hosts install it by, and throws a
`ManifestError` with the host's reason; `parseManifest` and `checkInstall` are its two
halves. The web app installs by these same rules:

```ts
import { readFileSync } from "node:fs";
import { validateManifest } from "@rim-platform/plugin-sdk/testing";

const manifest = JSON.parse(readFileSync("rim-plugin.json", "utf8"));
expect(() => validateManifest({ ...manifest, entrypoint: "main.mjs" })).not.toThrow();
```

## Installing a plugin

A plugin in `~/.rim/plugins` runs from its own folder, without the SDK source or
your `node_modules`, so bundle it into one file first:

```sh
npx rim-plugin-bundle .                               # in the plugin's folder
npm run plugin:bundle -- plugins/template-ts          # or, in rim-ui
cp -r plugins/template-ts/dist/dev.example.template-ts ~/.rim/plugins/
```

The output folder is emptied first, so the bundler refuses a folder that holds the
plugin or has other files in it. The bundle directory holds `rim-plugin.json` (with
`entrypoint` set to `main.mjs`), `main.mjs` with the SDK inside, and the plugin's
`panels/` folder (dotfiles left out). Beside the folder the bundler writes the same
files as one `<plugin_id>-<version>.rimbundle` and prints its hash and size:

```text
sha256 <64 lowercase hex characters>  size <bytes>
```

`sha256sum` on the file prints the same hash. Install the folder on the desktop, or
serve the `.rimbundle` over https with `Access-Control-Allow-Origin: *` and install it
on the web or the desktop with **Install from link** and
`https://host/path/<plugin_id>-<version>.rimbundle#sha256=<hash>`.

For a WebSandboxed plugin the bundler builds for the browser (`platform: "browser"`,
the `browser` condition, ES2022, no `#!` line) and fails when the output still imports
something or names a `node:` module: the frame shell loads the entry from a `blob:`
URL, where nothing can be imported. Every file besides the manifest and `main.mjs`
comes from `panels/`. Then enable the plugin in **Settings → Plugins**.

## Publishing a plugin

A plugin lives in a repository of its own, `plugin-<id>`, that holds the built plugin at
its root beside the sources, so **Install from git URL** finds a complete plugin:

```text
plugin-<id>/
  rim-plugin.json   # entrypoint "main.mjs"
  main.mjs          # built and committed
  panels/           # the panels, as the bundle ships them
  src/main.ts       # the source the build starts from
  package.json      # devDependencies: @rim-platform/plugin-sdk, esbuild
```

`--in-place` builds the source `--entry` names into `main.mjs` beside the manifest, which
must already point at `main.mjs`. `--check` builds it again into a temporary folder and
exits 1, naming each file, when the committed `main.mjs` or `panels/` differ from that
build, so a repository's CI catches a `main.mjs` nobody rebuilt:

```sh
npx rim-plugin-bundle --in-place --entry src/main.ts .   # after changing the source
npx rim-plugin-bundle --check --entry src/main.ts .      # in CI
```

[`plugin-k8s-pods`](https://github.com/rim-platform/plugin-k8s-pods) (a local process) and
[`plugin-github-prs`](https://github.com/rim-platform/plugin-github-prs) (a web plugin) are
two such repositories, with CI that runs `--check` and a release workflow that attaches the
`.rimbundle`.

The build names no absolute path and no time, so the same sources and the same SDK
version give the same bytes on every machine; commit the lockfile so CI builds with the
SDK the committed `main.mjs` was built with. A release is a tag; its `.rimbundle`
(`npx rim-plugin-bundle --entry src/main.ts .`, whose `main.mjs` is the committed one
byte for byte) can go on the release for **Install from link**.

For a WebSandboxed plugin the desktop takes `rim-plugin.json`, the entrypoint and
`panels/` from the checkout and ignores the rest: the sources, `package.json` and the
README stay in the checkout and never reach the plugin's frame. Those three parts follow
the bundle rules (names starting with `.` are skipped, and any other name under `panels/`
must be a bundle path), and signing an installed web plugin gives the same bundle hash as
its `.rimbundle`. A local-process plugin's `package.json` asks for `npm install` only when
it lists `dependencies`, `optionalDependencies` or `peerDependencies`; a committed,
self-contained `main.mjs` with only `devDependencies` installs without that step.

## Working on the SDK

- `src/generated/protocol.ts` is generated from the schema: run `npm run sdk:generate`
  after the schema changes. A test fails while it is stale.
- `npm run sdk:build` builds the package into `dist/`: the JavaScript, the type
  declarations and the bundler. The plugins in rim-ui import `@rim-platform/plugin-sdk`
  as any plugin does; the npm workspace links it to this folder, so they get `dist/`,
  exactly what the package ships. `npm test` builds it first; after changing the SDK,
  rebuild before running a plugin by hand.
- `npm run sdk:typecheck` builds it and checks the SDK and the plugins with the strict
  settings plugins use (`erasableSyntaxOnly`, so Node can run the source).
- `npm run sdk:smoke` packs the SDK as npm would publish it, installs the tarball into a
  copy of the template outside the repository, and type-checks, tests, runs and bundles
  the copy there. `docs/release-sdk.md` says how a release publishes the package.
- `npm test` runs the SDK tests, including the template over real stdio, both from
  source and bundled, and over a `MessageChannel`. The app's web host runs the
  template's browser build over a port in its own conformance test
  (`src/features/plugins/web/conformance.test.ts`). The Rust conformance tests
  (`src-tauri/src/plugin_host/protocol/conformance.rs`) run the template against the
  schema and through the host's own start-up and command path.
