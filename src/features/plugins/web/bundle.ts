// `.rimbundle` files: a plugin's files in one JSON document,
// {"format":"rim-plugin-bundle","v":1,"files":[{"path":…,"text":…},…]}.
//
// A reader takes the bytes exactly as fetched and never re-serializes them; the
// bundle hash is the SHA-256 of those bytes. A writer sorts `files` by path and
// writes compact JSON, so the same files always give the same bytes. The
// desktop's reader is `src-tauri/src/plugin_host/bundle.rs`; both accept the
// same bundles and hash them the same.

import {
  ManifestError,
  isBundlePath,
  parseManifestText,
  type PluginManifest,
} from "../../../../sdk/plugin-sdk/src/manifestRules";

export const BUNDLE_FORMAT = "rim-plugin-bundle";
export const BUNDLE_MEDIA_TYPE = "application/vnd.rim.plugin-bundle+json";
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
export const MAX_BUNDLE_FILES = 256;
export const MANIFEST_FILE = "rim-plugin.json";
const PANELS_DIR = "panels/";

/** Why bytes are not a bundle this host accepts. */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

/** One file of a bundle: its bundle path and its bytes. */
export interface BundleFile {
  path: string;
  bytes: Uint8Array;
}

/** A bundle that passed every structural rule, with its manifest parsed. */
export interface Bundle {
  /** Every file, sorted by path. */
  files: BundleFile[];
  /** The exact text of `rim-plugin.json`. */
  manifestText: string;
  manifest: PluginManifest;
}

const MEDIA_TYPES: Record<string, string> = {
  html: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
  txt: "text/plain",
};

/** The media type of a bundle file, from its extension. */
export function mediaTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** SHA-256 of `bytes` as 64 lowercase hex characters, what `sha256sum` prints. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `bytes` as UTF-8 text, or null when they are not UTF-8. */
export function utf8OrNull(bytes: Uint8Array): string | null {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

/** True when `text` has no unpaired surrogate, so it encodes to UTF-8 and back. */
function isWellFormed(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(text);
}

/** Standard base64 with padding, canonical, as the desktop's decoder requires. */
export function decodeBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new BundleError("not standard base64");
  }
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (encodeBase64(bytes) !== text) throw new BundleError("not canonical base64");
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * The first key that appears twice in one object of `text`, which must be valid
 * JSON, or null. `JSON.parse` keeps the last of two equal keys where the desktop
 * refuses the document, so a reader checks before trusting what it parsed.
 */
export function findDuplicateKey(text: string): string | null {
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && expectKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.has(key)) return key;
        top.add(key);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (c === "[") {
      stack.push(null);
    } else if (c === "}" || c === "]") {
      stack.pop();
    } else if (c === ",") {
      expectKey = stack[stack.length - 1] instanceof Set;
    }
    i += 1;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(object: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new BundleError(`${where}: unknown field \`${key}\``);
  }
}

/** Read a bundle file: structure, paths, manifest and the kind's file rules. */
export function readBundle(bytes: Uint8Array): Bundle {
  if (bytes.length > MAX_BUNDLE_BYTES) {
    throw new BundleError(
      `bundle is ${bytes.length} bytes, over the ${MAX_BUNDLE_BYTES}-byte limit`,
    );
  }
  const text = utf8OrNull(bytes);
  if (text === null) throw new BundleError("not a plugin bundle: not UTF-8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new BundleError(`not a plugin bundle: ${(error as Error).message}`);
  }
  const duplicate = findDuplicateKey(text);
  if (duplicate !== null)
    throw new BundleError(`not a plugin bundle: duplicate field \`${duplicate}\``);
  if (!isObject(raw)) throw new BundleError("not a plugin bundle: not a JSON object");
  onlyKeys(raw, ["format", "v", "files"], "bundle");
  for (const key of ["format", "v", "files"]) {
    if (!(key in raw)) throw new BundleError(`not a plugin bundle: missing field \`${key}\``);
  }
  if (raw.format !== BUNDLE_FORMAT) {
    throw new BundleError(`not a plugin bundle: format is not \`${BUNDLE_FORMAT}\``);
  }
  if (raw.v !== 1) throw new BundleError("not a plugin bundle: version is not 1");
  if (!Array.isArray(raw.files)) throw new BundleError("not a plugin bundle: files is not a list");
  const files = raw.files.map((entry, i): BundleFile => {
    const where = `files[${i}]`;
    if (!isObject(entry)) throw new BundleError(`${where} is not an object`);
    onlyKeys(entry, ["path", "text", "base64"], where);
    if (typeof entry.path !== "string") throw new BundleError(`${where}: path must be a string`);
    const hasText = "text" in entry;
    const hasBase64 = "base64" in entry;
    if (hasText === hasBase64) {
      throw new BundleError(`${entry.path} needs exactly one of text and base64`);
    }
    if (hasText) {
      if (typeof entry.text !== "string" || !isWellFormed(entry.text)) {
        throw new BundleError(`${entry.path}: text must be a UTF-8 string`);
      }
      return { path: entry.path, bytes: encoder.encode(entry.text) };
    }
    if (typeof entry.base64 !== "string")
      throw new BundleError(`${entry.path}: base64 must be a string`);
    try {
      return { path: entry.path, bytes: decodeBase64(entry.base64) };
    } catch {
      throw new BundleError(`${entry.path} is not standard base64`);
    }
  });
  return checkFiles(files);
}

