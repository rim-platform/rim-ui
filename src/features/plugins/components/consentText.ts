import type { PluginRuntimeKind } from "../types";
import { parseNetworkOrigin, siteOf } from "../../../../sdk/plugin-sdk/src/manifestRules";

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

/**
 * The prompt's chat lines: what each chat capability lets the plugin do, in one sentence
 * whose words before the colon name it. The encrypted ones widen the plain ones.
 */
export const CHAT_CONSENT_TEXT = {
  "chat.read":
    "Read your conversations: this plugin sees the messages stored on this device, except those of encrypted DMs and groups.",
  "chat.write":
    "Post as you: this plugin sends messages in your name, except in encrypted DMs and groups.",
  "chat.read.encrypted":
    "Read your encrypted DMs and groups: this plugin sees their decrypted text and can send it anywhere its other permissions allow.",
  "chat.write.encrypted":
    "Post as you in your encrypted DMs and groups: this plugin sends messages in your name there, encrypted like your own.",
} as const;

export type ChatCapability = keyof typeof CHAT_CONSENT_TEXT;

export function isChatCapability(capability: string): capability is ChatCapability {
  return capability in CHAT_CONSENT_TEXT;
}

/** The plain capability an encrypted one requires, or `null`. */
export function plainCapabilityOf(capability: string): string | null {
  if (capability === "chat.read.encrypted") return "chat.read";
  if (capability === "chat.write.encrypted") return "chat.write";
  return null;
}
