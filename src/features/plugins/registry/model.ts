// What the client says and decides about registry entries: the trust badge, the palette
// line, how an entry relates to what this device has installed, and whether an update installs
// on its own.

import { WorkspacePluginStatus } from "../../../core/graphql/generated/schema-types";
import { NETWORK_FETCH } from "../../../../sdk/plugin-sdk/src/manifestRules";
import { limitView, type LimitView } from "../../limits/limits";
import {
  runtimeKind,
  sameNetworkOrigins,
  type PluginInfo,
  type PluginInstallSource,
} from "../types";
import type { EntryCheck, VerifiedEntry } from "./verify";

const PRINCIPAL_PREFIX = "rimp1_";

/** The registry's entries against the instance's plugin cap; `null` without a cap. */
export function registryLimit(cap: number | null | undefined, entries: number): LimitView | null {
  return limitView(cap, entries, ["plugin", "plugins"], "plugins per workspace");
}

/** `rimp1_` and the first 8 characters after it: how a badge names a principal. */
export function shortPrincipal(principalId: string): string {
  if (!principalId.startsWith(PRINCIPAL_PREFIX)) return principalId.slice(0, 14);
  return PRINCIPAL_PREFIX + principalId.slice(PRINCIPAL_PREFIX.length, PRINCIPAL_PREFIX.length + 8);
}

/** Who signed an entry, as the badge shows them. */
export interface Publisher {
  principalId: string;
  /** The member's name when a member has this principal id, else the self-asserted name. */
  name: string;
  /** A member of this workspace has the publisher's principal id. */
  member: boolean;
}

/** A workspace member as the badge rule reads them. */
export interface MemberIdentity {
  principalId?: string | null;
  username: string;
  displayName?: string | null;
}

/**
 * The publisher of a statement: the workspace's name for the member with that principal id,
 * else the name the publisher chose, which proves nothing.
 */
export function publisherOf(
  principalId: string,
  publisherName: string,
  members: readonly MemberIdentity[],
): Publisher {
  const member = members.find((m) => m.principalId === principalId);
  return member
    ? { principalId, name: member.displayName || member.username, member: true }
    : { principalId, name: publisherName, member: false };
}

/** `Signed by Ada · rimp1_txDLbnip`, the name quoted and called out when not a member's. */
export function trustBadge(publisher: Publisher): string {
  const short = shortPrincipal(publisher.principalId);
  return publisher.member
    ? `Signed by ${publisher.name} · ${short}`
    : `Signed by “${publisher.name}” (not a member of this workspace) · ${short}`;
}

/** `Recommended` or `Required`, as entry lines start. */
export function statusWord(status: WorkspacePluginStatus): string {
  return status === WorkspacePluginStatus.REQUIRED ? "Required" : "Recommended";
}

/** `Recommended by Acme · signed by Ada (rimp1_txDLbnip)`, the palette's second column. */
export function paletteLine(
  status: WorkspacePluginStatus,
  workspaceName: string,
  publisher: Publisher,
): string {
  const short = shortPrincipal(publisher.principalId);
  const signer = publisher.member
    ? `signed by ${publisher.name} (${short})`
    : `signed by “${publisher.name}”, not a member of this workspace (${short})`;
  return `${statusWord(status)} by ${workspaceName} · ${signer}`;
}

