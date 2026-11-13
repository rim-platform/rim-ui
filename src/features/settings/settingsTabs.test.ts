import { describe, expect, it } from "vitest";

import {
  listedSettingsTab,
  SETTINGS_GROUPS,
  SETTINGS_SECTION_TABS,
  SETTINGS_TABS,
  settingsTabCommandId,
  visibleSettingsTabs,
  type SettingsTab,
  type SettingsTabAccess,
} from "./settingsTabs";

/** Access under which every tab but the older servers' Commands is offered. */
const EVERYTHING: SettingsTabAccess = {
  canModerate: true,
  isOperator: true,
  customEmoji: true,
  botsManageable: true,
  agentAvailable: true,
  desktopShellAvailable: true,
  inDirectSpace: false,
  accountMacros: true,
};

describe("settings tabs", () => {
  it("groups the navigation as You, Messaging, Shortcuts & automation, Tools & AI, Workspace", () => {
    expect(SETTINGS_GROUPS).toEqual([
      "You",
      "Messaging",
      "Shortcuts & automation",
      "Tools & AI",
      "Workspace",
      "Instance",
      "About",
    ]);
  });

  it("lists the tabs in order, each in its group", () => {
    expect(SETTINGS_TABS.map(({ key, label, group }) => `${group} / ${label} (${key})`)).toEqual([
      "You / Profile (profile)",
      "You / Account (account)",
      "You / Security (security)",
      "You / Desktop (desktop)",
      "You / Contacts (contacts)",
      "Messaging / Messages (messages)",
      "Messaging / Direct messages (direct-messages)",
      "Messaging / Notifications (notifications)",
      "Messaging / History (history)",
      "Messaging / Emoji (emoji)",
      "Shortcuts & automation / Keyboard (keyboard)",
      "Shortcuts & automation / Keybinds (keybinds)",
      "Shortcuts & automation / Commands (commands)",
      "Shortcuts & automation / Macros (macros)",
      "Shortcuts & automation / Pipelines (pipelines)",
      "Shortcuts & automation / State (state)",
      "Tools & AI / Plugins (plugins)",
      "Tools & AI / Assistant (agent)",
      "Tools & AI / Agents (agents)",
      "Workspace / Workspace (workspace)",
      "Workspace / Moderation (workspace-moderation)",
      "Workspace / Bots & webhooks (bots)",
      "Instance / Instance moderation (moderation)",
      "About / About (about)",
    ]);
    const groupOrder = SETTINGS_TABS.map((tab) => SETTINGS_GROUPS.indexOf(tab.group));
    expect(groupOrder).toEqual([...groupOrder].sort((a, b) => a - b));
  });

  it("does not list plugin-ai, which stays a tab key with its command, shown in Assistant", () => {
    const key: SettingsTab = "plugin-ai";
    expect(SETTINGS_TABS.map((tab) => tab.key)).not.toContain(key);
    expect(visibleSettingsTabs(EVERYTHING).map((tab) => tab.key)).not.toContain(key);
    expect(SETTINGS_SECTION_TABS).toEqual([
      expect.objectContaining({ key, shownIn: "agent", label: "Assistant's Plugin Commands" }),
    ]);
    expect(settingsTabCommandId(key)).toBe("settings.open.plugin_ai");
    expect(listedSettingsTab(key)).toBe("agent");
    expect(listedSettingsTab("agents")).toBe("agents");
  });
});
