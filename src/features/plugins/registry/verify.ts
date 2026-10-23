// The verification a client runs on a registry entry before it offers, installs or updates
// it, without trusting the server: the statement and its fields, the publisher's key log,
// the signature at `keySeq`, the manifest against this host's rules, and the fetched bundle.
// A git source's tree is checked by the desktop after its checkout.

import { getApiOrigin } from "../../../core/graphql/config";
import type { AppPlatform } from "../../../core/runtime/runtime";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import {
  PluginRuntimeKind,
  PluginSourceKind,
  type SignedStatementInput,
} from "../../../core/graphql/generated/schema-types";
import { verifyPluginManifest } from "../../key-identity/api/keyBackend";
import { fetchKeyLog } from "../../key-identity/api/keyIdentity";
import type {
  PluginManifestStatement,
  PluginManifestValidity,
} from "../../key-identity/browser/pluginManifest";
import { readBundle, sha256Hex } from "../web/bundle";
import { fetchBundle, fetchBundleOnDesktop, type InvokeImpl } from "../web/bundleLink";
import {
  checkInstall,
  parseManifestText,
  type PluginManifest,
} from "../../../../sdk/plugin-sdk/src/manifestRules";
import { rimOrigins } from "../web/pluginServices";
import type { RegistryEntry } from "./api";

/** An entry whose statement verified on this device. */
export interface VerifiedEntry {
  ok: true;
  entry: RegistryEntry;
  statement: PluginManifestStatement;
  validity: PluginManifestValidity;
  /** The statement's manifest as this host reads it. */
  manifest: PluginManifest;
  /** SHA-256 of the statement's payload, lowercase hex: what an install record keeps. */
  statementSha256: string;
}

/** An entry that failed verification, with the reason. It is never offered. */
export interface FailedEntry {
  ok: false;
  entry: RegistryEntry;
  reason: string;
  statementSha256: string;
}

export type EntryCheck = VerifiedEntry | FailedEntry;

/** What a client says about an entry whose publisher recovered their key. */
export const PUBLISHER_RECOVERED_TEXT =
  "The publisher recovered their key: ask for a re-signed version";

/** SHA-256 of a statement's payload as lowercase hex. */
export function statementSha256(payload: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(payload));
}

