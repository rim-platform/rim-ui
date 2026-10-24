// The web app's store of plugin settings: values per plugin and account in
// IndexedDB, checked against the manifest's schema, no secrets, and gone on
// uninstall; and the database's upgrade that adds the settings store.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PluginSettingsError } from "../pluginSettings";
import { sha256Hex, writeBundle } from "./bundle";
import * as storeModule from "./browserPluginStore";
import { BrowserPluginStore } from "./browserPluginStore";
import { webPluginHost } from "./webPluginHost";
import { lockVault, VaultLockedError } from "../../../core/accountVault/accountVault";
import { unlockTestVault } from "../../../test/accountVault";

const encoder = new TextEncoder();
const PLUGIN = "dev.example.pods";

const MANIFEST = JSON.stringify({
  manifest_version: 1,
  plugin_id: PLUGIN,
  display_name: "Pods",
  version: "0.1.0",
  description: "Lists pods.",
  runtime_kind: "WebSandboxed",
  entrypoint: "main.mjs",
  settings_schema: [
    { key: "context", title: "Context", value_type: "string", placeholder: "prod-eu" },
    { key: "namespace", title: "Namespace", value_type: "string", default: "default" },
    {
      key: "refresh_seconds",
      title: "Refresh",
      value_type: "integer",
      default: 30,
      min: 5,
      max: 3600,
    },
    { key: "output", title: "Output", value_type: "enum", options: ["table", "json"] },
    { key: "api_token", title: "Token", value_type: "string", is_secret: true },
  ],
});

