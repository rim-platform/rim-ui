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

const RESERVED_ID_PREFIXES = ["dev.rim.", "com.rim."];
const RESERVED_CAPABILITY_PREFIXES = ["system.", "internal.", "admin.", "audit."];
const RESERVED_SEGMENTS = ["system", "internal", "admin", "audit"];
const BUILTIN_CAPABILITIES = [
  "ui.panel",
  "ui.notify",
  CHAT_READ,
  CHAT_WRITE,
  CHAT_READ_ENCRYPTED,
  CHAT_WRITE_ENCRYPTED,
];
const LOCAL_ONLY_CAPABILITIES = ["local.process", "fs.read", "fs.write"];
const MIN_KEY_BYTES = 4;
const MAX_KEY_BYTES = 128;

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
  settings_schema: {
    key: string;
    title: string;
    description: string;
    value_type: string;
    is_secret: boolean;
  }[];
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

function has(object: Json, key: string): boolean {
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
      return {
        key: str(s, "key", at),
        title: str(s, "title", at),
        description: withDefault(s, "description", "", asString, at),
        value_type: str(s, "value_type", at),
        is_secret: withDefault(s, "is_secret", false, asBool, at),
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

function validateCapability(kind: RuntimeKind, pluginId: string, key: string): void {
  const reject = (reason: string): never => {
    throw new ManifestError(`invalid capability key \`${key}\`: ${reason}`);
  };
  const length = byteLength(key);
  if (length < MIN_KEY_BYTES) {
    reject(`capability key must be at least ${MIN_KEY_BYTES} bytes (got ${length})`);
  }
  if (length > MAX_KEY_BYTES) {
    reject(`capability key must be at most ${MAX_KEY_BYTES} bytes (got ${length})`);
  }
  if (BUILTIN_CAPABILITIES.includes(key)) return;
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
  for (const reserved of RESERVED_CAPABILITY_PREFIXES) {
    if (key.startsWith(reserved))
      reject(`capability key starts with reserved namespace \`${reserved}\``);
  }
  const prefix = `plugin.${pluginId}.`;
  if (!key.startsWith(prefix)) {
    reject(`capability key must be a built-in name or start with \`${prefix}\``);
  }
  const verb = key.slice(prefix.length);
  if (verb === "") reject("capability key must declare a verb after `plugin.<id>.`");
  if (!/^[a-z0-9_.]+$/.test(verb)) {
    reject("capability verb must match [a-z0-9_.]+ (lowercase ASCII alnum, underscore, dot)");
  }
  if (verb.startsWith(".") || verb.endsWith("."))
    reject("capability key may not start or end with `.`");
  if (verb.includes("..")) reject("capability key may not contain `..` (empty segment)");
  for (const segment of key.split(".")) {
    if (RESERVED_SEGMENTS.includes(segment))
      reject(`capability key segment \`${segment}\` is reserved`);
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

/** Origins a manifest may never list: the app's and the RIM API's. */
export interface InstallContext {
  forbiddenOrigins?: readonly string[];
}

/**
 * The install rules: no reserved id, capabilities this kind may hold (an
 * encrypted chat capability with its plain one), `network_origins`, a web plugin's entrypoint and panel ids, and the AI
 * surface's install-id leak check.
 */
export function checkInstall(manifest: PluginManifest, context: InstallContext = {}): void {
  if (RESERVED_ID_PREFIXES.some((prefix) => manifest.plugin_id.startsWith(prefix))) {
    throw new ManifestError(`reserved plugin_id prefix: ${manifest.plugin_id}`);
  }
  for (const capability of manifest.capabilities) {
    validateCapability(manifest.runtime_kind, manifest.plugin_id, capability);
  }
  for (const [encrypted, plain] of ENCRYPTED_CHAT_CAPABILITIES) {
    if (manifest.capabilities.includes(encrypted) && !manifest.capabilities.includes(plain)) {
      throw new ManifestError(
        `invalid capability key \`${encrypted}\`: ${encrypted} requires ${plain} as well`,
      );
    }
  }
  validateNetworkOrigins(manifest, context.forbiddenOrigins ?? []);
  if (manifest.runtime_kind === "WebSandboxed") validateWebLayout(manifest);
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
