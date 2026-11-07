import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { runDesktopLocalCommand } from "../features/commands/runtime/commandDispatcher";
import {
  BUILT_IN_COMMAND_TITLES,
  LOCAL_COMMANDS,
} from "../features/commands/runtime/localCommands";
import { useMembersPanelStore } from "../features/conversations/state/useMembersPanelStore";
import { useNotificationsPanelStore } from "../features/notifications/state/useNotificationsPanelStore";
import {
  isOpenPluginPanelCommand,
  openPluginPanelCommandId,
} from "../features/plugins/pluginPanels";
import {
  SETTINGS_TABS,
  visibleSettingsTabs,
  type SettingsTabAccess,
} from "../features/settings/components/SettingsPage";
import { useMemberDirectoryStore } from "../features/workspaces/state/useMemberDirectoryStore";
import { BUILT_IN_PROFILES, DEFAULT_BINDINGS } from "../features/commands/profiles/builtInProfiles";
import { useWorkspaceStore } from "../features/workspaces/state/useWorkspaceStore";
import { useShellStore, type MainSurface } from "./state/useShellStore";
import { queryKeys } from "../core/query/keys";
import { queryClient } from "../core/query/queryClient";
import { useHomeEditStore } from "../features/home/state/useHomeEditStore";

const EVERYTHING: SettingsTabAccess = {
  canModerate: true,
  isOperator: true,
  customEmoji: true,
  botsManageable: true,
  agentAvailable: true,
  desktopShellAvailable: true,
  inDirectSpace: false,
};

const NOTHING: SettingsTabAccess = {
  canModerate: false,
  isOperator: false,
  customEmoji: false,
  botsManageable: false,
  agentAvailable: false,
  desktopShellAvailable: false,
  inDirectSpace: false,
};

/** The command that opens each kind of main surface; a new kind must name one here. */
const SURFACE_COMMANDS: Record<MainSurface["kind"], string> = {
  conversation: "workspace.navigate_to_channel",
  settings: "workspace.open_settings",
  plugin: openPluginPanelCommandId("some-plugin", "some-panel"),
  marketplace: "workspace.open_marketplace",
  "audit-log": "workspace.open_audit_log",
  home: "workspace.open_home",
  unreads: "workspace.open_unreads",
  "dm-requests": "workspace.open_message_requests",
};

/** The command behind each panel, overlay and entry point that is not a main surface. */
const ENTRY_COMMANDS: Record<string, string> = {
  palette: "workspace.open_command_palette",
  search: "workspace.open_search",
  "search in a conversation": "workspace.search_in_channel",
  threads: "workspace.reopen_last_thread",
  pins: "workspace.toggle_pinned_messages",
  "bots in a channel": "workspace.toggle_channel_bots",
  notifications: "workspace.toggle_notifications",
  "conversation members": "workspace.toggle_conversation_members",
  "workspace members": "workspace.toggle_member_directory",
  agents: "workspace.open_agents",
  bots: "workspace.open_bots",
  webhooks: "workspace.open_bots",
  "sidebar and drawer": "workspace.toggle_sidebar",
  "editing Home": "workspace.edit_home",
  back: "workspace.go_back",
  forward: "workspace.go_forward",
};

function isKnownCommand(id: string): boolean {
  return (
    isOpenPluginPanelCommand(id) ||
    LOCAL_COMMANDS.some((command) => command.id === id) ||
    id in BUILT_IN_COMMAND_TITLES
  );
}

