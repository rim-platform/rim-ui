// Where the web app keeps web plugins: IndexedDB database `rim-plugins` with
// verified bundles keyed by hash (`bundles`), install records per account
// (`installs`), each plugin's `rim.storage` per account (`storage`), and the
// provisional-to-key principal ids this browser has seen (`principalIds`).
// Bundles are hashed again at every start; a damaged or evicted one is fetched
// again from its link and must hash the same.

import type {
  PluginCommandInfo,
  PluginContextAction,
  PluginInfo,
  PluginInstallResult,
  PluginInstallSource,
} from "../types";
import { readBundle, sha256Hex, type BundleFile } from "./bundle";
import { fetchBundle } from "./bundleLink";
import { checkInstall, parseManifestText, type PluginManifest } from "./manifestRules";
import { rimOrigins, type BundleInstall, type PluginServices } from "./pluginServices";
import { ErrorCode, RpcError, type PrincipalMapping } from "./rpc";

const DB_NAME = "rim-plugins";
const DB_VERSION = 1;
const BUNDLES = "bundles";
const INSTALLS = "installs";
const STORAGE = "storage";
const PRINCIPAL_IDS = "principalIds";

/** Largest `rim.storage` store: key lengths plus the values' JSON text, in bytes. */
export const MAX_STORE_BYTES = 1024 * 1024;
const STORAGE_KEY = /^[A-Za-z0-9._-]{1,128}$/;

type InstallStatus = "installed" | "enabled" | "disabled";

/** One plugin installed for one account in this browser. */
export interface InstallRecord {
  v: 1;
  /** The account's provisional principal id. */
  account: string;
  pluginId: string;
  /** The exact text of the bundle's `rim-plugin.json`. */
  manifestText: string;
  bundleSha256: string;
  bundleSize: number;
  source: PluginInstallSource;
  status: InstallStatus;
  approvedCapabilities: string[];
  approvedAiCommands: string[];
  /** Set while the page starts the plugin; see safe start in the host. */
  starting: boolean;
  installedAt: string;
}

interface StoredBundle {
  sha256: string;
  bytes: Uint8Array;
}

interface StorageRecord {
  pluginId: string;
  account: string;
  key: string;
  /** The value's JSON text. */
  json: string;
}

/** The plugin is already installed and the caller did not ask to replace it. */
export class AlreadyInstalledError extends Error {
  readonly pluginId: string;

  constructor(pluginId: string) {
    super(`plugin already installed: ${pluginId}`);
    this.name = "AlreadyInstalledError";
    this.pluginId = pluginId;
  }
}

let opened: { factory: IDBFactory; db: Promise<IDBDatabase> } | null = null;

function database(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error("this browser cannot store plugins"));
  if (opened?.factory === factory) return opened.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(BUNDLES, { keyPath: "sha256" });
      db.createObjectStore(INSTALLS, { keyPath: ["account", "pluginId"] });
      db.createObjectStore(STORAGE, { keyPath: ["pluginId", "account", "key"] });
      db.createObjectStore(PRINCIPAL_IDS, { keyPath: "from" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (opened?.factory === factory) opened = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("the plugin store did not open"));
    request.onblocked = () => reject(new Error("the plugin store is blocked by another tab"));
  });
  opened = { factory, db };
  db.catch(() => {
    if (opened?.db === db) opened = null;
  });
  return db;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("plugin store request failed"));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("plugin store write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("plugin store write was aborted"));
  });
}

