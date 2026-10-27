import { describe, expect, it } from "vitest";

import { LOCAL_COMMANDS, withClientLabel } from "./localCommands";

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
