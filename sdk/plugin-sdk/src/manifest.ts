/** The parts of `rim-plugin.json` the SDK checks a plugin against. */
export interface ManifestInfo {
  readonly pluginId: string;
  /** Command ids mapped to their `dangerous` flag. */
  readonly commands: ReadonlyMap<string, boolean>;
  readonly panelIds: ReadonlySet<string>;
}

/**
 * Read the text of `rim-plugin.json`; `source` names it in errors.
 *
 * @throws Error when the text is not a manifest.
 */
export function parseManifestInfo(text: string, source: string): ManifestInfo {
  const raw = JSON.parse(text) as unknown;
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).plugin_id !== "string"
  ) {
    throw new Error(`${source} is not a plugin manifest: plugin_id is missing`);
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
