// The rules a host installs a plugin's `rim-plugin.json` by: parsing as the
// desktop host's Rust manifest type does, then its install checks. The web app,
// which has no Rust host, installs by these, and a plugin's tests can check its
// manifest against them. They reach the desktop host's verdict on every entry of
// the shared manifest vectors.

/** How a plugin runs: a program on the desktop, or sandboxed in the app's frames. */
export type RuntimeKind = "DesktopLocalProcess" | "WebSandboxed";

export const NETWORK_FETCH = "network.fetch";
export const CHAT_READ = "chat.read";
export const CHAT_WRITE = "chat.write";
export const CHAT_READ_ENCRYPTED = "chat.read.encrypted";
export const CHAT_WRITE_ENCRYPTED = "chat.write.encrypted";
/** Each encrypted chat capability and the plain one a manifest must ask for with it. */
export const ENCRYPTED_CHAT_CAPABILITIES: readonly (readonly [string, string])[] = [
  [CHAT_READ_ENCRYPTED, CHAT_READ],
  [CHAT_WRITE_ENCRYPTED, CHAT_WRITE],
];
export const MAX_NETWORK_ORIGINS = 16;
export const MAX_BUNDLE_PATH_BYTES = 255;

/**
 * The capability names a manifest may declare and a command may require, with
 * {@link NETWORK_FETCH} for a WebSandboxed plugin; install refuses any other name.
 */
export const BUILTIN_CAPABILITIES = [
  "ui.panel",
  "ui.notify",
  CHAT_READ,
  CHAT_WRITE,
  CHAT_READ_ENCRYPTED,
  CHAT_WRITE_ENCRYPTED,
] as const;

/** A name in {@link BUILTIN_CAPABILITIES}. */
export type BuiltinCapability = (typeof BUILTIN_CAPABILITIES)[number];

const RESERVED_ID_PREFIXES = ["dev.rim.", "com.rim."];
const LOCAL_ONLY_CAPABILITIES = ["local.process", "fs.read", "fs.write"];

/**
 * The context kinds a command's `required_context` can name, and the arguments
 * the host adds to the command's `args` for each. A command requiring a kind may
 * not declare an argument of those names.
 */
export const CONTEXT_ARGUMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  workspace: ["workspace_id"],
  conversation: ["conversation_id", "thread_id"],
  message: ["message_id", "conversation_id", "thread_id"],
});

export interface ManifestCommand {
  id: string;
  title: string;
  description: string;
  keybind_capable: boolean;
  dangerous: boolean;
  required_context: string[];
  required_capabilities: string[];
  arguments: unknown[];
  ai_callable: boolean;
  output_schema: unknown;
}

export interface ManifestPanel {
  id: string;
  title: string;
  description: string;
  slot?: "tool_panel" | "main_area";
}

/** The value types a `settings_schema` entry may declare. */
export const SETTING_VALUE_TYPES = ["string", "boolean", "integer", "path", "enum"] as const;

/** A name in {@link SETTING_VALUE_TYPES}. */
export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

/**
 * Largest magnitude of an `integer` setting, its bounds and its default: 2^53 - 1,
 * {@link Number.MAX_SAFE_INTEGER}.
 */
export const MAX_SETTING_INTEGER = Number.MAX_SAFE_INTEGER;

/**
 * One `settings_schema` entry: a setting the user fills in the plugin's settings
 * form. The optional fields are present only when the manifest sets them.
 */
export interface ManifestSetting {
  /** The setting's name in the plugin's values. */
  key: string;
  /** The field's label in the form. */
  title: string;
  /** The help line under the field. */
  description: string;
  /** One of {@link SETTING_VALUE_TYPES} once installed; parsing takes any string. */
  value_type: string;
  /** Kept in the desktop's secret vault and never shown again once saved. */
  is_secret: boolean;
  /** The value the plugin gets while the user has saved none. */
  default?: unknown;
  /** Inclusive lower bound of an `integer` setting. */
  min?: number;
  /** Inclusive upper bound of an `integer` setting. */
  max?: number;
  /** The values an `enum` setting offers. */
  options?: string[];
  /** The hint an empty `string`, `path` or `integer` field shows. */
  placeholder?: string;
}