async function read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = (await database()).transaction(store, "readonly");
  return done(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

async function write(store: string, value: unknown): Promise<void> {
  const tx = (await database()).transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await committed(tx);
}

function storageRange(pluginId: string, account: string): IDBKeyRange {
  return IDBKeyRange.bound([pluginId, account, ""], [pluginId, account, "￿"]);
}

const encoder = new TextEncoder();

/** `plugin.<id>.<command>` ids and the rest of `PluginInfo`, as the desktop's `plugin_list` builds them. */
function commandInfos(manifest: PluginManifest): PluginCommandInfo[] {
  return manifest.commands.map((c) => ({
    id: c.id,
    qualified_id: `plugin.${manifest.plugin_id}.${c.id}`,
    title: c.title,
    description: c.description,
    keybind_capable: c.keybind_capable,
    dangerous: c.dangerous,
    ai_callable: c.ai_callable,
    arguments: c.arguments as PluginCommandInfo["arguments"],
    required_capabilities: c.required_capabilities,
  }));
}

function contextActions(manifest: PluginManifest): PluginContextAction[] {
  return manifest.context_actions.map((a) => ({
    id: `plugin.${manifest.plugin_id}.${a.id}`,
    title: a.title,
    command_id: `plugin.${manifest.plugin_id}.${a.command_id}`,
    context_types: a.context_types,
  }));
}

export function toPluginInfo(record: InstallRecord): PluginInfo {
  const manifest = parseManifestText(record.manifestText);
  return {
    plugin_id: record.pluginId,
    manifest_id: record.pluginId,
    display_name: manifest.display_name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author ?? undefined,
    enabled: record.status === "enabled",
    capabilities: manifest.capabilities,
    approved_capabilities: record.approvedCapabilities,
    approved_ai_commands: record.approvedAiCommands,
    ai_callable_commands: manifest.commands.filter((c) => c.ai_callable).map((c) => c.id),
    ai_consent_required: false,
    fingerprint_changed: false,
    context_actions: contextActions(manifest),
    panels: manifest.panels,
    commands: commandInfos(manifest),
    health: "stopped",
    runtime_kind: manifest.runtime_kind,
    network_origins: manifest.network_origins ?? [],
    source: record.source,
    starting: record.starting,
  };
}

/** The web app's plugin store, for the signed-in account. */
export class BrowserPluginStore implements PluginServices {
  private account: string | null = null;

  /** The signed-in account's provisional principal id, or null after sign-out. */
  setAccount(account: string | null): void {
    this.account = account;
  }

  private signedIn(): string {
    if (this.account === null) throw new Error("nobody is signed in");
    return this.account;
  }

  private async record(pluginId: string): Promise<InstallRecord> {
    const record = await read<InstallRecord>(INSTALLS, [this.signedIn(), pluginId]);
    if (!record) throw new Error(`plugin not found: ${pluginId}`);
    return record;
  }

  private async update(
    pluginId: string,
    change: (record: InstallRecord) => InstallRecord,
  ): Promise<void> {
    await write(INSTALLS, change(await this.record(pluginId)));
  }

  async list(): Promise<PluginInfo[]> {
    if (this.account === null) return [];
    const tx = (await database()).transaction(INSTALLS, "readonly");
    const range = IDBKeyRange.bound([this.account, ""], [this.account, "￿"]);
    const records = await done(
      tx.objectStore(INSTALLS).getAll(range) as IDBRequest<InstallRecord[]>,
    );
    return records.map(toPluginInfo);
  }

  enable(pluginId: string): Promise<void> {
    // Enabling is the user retrying, so a start the page died in no longer blocks it.
    return this.update(pluginId, (r) => ({ ...r, status: "enabled", starting: false }));
  }

  disable(pluginId: string): Promise<void> {
    return this.update(pluginId, (r) => ({ ...r, status: "disabled" }));
  }

  /** Grant `capabilities`, the subset the user approved of those the manifest asks for. */
  approveCapabilities(pluginId: string, capabilities: string[]): Promise<void> {
    return this.update(pluginId, (r) => {
      const asked = parseManifestText(r.manifestText).capabilities;
      return { ...r, approvedCapabilities: capabilities.filter((c) => asked.includes(c)) };
    });
  }

  /** Revoking a capability also disables the plugin, as on the desktop. */
  revokeCapability(pluginId: string, capability: string): Promise<void> {
    return this.update(pluginId, (r) => ({
      ...r,
      status: r.status === "enabled" ? "disabled" : r.status,
      approvedCapabilities: r.approvedCapabilities.filter((c) => c !== capability),
    }));
  }

  /** Remove the plugin, its storage, and its bundle when no other install uses it. */
  async uninstall(pluginId: string): Promise<void> {
    const account = this.signedIn();
    const record = await this.record(pluginId);
    const db = await database();
    const tx = db.transaction([INSTALLS, STORAGE, BUNDLES], "readwrite");
    const installs = tx.objectStore(INSTALLS);
    installs.delete([account, pluginId]);
    tx.objectStore(STORAGE).delete(storageRange(pluginId, account));
    const rest = await done(installs.getAll() as IDBRequest<InstallRecord[]>);
    if (!rest.some((r) => r.bundleSha256 === record.bundleSha256)) {
      tx.objectStore(BUNDLES).delete(record.bundleSha256);
    }
    await committed(tx);
  }

  async installBundle({
    bytes,
    sha256,
    source,
    replace,
  }: BundleInstall): Promise<PluginInstallResult> {
    const account = this.signedIn();
    if ((await sha256Hex(bytes)) !== sha256)
      throw new Error("the bundle does not match its SHA-256");
    const bundle = readBundle(bytes);
    const manifest = bundle.manifest;
    if (manifest.runtime_kind !== "WebSandboxed") {
      throw new Error(
        `${manifest.display_name} runs as a program on a computer: it needs the desktop app`,
      );
    }
    checkInstall(manifest, { forbiddenOrigins: rimOrigins() });
    const existing = await read<InstallRecord>(INSTALLS, [account, manifest.plugin_id]);
    if (existing && !replace) throw new AlreadyInstalledError(manifest.plugin_id);
    const record: InstallRecord = {
      v: 1,
      account,
      pluginId: manifest.plugin_id,
      manifestText: bundle.manifestText,
      bundleSha256: sha256,
      bundleSize: bytes.length,
      source,
      status: "installed",
      approvedCapabilities: [],
      approvedAiCommands: [],
      starting: false,
      installedAt: new Date().toISOString(),
    };
    const tx = (await database()).transaction([BUNDLES, INSTALLS], "readwrite");
    tx.objectStore(BUNDLES).put({ sha256, bytes } satisfies StoredBundle);
    tx.objectStore(INSTALLS).put(record);
    await committed(tx);
    return {
      plugin_id: manifest.plugin_id,
      display_name: manifest.display_name,
      version: manifest.version,
      capabilities: manifest.capabilities,
      install_path: "",
    };
  }

  /** The install's bundle, hashed again; fetched again from its link when missing or damaged. */
  async loadFiles(pluginId: string): Promise<{ manifestText: string; files: BundleFile[] }> {
    const record = await this.record(pluginId);
    let bytes = (await read<StoredBundle>(BUNDLES, record.bundleSha256))?.bytes ?? null;
    if (bytes === null || (await sha256Hex(bytes)) !== record.bundleSha256) {
      bytes = await this.refetch(record);
    }
    const bundle = readBundle(bytes);
    if (bundle.manifestText !== record.manifestText)
      throw new Error("bundle damaged or unavailable");
    return { manifestText: bundle.manifestText, files: bundle.files };
  }

  private async refetch(record: InstallRecord): Promise<Uint8Array> {
    if (record.source.kind !== "link") throw new Error("bundle damaged or unavailable");
    let bytes: Uint8Array;
    try {
      bytes = await fetchBundle(record.source.url, record.bundleSha256);
    } catch {
      throw new Error("bundle damaged or unavailable");
    }
    await write(BUNDLES, { sha256: record.bundleSha256, bytes } satisfies StoredBundle);
    return bytes;
  }

  setStarting(pluginId: string, starting: boolean): Promise<void> {
    return this.update(pluginId, (r) => ({ ...r, starting }));
  }

  async storageGet(pluginId: string, key: string): Promise<unknown> {
    const account = this.storageAccount(key);
    const entry = await read<StorageRecord>(STORAGE, [pluginId, account, key]);
    return entry ? (JSON.parse(entry.json) as unknown) : null;
  }

  async storageSet(pluginId: string, key: string, value: unknown): Promise<void> {
    const account = this.storageAccount(key);
    const db = await database();
    const tx = db.transaction(STORAGE, "readwrite");
    const store = tx.objectStore(STORAGE);
    if (value === null) {
      store.delete([pluginId, account, key]);
      await committed(tx);
      return;
    }
    const json = JSON.stringify(value);
    const entries = await done(
      store.getAll(storageRange(pluginId, account)) as IDBRequest<StorageRecord[]>,
    );
    let bytes = encoder.encode(key).length + encoder.encode(json).length;
    for (const entry of entries) {
      if (entry.key !== key)
        bytes += encoder.encode(entry.key).length + encoder.encode(entry.json).length;
    }
    if (bytes > MAX_STORE_BYTES) {
      tx.abort();
      throw new RpcError(
        ErrorCode.INVALID_PARAMS,
        `the plugin's store would exceed ${MAX_STORE_BYTES} bytes`,
        { reason: "quota" },
      );
    }
    store.put({ pluginId, account, key, json } satisfies StorageRecord);
    await committed(tx);
  }

  private storageAccount(key: string): string {
    if (this.account === null) throw new RpcError(ErrorCode.INVALID_PARAMS, "nobody is signed in");
    if (!STORAGE_KEY.test(key)) {
      throw new RpcError(
        ErrorCode.INVALID_PARAMS,
        "key must be 1 to 128 characters of A-Z a-z 0-9 . _ -",
      );
    }
    return this.account;
  }

  async checkAiConsent(pluginId: string, commandId: string): Promise<void> {
    const record = await this.record(pluginId);
    if (!record.approvedAiCommands.includes(commandId)) {
      throw new Error(`AI command not approved: ${commandId}`);
    }
  }

  async mappings(): Promise<PrincipalMapping[]> {
    const tx = (await database()).transaction(PRINCIPAL_IDS, "readonly");
    return done(tx.objectStore(PRINCIPAL_IDS).getAll() as IDBRequest<PrincipalMapping[]>);
  }

  /** Remember that `from` became `to`; true when this browser had not seen it before. */
  async recordMapping(from: string, to: string): Promise<boolean> {
    const known = await read<PrincipalMapping>(PRINCIPAL_IDS, from);
    if (known?.to === to) return false;
    await write(PRINCIPAL_IDS, { from, to } satisfies PrincipalMapping);
    return true;
  }
}

/** The store the web app uses. */
export const browserPluginStore = new BrowserPluginStore();