describe("every way into the app is reachable", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "conv-1", shellWidth: "wide" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useNotificationsPanelStore.getState().setOpen(false);
    useMembersPanelStore.getState().setOpen(false);
    useMemberDirectoryStore.getState().setOpen(false);
  });

  it("lists every settings tab for a person who may see it", () => {
    const shown = visibleSettingsTabs(EVERYTHING).map((tab) => tab.key);
    expect(shown).toEqual(SETTINGS_TABS.map((tab) => tab.key));
  });

  it("keeps the tabs that need a role out of the list for everyone else", () => {
    const shown = visibleSettingsTabs(NOTHING).map((tab) => tab.key);
    expect(shown).toContain("profile");
    expect(shown).toContain("plugins");
    expect(shown).not.toContain("workspace");
    expect(shown).not.toContain("bots");
    expect(shown).not.toContain("moderation");
  });

  it("names a command for every kind of main surface", () => {
    for (const [kind, id] of Object.entries(SURFACE_COMMANDS)) {
      expect(isKnownCommand(id), `${kind}: ${id}`).toBe(true);
    }
  });

  it("names a command for every panel, overlay and entry point", () => {
    for (const [entry, id] of Object.entries(ENTRY_COMMANDS)) {
      expect(isKnownCommand(id), `${entry}: ${id}`).toBe(true);
    }
  });

  it("opens the pages by their commands", () => {
    runDesktopLocalCommand("workspace.open_home");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "home" });

    useShellStore.getState().setMainSurface({ kind: "unreads" });
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["home_layout"] });
    runDesktopLocalCommand("workspace.edit_home");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "home" });
    expect(useHomeEditStore.getState().requested).toBe(true);
    useHomeEditStore.getState().stop();
    queryClient.removeQueries({ queryKey: queryKeys.serverInfo });

    runDesktopLocalCommand("workspace.open_unreads");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "unreads" });

    runDesktopLocalCommand("workspace.open_audit_log");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "audit-log" });

    runDesktopLocalCommand("workspace.open_message_requests");
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "dm-requests",
      workspaceId: "ws-1",
    });

    runDesktopLocalCommand("workspace.open_marketplace");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "marketplace" });

    runDesktopLocalCommand("workspace.open_settings");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
  });

  it("opens and closes the panels by their commands", () => {
    runDesktopLocalCommand("workspace.toggle_pinned_messages");
    expect(useShellStore.getState().pinnedPanelOpen).toBe(true);
    runDesktopLocalCommand("workspace.toggle_pinned_messages");
    expect(useShellStore.getState().pinnedPanelOpen).toBe(false);

    runDesktopLocalCommand("workspace.toggle_channel_bots");
    expect(useShellStore.getState().botsPanelOpen).toBe(true);
    runDesktopLocalCommand("workspace.toggle_pinned_messages");
    expect(useShellStore.getState()).toMatchObject({ pinnedPanelOpen: true, botsPanelOpen: false });
    runDesktopLocalCommand("workspace.toggle_pinned_messages");

    // The notification inbox opens under the top bar over any page, so the page stays.
    runDesktopLocalCommand("workspace.open_settings");
    runDesktopLocalCommand("workspace.toggle_notifications");
    expect(useNotificationsPanelStore.getState().open).toBe(true);
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });

    runDesktopLocalCommand("workspace.toggle_conversation_members");
    expect(useMembersPanelStore.getState().open).toBe(true);
    expect(useNotificationsPanelStore.getState().open).toBe(false);

    runDesktopLocalCommand("workspace.toggle_member_directory");
    expect(useMemberDirectoryStore.getState().open).toBe(true);
    expect(useMembersPanelStore.getState().open).toBe(false);
  });

  it("opens the drawer, not a collapsed sidebar, in a narrow window", () => {
    useShellStore.setState({ shellWidth: "narrow" });
    runDesktopLocalCommand("workspace.toggle_sidebar");
    expect(useShellStore.getState().navDrawerOpen).toBe(true);
    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
    runDesktopLocalCommand("workspace.toggle_sidebar");
    expect(useShellStore.getState().navDrawerOpen).toBe(false);
  });

  it("leaves Back and Forward without a default keystroke, Alt+Left staying Back to Workspace", () => {
    for (const profile of Object.values(BUILT_IN_PROFILES)) {
      const ids = profile.bindings.map((binding) => binding.commandId);
      expect(ids).not.toContain("workspace.go_back");
      expect(ids).not.toContain("workspace.go_forward");
    }
    expect(
      DEFAULT_BINDINGS.find((binding) => binding.keystroke === "Alt+ArrowLeft")?.commandId,
    ).toBe("workspace.back_to_workspace");
  });

  it("collapses the sidebar in a wide window as before", () => {
    runDesktopLocalCommand("workspace.toggle_sidebar");
    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    expect(useShellStore.getState().navDrawerOpen).toBe(false);
  });
});
