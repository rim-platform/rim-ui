// The template plugin's commands and its one setting. `main.ts` runs it;
// `plugin.test.ts` tests it against an in-memory host, with no RIM app needed.

import {
  definePlugin,
  ErrorCode,
  HostRequestError,
  PluginError,
  type Host,
} from "@rim-platform/plugin-sdk";

export const PLUGIN_ID = "dev.example.template-ts";

/** The `default` of the `greeting` setting in `rim-plugin.json`. */
const DEFAULT_GREETING = "Hello";

/** A fresh plugin with its own greeting count. */
export function createPlugin() {
  let greetings = 0;
  let greeting = DEFAULT_GREETING;

  // A value saved under an older version may not fit, so each one is checked.
  const applySettings = (values: Readonly<Record<string, unknown>>) => {
    const saved = values.greeting;
    greeting = typeof saved === "string" && saved.trim() ? saved.trim() : DEFAULT_GREETING;
  };

  const readSettings = async (host: Host) => {
    try {
      applySettings(await host.settings.get());
    } catch (error) {
      // A host from before settings has none to give: keep the default.
      if (error instanceof HostRequestError && error.code === ErrorCode.METHOD_NOT_FOUND) return;
      host.log.warn(`settings not read: ${(error as Error).message}`);
    }
  };

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
            payload: `${greeting}, ${name}!`,
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
    async onReady(host) {
      host.log.info(`ready on protocol v${host.protocolVersion}`);
      await readSettings(host);
    },
    onPrincipalChanged(principal, host) {
      // Store principalId if you need to, but never parse it.
      host.log.info(principal ? `signed in as ${principal.displayName}` : "signed out");
    },
    // The user saved the settings, or another account signed in: the whole set.
    onSettingsChanged(values) {
      applySettings(values);
    },
  });
}
