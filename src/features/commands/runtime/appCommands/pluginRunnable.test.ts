import { describe, expect, it } from "vitest";

import { AGENT_MANAGEMENT_COMMAND_IDS as SDK_AGENT_COMMANDS } from "../../../../../sdk/plugin-sdk/src/manifestRules";
import { LOCAL_COMMANDS } from "../localCommands";
import { AGENT_MANAGEMENT_COMMAND_IDS } from "./agentCommandIds";

describe("app commands plugins may be granted", () => {
  // Each addition is reviewed: it must only open, show, or move focus or selection, or start
  // a form the person finishes, and never save, send, delete, sign out, close or restart the
  // app, manage plugins, or touch agents, moderation, bots, blocking, invites or contacts.
  it("are exactly these", () => {
    const runnable = LOCAL_COMMANDS.filter((c) => c.pluginRunnable)
      .map((c) => c.id)
      .sort();
    expect(runnable).toEqual([
      "chat.browse_channels",
      "chat.select_first_message",
      "chat.select_last_message",
      "chat.select_next_message",
      "chat.select_previous_message",
      "people.view_profile",
      "settings.open.about",
      "settings.open.commands",
      "settings.open.desktop",
      "settings.open.emoji",
      "settings.open.history",
      "settings.open.keybinds",
      "settings.open.keyboard",
      "settings.open.macros",
      "settings.open.messages",
      "settings.open.notifications",
      "settings.open.pipelines",
      "settings.open.profile",
      "settings.open.state",
      "unreads.toggle_muted",
      "workspace.back_to_workspace",
      "workspace.go_back",
      "workspace.go_forward",
      "workspace.navigate_panel_left",
      "workspace.navigate_panel_right",
      "workspace.open_audit_log",
      "workspace.open_direct_messages",
      "workspace.open_home",
      "workspace.open_unreads",
      "workspace.previous_unread_channel",
      "workspace.show_shortcuts",
      "workspace.toggle_conversation_members",
      "workspace.toggle_lens_picker",
      "workspace.toggle_member_directory",
      "workspace.toggle_notifications",
      "workspace.toggle_pinned_messages",
      "workspace.unreads_next",
      "workspace.unreads_open",
      "workspace.unreads_previous",
    ]);
  });

  it("never include an agent command, and the manifest rules refuse the same agent commands", () => {
    expect(
      LOCAL_COMMANDS.some((c) => c.pluginRunnable && AGENT_MANAGEMENT_COMMAND_IDS.has(c.id)),
    ).toBe(false);
    expect([...AGENT_MANAGEMENT_COMMAND_IDS].sort()).toEqual([...SDK_AGENT_COMMANDS].sort());
  });
});
