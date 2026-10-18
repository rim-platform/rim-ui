// The values a user saves in a plugin's settings form, shared by the web app's
// store and the form: the error a refused save carries and the merge of saved
// values with the schema's defaults.

import type { PluginSetting } from "./types";

/** A save of a plugin's settings that the host refused. */
export class PluginSettingsError extends Error {
  /** The setting whose value was refused, or `null` when the save failed as a whole. */
  readonly key: string | null;

  constructor(message: string, key: string | null = null) {
    super(message);
    this.name = "PluginSettingsError";
    this.key = key;
  }
}

/** Whether `schema` declares any setting, so the plugin has a settings form. */
export function hasSettings(schema: readonly PluginSetting[] | undefined): boolean {
  return (schema?.length ?? 0) > 0;
}

/**
 * The settings a plugin reads: for each declared setting the saved value, or
 * else its default; a setting with neither is left out, and so is every key the
 * schema does not declare.
 *
 * @param schema - The plugin's `settings_schema`.
 * @param saved - The saved values by key, secret ones included where the host keeps them.
 * @returns The values by key.
 */
export function mergeSettings(
  schema: readonly PluginSetting[],
  saved: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const setting of schema) {
    if (Object.prototype.hasOwnProperty.call(saved, setting.key)) {
      values[setting.key] = saved[setting.key];
    } else if (setting.default !== undefined) {
      values[setting.key] = setting.default;
    }
  }
  return values;
}