/**
 * The rules every bundle's files follow: 1 to 256 files sorted by path with no
 * duplicates, bundle paths, a manifest, its entrypoint, and for `WebSandboxed`
 * nothing else outside `panels/` and an entrypoint with no `#!` line.
 */
export function checkFiles(files: BundleFile[]): Bundle {
  if (files.length === 0 || files.length > MAX_BUNDLE_FILES) {
    throw new BundleError(`holds ${files.length} files, must hold 1 to ${MAX_BUNDLE_FILES}`);
  }
  files.forEach((file, i) => {
    if (!isBundlePath(file.path))
      throw new BundleError(`\`${file.path}\` is not a valid bundle path`);
    if (i > 0 && !(files[i - 1].path < file.path)) {
      throw new BundleError(
        `paths must be sorted and unique: \`${file.path}\` follows \`${files[i - 1].path}\``,
      );
    }
  });
  const manifestFile = files.find((f) => f.path === MANIFEST_FILE);
  if (!manifestFile) throw new BundleError(`${MANIFEST_FILE} is missing`);
  const manifestText = utf8OrNull(manifestFile.bytes);
  if (manifestText === null) throw new BundleError(`${MANIFEST_FILE} is not UTF-8`);
  let manifest: PluginManifest;
  try {
    manifest = parseManifestText(manifestText);
  } catch (error) {
    if (error instanceof ManifestError) throw new BundleError(`bundle manifest: ${error.message}`);
    throw error;
  }
  const entry = files.find((f) => f.path === manifest.entrypoint);
  if (!entry) throw new BundleError(`the entrypoint \`${manifest.entrypoint}\` is missing`);
  if (manifest.runtime_kind === "WebSandboxed") {
    if (entry.bytes[0] === 0x23 && entry.bytes[1] === 0x21) {
      throw new BundleError("a WebSandboxed entrypoint has no #! line");
    }
    if (utf8OrNull(entry.bytes) === null) {
      throw new BundleError("a WebSandboxed entrypoint is UTF-8 JavaScript");
    }
    const stray = files.find(
      (f) =>
        f.path !== MANIFEST_FILE &&
        f.path !== manifest.entrypoint &&
        !f.path.startsWith(PANELS_DIR),
    );
    if (stray) {
      throw new BundleError(
        `\`${stray.path}\` is outside panels/, where a WebSandboxed bundle keeps its other files`,
      );
    }
  }
  return { files, manifestText, manifest };
}

/** Write files as a bundle: sorted by path, UTF-8 as `text`, the rest as `base64`, compact. */
export function writeBundle(files: readonly BundleFile[]): Uint8Array {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const entries = sorted.map((file) => {
    const text = utf8OrNull(file.bytes);
    return text !== null
      ? { path: file.path, text }
      : { path: file.path, base64: encodeBase64(file.bytes) };
  });
  return encoder.encode(JSON.stringify({ format: BUNDLE_FORMAT, v: 1, files: entries }));
}
