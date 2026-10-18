// Where the web app keeps web plugins: IndexedDB database `rim-plugins` with
// verified bundles keyed by hash (`bundles`), install records per account
// (`installs`), each plugin's `rim.storage` per account (`storage`), the
// provisional-to-key principal ids this browser has seen (`principalIds`), and
// the non-secret values each account saved in a plugin's settings form
// (`settings`); the web app keeps no secret settings.
// Bundles are hashed again at every start; a damaged or evicted one is fetched
// again from its link and must hash the same.

import { EMPTY_AUDIT, withEncryptedReads, withGrant } from "../audit";
import type {
  PluginAudit,
  PluginCommandInfo,
  PluginContextAction,
  PluginInfo,
  PluginInstallResult,
  PluginInstallSource,
  PluginSettingsFormState,
} from "../types";
import { mergeSettings, PluginSettingsError } from "../pluginSettings";
import { readBundle, sha256Hex, type BundleFile } from "./bundle";
import { fetchBundle, serverBundleUrl } from "./bundleLink";
import {
  checkInstall,
  parseManifestText,
  settingValueError,
  type ManifestSetting,
  type PluginManifest,
} from "../../../../sdk/plugin-sdk/src/manifestRules";
import { rimOrigins, type BundleInstall, type PluginServices } from "./pluginServices";
import { ErrorCode, RpcError, type PrincipalMapping } from "./rpc";
import { webPluginHost } from "./webPluginHost";

const DB_NAME = "rim-plugins";
const DB_VERSION = 2;
const BUNDLES = "bundles";
const INSTALLS = "installs";
const STORAGE = "storage";
const PRINCIPAL_IDS = "principalIds";
const SETTINGS = "settings";

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
  /** Grant history and encrypted reads; absent on records older than the audit. */
  audit?: PluginAudit;
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

/** One saved non-secret setting of one plugin for one account. */
interface SettingRecord {
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
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(BUNDLES, { keyPath: "sha256" });
        db.createObjectStore(INSTALLS, { keyPath: ["account", "pluginId"] });
        db.createObjectStore(STORAGE, { keyPath: ["pluginId", "account", "key"] });
        db.createObjectStore(PRINCIPAL_IDS, { keyPath: "from" });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore(SETTINGS, { keyPath: ["pluginId", "account", "key"] });
      }
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

