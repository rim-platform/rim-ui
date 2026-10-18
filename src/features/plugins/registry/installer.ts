// Installing, updating and letting go of registry plugins on this device. Each install records
// where it came from: the server, the workspace, the plugin id, the statement's hash and the
// publisher, so updates follow the entry and removals find it.

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import type { AppPlatform } from "../../../core/runtime/runtime";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import type { PluginInfo, PluginInstallResult, PluginInstallSource } from "../types";
import { browserPluginStore } from "../web/browserPluginStore";
import { rimOrigins } from "../web/pluginServices";
import { pluginServices } from "../web/webPluginEnvironment";
import { webPluginHost } from "../web/webPluginHost";
import { fetchEntryBundle, type VerifiedEntry } from "./verify";

/** The API endpoint install records name, as key identity names its server. */
export function registryEndpoint(): string {
  return getGraphqlEndpoint();
}

/** The install record's source for a verified entry. */
export function registryInstallSource(check: VerifiedEntry): PluginInstallSource {
  return {
    kind: "registry",
    endpoint: registryEndpoint(),
    serverId: check.entry.serverId,
    pluginId: check.entry.pluginId,
    statementSha256: check.statementSha256,
    publisherPrincipalId: check.entry.publisherPrincipalId,
  };
}

/** How to install an entry. */
export interface InstallOptions {
  /** Install over a copy of the same plugin id. */
  replace: boolean;
  /** Carry the replaced copy's approvals and state over: an update with nothing new. */
  keepApprovals?: boolean;
  /** The person consented to a git source's post-install steps. */
  allowPostInstall?: boolean;
  /** The bundle, already fetched and checked. */
  bytes?: Uint8Array;
}

/** The message of whatever an install threw: an `Error` or a Tauri command's error. */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/**
 * Install a verified entry: a bundle source is fetched and checked (step 5) and installed by
 * the platform's store; a git source is checked out at its commit by the desktop, which checks
 * the tree hash before anything runs. Throws a Tauri error as is, so a post-install consent
 * request can be read from it.
 */
export async function installEntry(
  platform: AppPlatform,
  check: VerifiedEntry,
  options: InstallOptions,
): Promise<PluginInstallResult> {
  const source = registryInstallSource(check);
  const signed = check.statement;
  if (signed.source.kind === "git") {
    if (platform !== "desktop") throw new Error("This plugin needs the desktop app.");
    const result = await safeInvoke<PluginInstallResult>("plugin_install_registry_git", {
      url: signed.source.url,
      commit: signed.source.commit,
      treeSha256: signed.source.treeSha256,
      manifest: signed.manifest,
      source,
      allowPostInstall: options.allowPostInstall === true,
      replace: options.replace,
      keepApprovals: options.keepApprovals === true,
      forbiddenOrigins: rimOrigins(),
    });
    if (!result.ok) throw result.error;
    return result.value;
  }
  const bytes = options.bytes ?? (await fetchEntryBundle(check, platform));
  // A running web plugin is stopped first; the host starts the new copy once it is listed.
  if (options.replace && webPluginHost.knows(signed.pluginId)) {
    await webPluginHost.stop(signed.pluginId);
  }
  return pluginServices(platform).installBundle({
    bytes,
    sha256: signed.source.sha256,
    source,
    replace: options.replace,
    manifest: signed.manifest,
    keepApprovals: options.keepApprovals,
  });
}

/** Stop and turn off a plugin: the first thing done when its entry disappears. */
export async function stopPlugin(platform: AppPlatform, plugin: PluginInfo): Promise<void> {
  if (webPluginHost.knows(plugin.plugin_id)) await webPluginHost.stop(plugin.plugin_id);
  if (!plugin.enabled) return;
  if (platform === "desktop") {
    const result = await safeInvoke<null>("plugin_disable", { pluginId: plugin.plugin_id });
    if (!result.ok) throw result.error;
  } else {
    await browserPluginStore.disable(plugin.plugin_id);
  }
}

/** Remove a plugin and its storage. */
export async function uninstallPlugin(platform: AppPlatform, pluginId: string): Promise<void> {
  if (platform === "desktop") {
    const result = await safeInvoke<null>("plugin_uninstall", { pluginId });
    if (!result.ok) throw result.error;
  } else {
    await browserPluginStore.uninstall(pluginId);
  }
}

/** Keep a plugin whose entry is gone as a local install: no registry source, no updates. */
export function keepAsLocal(platform: AppPlatform, pluginId: string): Promise<void> {
  return pluginServices(platform).detachRegistry(pluginId);
}
