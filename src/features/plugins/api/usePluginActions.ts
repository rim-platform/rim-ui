import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { reloadCommands } from "../../commands/api/useCommands";
import { safeInvoke, type PluginIpcError } from "./ipc";
import { safeInvoke as coreSafeInvoke } from "../../../core/tauri/safeInvoke";
import type { PluginInstallResult } from "../types";
import { browserPluginStore } from "../web/browserPluginStore";
import { readBundle, type Bundle } from "../web/bundle";
import { fetchBundle, parseBundleLink, type BundleLink } from "../web/bundleLink";
import { checkInstall } from "../web/manifestRules";
import { rimOrigins } from "../web/pluginServices";
import { pluginServices } from "../web/webPluginEnvironment";

export function usePluginEnable() {
  const qc = useQueryClient();
  const { platform } = useRuntime();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) =>
      platform === "web"
        ? browserPluginStore.enable(pluginId)
        : safeInvoke("plugin_enable", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

export function usePluginDisable() {
  const qc = useQueryClient();
  const { platform } = useRuntime();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) =>
      platform === "web"
        ? browserPluginStore.disable(pluginId)
        : safeInvoke("plugin_disable", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

export function usePluginUninstall() {
  const qc = useQueryClient();
  const { platform } = useRuntime();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) =>
      platform === "web"
        ? browserPluginStore.uninstall(pluginId)
        : safeInvoke("plugin_uninstall", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

/**
 * Install a plugin from a local folder on disk.
 *
 * Opens a Tauri folder-picker dialog (caller is responsible for that), then calls
 * `plugin_install_from_local` with the selected path.  On success the plugin list
 * is invalidated so the UI refreshes.
 *
 * @returns TanStack mutation — `mutate(path)` where `path` is an absolute folder path.
 */
export function usePluginInstallFromLocal() {
  const qc = useQueryClient();

  return useMutation<PluginInstallResult | undefined, PluginIpcError, string>({
    mutationFn: async (path) => {
      const result = await coreSafeInvoke<PluginInstallResult>("plugin_install_from_local", {
        path,
        forbiddenOrigins: rimOrigins(),
      });
      if (!result.ok) {
        if (result.error.kind === "ipc_unavailable") return undefined;
        throw result.error;
      }
      return result.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

/** Variables for {@link usePluginInstallFromGit}. */
export interface GitInstallVariables {
  url: string;
  branch?: string;
  /**
   * Explicit user consent to run the plugin's dependency-install steps
   * (npm/pip), which execute code from the plugin author. Only set this to
   * `true` after the user confirmed the exact steps returned in a
   * `POST_INSTALL_CONSENT_REQUIRED` error (see `parsePostInstallConsent`).
   */
  allowPostInstall?: boolean;
}

/**
 * Install a plugin from a git URL.
 *
 * Calls `plugin_install_from_git` with the supplied URL and optional branch.
 * On success the plugin list is invalidated so the UI refreshes.
 *
 * Error contract (thrown as `PluginIpcError`, `kind: "backend_error"`):
 * - `INVALID_GIT_URL` / `INVALID_GIT_BRANCH` — rejected before git ran; show `message`.
 * - `POST_INSTALL_CONSENT_REQUIRED` — nothing was installed; `data` lists the exact
 *   npm/pip steps. Ask the user, then retry with `allowPostInstall: true`.
 *
 * @returns TanStack mutation — `mutate({ url, branch?, allowPostInstall? })`.
 */
export function usePluginInstallFromGit() {
  const qc = useQueryClient();

  return useMutation<PluginInstallResult | undefined, PluginIpcError, GitInstallVariables>({
    mutationFn: async ({ url, branch, allowPostInstall }) => {
      const result = await coreSafeInvoke<PluginInstallResult>("plugin_install_from_git", {
        url,
        branch: branch ?? null,
        allowPostInstall: allowPostInstall === true,
        forbiddenOrigins: rimOrigins(),
      });
      if (!result.ok) {
        if (result.error.kind === "ipc_unavailable") return undefined;
        throw result.error;
      }
      return result.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}

/**
 * Accept the new bundle fingerprint for a plugin whose fingerprint has changed.
 *
 * This is the "Trust new version" action in the UI.  After this call the plugin's
 * `fingerprint_changed` flag is cleared and the user can enable the plugin normally.
 *
 * @returns TanStack mutation — `mutate(pluginId)`.
 */
export function usePluginTrustFingerprint() {
  const qc = useQueryClient();

  return useMutation<void, PluginIpcError, string>({
    mutationFn: (pluginId) => safeInvoke("plugin_trust_fingerprint", { pluginId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
    },
  });
}

/** A bundle fetched from a pasted link and checked, waiting for the user to install it. */
export interface FetchedLinkBundle {
  link: BundleLink;
  bytes: Uint8Array;
  bundle: Bundle;
}

/**
 * Fetch the bundle a pasted `…#sha256=…` link names and check it: the hash, the
 * bundle rules and the manifest rules of this host. Nothing is installed yet,
 * so the UI can show what it is, and what changed when it replaces a plugin.
 */
export async function fetchLinkBundle(input: string): Promise<FetchedLinkBundle> {
  const link = parseBundleLink(input);
  const bytes = await fetchBundle(link.url, link.sha256);
  const bundle = readBundle(bytes);
  checkInstall(bundle.manifest, { forbiddenOrigins: rimOrigins() });
  return { link, bytes, bundle };
}

/** Install a bundle fetched from a link; `replace` installs over the same plugin id. */
export function usePluginInstallFromLink() {
  const qc = useQueryClient();
  const { platform } = useRuntime();

  return useMutation<PluginInstallResult, Error, { fetched: FetchedLinkBundle; replace: boolean }>({
    mutationFn: ({ fetched, replace }) =>
      pluginServices(platform).installBundle({
        bytes: fetched.bytes,
        sha256: fetched.link.sha256,
        source: { kind: "link", url: fetched.link.url, sha256: fetched.link.sha256 },
        replace,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
    },
  });
}
