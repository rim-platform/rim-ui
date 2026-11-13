/** The locale category names are compared in: the app's names are English. */
const CATEGORY_LOCALE = "en";

/**
 * The categories of the built-in commands, in the order the palette and the keybind settings
 * list them. A plugin's commands carry the plugin's name and a user command its own category;
 * those come after these, alphabetically.
 */
export const COMMAND_CATEGORIES = [
  "Navigation",
  "Messages",
  "Conversations",
  "Search",
  "People",
  "Home",
  "Unreads",
  "Notifications",
  "Moderation",
  "Workspace",
  "Agents",
  "Bots & Webhooks",
  "Plugins",
  "View",
  "App",
  "State",
] as const;

/** One of {@link COMMAND_CATEGORIES}. */
export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/** Names shown for categories whose name in the command list is not the one people read. */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  Agents: "Assistant & Agents",
};

/**
 * The name shown for a command category: "Assistant & Agents" for "Agents", which holds the
 * assistant's commands as well as those of agents, else the category's own name.
 *
 * @param category - The category as a command carries it.
 * @returns The name to show.
 */
export function commandCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

const CATEGORY_RANK: ReadonlyMap<string, number> = new Map(
  COMMAND_CATEGORIES.map((category, index) => [category, index]),
);

/**
 * Orders two category names: the built-in categories in {@link COMMAND_CATEGORIES} order first,
 * then any other name alphabetically.
 */
export function compareCommandCategories(a: string, b: string): number {
  const rankA = CATEGORY_RANK.get(a) ?? COMMAND_CATEGORIES.length;
  const rankB = CATEGORY_RANK.get(b) ?? COMMAND_CATEGORIES.length;
  return rankA - rankB || a.localeCompare(b, CATEGORY_LOCALE);
}
