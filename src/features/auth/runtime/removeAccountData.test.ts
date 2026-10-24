// Removing an account from this device: every store the account left something in loses it,
// another account's data stays, and a sign-out that keeps the account changes none of it.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ desktop: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => tauri.desktop,
}));
vi.mock("../../../core/tauri/safeInvoke", () => ({ safeInvoke: vi.fn() }));
vi.mock("../api/useAuthMutations", () => ({ logout: vi.fn() }));

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { toast } from "../../../shared/toast";
import { createTestQueryClient } from "../../../test/utils";
import { committed, database, done } from "../../e2ee/web/db";
import { insert, records } from "../../key-identity/browser/keyStore";
import { deferKeySetup, keySetupDeferred } from "../../key-identity/state/keySetupOffer";
import { useDraftStore } from "../../messages/state/useDraftStore";
import { sha256Hex, writeBundle } from "../../plugins/web/bundle";
import { BrowserPluginStore } from "../../plugins/web/browserPluginStore";
import { provisionalPrincipalId } from "../../plugins/web/principal";
import { webPluginHost } from "../../plugins/web/webPluginHost";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { allRecords, putRecord } from "../../relay/state/relayDb";
import { removalAccountKey, useRemovalNotices } from "../../workspaces/state/useRemovalNotices";
import { logout } from "../api/useAuthMutations";
import { useAuthStore } from "../state/useAuthStore";
import { removeAccountData, signedInAccount } from "./removeAccountData";
import { signOut } from "./signOut";

const ENDPOINT = getGraphqlEndpoint();
const PLUGIN = "dev.example.notes";
const MANIFEST = JSON.stringify({
  manifest_version: 1,
  plugin_id: PLUGIN,
  display_name: "Notes",
  version: "0.1.0",
  description: "Keeps notes.",
  runtime_kind: "WebSandboxed",
  entrypoint: "main.mjs",
  settings_schema: [{ key: "folder", title: "Folder", value_type: "string" }],
});

/** Each account: its user id, its principal and this browser's device under it. */
const ALICE = { userId: "alice", principalId: "rimp1_alice", deviceId: "device-alice" };
const BOB = { userId: "bob", principalId: "rimp1_bob", deviceId: "device-bob" };
type Account = typeof ALICE;

const relayKey = (a: Account) => `${ENDPOINT}|${a.principalId}`;

async function deviceKey(): Promise<CryptoKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return pair.privateKey;
}

/** Leave something of `a` in every store this app keeps per account. */
async function seed(a: Account): Promise<void> {
  await insert({
    v: 1,
    endpoint: ENDPOINT,
    principalId: a.principalId,
    deviceId: a.deviceId,
    deviceName: "Firefox on Linux",
    deviceKey: await deviceKey(),
    confirmed: true,
    userId: a.userId,
    username: a.userId,
  });

  const db = await database();
  const tx = db.transaction(["mls", "accounts", "pins"], "readwrite");
  const finished = committed(tx);
  const account = { endpoint: ENDPOINT.replace(/\/+$/, ""), principalId: a.principalId };
  tx.objectStore("mls").put({ ...account, label: "state", key: "k", value: "v" });
  tx.objectStore("accounts").put({ ...account, lastUsedAt: 1 });
  tx.objectStore("pins").put({ ...account, workspaceId: "ws", conversationId: "c1" });
  await finished;

  await putRecord("spaces", {
    account: relayKey(a),
    spaceId: `space-of-${a.userId}`,
    hostServerId: "host",
    kind: "workspace",
  });
  await putRecord("meta", { account: relayKey(a), name: "lastItem", value: 3 });
  await putRecord("requestSeq", { deviceId: a.deviceId, host: "host", seq: 7 });

  const plugins = new BrowserPluginStore();
  plugins.setAccount(await provisionalPrincipalId(a.userId));
  const bytes = writeBundle([
    { path: "rim-plugin.json", bytes: new TextEncoder().encode(MANIFEST) },
    { path: "main.mjs", bytes: new TextEncoder().encode("") },
  ]);
  const sha256 = await sha256Hex(bytes);
  await plugins.installBundle({
    bytes,
    sha256,
    source: { kind: "link", url: "https://example.com/notes.rimbundle", sha256 },
    replace: true,
  });
  await plugins.storageSet(PLUGIN, "note", "hello");
  await plugins.settingsSave(PLUGIN, { folder: a.userId });

  localStorage.setItem(`rim:remote-join-requests:${relayKey(a)}`, "[]");
  useRemovalNotices
    .getState()
    .add(removalAccountKey(a.userId), { workspaceId: "ws", cause: "kick" });
  deferKeySetup(a.userId);
}

/** Which stores still hold something of `a`. */
async function held(a: Account) {
  const db = await database();
  const tx = db.transaction(["mls", "accounts", "pins"], "readonly");
  const e2ee = await Promise.all(
    (["mls", "accounts", "pins"] as const).map(async (name) => {
      const rows = (await done(tx.objectStore(name).getAll())) as { principalId: string }[];
      return rows.some((r) => r.principalId === a.principalId);
    }),
  );
  const plugins = new BrowserPluginStore();
  plugins.setAccount(await provisionalPrincipalId(a.userId));
  const installed = (await plugins.list()).length > 0;
  return {
    keys: (await records(ENDPOINT)).some((r) => r.principalId === a.principalId),
    e2ee: e2ee.every(Boolean),
    relaySpaces: (await allRecords<{ account: string }>("spaces")).some(
      (r) => r.account === relayKey(a),
    ),
    relayMeta: (await allRecords<{ account: string }>("meta")).some(
      (r) => r.account === relayKey(a),
    ),
    requestSeq: (await allRecords<{ deviceId: string }>("requestSeq")).some(
      (r) => r.deviceId === a.deviceId,
    ),
    plugin: installed,
    pluginStorage: installed && (await plugins.storageGet(PLUGIN, "note")) === "hello",
    pluginSettings: installed && (await plugins.settingsGet(PLUGIN)).values.folder === a.userId,
    joinRequests: localStorage.getItem(`rim:remote-join-requests:${relayKey(a)}`) !== null,
    removalNotices: removalAccountKey(a.userId) in useRemovalNotices.getState().accounts,
    keySetupLater: keySetupDeferred(a.userId),
  };
}

