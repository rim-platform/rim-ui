// Pasted links to a bundle: `https://host/path/name.rimbundle#sha256=<64 hex>`.
// The fragment pins the bytes: the link installs only a bundle with that hash.

import { getApiOrigin } from "../../../core/graphql/config";
import { featureDisabledFromResponse } from "../../../core/serverFeatures";
import { MAX_BUNDLE_BYTES, sha256Hex } from "./bundle";

/** A link the host refuses, with the reason. */
export class BundleLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleLinkError";
  }
}

/** A parsed link: where to fetch the bundle, and the hash it must have. */
export interface BundleLink {
  url: string;
  sha256: string;
  host: string;
}

/** Parse a pasted link; refuses another scheme and a link without the `#sha256=` fragment. */
export function parseBundleLink(link: string): BundleLink {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new BundleLinkError("That is not a link.");
  }
  if (url.protocol !== "https:")
    throw new BundleLinkError("A plugin link must start with https://.");
  const match = /^#sha256=([0-9a-f]{64})$/.exec(url.hash);
  if (!match) {
    throw new BundleLinkError(
      "A plugin link must end with #sha256= and the bundle's 64-character SHA-256, in lowercase.",
    );
  }
  url.hash = "";
  return { url: url.href, sha256: match[1], host: url.host };
}

/** Where the RIM server at the configured endpoint serves a workspace's bundle. */
export function serverBundleUrl(serverId: string, sha256: string): string {
  return `${getApiOrigin()}/api/plugin-bundles/${encodeURIComponent(serverId)}/${sha256}`;
}

/**
 * Fetch a bundle without caches, following redirects, and stop reading past
 * 8 MiB. The bytes must hash to `sha256`. Credentials go only to the RIM
 * server's own copy, which needs the session; any other host gets none. The server's own copy
 * is refused with a `FeatureDisabledError` while workspace plugins are switched off.
 */
export async function fetchBundle(
  url: string,
  sha256: string,
  fetchImpl: typeof fetch = fetch,
  credentials: RequestCredentials = "omit",
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      credentials,
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new BundleLinkError(
      "The bundle could not be fetched. Its server must allow it with Access-Control-Allow-Origin: *.",
    );
  }
  if (!response.ok) {
    const disabled = credentials === "include" ? await featureDisabledFromResponse(response) : null;
    throw disabled ?? new BundleLinkError(`The bundle's server answered ${response.status}.`);
  }
  const bytes = await readCapped(response);
  if ((await sha256Hex(bytes)) !== sha256) {
    throw new BundleLinkError("The bundle does not match the SHA-256 in the link.");
  }
  return bytes;
}

/** A response's body, refused past 8 MiB without reading further. */
export async function readCapped(response: Response): Promise<Uint8Array> {
  const tooLarge = () => new BundleLinkError("The bundle is over 8 MiB.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BUNDLE_BYTES) throw tooLarge();
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BUNDLE_BYTES) throw tooLarge();
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BUNDLE_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
