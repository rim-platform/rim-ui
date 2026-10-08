# TypeScript template plugin

A starting point for a RIM plugin written with the
[TypeScript SDK](../../sdk/plugin-sdk/README.md). It has two commands:

- **Template: Greet** (`greet`), a safe command: greets the `name` argument or the
  signed-in user and counts the greetings.
- **Template: Reset greeting count** (`reset_greetings`), a dangerous command: the app
  asks you to confirm it, the AI agent can never run it, and the SDK refuses it if it
  ever arrives unconfirmed.

## Files

```
template-ts/
  rim-plugin.json   # manifest: id, commands, the dangerous flag
  main.ts           # entrypoint the host runs (executable, #!/usr/bin/env node)
  plugin.ts         # the commands
  plugin.test.ts    # tests against the SDK's in-memory host
  tsconfig.json
```

## Make it yours

1. Copy the folder and change `plugin_id` in `rim-plugin.json` and `PLUGIN_ID` in
   `plugin.ts` to your own reverse-domain id.
2. Outside rim-ui, depend on the SDK and import from `@rim/plugin-sdk` instead of the
   relative path in `plugin.ts` and `plugin.test.ts`. Node will not run TypeScript
   from `node_modules`, so run it bundled (`npx rim-plugin-bundle .`) rather than
   from `main.ts`.
3. Add each command to the manifest and to `commands` in `plugin.ts`. Mark anything
   that changes or deletes something `dangerous` in both places.

## Run it

- Tests: `npm test` in rim-ui runs `plugin.test.ts`, and the SDK's stdio test starts
  this plugin as a real process.
- In the app: `npm run plugin:bundle -- plugins/template-ts`, then
  `cp -r plugins/template-ts/dist/dev.example.template-ts ~/.rim/plugins/`, start
  RIM, and enable "TypeScript Template" in **Settings → Plugins**. Run
  **Template: Greet** from the command palette.