const ALL_HELD = {
  keys: true,
  e2ee: true,
  relaySpaces: true,
  relayMeta: true,
  requestSeq: true,
  plugin: true,
  pluginStorage: true,
  pluginSettings: true,
  joinRequests: true,
  removalNotices: true,
  keySetupLater: true,
};
const NONE_HELD = Object.fromEntries(Object.keys(ALL_HELD).map((k) => [k, false]));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  tauri.desktop = false;
  vi.spyOn(webPluginHost, "settingsChanged").mockImplementation(() => undefined);
  useRemovalNotices.setState({ accounts: {} });
  useDraftStore.setState({ drafts: { c1: "half a thought" } });
  useAuthStore.setState({ session: { userId: ALICE.userId }, sessionEnded: false });
  useRelayStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(safeInvoke).mockReset();
  useAuthStore.setState({ session: null, sessionEnded: false });
});

describe("removeAccountData", () => {
  it("removes the account from every store and leaves another account's data", async () => {
    await seed(ALICE);
    await seed(BOB);
    expect(await held(ALICE)).toEqual(ALL_HELD);

    await removeAccountData({ endpoint: ENDPOINT, userId: ALICE.userId, relay: null });

    expect(await held(ALICE)).toEqual(NONE_HELD);
    expect(await held(BOB)).toEqual(ALL_HELD);
    expect(useDraftStore.getState().drafts).toEqual({});
    expect(localStorage.getItem("rim-drafts")).toBeNull();
  });

  it("removes the relay's principal for the account even without a key in this browser", async () => {
    await putRecord("spaces", {
      account: relayKey(ALICE),
      spaceId: "s",
      hostServerId: "host",
      kind: "direct",
    });
    useRelayStore.getState().setStarted(
      { directSpaceId: "direct" } as Parameters<
        ReturnType<typeof useRelayStore.getState>["setStarted"]
      >[0],
      {
        endpoint: ENDPOINT,
        userId: ALICE.userId,
        principalId: ALICE.principalId,
        deviceId: null,
      },
      [],
    );

    const account = signedInAccount();
    expect(account?.relay?.principalId).toBe(ALICE.principalId);
    await removeAccountData(account!);

    expect(await allRecords("spaces")).toEqual([]);
  });

  it("on the desktop, forgets the keys and removes the message cache in the Tauri side", async () => {
    tauri.desktop = true;
    vi.mocked(safeInvoke).mockImplementation(async (command: string) => {
      if (command === "key_identity_accounts") {
        return { ok: true, value: [{ principalId: ALICE.principalId, userId: ALICE.userId }] };
      }
      return { ok: true, value: null };
    });

    await removeAccountData({ endpoint: ENDPOINT, userId: ALICE.userId, relay: null });

    const calls = vi.mocked(safeInvoke).mock.calls;
    expect(calls).toContainEqual(["key_identity_forget", { principalId: ALICE.principalId }]);
    expect(calls).toContainEqual([
      "message_cache_remove_account",
      { account: { endpoint: ENDPOINT, userId: ALICE.userId } },
    ]);
    expect(calls).toContainEqual([
      "offline_session_save",
      { record: { state: "signedOut", endpoint: ENDPOINT } },
    ]);
  });
  it("carries on past a part that fails and says so once", async () => {
    tauri.desktop = true;
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    vi.mocked(safeInvoke).mockImplementation(async (command: string) =>
      command === "message_cache_remove_account"
        ? { ok: false, error: { kind: "backend_error", code: "CACHE_STORAGE", message: "busy" } }
        : { ok: true, value: command === "key_identity_accounts" ? [] : null },
    );

    await removeAccountData({ endpoint: ENDPOINT, userId: ALICE.userId, relay: null });

    expect(vi.mocked(safeInvoke).mock.calls.map(([command]) => command)).toContain(
      "offline_session_save",
    );
    expect(useDraftStore.getState().drafts).toEqual({});
    expect(warning).toHaveBeenCalledTimes(1);
  });
});

describe("signOut", () => {
  it("keeps the account on this device unless asked to remove it", async () => {
    await seed(ALICE);
    vi.mocked(logout).mockResolvedValue({ logout: true });

    await signOut(createTestQueryClient());

    expect(logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().session).toBeNull();
    expect(await held(ALICE)).toEqual(ALL_HELD);
    expect(useDraftStore.getState().drafts).toEqual({ c1: "half a thought" });
  });

  it("removes the account once signed out, even when the server refuses the logout", async () => {
    await seed(ALICE);
    vi.mocked(logout).mockRejectedValue(new Error("unauthenticated"));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["me"], { id: ALICE.userId });

    await signOut(queryClient, { remove: true });

    expect(useAuthStore.getState().session).toBeNull();
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
    expect(await held(ALICE)).toEqual(NONE_HELD);
  });
});
