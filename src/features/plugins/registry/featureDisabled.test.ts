import { describe, it, expect, vi } from "vitest";

import { FeatureDisabledError } from "../../../core/serverFeatures";
import { fetchBundle } from "../web/bundleLink";
import { uploadPluginBundle } from "./api";

const SHA = "a".repeat(64);

function pluginsOff(): Response {
  return new Response(
    JSON.stringify({
      error: "the workspace_plugins feature is not available on this server",
      code: "FEATURE_DISABLED",
      feature: "workspace_plugins",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

describe("plugin bundle routes while workspace plugins are switched off", () => {
  it("refuses an upload with a FeatureDisabledError", async () => {
    const fetchImpl = vi.fn(async () => pluginsOff()) as unknown as typeof fetch;
    const err = await uploadPluginBundle("ws-1", new Uint8Array([1]), fetchImpl).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect((err as Error).message).toBe("Workspace plugins are switched off on this server");
  });

  it("keeps the server's reason for any other refused upload", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "too large" }), { status: 413 }),
    ) as unknown as typeof fetch;
    await expect(uploadPluginBundle("ws-1", new Uint8Array([1]), fetchImpl)).rejects.toThrow(
      "The bundle upload was refused: too large",
    );
  });

  it("refuses the server's own copy of a bundle with a FeatureDisabledError", async () => {
    const fetchImpl = vi.fn(async () => pluginsOff()) as unknown as typeof fetch;
    const err = await fetchBundle("https://rim.test/b", SHA, fetchImpl, "include").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FeatureDisabledError);
  });

  it("recognizes the fetch-through feature refusal for an external bundle", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "FEATURE_DISABLED", feature: "plugin_link_fetch" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const err = await fetchBundle("https://elsewhere.test/b", SHA, fetchImpl).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect((err as Error).message).toBe("Plugin link installation is switched off on this server");
  });
});
