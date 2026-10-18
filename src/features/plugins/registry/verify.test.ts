import { beforeEach, describe, expect, it, vi } from "vitest";

const keyLog = vi.hoisted(() => ({ current: [] as { payload: string; signature: string }[] }));
vi.mock("../../key-identity/api/keyIdentity", () => ({
  fetchKeyLog: vi.fn(async () => keyLog.current),
}));

import { encodeBase64 } from "../web/bundle";
import type { InvokeImpl } from "../web/bundleLink";
import { helloEntry, SERVER, SHA } from "./testing/fixtures";
import { helloWebBundle, INCEPTION } from "./testing/signedHelloWeb";
import {
  bundleRequest,
  checkEntry,
  fetchEntryBundle,
  statementSha256,
  type VerifiedEntry,
} from "./verify";

const RELEASE = "https://github.com/o/r/releases/download/v0.1.0/hello-web-0.1.0.rimbundle";

function respond(bytes: Uint8Array): typeof fetch {
  return vi.fn(
    async () => new Response(bytes as BodyInit, { status: 200 }),
  ) as unknown as typeof fetch;
}

/** A `safeInvoke` stand-in that answers `plugin_fetch_bundle` with `bytes` as base64. */
function invokeReturning(bytes: Uint8Array): InvokeImpl {
  return vi.fn(async () => ({ ok: true, value: encodeBase64(bytes) })) as unknown as InvokeImpl;
}

/** Appendix A verified, with its bundle on a release host instead of the server. */
async function releaseCheck(): Promise<VerifiedEntry> {
  const entry = helloEntry();
  return (await checkEntry({
    ...entry,
    source: { ...entry.source, bundleUrl: RELEASE },
  })) as VerifiedEntry;
}

describe("verifying a registry entry on this device", () => {
  beforeEach(() => {
    keyLog.current = [];
  });

  it("verifies appendix A with the key log the entry keeps when the server has none", async () => {
    const check = await checkEntry(helloEntry());
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.statement.pluginId).toBe("dev.example.hello-web");
    expect(check.validity).toEqual({ status: "valid" });
    expect(check.statementSha256).toBe(await statementSha256(helloEntry().statement.payload));
  });

  it("prefers the server's own key log of the publisher", async () => {
    keyLog.current = [INCEPTION];
    const check = await checkEntry(helloEntry({ publisherKeyLog: [] }));
    expect(check.ok).toBe(true);
  });

  it("refuses a tampered statement with the reason", async () => {
    const entry = helloEntry();
    const check = await checkEntry({
      ...entry,
      statement: { ...entry.statement, payload: entry.statement.payload.replace("Ada", "Eve") },
    });
    expect(check).toMatchObject({ ok: false, reason: "signature does not verify" });
  });

  it("refuses an entry whose columns say other than its statement", async () => {
    const check = await checkEntry(helloEntry({ version: "9.9.9" }));
    expect(check).toMatchObject({
      ok: false,
      reason: "the entry does not match its signed statement",
    });
  });

  it("fetches the server's copy with the session and checks size, hash and manifest", async () => {
    const check = (await checkEntry(helloEntry())) as VerifiedEntry;
    const fetchImpl = respond(helloWebBundle());
    await expect(fetchEntryBundle(check, "web", fetchImpl)).resolves.toHaveLength(1605);
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8080/api/plugin-bundles/${SERVER}/${SHA}`,
      expect.objectContaining({ credentials: "include" }),
    );
    const other = new TextEncoder().encode("{}");
    await expect(fetchEntryBundle(check, "web", respond(other))).rejects.toThrow(/SHA-256/);
  });

  it("fetches the server's copy from the webview with the session on the desktop too", async () => {
    const check = (await checkEntry(helloEntry())) as VerifiedEntry;
    const fetchImpl = respond(helloWebBundle());
    const invoke = invokeReturning(helloWebBundle());
    await expect(fetchEntryBundle(check, "desktop", fetchImpl, invoke)).resolves.toHaveLength(1605);
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8080/api/plugin-bundles/${SERVER}/${SHA}`,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fetches a bundle on another host through the desktop host's command on the desktop", async () => {
    const check = await releaseCheck();
    const fetchImpl = respond(helloWebBundle());
    const invoke = invokeReturning(helloWebBundle());
    await expect(fetchEntryBundle(check, "desktop", fetchImpl, invoke)).resolves.toHaveLength(1605);
    expect(invoke).toHaveBeenCalledWith("plugin_fetch_bundle", { url: RELEASE, sha256: SHA });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches a bundle on another host from the webview without credentials on the web", async () => {
    const check = await releaseCheck();
    const fetchImpl = respond(helloWebBundle());
    const invoke = invokeReturning(helloWebBundle());
    await expect(fetchEntryBundle(check, "web", fetchImpl, invoke)).resolves.toHaveLength(1605);
    expect(fetchImpl).toHaveBeenCalledWith(
      RELEASE,
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses another host's bundle that does not match the signed SHA-256", async () => {
    const check = await releaseCheck();
    const other = new TextEncoder().encode("{}");
    await expect(
      fetchEntryBundle(check, "desktop", respond(helloWebBundle()), invokeReturning(other)),
    ).rejects.toThrow(/SHA-256/);
    await expect(
      fetchEntryBundle(check, "web", respond(other), invokeReturning(helloWebBundle())),
    ).rejects.toThrow(/SHA-256/);
  });

  it("sends no credentials to another host, and only over https", () => {
    expect(bundleRequest("https://cdn.example.com/p.rimbundle")).toEqual({
      url: "https://cdn.example.com/p.rimbundle",
      credentials: "omit",
    });
    expect(() => bundleRequest("http://cdn.example.com/p.rimbundle")).toThrow(/https/);
  });
});
