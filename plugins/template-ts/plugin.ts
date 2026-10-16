// The template plugin's commands. `main.ts` runs it; `plugin.test.ts` tests it
// against an in-memory host, with no RIM app needed.

import { definePlugin, ErrorCode, PluginError } from "@rim-platform/plugin-sdk";

export const PLUGIN_ID = "dev.example.template-ts";

/** A fresh plugin with its own greeting count. */
export function createPlugin() {
  let greetings = 0;

  return definePlugin({
    id: PLUGIN_ID,
    commands: {
      // A safe command: the palette, a keybind or a panel runs it straight away.
      greet: {
        run({ args, invoker }) {
          if (args.name !== undefined && typeof args.name !== "string") {
            throw new PluginError("name must be a string", { code: ErrorCode.INVALID_PARAMS });
          }
          const name = args.name?.trim() || invoker?.displayName || "world";
          greetings += 1;
          return {
            payload: `Hello, ${name}!`,
            message: `${greetings} greeting${greetings === 1 ? "" : "s"} so far`,
          };
        },
      },
      // A dangerous command: the host asks the user to confirm every run and
      // never lets the AI agent run it. `dangerous: true` must match the
      // manifest; the SDK refuses any run that arrives unconfirmed.
      reset_greetings: {
        dangerous: true,
        run({ host }) {
          const cleared = greetings;
          greetings = 0;
          host.log.info(`reset ${cleared} greetings`);
          return { payload: { cleared }, message: `Cleared ${cleared} greetings` };
        },
      },
    },
    onReady(host) {
      host.log.info(`ready on protocol v${host.protocolVersion}`);
    },
    onPrincipalChanged(principal, host) {
      // Store principalId if you need to, but never parse it.
      host.log.info(principal ? `signed in as ${principal.displayName}` : "signed out");
    },
  });
}