/** A parsed `rim-plugin.json`, with every default filled in. */
export interface PluginManifest {
  manifest_version: number;
  plugin_id: string;
  display_name: string;
  version: string;
  description: string;
  author: string | null;
  runtime_kind: RuntimeKind;
  entrypoint: string;
  capabilities: string[];
  network_origins: string[] | null;
  commands: ManifestCommand[];
  keybind_suggestions: {
    keystroke: string;
    command_id: string;
    context: string;
    preset_args: unknown;
  }[];
  context_actions: { id: string; title: string; command_id: string; context_types: string[] }[];
  panels: ManifestPanel[];
  settings_schema: ManifestSetting[];
}

/** A manifest the host refuses, with the reason. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

// ─── Parsing, as serde reads the Rust struct ─────────────────────────────────

function str(object: Json, key: string, where: string): string {
  const value = object[key];
  if (!has(object, key)) throw new ManifestError(`${where}: missing field \`${key}\``);
  if (typeof value !== "string") throw new ManifestError(`${where}: \`${key}\` must be a string`);
  return value;
}

/** A field with a default: absent gives the default, anything else must have the type. */
function withDefault<T>(
  object: Json,
  key: string,
  fallback: T,
  read: (value: unknown) => T | undefined,
  where: string,
): T {
  if (!has(object, key)) return fallback;
  const value = read(object[key]);
  if (value === undefined) throw new ManifestError(`${where}: \`${key}\` has the wrong type`);
  return value;
}

const asBool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const asString = (v: unknown) => (typeof v === "string" ? v : undefined);
const asStrings = (v: unknown) =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : undefined;
const asArray = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : undefined);
/** An `i64` field: a JSON integer; the setting rules bound it further. */
const asInteger = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

function objects(object: Json, key: string, where: string): Json[] {
  const list = withDefault(object, key, [] as unknown[], asArray, where);
  return list.map((entry, i) => {
    if (!isObject(entry)) throw new ManifestError(`${where}: ${key}[${i}] must be an object`);
    return entry;
  });
}

/** An `Option<T>` field: absent and `null` are both none. */
function optional<T>(object: Json, key: string, read: (v: unknown) => T | undefined): T | null {
  const value = object[key];
  if (value === undefined || value === null) return null;
  const read_ = read(value);
  if (read_ === undefined) throw new ManifestError(`manifest: \`${key}\` has the wrong type`);
  return read_;
}

