import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../plugins/chat/appMessageService", () => ({
  conversationEncrypted: vi.fn(async () => false),
  chatCache: () => null,
}));

import { toast } from "../../../shared/toast";
import { CANCELLED_PAYLOAD } from "../../plugins/runtime/pluginCommandInfo";
import { useCommandResultStore } from "../state/useCommandResultStore";
import type { CommandDefinition, CommandResult } from "../types";
import { findCommandByText } from "./composerCommand";
import { LOCAL_ACTION_PAYLOAD } from "./commandDispatcher";
import { showCommandOutcome } from "./commandOutcome";

function command(id: string, title: string, sourceKind = "BUILT_IN"): CommandDefinition {
  return {
    id,
    title,
    description: "",
    category: "Chat",
    sourceKind: sourceKind as CommandDefinition["sourceKind"],
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: false,
    dangerous: false,
  };
}

function result(patch: Partial<CommandResult>): CommandResult {
  return { status: "SUCCESS", message: "", payload: null, followUpCommands: [], ...patch };
}

const listMembers = command("chat.list_members", "List Members");

describe("showCommandOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommandResultStore.getState().dismiss();
  });

  it("opens the result view for a real list_members result", async () => {
    const shown = await showCommandOutcome(
      listMembers,
      result({
        message: "2 members found.",
        payload: {
          members: [
            { username: "ada", role: "OWNER" },
            { username: "bob", role: "MEMBER" },
          ],
        },
      }),
    );
    expect(shown).toBe(true);
    const view = useCommandResultStore.getState().view;
    expect(view?.title).toBe("List Members (2)");
    expect(view?.rows.map((r) => r.primary)).toEqual(["ada", "bob"]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts the title and message of a command that is not a read command", async () => {
    await showCommandOutcome(
      command("chat.mark_all_as_read", "Mark All as Read"),
      result({ message: "Done" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Mark All as Read: Done.");
  });

  it("toasts a failure with the command's title", async () => {
    expect(await showCommandOutcome(listMembers, result({ status: "ERROR", message: "No" }))).toBe(
      false,
    );
    expect(toast.error).toHaveBeenCalledWith("List Members: No");
    await showCommandOutcome(listMembers, null);
    expect(toast.error).toHaveBeenCalledWith("List Members: Command failed");
  });

  it("says nothing for a declined confirmation or a command that shows what it did", async () => {
    await showCommandOutcome(listMembers, result({ status: "ERROR", payload: CANCELLED_PAYLOAD }));
    await showCommandOutcome(listMembers, result({ payload: LOCAL_ACTION_PAYLOAD }));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("answers a plugin command in the words of its result", async () => {
    await showCommandOutcome(
      command("plugin.x.run", "Run", "PLUGIN"),
      result({ message: "Ran it" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Run: Ran it");
  });
});

describe("findCommandByText", () => {
  const known = [listMembers, command("chat.list_channels", "List Channels")];

  it("matches an id or a title, ignoring case and spacing", () => {
    expect(findCommandByText("/chat.list_members", known)).toBe(listMembers);
    expect(findCommandByText("/ List   MEMBERS ", known)).toBe(listMembers);
  });

  it("matches nothing for other text", () => {
    expect(findCommandByText("/list", known)).toBeNull();
    expect(findCommandByText("list members", known)).toBeNull();
    expect(findCommandByText("/list members now", known)).toBeNull();
    expect(findCommandByText("/", known)).toBeNull();
    expect(findCommandByText("/list members", undefined)).toBeNull();
  });
});