/** `Bundle 5b154b3e… · 1.6 KB`, or `git github.com/acme/k8s-pods @ 1a2b3c4d`. */
export function sourceLine(source: VerifiedEntry["statement"]["source"]): string {
  if (source.kind === "bundle") {
    return `Bundle ${source.sha256.slice(0, 8)}… · ${formatSize(source.size)}`;
  }
  const where = source.url.replace(/^(https|ssh):\/\/([^@/]*@)?/, "").replace(/\.git$/, "");
  return `git ${where} @ ${source.commit.slice(0, 8)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Where this device's copy of an entry's plugin stands. */
export type InstallState =
  | { kind: "notInstalled" }
  /** Installed from this entry's statement (from this or another workspace). */
  | { kind: "installed"; plugin: PluginInfo }
  /** Installed from this workspace's registry at another statement: an update is due. */
  | { kind: "otherStatement"; plugin: PluginInfo; publisherChanged: boolean }
  /** Installed from another workspace's registry at another statement. */
  | { kind: "otherWorkspace"; plugin: PluginInfo; serverId: string; publisherChanged: boolean }
  /** A copy of the same id from a folder, git or a link: unsigned. */
  | { kind: "local"; plugin: PluginInfo };

type RegistrySource = Extract<PluginInstallSource, { kind: "registry" }>;

/** The registry source of an install, if it came from a registry. */
export function registrySource(plugin: PluginInfo): RegistrySource | null {
  return plugin.source?.kind === "registry" ? plugin.source : null;
}

/** Whether an install came from `serverId`'s registry on the server at `endpoint`. */
export function fromWorkspace(plugin: PluginInfo, endpoint: string, serverId: string): boolean {
  const source = registrySource(plugin);
  return source !== null && source.endpoint === endpoint && source.serverId === serverId;
}

export function installState(
  check: EntryCheck,
  installed: readonly PluginInfo[],
  endpoint: string,
  serverId: string,
): InstallState {
  const plugin = installed.find((p) => p.plugin_id === check.entry.pluginId);
  if (!plugin) return { kind: "notInstalled" };
  const source = registrySource(plugin);
  if (!source) return { kind: "local", plugin };
  if (source.statementSha256 === check.statementSha256) return { kind: "installed", plugin };
  const publisherChanged = source.publisherPrincipalId !== check.entry.publisherPrincipalId;
  if (source.endpoint === endpoint && source.serverId === serverId) {
    return { kind: "otherStatement", plugin, publisherChanged };
  }
  return { kind: "otherWorkspace", plugin, serverId: source.serverId, publisherChanged };
}

/** Whether an entry can run on this device: the web app runs only sandboxed plugins. */
export function runsHere(check: EntryCheck, desktop: boolean): boolean {
  return desktop || check.entry.runtimeKind !== "DESKTOP_LOCAL_PROCESS";
}

/** What an update of an installed copy to a verified entry changes, and whether it waits. */
export interface UpdatePlan {
  /** Installs at once: same kind and publisher, nothing new to consent to. */
  automatic: boolean;
  publisherChanged: boolean;
  kindChanged: boolean;
  /** Capabilities neither asked for by the installed copy nor approved. */
  newCapabilities: string[];
  /** AI-callable commands neither in the installed copy nor consented to. */
  newAiCommands: string[];
  /** `network.fetch` is approved and the entry lists other sites, so it is asked for again. */
  sitesChanged: boolean;
}

/**
 * Plan the update of `plugin` to `check`. It installs at once when it keeps the runtime kind
 * and the publisher, asks for no capability the person was not already asked for or approved,
 * adds no AI-callable command beyond those already there or consented, and keeps the sites an
 * approved `network.fetch` reaches. Post-install steps are the host's to find: a git update
 * that needs one waits for consent there.
 */
export function planUpdate(plugin: PluginInfo, check: VerifiedEntry): UpdatePlan {
  const source = registrySource(plugin);
  const publisherChanged = source?.publisherPrincipalId !== check.entry.publisherPrincipalId;
  const kindChanged = runtimeKind(plugin) !== check.manifest.runtime_kind;
  const asked = new Set([...plugin.capabilities, ...plugin.approved_capabilities]);
  const newCapabilities = check.manifest.capabilities.filter((c) => !asked.has(c));
  const known = new Set([...plugin.ai_callable_commands, ...plugin.approved_ai_commands]);
  const newAiCommands = check.manifest.commands
    .filter((c) => c.ai_callable && !known.has(c.id))
    .map((c) => c.id);
  const sitesChanged =
    plugin.approved_capabilities.includes(NETWORK_FETCH) &&
    check.manifest.capabilities.includes(NETWORK_FETCH) &&
    !sameNetworkOrigins(plugin.network_origins, check.manifest.network_origins);
  return {
    automatic:
      !publisherChanged &&
      !kindChanged &&
      newCapabilities.length === 0 &&
      newAiCommands.length === 0 &&
      !sitesChanged,
    publisherChanged,
    kindChanged,
    newCapabilities,
    newAiCommands,
    sitesChanged,
  };
}
