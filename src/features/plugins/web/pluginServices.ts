// What the web plugin host needs from where plugins are installed: on the
// desktop, Tauri commands over the Rust `PluginStateStore` and plugin folders;
// on the web, IndexedDB (`browserPluginStore.ts`).

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import type { PluginInstallResult, PluginInstallSource } from "../types";
import { decodeBase64, encodeBase64, type BundleFile } from "./bundle";
import { ErrorCode, RpcError, type PrincipalMapping } from "./rpc";
import type { HostServices, LoadedPlugin } from "./webPluginHost";

/** A bundle the UI fetched and hashed, ready to install. */
export interface BundleInstall {
  bytes: Uint8Array;
  sha256: string;
  source: PluginInstallSource;
  /** Replace an installed plugin of the same id. */
  replace: boolean;
  /** The signed manifest the bundle's `rim-plugin.json` must equal byte for byte. */
  manifest?: string;
  /** Keep the replaced copy's approvals and state: an update that asks for nothing new. */
  keepApprovals?: boolean;
}

/** The host's services, plus installing bundles and the agent's consent gate. */
export interface PluginServices extends HostServices {
  installBundle(install: BundleInstall): Promise<PluginInstallResult>;
  /** Refuses unless the user consented to the agent running this command. */
  checkAiConsent(pluginId: string, commandId: string): Promise<void>;
  /** Every provisional-to-key principal mapping this device knows. */
  mappings(): Promise<PrincipalMapping[]>;
  /** Make a registry install a local one: no registry source and no updates. */
  detachRegistry(pluginId: string): Promise<void>;
}

/**
 * Origins a plugin may never reach: the RIM API's (from the GraphQL endpoint)
 * and the app's own.
 */
export function rimOrigins(): string[] {
  const origins = [window.location.origin];
  try {
    origins.push(new URL(getGraphqlEndpoint(), window.location.origin).origin);
  } catch {
    // An endpoint that does not parse names no origin to keep out.
  }
  return origins;
}

/** A Tauri command's failure as the JSON-RPC error a plugin gets. */
function toRpcError(error: {
  kind: string;
  message: string;
  code?: string;
  data?: unknown;
}): RpcError {
  const code = "code" in error ? error.code : undefined;
  if (code === "INVALID_PARAMS")
    return new RpcError(ErrorCode.INVALID_PARAMS, error.message, error.data);
  return new RpcError(ErrorCode.INTERNAL_ERROR, error.message);
}

async function invokeOrThrow<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (!result.ok) throw result.error;
  return result.value;
}

/** The desktop's services: the Rust host keeps installs, files and storage. */
export const desktopPluginServices: PluginServices = {
  async loadFiles(pluginId): Promise<LoadedPlugin> {
    const loaded = await invokeOrThrow<{
      manifest: string;
      files: { path: string; base64: string }[];
    }>("plugin_web_files", { pluginId });
    const files: BundleFile[] = loaded.files.map((f) => ({
      path: f.path,
      bytes: decodeBase64(f.base64),
    }));
    return { manifestText: loaded.manifest, files };
  },

  async setStarting(pluginId, starting) {
    await invokeOrThrow<null>("plugin_set_starting", { pluginId, starting });
  },

  async storageGet(pluginId, key) {
    const result = await safeInvoke<unknown>("plugin_storage_get", { pluginId, key });
    if (!result.ok) throw toRpcError(result.error);
    return result.value;
  },

  async storageSet(pluginId, key, value) {
    const result = await safeInvoke<null>("plugin_storage_set", { pluginId, key, value });
    if (!result.ok) throw toRpcError(result.error);
  },

  installBundle({ bytes, sha256, source, replace, manifest, keepApprovals }) {
    return invokeOrThrow<PluginInstallResult>("plugin_install_bundle", {
      bundle: encodeBase64(bytes),
      sha256,
      source,
      replace,
      manifest: manifest ?? null,
      keepApprovals: keepApprovals === true,
      forbiddenOrigins: rimOrigins(),
    });
  },

  async detachRegistry(pluginId) {
    await invokeOrThrow<null>("plugin_detach_registry", { pluginId });
  },

  async checkAiConsent(pluginId, commandId) {
    await invokeOrThrow<null>("plugin_check_ai_consent", { pluginId, commandId });
  },

  async mappings() {
    const result = await safeInvoke<PrincipalMapping[]>("plugin_principal_mappings", {});
    return result.ok ? result.value : [];
  },
};
