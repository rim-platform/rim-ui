import { describe, expect, it, vi } from "vitest";

import { encodeBase64, sha256Hex } from "./bundle";
import {
  BundleLinkError,
  fetchBundleOnDesktop,
  fetchBundle,
  fetchLinkBytes,
  parseBundleLink,
  type InvokeImpl,
} from "./bundleLink";

const encoder = new TextEncoder();
const BYTES = encoder.encode('{"format":"rim-plugin-bundle","v":1,"files":[]}');
const OTHER = encoder.encode("tampered");
const RELEASE = "https://github.com/o/r/releases/download/v1/p-1.rimbundle";

async function linkFor(bytes: Uint8Array) {
  return parseBundleLink(`${RELEASE}#sha256=${await sha256Hex(bytes)}`);
}

/** A `safeInvoke` stand-in that answers `plugin_fetch_bundle` with `bytes` as base64. */
function invokeReturning(bytes: Uint8Array) {
  return vi.fn(async () => ({ ok: true, value: encodeBase64(bytes) })) as unknown as InvokeImpl &
    ReturnType<typeof vi.fn>;
}

/** A `safeInvoke` stand-in whose command fails with `message`. */
function invokeFailing(message: string) {
  return vi.fn(async () => ({
    ok: false,
    error: { kind: "backend_error", code: "UNKNOWN", message },
  })) as unknown as InvokeImpl & ReturnType<typeof vi.fn>;
}

function fetchReturning(bytes: Uint8Array) {
  return vi.fn(async () => new Response(bytes.slice())) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;
}

describe("fetching a pasted link's bundle", () => {
  it("goes through the desktop host's command on the desktop, never the webview", async () => {
    const link = await linkFor(BYTES);
    const invoke = invokeReturning(BYTES);
    const fetchImpl = fetchReturning(BYTES);

    const bytes = await fetchLinkBytes(link, "desktop", fetchImpl, invoke);

    expect(Array.from(bytes)).toEqual(Array.from(BYTES));
    expect(invoke).toHaveBeenCalledWith("plugin_fetch_bundle", {
      url: RELEASE,
      sha256: link.sha256,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches through the authenticated RIM server in the browser", async () => {
    const link = await linkFor(BYTES);
    const invoke = invokeReturning(BYTES);
    const fetchImpl = fetchReturning(BYTES);

    const bytes = await fetchLinkBytes(link, "web", fetchImpl, invoke);

    expect(Array.from(bytes)).toEqual(Array.from(BYTES));
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/plugin-bundles\/fetch$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ url: RELEASE, sha256: link.sha256 }),
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses bytes that do not match the pin on the desktop", async () => {
    const link = await linkFor(BYTES);
    const err = await fetchLinkBytes(link, "desktop", fetchReturning(BYTES), invokeReturning(OTHER))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BundleLinkError);
    expect((err as Error).message).toBe("The bundle does not match the SHA-256 in the link.");
  });

  it("refuses bytes that do not match the pin on the web", async () => {
    const link = await linkFor(BYTES);
    const err = await fetchLinkBytes(link, "web", fetchReturning(OTHER), invokeReturning(BYTES))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BundleLinkError);
    expect((err as Error).message).toBe("The bundle does not match the SHA-256 in the link.");
  });

  it("shows the host's reason when the desktop host refuses the fetch", async () => {
    const reason = "The bundle's server redirected to a link that does not start with https://.";
    const err = await fetchBundleOnDesktop(RELEASE, "a".repeat(64), invokeFailing(reason))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BundleLinkError);
    expect((err as Error).message).toBe(reason);
  });

  it("refuses an answer from the desktop host that is not base64", async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: "not base64!" })) as unknown as InvokeImpl;
    await expect(fetchBundleOnDesktop(RELEASE, "a".repeat(64), invoke)).rejects.toThrow(
      "The desktop app returned a damaged bundle.",
    );
  });
});

describe("browser fetch-through errors", () => {
  it.each([400, 404])("explains an older server answering %s", async (status) => {
    await expect(
      fetchBundle(
        RELEASE,
        "a".repeat(64),
        vi.fn(async () => new Response(null, { status })),
      ),
    ).rejects.toThrow("Update the server");
  });
  it("explains an older server that treats fetch as a disabled workspace upload", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "FEATURE_DISABLED", feature: "workspace_plugins" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(fetchBundle(RELEASE, "a".repeat(64), fetchImpl)).rejects.toThrow(
      "Update the server",
    );
  });
  it("explains a rejected hash pin", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "bundle SHA-256 mismatch" }), { status: 422 }),
    );
    await expect(fetchBundle(RELEASE, "a".repeat(64), fetchImpl)).rejects.toThrow(
      "does not match the SHA-256",
    );
  });
  it("sends the browser CSRF cookie only to the RIM server", async () => {
    document.cookie = "rim_csrf=browser-token; path=/";
    const link = await linkFor(BYTES);
    const fetchImpl = fetchReturning(BYTES);
    await fetchBundle(RELEASE, link.sha256, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/plugin-bundles\/fetch$/),
      expect.objectContaining({
        headers: { "content-type": "application/json", "x-csrf-token": "browser-token" },
        credentials: "include",
      }),
    );
    document.cookie = "rim_csrf=; max-age=0; path=/";
  });
  it("reports a connection failure without blaming external CORS", async () => {
    await expect(
      fetchBundle(
        RELEASE,
        "a".repeat(64),
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).rejects.toThrow("Could not reach your RIM server");
  });
});
