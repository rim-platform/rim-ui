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
  package.json      # the SDK, esbuild, TypeScript and Vitest as dev dependencies
  tsconfig.json
```

## Make it yours

1. Copy the folder and change `plugin_id` in `rim-plugin.json` and `PLUGIN_ID` in
   `plugin.ts` to your own reverse-domain id.
2. Outside rim-ui, `npm install` installs `@rim-platform/plugin-sdk` from npm; the
   imports stay as they are. In rim-ui the npm workspace links the package to
   `sdk/plugin-sdk` instead. The SDK's README says how a plugin repository commits its
   build.
3. Add each command to the manifest and to `commands` in `plugin.ts`. Mark anything
   that changes or deletes something `dangerous` in both places.

## Run it

- Tests: `npm test` here or in rim-ui runs `plugin.test.ts`, and in rim-ui the SDK's
  stdio test starts this plugin as a real process.
- In the app: `npm run plugin:bundle -- plugins/template-ts`, then
  `cp -r plugins/template-ts/dist/dev.example.template-ts ~/.rim/plugins/`, start
  RIM, and enable "TypeScript Template" in **Settings → Plugins**. Run
  **Template: Greet** from the command palette.