function parseShape(raw: unknown): PluginManifest {
  if (!isObject(raw)) throw new ManifestError("manifest must be a JSON object");
  const where = "manifest";
  const version = raw.manifest_version;
  if (!has(raw, "manifest_version")) {
    throw new ManifestError("manifest: missing field `manifest_version`");
  }
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < -2147483648 ||
    version > 2147483647
  ) {
    throw new ManifestError("manifest: `manifest_version` must be an integer");
  }
  const kind = str(raw, "runtime_kind", where);
  if (kind !== "DesktopLocalProcess" && kind !== "WebSandboxed") {
    throw new ManifestError(`failed to parse manifest: unknown variant \`${kind}\``);
  }
  return {
    manifest_version: version,
    plugin_id: str(raw, "plugin_id", where),
    display_name: str(raw, "display_name", where),
    version: str(raw, "version", where),
    description: str(raw, "description", where),
    author: optional(raw, "author", asString),
    runtime_kind: kind,
    entrypoint: str(raw, "entrypoint", where),
    capabilities: withDefault(raw, "capabilities", [], asStrings, where),
    network_origins: optional(raw, "network_origins", asStrings),
    commands: objects(raw, "commands", where).map((c, i) => {
      const at = `commands[${i}]`;
      return {
        id: str(c, "id", at),
        title: str(c, "title", at),
        description: str(c, "description", at),
        keybind_capable: withDefault(c, "keybind_capable", false, asBool, at),
        dangerous: withDefault(c, "dangerous", false, asBool, at),
        required_context: withDefault(c, "required_context", [], asStrings, at),
        required_capabilities: withDefault(c, "required_capabilities", [], asStrings, at),
        arguments: withDefault(c, "arguments", [], asArray, at),
        ai_callable: withDefault(c, "ai_callable", false, asBool, at),
        output_schema: c.output_schema ?? null,
      };
    }),
    keybind_suggestions: objects(raw, "keybind_suggestions", where).map((k, i) => {
      const at = `keybind_suggestions[${i}]`;
      return {
        keystroke: str(k, "keystroke", at),
        command_id: str(k, "command_id", at),
        context: str(k, "context", at),
        preset_args: k.preset_args ?? null,
      };
    }),
    context_actions: objects(raw, "context_actions", where).map((a, i) => {
      const at = `context_actions[${i}]`;
      return {
        id: str(a, "id", at),
        title: str(a, "title", at),
        command_id: str(a, "command_id", at),
        context_types: withDefault(a, "context_types", [], asStrings, at),
      };
    }),
    panels: objects(raw, "panels", where).map((p, i) => {
      const at = `panels[${i}]`;
      const slot = optional(p, "slot", (v) =>
        v === "tool_panel" || v === "main_area" ? v : undefined,
      );
      return {
        id: str(p, "id", at),
        title: str(p, "title", at),
        description: withDefault(p, "description", "", asString, at),
        ...(slot ? { slot } : {}),
      };
    }),
    settings_schema: objects(raw, "settings_schema", where).map((s, i) => {
      const at = `settings_schema[${i}]`;
      const setting: ManifestSetting = {
        key: str(s, "key", at),
        title: str(s, "title", at),
        description: withDefault(s, "description", "", asString, at),
        value_type: str(s, "value_type", at),
        is_secret: withDefault(s, "is_secret", false, asBool, at),
      };
      const fallback = s.default ?? null;
      const min = optional(s, "min", asInteger);
      const max = optional(s, "max", asInteger);
      const options = optional(s, "options", asStrings);
      const placeholder = optional(s, "placeholder", asString);
      return {
        ...setting,
        ...(fallback !== null ? { default: fallback } : {}),
        ...(min !== null ? { min } : {}),
        ...(max !== null ? { max } : {}),
        ...(options !== null ? { options } : {}),
        ...(placeholder !== null ? { placeholder } : {}),
      };
    }),
  };
}

// ─── The manifest's own checks (`PluginManifest::validate`) ──────────────────

function validatePluginId(id: string): void {
  const segments = id.split(".");
  if (segments.length < 3) {
    throw new ManifestError(
      `plugin_id must have at least 3 segments (reverse-domain notation): '${id}'`,
    );
  }
  for (const segment of segments) {
    if (segment === "") throw new ManifestError(`plugin_id contains an empty segment: '${id}'`);
    if (!/^[A-Za-z0-9-]+$/.test(segment)) {
      throw new ManifestError(`plugin_id segment contains invalid characters: '${segment}'`);
    }
  }
}

function validateShape(m: PluginManifest): void {
  if (m.manifest_version !== 1) {
    throw new ManifestError(`unsupported manifest_version: ${m.manifest_version}`);
  }
  for (const field of ["plugin_id", "display_name", "version", "entrypoint"] as const) {
    if (m[field] === "") throw new ManifestError(`${field} must not be empty`);
  }
  validatePluginId(m.plugin_id);
  const ids = new Set(m.commands.map((c) => c.id));
  for (const s of m.keybind_suggestions) {
    if (!ids.has(s.command_id)) {
      throw new ManifestError(
        `keybind_suggestion references undeclared command: '${s.command_id}'`,
      );
    }
  }
  for (const a of m.context_actions) {
    if (!ids.has(a.command_id)) {
      throw new ManifestError(
        `context_action '${a.id}' references undeclared command: '${a.command_id}'`,
      );
    }
  }
}

/**
 * Read a manifest the way the desktop host loads one: its shape and its own
 * checks, without the install rules of {@link checkInstall}.
 */
export function parseManifest(value: unknown): PluginManifest {
  const manifest = parseShape(value);
  validateShape(manifest);
  return manifest;
}

/** {@link parseManifest} of `rim-plugin.json` text. */
export function parseManifestText(text: string): PluginManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ManifestError(`failed to parse manifest: ${(error as Error).message}`);
  }
  return parseManifest(value);
}

// ─── Install rules (`validation.rs`) ─────────────────────────────────────────

