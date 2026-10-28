import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { CommandDefinition, CommandResult } from "../types";

const mutateAsync = vi.fn();
const conversationEncrypted = vi.fn();
const cacheList = vi.fn();

function command(id: string, title: string): CommandDefinition {
  return {
    id,
    title,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
  };
}

const COMMANDS = [
  command("chat.list_channels", "List Channels"),
  command("chat.list_members", "List Members"),
  command("chat.get_recent_messages", "Get Recent Messages"),
  command("state.list", "List State"),
  command("chat.mark_as_read", "Mark As Read"),
];

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: COMMANDS, isLoading: false })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync })),
}));

vi.mock("../../plugins/api/usePluginCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/api/usePluginCommands")>()),
  usePluginCommands: vi.fn(() => []),
}));

vi.mock("../../plugins/registry/palette", () => ({
  isRegistryPaletteItem: () => false,
  useRegistryPaletteItems: vi.fn(() => []),
}));

vi.mock("../runtime/effectiveKeybinds", () => ({
  useEffectiveKeybinds: vi.fn(() => []),
}));

vi.mock("../../plugins/chat/appMessageService", () => ({
  conversationEncrypted: (...args: unknown[]) => conversationEncrypted(...args),
  chatCache: () => ({ list: cacheList }),
}));

vi.mock("../../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(() => "toast-1"),
    dismiss: vi.fn(),
  },
}));

import { CommandPalette } from "./CommandPalette";
import { useCommandStore } from "../state/useCommandStore";
import { useCommandResultStore } from "../state/useCommandResultStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import { queryClient } from "../../../core/query/queryClient";

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function result(message: string, payload: unknown): CommandResult {
  return { status: "SUCCESS", message, payload, followUpCommands: [] };
}

async function run(title: string) {
  render(<CommandPalette />, { wrapper: Providers });
  act(() => useCommandStore.getState().openCommandPalette());
  await act(async () => {
    fireEvent.click(screen.getByText(title));
  });
}

describe("Read command results in the command palette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationEncrypted.mockResolvedValue(false);
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-1");
  });

  afterEach(() => {
    act(() => {
      useCommandStore.getState().closeCommandPalette();
      useCommandResultStore.getState().dismiss();
    });
    useShellStore.getState().setSelectedConversationId(null);
    useWorkspaceStore.getState().clearWorkspaceId();
  });

  it("lists the channels by name instead of only counting them", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("2 channels found", {
        channels: [
          { id: "c1", title: "general", conversation_type: "CHANNEL", is_private: false },
          { id: "c2", title: "random", conversation_type: "CHANNEL", is_private: true },
        ],
      }),
    });
    await run("List Channels");

    expect(screen.getByRole("dialog", { name: "List Channels (2)" })).toBeInTheDocument();
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.getByText("random")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("lists the members with their role", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("1 members found", {
        members: [{ username: "alice", role: "ADMIN", joined: "2026-10-01T00:00:00Z" }],
      }),
    });
    await run("List Members");

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("lists the state entries as key = value", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("1 entries found", {
        entries: [{ key: "visits", value: 3, version: 2 }],
      }),
    });
    await run("List State");

    expect(screen.getByText("visits = 3")).toBeInTheDocument();
  });

  it("shows the recent messages with their author", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("1 messages", {
        messages: [{ author: "bob", text: "hello there", sentAt: "2026-10-27T10:00:00Z" }],
      }),
    });
    await run("Get Recent Messages");

    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(screen.getByText(/^bob/)).toBeInTheDocument();
  });

  it("shows the messages this device holds of an encrypted conversation", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("0 messages", { messages: [] }),
    });
    conversationEncrypted.mockResolvedValue(true);
    cacheList.mockResolvedValue({
      messages: [{ text: "secret hello", author: { displayName: "Carol" }, sentAt: "2026-10-27" }],
      hasOlder: false,
    });
    await run("Get Recent Messages");

    expect(screen.getByText("secret hello")).toBeInTheDocument();
    expect(cacheList).toHaveBeenCalledWith(
      "ws-1",
      "conv-1",
      null,
      30,
      expect.objectContaining({ encryptedAllowed: true }),
    );
  });

  it("says an encrypted conversation is not on this device when the cache has none", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("0 messages", { messages: [] }),
    });
    conversationEncrypted.mockResolvedValue(true);
    cacheList.mockResolvedValue(null);
    await run("Get Recent Messages");

    expect(screen.getByText(/end-to-end encrypted/)).toBeInTheDocument();
  });

  it("closes the view with Escape", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("1 entries found", { entries: [{ key: "k", value: "v" }] }),
    });
    await run("List State");
    expect(screen.getByText("k = v")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByText("k = v")).not.toBeInTheDocument();
  });

  it("only toasts a command that is not a read command", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("Marked", { channels: [{ id: "c1", title: "general" }] }),
    });
    await run("Mark As Read");

    expect(toast.success).toHaveBeenCalledWith("Mark As Read: Marked.");
    expect(useCommandResultStore.getState().view).toBeNull();
  });

  it("only toasts a read command with nothing to list", async () => {
    mutateAsync.mockResolvedValue({
      executeCommand: result("0 channels found", { channels: [] }),
    });
    await run("List Channels");

    expect(toast.success).toHaveBeenCalledWith("List Channels: 0 channels found.");
    expect(useCommandResultStore.getState().view).toBeNull();
  });
});
