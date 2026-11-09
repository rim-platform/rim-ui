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

/** Settings of the AI agent, which runs in the desktop app only. */
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
  "Programmable",
  "Extensions",
  "Workspace",
  "Instance",
  "About",
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export const SETTINGS_TABS: { key: SettingsTab; label: string; group: SettingsGroup }[] = [
  { key: "profile", label: "Profile", group: "You" },
  { key: "account", label: "Account", group: "You" },
  { key: "security", label: "Security", group: "You" },
  { key: "desktop", label: "Desktop", group: "You" },
  { key: "contacts", label: "Contacts", group: "You" },
  { key: "messages", label: "Messages", group: "Messaging" },
  { key: "direct-messages", label: "Direct messages", group: "Messaging" },
  { key: "notifications", label: "Notifications", group: "Messaging" },
  { key: "history", label: "History", group: "Messaging" },
  { key: "keybinds", label: "Keybinds", group: "Programmable" },
  { key: "keyboard", label: "Keyboard", group: "Programmable" },
  { key: "commands", label: "Commands", group: "Programmable" },
  { key: "macros", label: "Macros", group: "Programmable" },
  { key: "pipelines", label: "Pipelines", group: "Programmable" },
  { key: "plugins", label: "Plugins", group: "Extensions" },
  { key: "plugin-ai", label: "Plugin AI", group: "Extensions" },
  { key: "state", label: "State", group: "Extensions" },
  { key: "emoji", label: "Emoji", group: "Extensions" },
  { key: "agents", label: "Agents", group: "Extensions" },
  { key: "agent", label: "AI Agent", group: "Extensions" },
  { key: "workspace", label: "Workspace", group: "Workspace" },
  { key: "workspace-moderation", label: "Moderation", group: "Workspace" },
  { key: "bots", label: "Bots", group: "Workspace" },
  { key: "moderation", label: "Instance moderation", group: "Instance" },
  { key: "about", label: "About", group: "About" },
];

/** What decides which settings tabs a person is offered. */
export interface SettingsTabAccess {
  canModerate: boolean;
  isOperator: boolean;
  customEmoji: boolean;
  botsManageable: boolean;
  agentAvailable: boolean;
  desktopShellAvailable: boolean;
  inDirectSpace: boolean;
}

/**
 * The settings tabs offered under `access`, in display order.
 *
 * @param access - The person's role, the server's features and where they are.
 */
export function visibleSettingsTabs(access: SettingsTabAccess): typeof SETTINGS_TABS {
  return SETTINGS_TABS.filter(
    (tab) =>
      (!["workspace", "workspace-moderation"].includes(tab.key) || access.canModerate) &&
      (tab.key !== "moderation" || access.isOperator) &&
      (tab.key !== "emoji" || access.customEmoji) &&
      (tab.key !== "bots" || access.botsManageable) &&
      (!AGENT_TABS.includes(tab.key) || access.agentAvailable) &&
      (tab.key !== "desktop" || access.desktopShellAvailable) &&
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