/** Whether `path` is a bundle path: `/`-separated segments of `A-Z a-z 0-9 . _ -`. */
export function isBundlePath(path: string): boolean {
  return (
    path.length > 0 &&
    byteLength(path) <= MAX_BUNDLE_PATH_BYTES &&
    path.split("/").every(isBundleSegment)
  );
}

export function isBundleSegment(segment: string): boolean {
  return segment.length > 0 && !segment.startsWith(".") && /^[A-Za-z0-9._-]+$/.test(segment);
}

/** One parsed `network_origins` entry. */
export interface NetworkOrigin {
  scheme: "https" | "wss";
  host: string;
  port: number | null;
}

/** Host and port, the default port (443) left out: how the consent prompt names a site. */
export function siteOf(origin: NetworkOrigin): string {
  return origin.port !== null && origin.port !== 443
    ? `${origin.host}:${origin.port}`
    : origin.host;
}

/** Parse `https://host[:port]` or `wss://host[:port]`, lowercase, nothing else. */
export function parseNetworkOrigin(origin: string): NetworkOrigin {
  let scheme: NetworkOrigin["scheme"];
  let rest: string;
  if (origin.startsWith("https://")) {
    scheme = "https";
    rest = origin.slice("https://".length);
  } else if (origin.startsWith("wss://")) {
    scheme = "wss";
    rest = origin.slice("wss://".length);
  } else {
    throw new ManifestError(`\`${origin}\` must start with https:// or wss://`);
  }
  const colon = rest.indexOf(":");
  const host = colon === -1 ? rest : rest.slice(0, colon);
  let port: number | null = null;
  if (colon !== -1) {
    const digits = rest.slice(colon + 1);
    const value = Number(digits);
    if (!/^[1-9][0-9]{0,4}$/.test(digits) || value > 65535) {
      throw new ManifestError(`\`${origin}\` has an invalid port`);
    }
    port = value;
  }
  const validHost =
    host.length > 0 &&
    host.length <= 253 &&
    host
      .split(".")
      .every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          !label.startsWith("-") &&
          !label.endsWith("-") &&
          /^[a-z0-9-]+$/.test(label),
      );
  if (!validHost) {
    throw new ManifestError(
      `\`${origin}\` must be scheme://host[:port] with a lowercase host and no path, query, fragment, userinfo or wildcard`,
    );
  }
  return { scheme, host, port };
}

