/**
 * Plugin manifest statements in the browser: a publisher's identity key signing the exact
 * `rim-plugin.json` of one plugin version and where its code comes from. The same rules, in the
 * same order and with the same messages, as the Tauri side's `plugin_manifest.rs` and the
 * server's verifier.
 *
 * `JSON.parse` keeps the last of two fields with one name, so the payload is scanned for
 * duplicates before what it parsed is trusted.
 */

import { findDuplicateKey } from "../../plugins/web/bundle";
import { utf8 } from "./bytes";
import { CONTEXT, replay, verify, type KeyHead, type Statement } from "./statements";

export const MAX_PAYLOAD_LEN = 96 * 1024;
export const MAX_PUBLISHER_NAME_CHARS = 80;
export const MAX_PLUGIN_VERSION_CHARS = 64;
export const MAX_MANIFEST_LEN = 64 * 1024;
export const MAX_BUNDLE_SIZE = 8 * 1024 * 1024;
export const MAX_GIT_URL_LEN = 2048;

/** Where the signed plugin's code comes from. Hashes are lowercase hex. */
export type SignedPluginSource =
  | { kind: "bundle"; sha256: string; size: number }
  | { kind: "git"; url: string; commit: string; treeSha256: string };

export type SignedRuntimeKind = "DesktopLocalProcess" | "WebSandboxed";

/** A plugin manifest statement whose fields passed every rule. */
export interface PluginManifestStatement {
  principalId: string;
  keySeq: number;
  /** Trimmed. Chosen by the publisher, so it proves nothing about who they are. */
  publisherName: string;
  pluginId: string;
  version: string;
  /** The exact text of `rim-plugin.json`. */
  manifest: string;
  displayName: string;
  runtimeKind: SignedRuntimeKind;
  source: SignedPluginSource;
  issuedAt: string;
}

/** Whether a verified statement still stands. */
export type PluginManifestValidity =
  | { status: "valid" }
  /** The key log entry at `atSeq`, after the statement's `keySeq`, is a recovery rotation. */
  | { status: "publisherRecovered"; atSeq: number };

export interface VerifiedPluginManifest {
  statement: PluginManifestStatement;
  validity: PluginManifestValidity;
}

/** A plugin manifest statement this module refused; its message says why. */
export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginManifestError";
  }
}

/** A replayed key log: every entry's identity key and who signed it, oldest first. */
export interface KeyHistory {
  principalId: string;
  identityKeys: string[];
  signers: KeyHead["signers"];
}

/** Verify a whole key log, oldest entry first. */
export async function replayHistory(log: Statement[]): Promise<KeyHistory> {
  return replay(log);
}

/** The seq of the first recovery rotation after entry `seq`, if there is one. */
export function recoveryAfter(history: KeyHistory, seq: number): number | null {
  for (let at = seq + 1; at < history.signers.length; at++) {
    if (history.signers[at] === "recovery") return at;
  }
  return null;
}

type Fields = Record<string, unknown>;

const STATEMENT_FIELDS = [
  "v",
  "type",
  "principalId",
  "keySeq",
  "publisherName",
  "pluginId",
  "version",
  "manifest",
  "source",
  "issuedAt",
];
const SOURCE_FIELDS = ["kind", "sha256", "size", "url", "commit", "treeSha256"];
const RFC_3339 = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const U32 = 0xffffffff;

function refused(message: string): PluginManifestError {
  return new PluginManifestError(message);
}

function malformed(message: string): PluginManifestError {
  return refused(`statement payload is not valid: ${message}`);
}

function isObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUint(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** The object's fields, refusing unknown ones and missing required ones. */
function shape(object: Fields, allowed: string[], required: string[]): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw malformed(`unknown field \`${key}\``);
  }
  for (const key of required) {
    if (!(key in object)) throw malformed(`missing field \`${key}\``);
  }
}

function string(object: Fields, key: string): string {
  const value = object[key];
  if (typeof value !== "string") throw malformed(`invalid type for \`${key}\`, expected a string`);
  return value;
}

