import { readFileSync } from "node:fs";

/** The parts of `rim-plugin.json` the SDK checks a plugin against. */
export interface ManifestInfo {
  readonly pluginId: string;
  /** Command ids mapped to their `dangerous` flag. */
  readonly commands: ReadonlyMap<string, boolean>;
  readonly panelIds: ReadonlySet<string>;
}

/**
 * Read `rim-plugin.json`. Returns `undefined` when the file does not exist, so
 * a plugin started outside the host (in a test, say) still runs.
 *
 * @throws Error when the file exists but is not a manifest.
 */
export function readManifest(path: string): ManifestInfo | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const raw = JSON.parse(text) as unknown;
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).plugin_id !== "string"
  ) {
    throw new Error(`${path} is not a plugin manifest: plugin_id is missing`);
  }
  const manifest = raw as Record<string, unknown>;
  const commands = new Map<string, boolean>();
  for (const entry of arrayOf(manifest.commands)) {
    if (typeof entry.id === "string") commands.set(entry.id, entry.dangerous === true);
  }
  const panelIds = new Set<string>();
  for (const entry of arrayOf(manifest.panels)) {
    if (typeof entry.id === "string") panelIds.add(entry.id);
  }
  return { pluginId: manifest.plugin_id as string, commands, panelIds };
}

function arrayOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}
