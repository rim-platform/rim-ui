// Pasted links to a bundle: `https://host/path/name.rimbundle#sha256=<64 hex>`.
// The fragment pins the bytes: the link installs only a bundle with that hash.

import { authHeaders } from "../../../core/graphql/csrf";
import { getApiOrigin } from "../../../core/graphql/config";
import type { AppPlatform } from "../../../core/runtime/runtime";
import { featureDisabledFromResponse } from "../../../core/serverFeatures";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { MAX_BUNDLE_BYTES, decodeBase64, sha256Hex } from "./bundle";

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

/** Fetch a pinned external bundle through the RIM server, or its authenticated stored copy. */
export async function fetchBundle(
  url: string,
  sha256: string,
  fetchImpl: typeof fetch = fetch,
  credentials: RequestCredentials = "omit",
): Promise<Uint8Array> {
  const external = credentials !== "include";
  let response: Response;
  try {
    response = await fetchImpl(external ? `${getApiOrigin()}/api/plugin-bundles/fetch` : url, {
      credentials: "include",
      cache: "no-store",
      redirect: external ? "error" : "follow",
      referrerPolicy: "no-referrer",
      ...(external
        ? {
            method: "POST",
            headers: { "content-type": "application/json", ...authHeaders() },
            body: JSON.stringify({ url, sha256 }),
          }
        : {}),
    });
  } catch {
    throw new BundleLinkError(
      "Could not reach your RIM server to fetch the bundle. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const disabled = await featureDisabledFromResponse(response);
    if (external && disabled?.feature === "workspace_plugins")
      throw new BundleLinkError(
        "This RIM server does not support installing plugins from links in the browser. Update the server.",
      );
    if (disabled) throw disabled;
    if (external && (response.status === 400 || response.status === 404))
      throw new BundleLinkError(
        "This RIM server does not support installing plugins from links in the browser. Update the server.",
      );
    if (external && response.status === 422) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new BundleLinkError(
        body?.error === "bundle SHA-256 mismatch"
          ? "The bundle does not match the SHA-256 in the link."
          : "The server refused the bundle: its link, size or contents are invalid.",
      );
    }
    if (response.status === 401)
      throw new BundleLinkError("Sign in again to fetch this plugin bundle.");
    if (response.status === 429)
      throw new BundleLinkError("Too many plugin download attempts. Try again later.");
    throw new BundleLinkError(
      `The RIM server could not fetch the bundle (HTTP ${response.status}).`,
    );
  }
  return checkPin(await readCapped(response), sha256);
}

/**
 * The bytes of a fetched bundle, once they hash to the link's pin.
 *
 * @param bytes - The bundle as fetched.
 * @param sha256 - The pin: the SHA-256 the link names, in lowercase hex.
 * @returns `bytes`, unchanged.
 */
export async function checkPin(bytes: Uint8Array, sha256: string): Promise<Uint8Array> {
  if ((await sha256Hex(bytes)) !== sha256) {
    throw new BundleLinkError("The bundle does not match the SHA-256 in the link.");
  }
  return bytes;
}

/** Calls a Tauri command; `safeInvoke` unless a test passes its own. */
export type InvokeImpl = typeof safeInvoke;

/**
 * Fetch a bundle through the desktop host's `plugin_fetch_bundle` command, which reads
 * hosts that send no `Access-Control-Allow-Origin`, such as GitHub release assets. The
 * host refuses another scheme, a redirect to another scheme and a body past 8 MiB, and
 * sends no cookies or credentials; the bytes it returns are checked against `sha256`
 * here as well.
 *
 * @param url - The bundle's `https://` link, without the fragment.
 * @param sha256 - The pin the bytes must hash to.
 * @returns The bundle's bytes.
 */
export async function fetchBundleOnDesktop(
  url: string,
  sha256: string,
  invokeImpl: InvokeImpl = safeInvoke,
): Promise<Uint8Array> {
  const result = await invokeImpl<string>("plugin_fetch_bundle", { url, sha256 });
  if (!result.ok) throw new BundleLinkError(result.error.message);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(result.value);
  } catch {
    throw new BundleLinkError("The desktop app returned a damaged bundle.");
  }
  if (bytes.length > MAX_BUNDLE_BYTES) throw new BundleLinkError("The bundle is over 8 MiB.");
  return checkPin(bytes, sha256);
}

/**
 * Fetch a pasted link's bundle the way the platform allows: through the desktop host on
 * the desktop, through the configured RIM server in the browser.
 *
 * @returns The bundle's bytes, checked against the link's pin.
 */
export function fetchLinkBytes(
  link: BundleLink,
  platform: AppPlatform,
  fetchImpl: typeof fetch = fetch,
  invokeImpl: InvokeImpl = safeInvoke,
): Promise<Uint8Array> {
  return platform === "desktop"
    ? fetchBundleOnDesktop(link.url, link.sha256, invokeImpl)
    : fetchBundle(link.url, link.sha256, fetchImpl);
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
