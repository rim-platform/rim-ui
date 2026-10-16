// Writing `.rimbundle` files: a plugin's files in one JSON document, sorted by
// path, UTF-8 files as `text` and others as `base64`, compact, so the same files
// always give the same bytes and the same SHA-256.

export { isBundlePath } from "./manifestRules.ts";

/** The `format` field of every bundle. */
export const BUNDLE_FORMAT = "rim-plugin-bundle";
/** Largest bundle file, in bytes. */
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
/** Most files a bundle may hold. */
export const MAX_BUNDLE_FILES = 256;

/** One file of a bundle: its bundle path and its bytes. */
export interface BundleFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The bundle file of `files`. */
export function writeBundle(files: readonly BundleFile[]): Uint8Array {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const entries = sorted.map((file) => {
    try {
      return { path: file.path, text: strictUtf8.decode(file.bytes) };
    } catch {
      return { path: file.path, base64: base64(file.bytes) };
    }
  });
  return new TextEncoder().encode(JSON.stringify({ format: BUNDLE_FORMAT, v: 1, files: entries }));
}
