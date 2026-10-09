import { beforeEach, describe, expect, it, vi } from "vitest";

const keyLog = vi.hoisted(() => ({ current: [] as { payload: string; signature: string }[] }));
vi.mock("../../key-identity/api/keyIdentity", () => ({
  fetchKeyLog: vi.fn(async () => keyLog.current),
}));

import { helloEntry, SERVER, SHA } from "./testing/fixtures";
import { helloWebBundle, INCEPTION } from "./testing/signedHelloWeb";
import {
  bundleRequest,
  checkEntry,
  fetchEntryBundle,
  statementSha256,
  type VerifiedEntry,
} from "./verify";

function respond(bytes: Uint8Array): typeof fetch {
  return vi.fn(
    async () => new Response(bytes as BodyInit, { status: 200 }),
  ) as unknown as typeof fetch;
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
    await expect(fetchEntryBundle(check, fetchImpl)).resolves.toHaveLength(1605);
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:8080/api/plugin-bundles/${SERVER}/${SHA}`,
      expect.objectContaining({ credentials: "include" }),
    );
    const other = new TextEncoder().encode("{}");
    await expect(fetchEntryBundle(check, respond(other))).rejects.toThrow(/SHA-256/);
  });

  it("sends no credentials to another host, and only over https", () => {
    expect(bundleRequest("https://cdn.example.com/p.rimbundle")).toEqual({
      url: "https://cdn.example.com/p.rimbundle",
      credentials: "omit",
    });
    expect(() => bundleRequest("http://cdn.example.com/p.rimbundle")).toThrow(/https/);
  });
});