/** Host and port of an http(s) or ws(s) origin or URL, default port left out. */
function forbiddenSite(origin: string): string | null {
  const match = /^([a-z]+):\/\/([^/?#]*)/i.exec(origin);
  if (!match) return null;
  const defaults: Record<string, string> = { https: "443", wss: "443", http: "80", ws: "80" };
  const defaultPort = defaults[match[1].toLowerCase()];
  if (!defaultPort) return null;
  const authority = match[2].toLowerCase();
  const colon = authority.lastIndexOf(":");
  if (colon !== -1 && authority.slice(colon + 1) === defaultPort) return authority.slice(0, colon);
  return authority;
}

function isBuiltinCapability(key: string): key is BuiltinCapability {
  return (BUILTIN_CAPABILITIES as readonly string[]).includes(key);
}

/**
 * Refuses a capability name a plugin of `kind` may not declare or require: any
 * name but the built-in ones, and {@link NETWORK_FETCH} for a WebSandboxed plugin.
 *
 * @param context - Put before the reason, such as the command that requires the name.
 */
function validateCapability(kind: RuntimeKind, key: string, context = ""): void {
  const reject = (reason: string): never => {
    throw new ManifestError(`invalid capability key \`${key}\`: ${context}${reason}`);
  };
  if (isBuiltinCapability(key)) return;
  if (key === NETWORK_FETCH) {
    if (kind === "WebSandboxed") return;
    reject(
      "network.fetch is for WebSandboxed plugins; a local process reaches the network on its own",
    );
  }
  if (kind === "WebSandboxed") {
    if (LOCAL_ONLY_CAPABILITIES.includes(key)) {
      reject("WebSandboxed plugins cannot run programs or read files; use DesktopLocalProcess");
    }
    if (key === "network") {
      reject(
        "network names host-brokered requests for local processes; a WebSandboxed plugin asks for network.fetch",
      );
    }
  }
  const allowed = [...BUILTIN_CAPABILITIES, ...(kind === "WebSandboxed" ? [NETWORK_FETCH] : [])];
  if (key.startsWith("plugin.")) {
    reject(
      `plugin-scoped capability keys are not supported, since the permission prompt cannot approve them; a manifest names only built-in capabilities: ${allowed.join(", ")}`,
    );
  }
  reject(
    `not a built-in capability; a manifest names only built-in capabilities: ${allowed.join(", ")}`,
  );
}

/** Each command requires only built-in names that the manifest's `capabilities` declares. */
function validateRequiredCapabilities(m: PluginManifest): void {
  for (const command of m.commands) {
    for (const key of command.required_capabilities) {
      validateCapability(m.runtime_kind, key, `required by command \`${command.id}\`: `);
      if (!m.capabilities.includes(key)) {
        throw new ManifestError(
          `command \`${command.id}\` requires capability \`${key}\`, which the manifest's capabilities do not declare`,
        );
      }
    }
  }
}

function validateNetworkOrigins(m: PluginManifest, forbiddenOrigins: readonly string[]): void {
  const reject = (reason: string): never => {
    throw new ManifestError(`invalid network_origins: ${reason}`);
  };
  const wantsFetch = m.capabilities.includes(NETWORK_FETCH);
  const origins = m.network_origins;
  if (origins === null) {
    if (wantsFetch) reject("network.fetch needs network_origins listing 1 to 16 origins");
    return;
  }
  if (m.runtime_kind !== "WebSandboxed") reject("network_origins is for WebSandboxed plugins");
  if (!wantsFetch) reject("network_origins is present without the network.fetch capability");
  if (origins.length === 0 || origins.length > MAX_NETWORK_ORIGINS) {
    reject(`lists ${origins.length} origins, must list 1 to ${MAX_NETWORK_ORIGINS}`);
  }
  const forbidden = forbiddenOrigins.map(forbiddenSite).filter((s): s is string => s !== null);
  const seen = new Set<string>();
  for (const origin of origins) {
    let parsed: NetworkOrigin;
    try {
      parsed = parseNetworkOrigin(origin);
    } catch (error) {
      return reject((error as Error).message);
    }
    if (seen.has(origin)) reject(`\`${origin}\` is listed twice`);
    seen.add(origin);
    if (forbidden.includes(siteOf(parsed))) {
      reject(`\`${origin}\` is RIM's own origin, which a plugin may never reach`);
    }
  }
}

function validateWebLayout(m: PluginManifest): void {
  const entry = m.entrypoint;
  const reject = (reason: string): never => {
    throw new ManifestError(`invalid entrypoint \`${entry}\`: ${reason}`);
  };
  if (!isBundlePath(entry)) reject("must be a bundle path of A-Z a-z 0-9 . _ - segments");
  if (!entry.endsWith(".mjs") && !entry.endsWith(".js")) {
    reject("a WebSandboxed entrypoint is an ES module ending in .mjs or .js");
  }
  if (entry.startsWith("panels/")) reject("the entrypoint may not live under panels/");
  for (const panel of m.panels) {
    if (!isBundleSegment(panel.id)) {
      throw new ManifestError(
        `invalid panel \`${panel.id}\`: a panel id names its folder under panels/`,
      );
    }
  }
}

function normalizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function leaksInstallId(name: string): boolean {
  const normalized = normalizeName(name);
  return normalized.includes("installid") || normalized.includes("installationid");
}

function walkSchema(commandId: string, path: string, node: unknown): void {
  if (!isObject(node)) return;
  const leak = (field: string): never => {
    throw new ManifestError(
      `command \`${commandId}\` is ai_callable but its output_schema declares \`${field}\`, which matches the plugin-install-id leak heuristic`,
    );
  };
  const join = (child: string) => (path === "" ? child : `${path}.${child}`);
  if (isObject(node.properties)) {
    for (const [name, value] of Object.entries(node.properties)) {
      if (leaksInstallId(name)) leak(join(name));
      walkSchema(commandId, join(name), value);
    }
  }
  if (has(node, "items")) {
    const items = node.items;
    if (Array.isArray(items))
      items.forEach((item, i) => walkSchema(commandId, `${path}[${i}]`, item));
    else walkSchema(commandId, `${path}[]`, items);
  }
  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    const branches = node[keyword];
    if (Array.isArray(branches)) {
      branches.forEach((branch, i) => walkSchema(commandId, `${path}|${keyword}[${i}]`, branch));
    }
  }
  if (isObject(node.$defs)) {
    for (const [name, def] of Object.entries(node.$defs)) {
      const defPath = path === "" ? `$defs.${name}` : `${path}.$defs.${name}`;
      if (leaksInstallId(name)) leak(defPath);
      walkSchema(commandId, defPath, def);
    }
  }
}

/** A command may not declare an argument the host sets from a context it requires. */
function checkContextArguments(command: ManifestCommand): void {
  for (const kind of command.required_context) {
    if (!has(CONTEXT_ARGUMENTS, kind)) continue;
    const reserved = CONTEXT_ARGUMENTS[kind];
    for (const argument of command.arguments) {
      const name = isObject(argument) ? argument.name : undefined;
      if (typeof name === "string" && reserved.includes(name)) {
        throw new ManifestError(
          `command \`${command.id}\` declares argument \`${name}\`, which the host sets from its required ${kind} context`,
        );
      }
    }
  }
}

function checkAiCommand(command: ManifestCommand): void {
  const review = (reason: string): never => {
    throw new ManifestError(`command \`${command.id}\` requires manual install review: ${reason}`);
  };
  const schema = command.output_schema;
  if (schema === null || schema === undefined) {
    review("ai_callable: true requires a declared output_schema");
  }
  if (!isObject(schema)) return review("output_schema must be a JSON object");
  if (schema.type !== "object") review("output_schema root type must be `object`");
  if (schema.additionalProperties === true)
    review("output_schema declares additionalProperties: true");
  const compositional = ["oneOf", "anyOf", "allOf", "$defs", "items"].some((k) => has(schema, k));
  if (!isObject(schema.properties) && !compositional) {
    review("output_schema must declare `properties` or a compositional keyword");
  }
  walkSchema(command.id, "", schema);
}

// ─── Settings (`validation.rs`) ──────────────────────────────────────────────

const SETTING_KEY = /^[A-Za-z0-9._-]{1,128}$/;

function isSettingInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= MAX_SETTING_INTEGER
  );
}

