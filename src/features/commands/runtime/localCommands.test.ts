import { describe, expect, it } from "vitest";

import { COMMAND_CATEGORIES } from "./commandCategories";
import { BUILT_IN_COMMAND_TITLES, LOCAL_COMMANDS, withClientLabel } from "./localCommands";

const SERVER_NAVIGATION = [
  "workspace.previous_channel",
  "workspace.next_channel",
  "workspace.next_unread_channel",
].map((id) => ({ id, title: "Channel", description: "" }));

describe("navigation command titles", () => {
  it("names the four conversation navigation commands with one noun", () => {
    const local = LOCAL_COMMANDS.find((cmd) => cmd.id === "workspace.previous_unread_channel");
    const titles = [...SERVER_NAVIGATION.map(withClientLabel), local!].map((cmd) => cmd.title);

    expect(titles).toEqual([
      "Previous Conversation",
      "Next Conversation",
      "Next Unread Conversation",
      "Previous Unread Conversation",
    ]);
    for (const title of titles) expect(title).not.toContain("Channel");
  });
});

describe("titles shown before the command list loads", () => {
  it("are the titles the loaded list shows: this app's own, else the server's", () => {
    const serverTitles: Record<string, string> = {
      "workspace.open_command_palette": "Open Command Palette",
      "workspace.previous_channel": "Previous Channel",
      "chat.create_group": "Create Group",
      "chat.mark_all_as_read": "Mark All as Read",
    };
    for (const [id, title] of Object.entries(serverTitles)) {
      expect(BUILT_IN_COMMAND_TITLES[id], id).toBe(
        withClientLabel({ id, title, description: "" }).title,
      );
    }
    expect(BUILT_IN_COMMAND_TITLES["chat.create_group"]).toBe("New Message");
    expect(BUILT_IN_COMMAND_TITLES["workspace.toggle_lens_picker"]).toBe("Toggle Channel Lenses");
  });
});

describe("local command categories", () => {
  it("gives every app command one of the built-in categories", () => {
    for (const command of LOCAL_COMMANDS) {
      expect(COMMAND_CATEGORIES, command.id).toContain(command.category);
    }
  });

  it("files commands by what they do", () => {
    const category = (id: string) => LOCAL_COMMANDS.find((cmd) => cmd.id === id)?.category;
    expect(category("workspace.go_back")).toBe("Navigation");
    expect(category("workspace.toggle_lens_picker")).toBe("Conversations");
    expect(category("workspace.unreads_undo")).toBe("Unreads");
    expect(category("workspace.open_bots")).toBe("Bots & Webhooks");
    expect(category("workspace.open_message_requests")).toBe("People");
    expect(category("workspace.toggle_zen_mode")).toBe("View");
    expect(category("app.quit")).toBe("App");
  });
});
