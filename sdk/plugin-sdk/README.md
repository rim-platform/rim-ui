# @rim/plugin-sdk

Write a RIM plugin in TypeScript. A plugin is either a local process the RIM desktop
app starts and talks to over stdio (`DesktopLocalProcess`), or a bundle that runs in a
sandboxed frame of the app, on the desktop and on the web, and talks over a
`MessagePort` (`WebSandboxed`). The SDK speaks
[plugin protocol v1](../../protocol/plugin-protocol-v1.schema.json) for you over either
transport: the handshake and version negotiation, heartbeats, the dangerous-command
gate, errors and shutdown.

The SDK lives in rim-ui until the protocol settles, and is not published to npm yet.
Start from [`plugins/template-ts`](../../plugins/template-ts), which uses it.

## Requirements

- Node 22.18 or newer. It runs `.ts` files as they are, so a plugin needs no build step
  while you work on it inside rim-ui. Node does not do this for files under
  `node_modules`, so a plugin that depends on `@rim/plugin-sdk` from outside rim-ui runs
  only once bundled (see below); its tests still run with Vitest.
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

The package has a `browser` export condition, `src/index.browser.ts`, with the same API
and no `node:` imports; `rim-plugin-bundle` uses it for WebSandboxed plugins. A web
plugin gets no Node APIs and no filesystem: it reaches the network only at the origins
its manifest lists in `network_origins`, once the user approves `network.fetch`.

## A plugin in one file

```ts
#!/usr/bin/env node
import { definePlugin, PluginError } from "@rim/plugin-sdk";

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

Not in v1: reading or sending chat messages. Those host methods exist but are not
frozen, and the SDK does not expose them.

## Testing without the app

`@rim/plugin-sdk/testing` runs a plugin against an in-memory host. Like the app, it
refuses `host.panels` calls with `CAPABILITY_DENIED` unless `grantedCapabilities`
includes `"ui.panel"`, and `onRequest` answers the rest:

```ts
import { startTestHost } from "@rim/plugin-sdk/testing";

const host = startTestHost(createPlugin(), { manifestPath: "rim-plugin.json" });
await host.handshake();
expect(await host.execute("greet")).toEqual({ result: { payload: "Hello, Test User!" } });
expect((await host.execute("restart_pod", { pod: "web-1" })).error?.code).toBe(-32002);
await host.execute("restart_pod", { pod: "web-1" }, { confirmed: true });
await host.shutdown();
```

`startTestHost(plugin, { transport: "port" })` runs the plugin over a Node
`MessageChannel`, as a web plugin's frame does, with the same assertions. `onRequest`
can answer `rim.storage.get` and `rim.storage.set` to test a plugin's store.

## Installing a plugin

A plugin in `~/.rim/plugins` runs from its own folder, without the SDK source or
your `node_modules`, so bundle it into one file first:

```sh
npm run plugin:bundle -- plugins/template-ts          # in rim-ui
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

## Working on the SDK

- `src/generated/protocol.ts` is generated from the schema: run `npm run sdk:generate`
  after the schema changes. A test fails while it is stale.
- `npm run sdk:typecheck` checks the SDK and the template with the strict settings
  plugins use (`erasableSyntaxOnly`, so Node can run the source).
- `npm test` runs the SDK tests, including the template over real stdio, both from
  source and bundled, and over a `MessageChannel`. The app's web host runs the
  template's browser build over a port in its own conformance test
  (`src/features/plugins/web/conformance.test.ts`). The Rust conformance tests
  (`src-tauri/src/plugin_host/protocol/conformance.rs`) run the template against the
  schema and through the host's own start-up and command path.