/**
 * Why `value` cannot be the value of `setting`: a JSON string for `string` and
 * `path`, `true` or `false` for `boolean`, an integer of at most 2^53 - 1 in
 * magnitude within `min` and `max` for `integer`, and one of `options` for `enum`.
 *
 * @returns The reason, such as "must be at least 5", or `null` when `value` fits.
 */
export function settingValueError(setting: ManifestSetting, value: unknown): string | null {
  switch (setting.value_type) {
    case "string":
    case "path":
      return typeof value === "string" ? null : "must be a string";
    case "boolean":
      return typeof value === "boolean" ? null : "must be true or false";
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return "must be an integer";
      if (!isSettingInteger(value)) return "must lie between -(2^53 - 1) and 2^53 - 1";
      if (setting.min !== undefined && value < setting.min) {
        return `must be at least ${setting.min}`;
      }
      if (setting.max !== undefined && value > setting.max) return `must be at most ${setting.max}`;
      return null;
    case "enum": {
      const options = setting.options ?? [];
      return typeof value === "string" && options.includes(value)
        ? null
        : `must be one of: ${options.join(", ")}`;
    }
    default:
      return `has the unsupported value_type \`${setting.value_type}\``;
  }
}

/**
 * The `settings_schema` rules: a storage-key `key` unique in the manifest, a
 * non-empty `title`, a known `value_type`, `is_secret` only on a `string` without
 * a `default`, `min` and `max` only on an `integer` and in order, `options`
 * exactly on an `enum`, non-empty and without duplicates, `placeholder` only on
 * `string`, `path` and `integer`, integers of at most 2^53 - 1 in magnitude, and
 * a `default` the setting accepts as a value.
 */
