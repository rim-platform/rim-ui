// What signing a plugin on this desktop needs: whether this device holds the account's
// identity key, the source the Tauri host builds, and the name a statement starts with.

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import {
  fetchMyKeyIdentity,
  syncKeyLog,
  type MyKeyIdentity,
} from "../../key-identity/api/keyIdentity";
import type {
  SignedPluginSource,
  SignedRuntimeKind,
} from "../../key-identity/browser/pluginManifest";
import { decodeBase64 } from "../web/bundle";

/** A plugin's code as a statement names it, built by the Tauri host. */
export interface SigningSource {
  pluginId: string;
  version: string;
  displayName: string;
  runtimeKind: SignedRuntimeKind;
  /** The exact text of `rim-plugin.json`. */
  manifest: string;
  source: SignedPluginSource;
  /** The bundle file in standard base64, for a bundle source. */
  bundle: string | null;
  /** Where a picked bundle file is; null for one built from the installed folder. */
  bundlePath: string | null;
}

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** The source of an installed plugin: its git checkout, or a bundle of its folder. */
export function signingSourceOf(pluginId: string): Promise<SigningSource> {
  return invoke<SigningSource>("plugin_signing_source", { pluginId });
}

/** Ask for a `.rimbundle` to sign; null when the person cancels. */
export function pickSigningBundle(): Promise<SigningSource | null> {
  return invoke<SigningSource | null>("plugin_pick_signing_bundle");
}

/** Save a signature file, and a built bundle, where the person picks; null when cancelled. */
export function exportSignature(
  stem: string,
  signature: string,
  bundle: string | null,
  beside: string | null,
): Promise<string | null> {
  return invoke<string | null>("plugin_export_signature", { stem, signature, bundle, beside });
}

export function bundleBytes(source: SigningSource): Uint8Array | undefined {
  return source.bundle === null ? undefined : decodeBase64(source.bundle);
}

/** The display name on the published profile card, if there is one. */
export function profileCardName(identity: MyKeyIdentity): string | null {
  const payload = identity.profileCard?.statement.payload;
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { displayName?: unknown };
    return typeof parsed.displayName === "string" ? parsed.displayName : null;
  } catch {
    return null;
  }
}

/**
 * The account's key identity and whether this device holds its identity key, which signs
 * plugin manifests. Only the desktop signs them.
 */
export function usePluginSigning() {
  const { capabilities } = useRuntime();
  const identity = useQuery({
    queryKey: queryKeys.myKeyIdentity,
    queryFn: fetchMyKeyIdentity,
    enabled: capabilities.pluginSigning,
    retry: false,
  });
  const principalId = identity.data?.principalId ?? null;
  const holds = useQuery({
    queryKey: queryKeys.pluginSigning(principalId, identity.data?.keySeq ?? null),
    enabled: capabilities.pluginSigning && principalId !== null,
    retry: false,
    queryFn: async () =>
      (await syncKeyLog(identity.data as MyKeyIdentity))?.holdsIdentityKey ?? false,
  });
  return { canSign: holds.data === true, identity: identity.data };
}
