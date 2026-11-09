import type { CommandDefinition } from "../../types";
import type { CommandCategory } from "../commandCategories";

/**
 * Defines a command this app runs itself.
 *
 * @param id - The command's id.
 * @param category - The palette category it is listed under.
 * @param title - The title the palette shows.
 * @param description - One line saying what it does.
 * @param keybindCapable - Whether a keybind may run it; defaults to true.
 * @returns The definition, listed as a built-in command that runs on this device.
 */
export function localCommand(
  id: string,
  category: CommandCategory,
  title: string,
  description: string,
  keybindCapable = true,
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
  };
}
