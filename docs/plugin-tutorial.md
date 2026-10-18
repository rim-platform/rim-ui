# Your first plugin

This walk-through builds a local-process plugin with the TypeScript SDK: a command in the palette,
a panel beside the conversation, then a permission to read the open conversation. It ends with the
plugin installed from git and published to a workspace. It needs Node 22.18 or newer, git and the
desktop app. [The manifest reference](plugin-manifest.md) has every field, and
[the SDK's README](../sdk/plugin-sdk/README.md) its API and a plugin in one file.

## 1. Copy the template

```sh
cp -r rim-ui/plugins/template-ts greeter && cd greeter
npm install    # the SDK from npm, esbuild, TypeScript and Vitest
npm test       # the template's own tests, against the SDK's in-memory host
```

`main.ts` is the entrypoint and stays as it is: it runs the plugin `plugin.ts` creates. The next
steps replace `rim-plugin.json`, `plugin.ts` and `plugin.test.ts`, and add `panels/`.

## 2. The manifest, `rim-plugin.json`

```json
{
  "manifest_version": 1,
  "plugin_id": "dev.example.greeter",
  "display_name": "Greeter",
  "version": "0.1.0",
  "description": "Greets people and shows the last greeting in a panel.",
  "author": "Ada Example",
  "runtime_kind": "DesktopLocalProcess",
  "entrypoint": "main.ts",
  "capabilities": ["ui.panel"],
  "commands": [
    {
      "id": "greet",
      "title": "Greeter: Greet",
      "description": "Greets someone and shows the greeting in the Greetings panel.",
      "keybind_capable": true,
      "arguments": [{ "name": "name", "type": "string", "required": false }]
    }
  ],
  "panels": [{ "id": "greetings", "title": "Greetings", "slot": "tool_panel" }]
}
```

- `plugin_id` is a reverse-domain id of your own. Node runs `main.ts` as it is while you work, and
  the bundler sets `entrypoint` to `main.mjs`.
- `ui.panel` lets the plugin set its panel's state. The palette runs commands without arguments,
  so it lists `greet` only because its one argument is not `required`.

## 3. The command, `plugin.ts`

```ts
import { definePlugin, ErrorCode, PluginError } from "@rim-platform/plugin-sdk";

export function createPlugin() {
  let count = 0;
  let last = "";

  return definePlugin({
    id: "dev.example.greeter",
    commands: {
      greet: {
        async run({ args, invoker, host }) {
          if (args.name !== undefined && typeof args.name !== "string") {
            throw new PluginError("name must be a string", { code: ErrorCode.INVALID_PARAMS });
          }
          count += 1;
          last = `Hello, ${args.name?.trim() || invoker?.displayName || "world"}!`;
          await host.panels.set("greetings", { last, count });
          return { payload: { last, count }, message: last };
        },
      },
    },
    async onReady(host) {
      await host.panels.set("greetings", { last, count });
    },
  });
}
```

`host.panels.set` replaces the panel's state, which the host keeps and sends to the panel whenever
it opens. Without an approved `ui.panel` it rejects with `CAPABILITY_DENIED` and the command fails.

## 4. The panel

A panel is `panels/<id>/index.html` in a sandboxed frame. `panels/greetings/index.html`:

```html
<!doctype html>
<meta charset="UTF-8" />
<style>
  body { background: var(--color-rim-void, #0d0d0f); color: var(--color-rim-text, #e0e0e6); }
</style>
<p id="last">Waiting for the plugin…</p>
<button id="greet" type="button">Greet</button>
<script src="app.js"></script>
```

`panels/greetings/app.js`:

```js
const last = document.getElementById("last");
let nextRequest = 1;

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || typeof event.data?.type !== "string") return;
  const message = event.data;
  if (message.type === "theme.changed") {
    for (const [name, value] of Object.entries(message.variables ?? {})) {
      document.documentElement.style.setProperty(name, value);
    }
  } else if (message.type === "panel.state_update") {
    const state = message.state;
    last.textContent = state ? `${state.last || "No greeting yet"} (${state.count})` : "Stopped";
  } else if (message.type === "rim.command.result" && !message.ok) {
    last.textContent = message.message;
  }
});

document.getElementById("greet").addEventListener("click", () => {
  const commandId = "plugin.dev.example.greeter.greet";
  const requestId = `greet-${nextRequest++}`;
  window.parent.postMessage({ type: "rim.command.execute", commandId, args: {}, requestId }, "*");
});
```

A panel does not use the SDK: it speaks the panel bridge over `postMessage`, not frozen in
protocol v1. The host sends `theme.changed` with the `--color-rim-*` tokens, `panel.state_update`
on opening, after every `set` and as `null` once the plugin stops, and `rim.command.result` for a
`requestId`. A panel runs only its own plugin's commands, never confirms a dangerous one, loads
only the files `index.html` names, runs no inline handlers, and has no network.

## 5. Test it, `plugin.test.ts`

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { startTestHost, validateManifest } from "@rim-platform/plugin-sdk/testing";

import { createPlugin } from "./plugin.ts";

const manifestPath = `${import.meta.dirname}/rim-plugin.json`;

it("installs, greets and updates the panel", async () => {
  expect(() => validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")))).not.toThrow();
  const panels: unknown[] = [];
  const host = startTestHost(createPlugin(), {
    manifestPath,
    grantedCapabilities: ["ui.panel"],
    onRequest: (method, params) => {
      if (method === "rim.ui.update_panel") panels.push(params);
      return {};
    },
  });
  await host.handshake();
  expect((await host.execute("greet", { name: "RIM" })).result?.message).toBe("Hello, RIM!");
  expect(panels.at(-1)).toMatchObject({ panel_id: "greetings", state: { count: 1 } });
  await host.shutdown();
});
```

`npm test` runs it, `npm run typecheck` checks the types. Without `ui.panel` in
`grantedCapabilities` the test host refuses `rim.ui.update_panel`, as the app does.

## 6. Build and install

```sh
npm run bundle
```

It writes `dist/dev.example.greeter` and `dist/dev.example.greeter-0.1.0.rimbundle` and prints
`sha256 <hash>  size <bytes>`. The folder holds `rim-plugin.json`, an executable `main.mjs` with
the SDK inside, and `panels/`. In the desktop app, choose that folder with Settings → Plugins →
Install from local folder. The app copies it to `~/.rim/plugins/dev.example.greeter/` and opens
Plugin Permissions: the name, version and author, the description under "From the plugin
author:", the warning that a local process runs with your account's access, and one checkbox,
"Render UI Panels". Approve, then turn the plugin on with its toggle.

## 7. Try it

Open a conversation. The palette lists **Greeter: Greet** under Greeter; running it shows the toast
"Greeter: Greet: Hello, <your name>!". **Open Greetings** in the palette, or the side rail's
Plugins menu, one row per running panel ("Greeter", then "Greetings"), shows the panel beside the
tool panel; its button runs the same command. `host.log` lines and stderr go to the app's log.

## 8. Ask for a permission

Reading the open conversation takes `chat.read` and a command that requires the conversation. In
`rim-plugin.json`, set `"capabilities": ["ui.panel", "chat.read"]` and add to `commands`:

```json
{
  "id": "count_messages",
  "title": "Greeter: Count messages",
  "description": "Counts the latest messages of the open conversation.",
  "required_context": ["conversation"],
  "required_capabilities": ["chat.read"]
}
```

In `plugin.ts`, next to `greet`:

```ts
count_messages: {
  async run({ args, host }) {
    const { messages, hasOlder } = await host.chat.listMessages(args.conversation_id as string, {
      limit: 50,
    });
    const shown = `${messages.length}${hasOlder ? "+" : ""}`;
    return { payload: messages.length, message: `${shown} messages` };
  },
},
```

The host adds `conversation_id` to `args` and lists the command only while a conversation is open.
Run `npm run bundle`, uninstall the old copy in Settings → Plugins and install the folder again.
The prompt now has a second checkbox, "Read your conversations: this plugin sees the messages
stored on this device, except those of encrypted DMs and groups." Unchecked, the command fails
with `CAPABILITY_DENIED`. The Permissions button reopens the prompt; revoking any permission stops
the plugin. Encrypted conversations also take `chat.read.encrypted` ([how](plugin-chat-methods.md)).

## 9. Publish from git

A plugin repository holds its build at the root, so **Install from git URL** finds a complete
plugin. Set `"entrypoint": "main.mjs"` in `rim-plugin.json` and the `bundle` script in
`package.json` to `rim-plugin-bundle --entry main.ts .`, then:

```sh
npx rim-plugin-bundle --in-place --entry main.ts .   # writes main.mjs beside the manifest
npx rim-plugin-bundle --check --entry main.ts .      # exits 1 when main.mjs is stale; run it in CI
printf 'node_modules/\ndist/\n' > .gitignore
git init && git add . && git commit -m "Add the Greeter plugin"
```

Push it to a host such as GitHub; others paste its `https://` URL into Settings → Plugins →
Install from git URL. With only `devDependencies` nothing more runs; with `dependencies` the app
shows the `npm install --production` it would run and asks first. A release can attach the
`.rimbundle` of `npm run bundle`, served with `Access-Control-Allow-Origin: *`, for Install from
link as `https://host/path/dev.example.greeter-0.1.0.rimbundle#sha256=<hash>`.

## 10. Sign and publish to a workspace

On a desktop that holds your account's identity key (Settings → Security), Settings → Plugins
shows **Sign and publish…** on each installed plugin. A plugin installed from git is signed as its
checkout's `origin` URL, commit and tree hash; any other as a bundle of its installed folder. Give
a publisher name and choose Sign. An Owner or Moderator of the workspace picks Recommended or
Required and chooses Publish; anyone else chooses Export… and hands the `.rimsig.json` to one, who
adds it in Workspace settings → Plugins → Add from files. Members find it in the palette's
"Workspace plugins" ([workspace plugins](workspace-plugins.md)).