/** Whether a verified entry may be installed or updated: not withdrawn by a key recovery. */
export function isInstallable(check: EntryCheck): check is VerifiedEntry {
  return check.ok && check.validity.status === "valid";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The publisher's key log: this server's copy, else the one the entry keeps. */
export async function publisherKeyLog(
  principalId: string,
  stored: readonly SignedStatementInput[],
): Promise<SignedStatementInput[]> {
  const local = await fetchKeyLog(principalId);
  return local.length > 0 ? local : [...stored];
}

const KIND: Record<PluginManifestStatement["runtimeKind"], PluginRuntimeKind> = {
  DesktopLocalProcess: PluginRuntimeKind.DESKTOP_LOCAL_PROCESS,
  WebSandboxed: PluginRuntimeKind.WEB_SANDBOXED,
};

/** The columns the server copied from the statement must say what the statement says. */
function matchesStatement(entry: RegistryEntry, statement: PluginManifestStatement): boolean {
  const source = statement.source;
  const sourceMatches =
    source.kind === "bundle"
      ? entry.source.kind === PluginSourceKind.BUNDLE &&
        entry.source.bundleSha256 === source.sha256 &&
        entry.source.bundleSize === source.size
      : entry.source.kind === PluginSourceKind.GIT &&
        entry.source.gitUrl === source.url &&
        entry.source.gitCommit === source.commit &&
        entry.source.gitTreeSha256 === source.treeSha256;
  return (
    sourceMatches &&
    entry.pluginId === statement.pluginId &&
    entry.version === statement.version &&
    entry.runtimeKind === KIND[statement.runtimeKind] &&
    entry.manifest === statement.manifest
  );
}

/**
 * Verify a statement against its publisher's key log and this host's manifest rules, and
 * read it. `keyLog` is the publisher's log as step 2 picked it.
 */
export async function verifyStatement(
  statement: SignedStatementInput,
  keyLog: SignedStatementInput[],
): Promise<{
  statement: PluginManifestStatement;
  validity: PluginManifestValidity;
  manifest: PluginManifest;
}> {
  const verified = await verifyPluginManifest(statement, keyLog);
  const manifest = parseManifestText(verified.statement.manifest);
  checkInstall(manifest, { forbiddenOrigins: rimOrigins() });
  return { ...verified, manifest };
}

/** Steps 1 to 4 for a registry entry. Never throws: a failure is an entry with its reason. */
export async function checkEntry(entry: RegistryEntry): Promise<EntryCheck> {
  const hash = await statementSha256(entry.statement.payload);
  try {
    const keyLog = await publisherKeyLog(entry.publisherPrincipalId, entry.publisherKeyLog);
    const verified = await verifyStatement(entry.statement, keyLog);
    if (!matchesStatement(entry, verified.statement)) {
      throw new Error("the entry does not match its signed statement");
    }
    return { ok: true, entry, ...verified, statementSha256: hash };
  } catch (err) {
    return { ok: false, entry, reason: errorText(err), statementSha256: hash };
  }
}

/** Step 5 on bytes already in hand: size, hash, and a byte-identical `rim-plugin.json`. */
export async function checkBundleBytes(
  statement: PluginManifestStatement,
  bytes: Uint8Array,
): Promise<void> {
  if (statement.source.kind !== "bundle") throw new Error("this plugin does not come as a bundle");
  if (bytes.length !== statement.source.size) {
    throw new Error(
      `The bundle has ${bytes.length} bytes, not the ${statement.source.size} it was signed with.`,
    );
  }
  if ((await sha256Hex(bytes)) !== statement.source.sha256) {
    throw new Error("The bundle does not match the SHA-256 it was signed with.");
  }
  if (readBundle(bytes).manifestText !== statement.manifest) {
    throw new Error("The bundle's rim-plugin.json is not the signed manifest.");
  }
}

/**
 * Where to fetch an entry's bundle, and with which credentials: the server's own copy (a path,
 * or a URL on its origin) with the session; any other `https://` host without credentials.
 */
export function bundleRequest(bundleUrl: string): { url: string; credentials: RequestCredentials } {
  const api = new URL(getApiOrigin());
  const url = new URL(bundleUrl, api);
  if (url.origin === api.origin) return { url: url.href, credentials: "include" };
  if (url.protocol !== "https:") throw new Error("A bundle link must start with https://.");
  return { url: url.href, credentials: "omit" };
}

/**
 * Step 5 for a bundle source: fetch the entry's bundle and check it. The server's own copy is
 * fetched from the webview with the session on every platform. A bundle on another host is
 * fetched through the desktop host's `plugin_fetch_bundle` command on the desktop, which reads
 * hosts that send no `Access-Control-Allow-Origin`, and through the RIM server in the browser.
 * Either way the bytes must hash to the signed SHA-256.
 *
 * @param check - The verified entry.
 * @param platform - The platform this client runs on.
 * @returns The bundle's bytes, with the signed size, hash and manifest.
 */
export async function fetchEntryBundle(
  check: VerifiedEntry,
  platform: AppPlatform,
  fetchImpl: typeof fetch = fetch,
  invokeImpl: InvokeImpl = safeInvoke,
): Promise<Uint8Array> {
  const source = check.statement.source;
  const url = check.entry.source.bundleUrl;
  if (source.kind !== "bundle" || !url) throw new Error("this plugin does not come as a bundle");
  const request = bundleRequest(url);
  const bytes =
    platform === "desktop" && request.credentials === "omit"
      ? await fetchBundleOnDesktop(request.url, source.sha256, invokeImpl)
      : await fetchBundle(request.url, source.sha256, fetchImpl, request.credentials);
  await checkBundleBytes(check.statement, bytes);
  return bytes;
}