export function validateSettingsSchema(settings: readonly ManifestSetting[]): void {
  const keys = new Set<string>();
  settings.forEach((setting, index) => {
    const reject = (reason: string): never => {
      throw new ManifestError(`invalid settings_schema[${index}] \`${setting.key}\`: ${reason}`);
    };
    const type = setting.value_type;
    if (!SETTING_KEY.test(setting.key)) {
      reject("key must be 1 to 128 characters of A-Z a-z 0-9 . _ -");
    }
    if (keys.has(setting.key)) reject("key is declared twice");
    keys.add(setting.key);
    if (setting.title === "") reject("title must not be empty");
    if (!(SETTING_VALUE_TYPES as readonly string[]).includes(type)) {
      reject(`value_type must be one of ${SETTING_VALUE_TYPES.join(", ")}`);
    }
    if (setting.is_secret && type !== "string") {
      reject("is_secret is allowed only with value_type string");
    }
    if (setting.is_secret && setting.default !== undefined) {
      reject("a secret setting may not have a default");
    }
    if ((setting.min !== undefined || setting.max !== undefined) && type !== "integer") {
      reject("min and max are allowed only with value_type integer");
    }
    for (const [name, bound] of [
      ["min", setting.min],
      ["max", setting.max],
    ] as const) {
      if (bound !== undefined && !isSettingInteger(bound)) {
        reject(`${name} must lie between -(2^53 - 1) and 2^53 - 1`);
      }
    }
    if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) {
      reject("min must be at most max");
    }
    if (type === "enum" && setting.options === undefined) reject("an enum setting needs options");
    if (type !== "enum" && setting.options !== undefined) {
      reject("options are allowed only with value_type enum");
    }
    if (setting.options !== undefined) {
      if (setting.options.length === 0) reject("options must list at least one value");
      const seen = new Set<string>();
      for (const option of setting.options) {
        if (seen.has(option)) reject(`options lists \`${option}\` twice`);
        seen.add(option);
      }
    }
    if (setting.placeholder !== undefined && !["string", "path", "integer"].includes(type)) {
      reject("placeholder is allowed only with value_type string, path or integer");
    }
    if (setting.default !== undefined) {
      const reason = settingValueError(setting, setting.default);
      if (reason !== null) reject(`default ${reason}`);
    }
  });
}

/** Origins a manifest may never list: the app's and the RIM API's. */
export interface InstallContext {
  forbiddenOrigins?: readonly string[];
}

/**
 * The install rules: no reserved id, built-in capabilities this kind may hold
 * (an encrypted chat capability with its plain one), commands that require only
 * declared capabilities, `network_origins`, a web plugin's entrypoint and panel
 * ids, no argument named like one the host adds from a required context, the
 * `settings_schema` rules, and the AI surface's install-id leak check.
 */
export function checkInstall(manifest: PluginManifest, context: InstallContext = {}): void {
  if (RESERVED_ID_PREFIXES.some((prefix) => manifest.plugin_id.startsWith(prefix))) {
    throw new ManifestError(`reserved plugin_id prefix: ${manifest.plugin_id}`);
  }
  for (const capability of manifest.capabilities) {
    validateCapability(manifest.runtime_kind, capability);
  }
  for (const [encrypted, plain] of ENCRYPTED_CHAT_CAPABILITIES) {
    if (manifest.capabilities.includes(encrypted) && !manifest.capabilities.includes(plain)) {
      throw new ManifestError(
        `invalid capability key \`${encrypted}\`: ${encrypted} requires ${plain} as well`,
      );
    }
  }
  validateRequiredCapabilities(manifest);
  validateNetworkOrigins(manifest, context.forbiddenOrigins ?? []);
  if (manifest.runtime_kind === "WebSandboxed") validateWebLayout(manifest);
  for (const command of manifest.commands) checkContextArguments(command);
  validateSettingsSchema(manifest.settings_schema);
  for (const command of manifest.commands) {
    if (command.ai_callable) checkAiCommand(command);
  }
}

/** {@link parseManifest} then {@link checkInstall}: the verdict an install gives. */
export function validateManifest(value: unknown, context: InstallContext = {}): PluginManifest {
  const manifest = parseManifest(value);
  checkInstall(manifest, context);
  return manifest;
}