/** A source field that may be absent; `null` reads as absent, as serde's `Option` does. */
function optional<T>(object: Fields, key: string, read: (v: unknown) => v is T): T | undefined {
  const value = object[key];
  if (value === undefined || value === null) return undefined;
  if (!read(value)) throw malformed(`invalid type for \`source.${key}\``);
  return value;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isSize = (v: unknown): v is number => isUint(v, Number.MAX_SAFE_INTEGER);

function lowerHex(text: string, ...lengths: number[]): boolean {
  return lengths.includes(text.length) && /^[0-9a-f]*$/.test(text);
}

function label(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || [...trimmed].length > max) {
    throw refused(`${field} must be 1 to ${max} characters`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
    throw refused(`${field} must not contain control characters`);
  }
  return trimmed;
}

interface ManifestHead {
  pluginId: string;
  displayName: string;
  version: string;
  runtimeKind: string;
}

function readManifest(manifest: string): ManifestHead {
  if (utf8(manifest).length > MAX_MANIFEST_LEN) {
    throw refused(`manifest must be at most ${MAX_MANIFEST_LEN} bytes`);
  }
  if (!manifest.trimStart().startsWith("{")) throw refused("manifest must be a JSON object");
  let value: unknown;
  try {
    value = JSON.parse(manifest);
  } catch (err) {
    throw refused(`manifest is not valid: ${(err as Error).message}`);
  }
  const duplicate = findDuplicateKey(manifest);
  if (duplicate !== null) throw refused(`manifest is not valid: duplicate field \`${duplicate}\``);
  if (!isObject(value)) throw refused("manifest must be a JSON object");
  const field = (key: string): unknown => {
    if (!(key in value)) throw refused(`manifest is not valid: missing field \`${key}\``);
    return value[key];
  };
  const text = (key: string): string => {
    const v = field(key);
    if (typeof v !== "string") throw refused(`manifest is not valid: \`${key}\` is not a string`);
    return v;
  };
  if (!isUint(field("manifest_version"), Number.MAX_SAFE_INTEGER)) {
    throw refused("manifest is not valid: `manifest_version` is not an unsigned integer");
  }
  return {
    pluginId: text("plugin_id"),
    displayName: text("display_name"),
    version: text("version"),
    runtimeKind: text("runtime_kind"),
  };
}

function readSource(raw: Fields): SignedPluginSource {
  const kind = string(raw, "kind");
  const sha256 = optional(raw, "sha256", isString);
  const size = optional(raw, "size", isSize);
  const url = optional(raw, "url", isString);
  const commit = optional(raw, "commit", isString);
  const treeSha256 = optional(raw, "treeSha256", isString);
  const bundle =
    kind === "bundle" && sha256 !== undefined && size !== undefined && url === undefined;
  if (bundle && commit === undefined && treeSha256 === undefined) {
    if (!lowerHex(sha256, 64)) throw refused("source.sha256 must be 64 lowercase hex characters");
    if (size < 1 || size > MAX_BUNDLE_SIZE) {
      throw refused(`source.size must be 1 to ${MAX_BUNDLE_SIZE}`);
    }
    return { kind: "bundle", sha256, size };
  }
  const git =
    kind === "git" &&
    sha256 === undefined &&
    size === undefined &&
    url !== undefined &&
    commit !== undefined &&
    treeSha256 !== undefined;
  if (git) {
    const scheme = url.startsWith("https://") ? 8 : url.startsWith("ssh://") ? 6 : 0;
    if (
      scheme === 0 ||
      url.length === scheme ||
      utf8(url).length > MAX_GIT_URL_LEN ||
      // eslint-disable-next-line no-control-regex
      /[\s\u0000-\u001f\u007f-\u009f]/.test(url)
    ) {
      throw refused(
        `source.url must be an https:// or ssh:// URL of at most ${MAX_GIT_URL_LEN} bytes`,
      );
    }
    if (!lowerHex(commit, 40, 64)) {
      throw refused("source.commit must be 40 or 64 lowercase hex characters");
    }
    if (!lowerHex(treeSha256, 64)) {
      throw refused("source.treeSha256 must be 64 lowercase hex characters");
    }
    return { kind: "git", url, commit, treeSha256 };
  }
  throw refused("source must be a bundle (sha256, size) or a git commit (url, commit, treeSha256)");
}

/** Read a plugin manifest statement and check every field rule, without its signature. */
export function readPluginManifest(statement: Statement): PluginManifestStatement {
  const payload = statement.payload;
  if (utf8(payload).length > MAX_PAYLOAD_LEN) {
    throw refused(`statement payload exceeds ${MAX_PAYLOAD_LEN} bytes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch (err) {
    throw malformed((err as Error).message);
  }
  const duplicate = findDuplicateKey(payload);
  if (duplicate !== null) throw malformed(`duplicate field \`${duplicate}\``);
  if (!isObject(raw)) throw malformed("not a JSON object");
  shape(raw, STATEMENT_FIELDS, STATEMENT_FIELDS);
  const v = raw.v;
  if (!isUint(v, U32)) throw malformed("invalid type for `v`");
  const kind = string(raw, "type");
  const principalId = string(raw, "principalId");
  const keySeq = raw.keySeq;
  if (!isUint(keySeq, U32)) throw malformed("invalid type for `keySeq`");
  const publisherName = string(raw, "publisherName");
  const pluginId = string(raw, "pluginId");
  const version = string(raw, "version");
  const manifest = string(raw, "manifest");
  const rawSource = raw.source;
  if (!isObject(rawSource)) throw malformed("invalid type for `source`");
  shape(rawSource, SOURCE_FIELDS, ["kind"]);
  const issuedAt = string(raw, "issuedAt");
  if (!RFC_3339.test(issuedAt) || Number.isNaN(Date.parse(issuedAt))) {
    throw malformed("`issuedAt` is not an RFC 3339 time");
  }

  if (v !== 1 && v !== 2) throw refused(`unsupported statement version ${v}`);
  if (kind !== "plugin-manifest") throw refused("expected a `plugin-manifest` statement");
  if (v !== 2) throw refused("a plugin manifest must be a version 2 statement");
  const name = label(publisherName, "publisherName", MAX_PUBLISHER_NAME_CHARS);
  const head = readManifest(manifest);
  if (head.pluginId !== pluginId) throw refused("pluginId does not match the manifest");
  if (head.version !== version) throw refused("version does not match the manifest");
  const versionChars = [...version].length;
  if (versionChars < 1 || versionChars > MAX_PLUGIN_VERSION_CHARS) {
    throw refused(`version must be 1 to ${MAX_PLUGIN_VERSION_CHARS} characters`);
  }
  if (head.runtimeKind !== "DesktopLocalProcess" && head.runtimeKind !== "WebSandboxed") {
    throw refused("the manifest's runtime_kind must be DesktopLocalProcess or WebSandboxed");
  }
  const source = readSource(rawSource);
  if (head.runtimeKind === "WebSandboxed" && source.kind !== "bundle") {
    throw refused("a WebSandboxed plugin must come with a bundle source");
  }
  return {
    principalId,
    keySeq,
    publisherName: name,
    pluginId,
    version,
    manifest,
    displayName: head.displayName,
    runtimeKind: head.runtimeKind,
    source,
    issuedAt,
  };
}

/**
 * Verify a plugin manifest statement against its publisher's key log: every field rule, the
 * log's principal, `keySeq` an entry of it and that entry's identity key's signature.
 */
export async function verifyPluginManifest(
  history: KeyHistory,
  statement: Statement,
): Promise<VerifiedPluginManifest> {
  const parsed = readPluginManifest(statement);
  if (parsed.principalId !== history.principalId) {
    throw refused("statement is for a different principal");
  }
  const key = history.identityKeys[parsed.keySeq];
  if (key === undefined) {
    throw refused(`keySeq ${parsed.keySeq} is not an entry of the publisher's key log`);
  }
  if (!(await verify(statement, CONTEXT.pluginManifest, key, 2))) {
    throw refused("signature does not verify");
  }
  const atSeq = recoveryAfter(history, parsed.keySeq);
  return {
    statement: parsed,
    validity: atSeq === null ? { status: "valid" } : { status: "publisherRecovered", atSeq },
  };
}