async function installed(account: string): Promise<BrowserPluginStore> {
  const store = new BrowserPluginStore();
  store.setAccount(account);
  const bytes = writeBundle([
    { path: "rim-plugin.json", bytes: encoder.encode(MANIFEST) },
    { path: "main.mjs", bytes: encoder.encode("") },
  ]);
  const sha256 = await sha256Hex(bytes);
  await store.installBundle({
    bytes,
    sha256,
    source: { kind: "link", url: "https://example.com/pods.rimbundle", sha256 },
    replace: true,
  });
  return store;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The stores these tests use are sealed under the unlocked account.
beforeEach(() => unlockTestVault());

describe("browser plugin settings", () => {
  it("lists the schema and keeps saved values per account, merged with defaults", async () => {
    const a = await installed("rimp0_a");
    const b = await installed("rimp0_b");
    const [info] = await a.list();
    expect(info.settings_schema?.map((s) => s.key)).toEqual([
      "context",
      "namespace",
      "refresh_seconds",
      "output",
      "api_token",
    ]);
    expect(await a.settingsGet(PLUGIN)).toEqual({
      values: {},
      secrets: { api_token: false },
      secrets_available: false,
      secrets_error: null,
    });

    await a.settingsSave(PLUGIN, { context: "prod-eu", refresh_seconds: 60, output: "json" });

    expect((await a.settingsGet(PLUGIN)).values).toEqual({
      context: "prod-eu",
      refresh_seconds: 60,
      output: "json",
    });
    expect(await a.settingsValues(PLUGIN, "rimp0_a")).toEqual({
      context: "prod-eu",
      namespace: "default",
      refresh_seconds: 60,
      output: "json",
    });
    expect(await b.settingsValues(PLUGIN, "rimp0_b")).toEqual({
      namespace: "default",
      refresh_seconds: 30,
    });
  });

  it("gives the defaults alone with nobody signed in, and refuses a plugin not installed", async () => {
    const store = await installed("rimp0_a");
    await store.settingsSave(PLUGIN, { namespace: "prod" });
    expect(await store.settingsValues(PLUGIN, null)).toEqual({
      namespace: "default",
      refresh_seconds: 30,
    });
    await expect(store.settingsValues(PLUGIN, "rimp0_nobody")).rejects.toThrow("plugin not found");
    await expect(storeModule.resolvedPluginSettings("dev.example.none", null)).rejects.toThrow(
      "plugin not found",
    );
  });

  it("gives the web plugin host the signed-in account's values, never a secret", async () => {
    const store = await installed("rimp0_a");
    await store.settingsSave(PLUGIN, { namespace: "prod", api_token: null });
    expect(await store.pluginSettings(PLUGIN)).toEqual({
      namespace: "prod",
      refresh_seconds: 30,
    });
    store.setAccount(null);
    expect(await store.pluginSettings(PLUGIN)).toEqual({
      namespace: "default",
      refresh_seconds: 30,
    });
  });

  it("tells the plugin's running session after every save and reset", async () => {
    const changed = vi.spyOn(webPluginHost, "settingsChanged");
    const store = await installed("rimp0_a");
    await store.settingsSave(PLUGIN, { namespace: "prod" });
    await store.settingsReset(PLUGIN);
    await expect(store.settingsSave(PLUGIN, { output: "yaml" })).rejects.toThrow();
    expect(changed.mock.calls).toEqual([[PLUGIN], [PLUGIN]]);
  });

  it("clears a value saved as null and keeps the keys left out", async () => {
    const store = await installed("rimp0_a");
    await store.settingsSave(PLUGIN, { context: "c", namespace: "prod" });
    await store.settingsSave(PLUGIN, { namespace: null });
    expect((await store.settingsGet(PLUGIN)).values).toEqual({ context: "c" });
  });

  it("refuses a value the schema does not accept, naming the setting, and writes nothing", async () => {
    const store = await installed("rimp0_a");
    const refused: [Record<string, unknown>, string, string][] = [
      [{ refresh_seconds: 4 }, "refresh_seconds", "refresh_seconds must be at least 5"],
      [{ refresh_seconds: 2.5 }, "refresh_seconds", "refresh_seconds must be an integer"],
      [{ output: "yaml" }, "output", "output must be one of: table, json"],
      [{ context: 5 }, "context", "context must be a string"],
      [{ unknown: 1 }, "unknown", "unknown is not a setting of this plugin"],
    ];
    for (const [change, key, message] of refused) {
      const error = await store.settingsSave(PLUGIN, { namespace: "x", ...change }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PluginSettingsError);
      expect(error).toMatchObject({ key, message });
    }
    expect((await store.settingsGet(PLUGIN)).values).toEqual({});
  });

  it("refuses a secret setting, which the web app cannot keep", async () => {
    const store = await installed("rimp0_a");
    await expect(store.settingsSave(PLUGIN, { api_token: "t" })).rejects.toMatchObject({
      key: "api_token",
      message: "api_token is a secret setting, which needs the desktop app",
    });
    await store.settingsSave(PLUGIN, { api_token: null });
    expect(await store.settingsValues(PLUGIN, "rimp0_a")).not.toHaveProperty("api_token");
  });

  it("resets the account's values and deletes them on uninstall", async () => {
    const a = await installed("rimp0_a");
    const b = await installed("rimp0_b");
    await a.settingsSave(PLUGIN, { context: "a" });
    await b.settingsSave(PLUGIN, { context: "b" });

    await a.settingsReset(PLUGIN);
    expect((await a.settingsGet(PLUGIN)).values).toEqual({});
    expect((await b.settingsGet(PLUGIN)).values).toEqual({ context: "b" });

    await b.uninstall(PLUGIN);
    const again = await installed("rimp0_b");
    expect((await again.settingsGet(PLUGIN)).values).toEqual({});
  });

  it("refuses with nobody signed in", async () => {
    const store = await installed("rimp0_a");
    store.setAccount(null);
    await expect(store.settingsGet(PLUGIN)).rejects.toThrow("nobody is signed in");
    await expect(store.settingsSave(PLUGIN, { context: "c" })).rejects.toThrow(
      "nobody is signed in",
    );
  });

  it("opens a database of the first version and keeps its installs", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("rim-plugins", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("bundles", { keyPath: "sha256" });
        db.createObjectStore("installs", { keyPath: ["account", "pluginId"] });
        db.createObjectStore("storage", { keyPath: ["pluginId", "account", "key"] });
        db.createObjectStore("principalIds", { keyPath: "from" });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("principalIds", "readwrite");
        tx.objectStore("principalIds").put({ from: "rimp0_old", to: "rimk1_new" });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    const store = await installed("rimp0_a");
    expect(await store.mappings()).toEqual([{ from: "rimp0_old", to: "rimk1_new" }]);
    await store.settingsSave(PLUGIN, { context: "c" });
    expect((await store.settingsGet(PLUGIN)).values).toEqual({ context: "c" });
  });

  it("keeps installs, storage and settings sealed, and the bundle plain", async () => {
    const store = await installed("rimp0_a");
    await store.settingsSave(PLUGIN, { context: "secret-context" });
    await store.storageSet(PLUGIN, "note", "secret-note");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rim-plugins");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (name: string) =>
      new Promise<Record<string, unknown>[]>((resolve) => {
        const request = db.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      });
    const [install] = await all("installs");
    expect(Object.keys(install).sort()).toEqual(["account", "bundleSha256", "data", "pluginId"]);
    const sealed = JSON.stringify([install, ...(await all("settings")), ...(await all("storage"))]);
    expect(sealed).not.toContain("secret-");
    expect(sealed).not.toContain("Lists pods");
    expect(await all("bundles")).toHaveLength(1);
    db.close();

    lockVault();
    await expect(store.list()).rejects.toBeInstanceOf(VaultLockedError);
    await unlockTestVault();
    expect(await store.storageGet(PLUGIN, "note")).toBe("secret-note");
  });
});
