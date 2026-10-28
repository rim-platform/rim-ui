import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  CommandArgumentType,
  ConversationTypeEnum,
} from "../../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "../../conversations/types";
import type { CommandDefinition, CommandResult } from "../types";

const mutateAsync = vi.fn();

function command(id: string, title: string, extra: Partial<CommandDefinition> = {}) {
  return {
    id,
    title,
    description: `${title}.`,
    category: "Workspace",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    ...extra,
  } as CommandDefinition;
}

const COMMANDS = [
  command("workspace.navigate_to_channel", "Navigate to Channel"),
  command("workspace.navigate_to_dm", "Navigate to DM"),
  command("workspace.switch_workspace", "Switch Workspace"),
  command("chat.join_channel", "Join Channel", {
    arguments: [
      {
        name: "server_id",
        required: true,
        argumentType: CommandArgumentType.WORKSPACE_ID,
      },
      {
        name: "conversation_id",
        required: true,
        argumentType: CommandArgumentType.CONVERSATION_ID,
      },
    ] as CommandDefinition["arguments"],
  }),
];

function conversation(
  id: string,
  type: ConversationTypeEnum,
  extra: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    serverId: "ws-1",
    title: id,
    conversationType: type,
    memberIds: [],
    topic: null,
    isPrivate: false,
    isArchived: false,
    archivedAt: null,
    memberCount: 1,
    isMember: true,
    createdBy: "u-1",
    slowModeSeconds: 0,
    notificationLevel: null,
    effectiveNotificationLevel: null,
    encryptedAt: null,
    pendingMemberIds: [],
    ...extra,
  } as ConversationSummary;
}

const page = (items: ConversationSummary[]) => ({
  data: { items, pageInfo: { hasNext: false, hasPrev: false } },
  isPending: false,
});

const served = vi.hoisted(() => ({
  joined: [] as ConversationSummary[],
  browse: [] as ConversationSummary[],
  inbox: [] as ConversationSummary[],
  direct: [] as ConversationSummary[],
  servers: [] as { id: string; name: string; owner: null }[],
}));

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: COMMANDS, isLoading: false })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync })),
}));

vi.mock("../../conversations/api/useChannels", () => ({
  useJoinedChannels: () => page(served.joined),
  useChannels: () => page(served.browse),
}));

vi.mock("../../conversations/api/useInboxConversations", () => ({
  useInboxConversations: () => page(served.inbox),
}));

vi.mock("../../relay/api/useDirectInbox", () => ({
  useDirectInbox: () => ({ items: served.direct, isPending: false, isError: false }),
}));

vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({ data: served.servers, isPending: false }),
}));

vi.mock("../../workspaces/api/useServerMembers", () => ({
  fetchServerMembers: vi.fn(async () => []),
}));

vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: undefined }),
}));

vi.mock("../../conversations/api/useConversation", () => ({
  useConversation: () => ({ data: undefined }),
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
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useRelayStore, type RelayInfo } from "../../relay/state/useRelayStore";
import { queryClient } from "../../../core/query/queryClient";

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const OK: CommandResult = {
  status: "SUCCESS",
  message: "Joined channel.",
  payload: null,
  followUpCommands: [],
};

/** Opens the palette and picks the command titled `title`; returns the picker's input. */
async function pick(title: string, name: string) {
  render(<CommandPalette />, { wrapper: Providers });
  act(() => useCommandStore.getState().openCommandPalette());
  const input = screen.getByPlaceholderText("Type a command...");
  fireEvent.change(input, { target: { value: title } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  return screen.getByRole("textbox", { name });
}

const CHANNEL = ConversationTypeEnum.CHANNEL;

describe("the command palette's target picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ executeCommand: OK });
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().reset();
    served.joined = [
      conversation("general", CHANNEL),
      conversation("old", CHANNEL, { isArchived: true }),
    ];
    served.inbox = [conversation("trio", ConversationTypeEnum.GROUP, { title: "Trio" })];
    served.browse = [
      conversation("general", CHANNEL),
      conversation("random", CHANNEL, { isMember: false }),
      conversation("retired", CHANNEL, { isMember: false, isArchived: true }),
    ];
    served.direct = [
      conversation("dm-1", ConversationTypeEnum.DIRECT, { serverId: "direct-1", title: "Alice" }),
    ];
    served.servers = [
      { id: "ws-1", name: "Home", owner: null },
      { id: "ws-2", name: "Work", owner: null },
    ];
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    useRelayStore.setState({ info: null });
  });

  it("lists the channels, groups and DMs of the open workspace, not archived ones", async () => {
    await pick("Navigate to Channel", "Go to channel");

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["#general", "Trio"]);
  });

  it("goes to the picked channel on Enter and closes", async () => {
    const input = await pick("Navigate to Channel", "Go to channel");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(useShellStore.getState().selectedConversationId).toBe("trio");
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("filters the targets by what is typed", async () => {
    const input = await pick("Navigate to Channel", "Go to channel");
    fireEvent.change(input, { target: { value: "tri" } });

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Trio"]);
  });

  it("returns to the command list on Escape", async () => {
    const input = await pick("Navigate to Channel", "Go to channel");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);
    expect(useCommandStore.getState().targetPicker).toBeNull();
    const search = screen.getByPlaceholderText("Type a command...");
    // The command list takes the keyboard back, so typing and Escape reach it again.
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it("opens the picked direct message in its space", async () => {
    await pick("Navigate to DM", "Go to direct message");
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Alice" }));
    });

    expect(useWorkspaceStore.getState().workspaceId).toBe("direct-1");
    expect(useShellStore.getState().selectedConversationId).toBe("dm-1");
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("switches to the picked workspace, listing neither the open one nor the direct space", async () => {
    served.servers.push({ id: "direct-1", name: "Direct", owner: null });
    useRelayStore.setState({ info: { directSpaceId: "direct-1" } as RelayInfo });
    await pick("Switch Workspace", "Switch workspace");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Work"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Work" }));
    });
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("says when there is no other workspace", async () => {
    served.servers = [{ id: "ws-1", name: "Home", owner: null }];
    await pick("Switch Workspace", "Switch workspace");

    expect(screen.getByText("No other workspaces")).toBeTruthy();
  });

  it("lists only unjoined, unarchived channels to join, and joins the picked one", async () => {
    useShellStore.getState().setSelectedConversationId("general");
    await pick("Join Channel", "Join channel");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["#random"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "#random" }));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      commandId: "chat.join_channel",
      args: { server_id: "ws-1", conversation_id: "random" },
      commandContext: { workspaceId: "ws-1", conversationId: "random" },
    });
    expect(useShellStore.getState().selectedConversationId).toBe("random");
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("says when there is no channel to join", async () => {
    served.browse = [conversation("general", CHANNEL)];
    await pick("Join Channel", "Join channel");

    expect(screen.getByText("No channels to join")).toBeTruthy();
  });

  it("opens straight on the target list when a keybind runs the command without a target", () => {
    render(<CommandPalette />, { wrapper: Providers });
    act(() =>
      useCommandStore
        .getState()
        .openTargetPicker({ commandId: "chat.join_channel", kind: "joinableChannel" }),
    );

    expect(screen.getByRole("textbox", { name: "Join channel" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "#random" })).toBeTruthy();
  });
});
