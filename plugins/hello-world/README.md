# Hello World Plugin

Reference in-tree plugin for the RIM plugin host. Exercises the full
Phase 1 spawn → broker → capability-gate cycle.

It speaks plugin protocol v1, frozen in
[`protocol/plugin-protocol-v1.schema.json`](../../protocol/plugin-protocol-v1.schema.json).
The host's conformance tests (`src-tauri/src/plugin_host/protocol/conformance.rs`)
drive this script through every v1 message, so keep it conforming when you
change it.

## File layout

```
hello-world/
  rim-plugin.json          # Full manifest (v1)
  main.py                  # Plugin process — speaks plugin protocol v1
  panels/
    main/
      index.html           # Panel UI loaded in sandboxed iframe
      app.js               # Button click → rim.ui.notification.show postMessage
  README.md                # This file
```

## Prerequisites

- Python 3.8+ on `$PATH` (the entrypoint is `main.py` — the OS executes it
  directly via its shebang `#!/usr/bin/env python3`).
- RIM desktop app built and running (`npm run tauri dev`).

## How to enable

1. Copy (or symlink) this directory into `~/.rim/plugins/`:

   ```sh
   mkdir -p ~/.rim/plugins
   cp -r plugins/hello-world ~/.rim/plugins/
   ```

2. In the RIM app open **Settings → Plugins**.
3. The "Hello World" plugin appears in the list.
4. Click the toggle to enable it.  No capability prompt appears because the
   plugin declares no capabilities.

## What you should observe

### In the host log (`npm run tauri dev` terminal output)

```
[plugin_host] plugin dev.example.hello-world started
[plugin:dev.example.hello-world] [info] [hello-world] plugin process started (pid=…)
[plugin:dev.example.hello-world] [info] [hello-world] handshake complete — broker loop active
```

These three lines confirm:
- The Tauri `plugin_enable` command called `runtime::start_plugin`.
- The broker loop is running.
- The plugin process successfully completed the handshake.

### After running "Hello: Greet" from the command palette

The palette sends the command to the plugin process as `rim.command.execute`
and the plugin answers `"Hello, world!"`, shown in the success
toast.

### After clicking "Say Hello" in the panel

The panel sends `rim.ui.notification.show` via `window.parent.postMessage`.
In Phase 1 this is logged by the bridge (`pluginBridge.ts` logs at `debug`
level).  The real toast notification is wired in Phase 2.

To see the log, open the Tauri devtools console and filter for
`[RIM:PluginBridge]`.

## Capability model

The manifest declares no capabilities. A manifest may declare the built-in
names `chat.read`, `chat.write`, `events.read`, `ui.panel` and `ui.notify`, and
its own keys of the form `plugin.<plugin_id>.<verb>` with the verb in
`[a-z0-9_.]` (validated at install time by `validation.rs`). `greet` needs
none: it only answers the host.

The `ui.notify` capability gate is exercised by the panel's postMessage
handler in `pluginBridge.ts` (front-end side only in Phase 1).

## Manual smoke-test recipe (for Jakub)

Run this after building and starting `npm run tauri dev`:

1. Open a terminal and run:
   ```sh
   mkdir -p ~/.rim/plugins
   cp -r /path/to/rim-ui/plugins/hello-world ~/.rim/plugins/
   ```

2. Start the app: `cd /path/to/rim-ui && npm run tauri dev`

3. Open **Settings → Plugins**.

4. Verify "Hello World" appears in the list.

5. Toggle the plugin **ON**.

6. Observe the terminal:
   - `[plugin_host] plugin dev.example.hello-world started`
   - `[plugin:dev.example.hello-world] [info] [hello-world] plugin process started`
   - `[plugin:dev.example.hello-world] [info] [hello-world] handshake complete`

7. In the tool panel or main surface (if the plugin panel is rendered), click
   **Say Hello** and observe the browser devtools console for:
   `[RIM:PluginBridge] dev.example.hello-world notification: Hello World`

8. Open the command palette, run **Hello: Greet**, and observe a success
   toast containing `Hello, world!`.

9. Toggle the plugin **OFF**.

10. Observe: `[plugin_host] plugin dev.example.hello-world stopped`

All ten steps passing = Phase 1 proof-of-life confirmed.
