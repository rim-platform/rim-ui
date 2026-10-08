# @rim/plugin-sdk

Write a RIM plugin in TypeScript. A plugin is a local process the RIM desktop app
starts and talks to over stdio; the SDK speaks
[plugin protocol v1](../../protocol/plugin-protocol-v1.schema.json) for you: framing,
the handshake and version negotiation, heartbeats, the dangerous-command gate, errors
and shutdown.

The SDK lives in rim-ui until the protocol settles, and is not published to npm yet.
Start from [`plugins/template-ts`](../../plugins/template-ts), which uses it.

## Requirements

- Node 22.18 or newer. It runs `.ts` files as they are, so a plugin needs no build step
  while you work on it.
- esbuild, only to bundle a plugin for installing (see below).

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
  and compare it, never parse it. Ids starting `rimp0_` are provisional and will be
  replaced once, with a mapping from the host, when key identity ships, so keep stored
  ids somewhere you can rewrite. `onPrincipalChanged` runs when the user signs in, out
  or switches.
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

### Panels (experimental)

`host.panels.set(panelId, state)` replaces a panel's state and
`host.panels.patch(panelId, partial)` merges top-level keys into it. Both send
`rim.ui.update_panel`, which the host routes but protocol v1 has not frozen yet, so
the shape may still change. The plugin needs `"ui.panel"` in its manifest
`capabilities`, approved by the user; otherwise the call rejects with a
`HostRequestError` whose `code` is `CAPABILITY_DENIED`. A panel id the manifest does
not declare is rejected before anything is sent.

Not in v1: reading or sending chat messages. Those host methods exist but are not
frozen, and the SDK does not expose them.

## Testing without the app

`@rim/plugin-sdk/testing` runs a plugin against an in-memory host:

```ts
import { startTestHost } from "@rim/plugin-sdk/testing";

const host = startTestHost(createPlugin(), { manifestPath: "rim-plugin.json" });
await host.handshake();
expect(await host.execute("greet")).toEqual({ result: { payload: "Hello, Test User!" } });
expect((await host.execute("restart_pod", { pod: "web-1" })).error?.code).toBe(-32002);
await host.execute("restart_pod", { pod: "web-1" }, { confirmed: true });
await host.shutdown();
```

## Installing a plugin

A plugin in `~/.rim/plugins` runs from its own folder, without the SDK source or
your `node_modules`, so bundle it into one file first:

```sh
npm run plugin:bundle -- plugins/template-ts          # in rim-ui
cp -r plugins/template-ts/dist/dev.example.template-ts ~/.rim/plugins/
```

The bundle directory holds `rim-plugin.json` (with `entrypoint` set to `main.mjs`),
`main.mjs` with the SDK inside, and the plugin's `panels/` folder. Then enable the
plugin in **Settings → Plugins**.

## Working on the SDK

- `src/generated/protocol.ts` is generated from the schema: run `npm run sdk:generate`
  after the schema changes. A test fails while it is stale.
- `npm run sdk:typecheck` checks the SDK and the template with the strict settings
  plugins use (`erasableSyntaxOnly`, so Node can run the source).
- `npm test` runs the SDK tests, including the template over real stdio, both from
  source and bundled. The Rust conformance tests
  (`src-tauri/src/plugin_host/protocol/conformance.rs`) run the template against the
  schema and through the host's own start-up and command path.
