import type { CommandDefinition } from "../../types";
import type { CommandCategory } from "../commandCategories";

/** What else an app command's definition says beyond its id, title and palette category. */
export interface LocalCommandOptions {
  /**
   * A plugin may be granted it: set only on a command that opens, shows, or moves focus or
   * selection, or starts a form the person must finish, and never on one that saves, sends,
   * deletes, signs out, closes or restarts the app, manages plugins, or touches agents,
   * moderation, bots and webhooks, blocking, invites, contacts or who can see what.
   */
  pluginRunnable?: boolean;
}

/** The options of an app command a plugin may be granted. */
export const PLUGIN_RUNNABLE: LocalCommandOptions = Object.freeze({ pluginRunnable: true });

/**
 * Defines a command this app runs itself.
 *
 * @param id - The command's id.
 * @param category - The palette category it is listed under.
 * @param title - The title the palette shows.
 * @param description - One line saying what it does.
 * @param keybindCapable - Whether a keybind may run it; defaults to true.
 * @param options - Whether a plugin may be granted it; by default none may.
 * @returns The definition, listed as a built-in command that runs on this device.
 */
export function localCommand(
  id: string,
  category: CommandCategory,
  title: string,
  description: string,
  keybindCapable = true,
  options: LocalCommandOptions = {},
): CommandDefinition {
  return {
    id,
    title,
    description,
    category,
    sourceKind: "BUILT_IN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable,
    dangerous: false,
    ...(options.pluginRunnable ? { pluginRunnable: true } : {}),
  };
}
