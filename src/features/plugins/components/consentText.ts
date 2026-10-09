import type { PluginRuntimeKind } from "../types";
import { parseNetworkOrigin, siteOf } from "../web/manifestRules";

/** What kind of plugin this is, in the app's words, above the permissions it asks for. */
export const KIND_CONSENT_TEXT: Record<PluginRuntimeKind, string> = {
  WebSandboxed:
    "Runs sandboxed in this app. It cannot read your files, run programs, or use your RIM session. It reaches RIM only through the permissions below.",
  DesktopLocalProcess:
    "Runs as a program on this computer with your account's access. It is not sandboxed: it can read your files and use the network whatever you approve below. Install it only if you trust its author.",
};

/** The sites `network.fetch` reaches, as a person reads them: no scheme, no default port. */
export function listedSites(origins: readonly string[]): string[] {
  return origins.map((origin) => {
    try {
      return siteOf(parseNetworkOrigin(origin));
    } catch {
      return origin;
    }
  });
}

/** The prompt's `network.fetch` line, naming every listed site. */
export function networkFetchText(origins: readonly string[]): string {
  return `send and receive data from ${listedSites(origins).join(", ")}. Anything you show this plugin can be sent to these sites.`;
}