/** Every key of one plugin and account in a store keyed `[pluginId, account, key]`. */
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
    required_context: c.required_context,
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
    settings_schema: manifest.settings_schema,
    health: "stopped",
    runtime_kind: manifest.runtime_kind,
    network_origins: manifest.network_origins ?? [],
    source: record.source,
    starting: record.starting,
    audit: record.audit ?? EMPTY_AUDIT,
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

  /** Add `capabilities` to those approved; each must be one the manifest asks for, as on the desktop. */
  approveCapabilities(pluginId: string, capabilities: string[]): Promise<void> {
    return this.update(pluginId, (r) => {
      const asked = parseManifestText(r.manifestText).capabilities;
      const unknown = capabilities.find((c) => !asked.includes(c));
      if (unknown !== undefined) throw new Error(`capability not requested by plugin: ${unknown}`);
      const approved = [...r.approvedCapabilities];
      let audit = r.audit;
      const now = new Date();
      for (const capability of capabilities) {
        if (!approved.includes(capability)) {
          approved.push(capability);
          audit = withGrant(audit, capability, "granted", now);
        }
      }
      return { ...r, approvedCapabilities: approved, ...(audit ? { audit } : {}) };
    });
  }

  /** Revoking a capability also disables the plugin, as on the desktop. */
  revokeCapability(pluginId: string, capability: string): Promise<void> {
    return this.update(pluginId, (r) => ({
      ...r,
      status: r.status === "enabled" ? "disabled" : r.status,
      approvedCapabilities: r.approvedCapabilities.filter((c) => c !== capability),
      ...(r.approvedCapabilities.includes(capability)
        ? { audit: withGrant(r.audit, capability, "revoked", new Date()) }
        : {}),
    }));
  }

  /** Count `count` encrypted messages the message service gave the plugin today. */
  recordEncryptedReads(pluginId: string, count: number): Promise<void> {
    return this.update(pluginId, (r) => ({
      ...r,
      audit: withEncryptedReads(r.audit, count, new Date()),
    }));
  }

  /** Remove the plugin, its storage and settings, and its bundle when no other install uses it. */
  async uninstall(pluginId: string): Promise<void> {
    const account = this.signedIn();
    const record = await this.record(pluginId);
    const db = await database();
    const tx = db.transaction([INSTALLS, STORAGE, SETTINGS, BUNDLES], "readwrite");
    const installs = tx.objectStore(INSTALLS);
    installs.delete([account, pluginId]);
    tx.objectStore(STORAGE).delete(storageRange(pluginId, account));
    tx.objectStore(SETTINGS).delete(storageRange(pluginId, account));
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
    manifest: signed,
    keepApprovals,
  }: BundleInstall): Promise<PluginInstallResult> {
    const account = this.signedIn();
    if ((await sha256Hex(bytes)) !== sha256)
      throw new Error("the bundle does not match its SHA-256");
    const bundle = readBundle(bytes);
    if (signed !== undefined && signed !== bundle.manifestText) {
      throw new Error("the bundle's rim-plugin.json is not the signed manifest");
    }
    const manifest = bundle.manifest;
    if (manifest.runtime_kind !== "WebSandboxed") {
      throw new Error(
        `${manifest.display_name} runs as a program on a computer: it needs the desktop app`,
      );
    }
    checkInstall(manifest, { forbiddenOrigins: rimOrigins() });
    const existing = await read<InstallRecord>(INSTALLS, [account, manifest.plugin_id]);
    if (existing && !replace) throw new AlreadyInstalledError(manifest.plugin_id);
    const kept = keepApprovals && existing ? existing : null;
    const aiCommands = manifest.commands.filter((c) => c.ai_callable).map((c) => c.id);
    const record: InstallRecord = {
      v: 1,
      account,
      pluginId: manifest.plugin_id,
      manifestText: bundle.manifestText,
      bundleSha256: sha256,
      bundleSize: bytes.length,
      source,
      status: kept?.status ?? "installed",
      approvedCapabilities: (kept?.approvedCapabilities ?? []).filter((c) =>
        manifest.capabilities.includes(c),
      ),
      approvedAiCommands: (kept?.approvedAiCommands ?? []).filter((c) => aiCommands.includes(c)),
      starting: false,
      installedAt: new Date().toISOString(),
      // An update keeps the plugin's history; a fresh install starts its own.
      ...(existing?.audit ? { audit: existing.audit } : {}),
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
    const source = record.source;
    let bytes: Uint8Array;
    try {
      if (source.kind === "link") {
        bytes = await fetchBundle(source.url, record.bundleSha256);
      } else if (source.kind === "registry") {
        const url = serverBundleUrl(source.serverId, record.bundleSha256);
        bytes = await fetchBundle(url, record.bundleSha256, fetch, "include");
      } else {
        throw new Error("no source to fetch from");
      }
    } catch {
      throw new Error("bundle damaged or unavailable");
    }
    await write(BUNDLES, { sha256: record.bundleSha256, bytes } satisfies StoredBundle);
    return bytes;
  }

  /** Make a registry install a local one: no registry source and no updates. */
  detachRegistry(pluginId: string): Promise<void> {
    return this.update(pluginId, (r) => ({ ...r, source: { kind: "local" } }));
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

  private async settingsSchema(pluginId: string): Promise<ManifestSetting[]> {
    return parseManifestText((await this.record(pluginId)).manifestText).settings_schema;
  }

  private async savedSettings(pluginId: string, account: string): Promise<Record<string, unknown>> {
    const tx = (await database()).transaction(SETTINGS, "readonly");
    const entries = await done(
      tx.objectStore(SETTINGS).getAll(storageRange(pluginId, account)) as IDBRequest<
        SettingRecord[]
      >,
    );
    return Object.fromEntries(entries.map((e) => [e.key, JSON.parse(e.json) as unknown]));
  }

  /**
   * The settings form of `pluginId` for the signed-in account: the saved values
   * of its non-secret settings. Secret settings are never set here, since the
   * web app keeps none.
   */
  async settingsGet(pluginId: string): Promise<PluginSettingsFormState> {
    const account = this.signedIn();
    const schema = await this.settingsSchema(pluginId);
    const saved = await this.savedSettings(pluginId, account);
    const values: Record<string, unknown> = {};
    for (const setting of schema) {
      if (!setting.is_secret && Object.prototype.hasOwnProperty.call(saved, setting.key)) {
        values[setting.key] = saved[setting.key];
      }
    }
    const secrets = Object.fromEntries(
      schema.filter((s) => s.is_secret).map((s) => [s.key, false] as const),
    );
    return { values, secrets, secrets_available: false, secrets_error: null };
  }

  /**
   * Save the user's changes to `pluginId`'s settings: each key a declared
   * setting, each value one it accepts, `null` clearing the saved value. Every
   * change is checked before any is written.
   *
   * @throws PluginSettingsError naming the first key refused, a secret setting
   *   among them, since the web app has no encrypted store for one.
   */
  async settingsSave(pluginId: string, changes: Readonly<Record<string, unknown>>): Promise<void> {
    const account = this.signedIn();
    const schema = await this.settingsSchema(pluginId);
    const checked: [ManifestSetting, unknown][] = [];
    for (const [key, value] of Object.entries(changes)) {
      const setting = schema.find((s) => s.key === key);
      if (!setting) throw new PluginSettingsError(`${key} is not a setting of this plugin`, key);
      if (setting.is_secret) {
        if (value === null) continue;
        throw new PluginSettingsError(
          `${key} is a secret setting, which needs the desktop app`,
          key,
        );
      }
      const reason = value === null ? null : settingValueError(setting, value);
      if (reason !== null) throw new PluginSettingsError(`${key} ${reason}`, key);
      checked.push([setting, value]);
    }
    const tx = (await database()).transaction(SETTINGS, "readwrite");
    const store = tx.objectStore(SETTINGS);
    for (const [setting, value] of checked) {
      if (value === null) store.delete([pluginId, account, setting.key]);
      else {
        store.put({
          pluginId,
          account,
          key: setting.key,
          json: JSON.stringify(value),
        } satisfies SettingRecord);
      }
    }
    await committed(tx);
    onPluginSettingsSaved(pluginId);
  }

  /** Clear every saved setting of `pluginId` for the signed-in account. */
  async settingsReset(pluginId: string): Promise<void> {
    const account = this.signedIn();
    await this.record(pluginId);
    const tx = (await database()).transaction(SETTINGS, "readwrite");
    tx.objectStore(SETTINGS).delete(storageRange(pluginId, account));
    await committed(tx);
    onPluginSettingsSaved(pluginId);
  }

  /**
   * The settings `pluginId` reads for `account`: each declared setting's saved
   * value or else its default; with `account` null, the defaults of any install
   * of the plugin in this browser. A secret setting never has a value here.
   *
   * @throws Error when the plugin is not installed for `account`, or at all.
   */
  async settingsValues(pluginId: string, account: string | null): Promise<Record<string, unknown>> {
    const record =
      account === null
        ? await this.anyInstall(pluginId)
        : await read<InstallRecord>(INSTALLS, [account, pluginId]);
    if (!record) throw new Error(`plugin not found: ${pluginId}`);
    const schema = parseManifestText(record.manifestText).settings_schema.filter(
      (s) => !s.is_secret,
    );
    const saved = account === null ? {} : await this.savedSettings(pluginId, account);
    return mergeSettings(schema, saved);
  }

  /** The settings `pluginId` reads for the signed-in account, as {@link resolvedPluginSettings} gives them. */
  pluginSettings(pluginId: string): Promise<Record<string, unknown>> {
    return resolvedPluginSettings(pluginId, this.account);
  }

  private async anyInstall(pluginId: string): Promise<InstallRecord | undefined> {
    const tx = (await database()).transaction(INSTALLS, "readonly");
    const records = await done(tx.objectStore(INSTALLS).getAll() as IDBRequest<InstallRecord[]>);
    return records.find((r) => r.pluginId === pluginId);
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

/**
 * The settings the web plugin `pluginId` reads for `account` (a provisional
 * principal id, or null with nobody signed in): saved values over defaults,
 * never a secret setting, which the web app does not keep.
 */
export function resolvedPluginSettings(
  pluginId: string,
  account: string | null,
): Promise<Record<string, unknown>> {
  return browserPluginStore.settingsValues(pluginId, account);
}

/**
 * Runs after a save or a reset changed `pluginId`'s settings for the signed-in
 * account, in this browser or in the desktop's host: the web plugin host sends
 * the plugin's running session its new settings in `rim.settings.changed`.
 */
export function onPluginSettingsSaved(pluginId: string): void {
  webPluginHost.settingsChanged(pluginId);
}
