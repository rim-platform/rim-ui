/** The tabs of the Settings page, and which of them a person is offered. */

export type SettingsTab =
  | "profile"
  | "keybinds"
  | "keyboard"
  | "commands"
  | "macros"
  | "pipelines"
  | "plugins"
  | "plugin-ai"
  | "emoji"
  | "bots"
  | "state"
  | "agents"
  | "agent"
  | "messages"
  | "direct-messages"
  | "notifications"
  | "history"
  | "workspace"
  | "security"
  | "desktop"
  | "contacts"
  | "account"
  | "workspace-moderation"
  | "moderation"
  | "about";

/** Settings of the assistant and of agents, which run in the desktop app only. */
const AGENT_TABS: readonly SettingsTab[] = ["agents", "agent", "plugin-ai"];

/** Tabs that edit what only a workspace has: hidden in a direct space. */
const WORKSPACE_ONLY_TABS: readonly SettingsTab[] = [
  "pipelines",
  "state",
  "emoji",
  "workspace",
  "workspace-moderation",
  "bots",
];

/** Sections of the settings navigation, in display order. */
export const SETTINGS_GROUPS = [
  "You",
  "Messaging",
  "Shortcuts & automation",
  "Tools & AI",
  "Workspace",
  "Instance",
  "About",
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** One entry of the settings navigation. */
export interface SettingsTabEntry {
  key: SettingsTab;
  label: string;
  group: SettingsGroup;
}

/** The tabs listed in the settings navigation, in display order. */
export const SETTINGS_TABS: SettingsTabEntry[] = [
  { key: "profile", label: "Profile", group: "You" },
  { key: "account", label: "Account", group: "You" },
  { key: "security", label: "Security", group: "You" },
  { key: "desktop", label: "Desktop", group: "You" },
  { key: "contacts", label: "Contacts", group: "You" },
  { key: "messages", label: "Messages", group: "Messaging" },
  { key: "direct-messages", label: "Direct messages", group: "Messaging" },
  { key: "notifications", label: "Notifications", group: "Messaging" },
  { key: "history", label: "History", group: "Messaging" },
  { key: "emoji", label: "Emoji", group: "Messaging" },
  { key: "keyboard", label: "Keyboard", group: "Shortcuts & automation" },
  { key: "keybinds", label: "Keybinds", group: "Shortcuts & automation" },
  { key: "commands", label: "Commands", group: "Shortcuts & automation" },
  { key: "macros", label: "Macros", group: "Shortcuts & automation" },
  { key: "pipelines", label: "Pipelines", group: "Shortcuts & automation" },
  { key: "state", label: "State", group: "Shortcuts & automation" },
  { key: "plugins", label: "Plugins", group: "Tools & AI" },
  { key: "agent", label: "Assistant", group: "Tools & AI" },
  { key: "agents", label: "Agents", group: "Tools & AI" },
  { key: "workspace", label: "Workspace", group: "Workspace" },
  { key: "workspace-moderation", label: "Moderation", group: "Workspace" },
  { key: "bots", label: "Bots & webhooks", group: "Workspace" },
  { key: "moderation", label: "Instance moderation", group: "Instance" },
  { key: "about", label: "About", group: "About" },
];

/**
 * A section of a listed tab that Settings can be opened on by its own tab key, from a command or
 * a link: `shownIn` is the tab it is part of, `label` names it in its command's title and
 * `description` is that command's description.
 */
export interface SettingsSectionTab {
  key: SettingsTab;
  label: string;
  description: string;
  shownIn: SettingsTab;
}

/** The sections of listed tabs that keep a tab key of their own. */
export const SETTINGS_SECTION_TABS: readonly SettingsSectionTab[] = [
  {
    key: "plugin-ai",
    label: "Assistant's Plugin Commands",
    description: "Open Settings > Assistant at the plugin commands it may run",
    shownIn: "agent",
  },
];

/**
 * The listed tab that shows `key`: the tab a section belongs to, else `key` itself.
 *
 * @param key - A tab key, listed or a section's.
 * @returns The key of the tab in the navigation.
 */
export function listedSettingsTab(key: SettingsTab): SettingsTab {
  return SETTINGS_SECTION_TABS.find((section) => section.key === key)?.shownIn ?? key;
}

/** What decides which settings tabs a person is offered. */
export interface SettingsTabAccess {
  canModerate: boolean;
  isOperator: boolean;
  customEmoji: boolean;
  botsManageable: boolean;
  agentAvailable: boolean;
  desktopShellAvailable: boolean;
  inDirectSpace: boolean;
  /** Whether the home server keeps the person's macros as their own commands, which Macros edits. */
  accountMacros: boolean;
}

/**
 * The settings tabs offered under `access`, in display order.
 *
 * @param access - The person's role, the server's features and where they are.
 */
export function visibleSettingsTabs(access: SettingsTabAccess): SettingsTabEntry[] {
  return SETTINGS_TABS.filter(
    (tab) =>
      (!["workspace", "workspace-moderation"].includes(tab.key) || access.canModerate) &&
      (tab.key !== "moderation" || access.isOperator) &&
      (tab.key !== "emoji" || access.customEmoji) &&
      (tab.key !== "bots" || access.botsManageable) &&
      (!AGENT_TABS.includes(tab.key) || access.agentAvailable) &&
      (tab.key !== "desktop" || access.desktopShellAvailable) &&
      (tab.key !== "commands" || !access.accountMacros) &&
      !(access.inDirectSpace && WORKSPACE_ONLY_TABS.includes(tab.key)),
  );
}

/**
 * The id of the command that opens Settings on `key`: the key lowercased, every run of
 * characters outside `a-z0-9` replaced by one underscore.
 */
export function settingsTabCommandId(key: SettingsTab): string {
  return `settings.open.${key.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}
