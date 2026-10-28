import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { CommandArgumentInfo, CommandDefinition, CommandResult } from "../types";

const mutateAsync = vi.fn();

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: [MARK_AS_READ, LIST_STATE], isLoading: false })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync })),
}));

vi.mock("../../plugins/api/usePluginCommands", () => ({
  usePluginCommands: vi.fn(() => []),
}));

vi.mock("../../plugins/registry/palette", () => ({
  isRegistryPaletteItem: () => false,
  useRegistryPaletteItems: vi.fn(() => []),
}));

vi.mock("../../plugins/registry/state", () => ({
  useRegistryStore: { getState: () => ({ openInstall: vi.fn() }) },
}));

vi.mock("../runtime/effectiveKeybinds", () => ({
  useEffectiveKeybinds: vi.fn(() => []),
}));

vi.mock("../runtime/commandDispatcher", () => ({
  dispatchCommand: vi.fn(),
  commandResultOf: (outcome: { result: CommandResult }) => outcome.result,
  hasLocalHandler: (id: string) => id === "chat.create_channel",
  argumentPromptName: (id: string) => (id === "chat.search_messages" ? "query" : undefined),
  targetPickerKind: () => undefined,
}));

vi.mock("../runtime/humanConfirmation", () => ({
  runWithHumanConfirmation: async (run: (proof: undefined) => Promise<CommandResult>) => ({
    kind: "completed",
    result: await run(undefined),
  }),
  strictestSensitivity: () => ({}),
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
import {
  CommandArgumentType,
  ConversationTypeEnum,
} from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { useCommands } from "../api/useCommands";
import { dispatchCommand } from "../runtime/commandDispatcher";
import { useCommandStore } from "../state/useCommandStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { fakeServerInfo } from "../../../test/serverInfo";
import { WORKSPACE_LEAVE, WORKSPACE_RENAME } from "../../updater/api/serverCapabilities";

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const SERVER_ID: CommandArgumentInfo = {
  name: "server_id",
  argumentType: CommandArgumentType.WORKSPACE_ID,
  required: true,
};

function requiredArgument(name: string, argumentType: CommandArgumentType): CommandArgumentInfo {
  return { name, argumentType, required: true };
}

const BASE_COMMAND: CommandDefinition = {
  id: "chat.mark_as_read",
  title: "Mark as read",
  description: "Marks the conversation read",
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

const MARK_AS_READ: CommandDefinition = {
  ...BASE_COMMAND,
  arguments: [SERVER_ID, requiredArgument("conversation_id", CommandArgumentType.CONVERSATION_ID)],
};

const LIST_STATE: CommandDefinition = {
  ...BASE_COMMAND,
  id: "state.list",
  title: "List State",
  description: "Lists the workspace's state keys",
  category: "State",
  arguments: [SERVER_ID],
};

const KICK: CommandDefinition = {
  ...BASE_COMMAND,
  id: "admin.kick",
  title: "Kick Member",
  description: "Removes a member from the workspace",
  category: "Admin",
  dangerous: true,
  arguments: [SERVER_ID, requiredArgument("user_id", CommandArgumentType.USER_ID)],
};

const CREATE_CHANNEL: CommandDefinition = {
  ...BASE_COMMAND,
  id: "chat.create_channel",
  title: "Create Channel",
  description: "Creates a channel",
  category: "Conversation",
  arguments: [SERVER_ID, requiredArgument("name", CommandArgumentType.STRING)],
};

const SEARCH: CommandDefinition = {
  ...BASE_COMMAND,
  id: "chat.search_messages",
  title: "Search Messages",
  description: "Searches workspace messages",
  category: "Chat",
  arguments: [SERVER_ID, requiredArgument("query", CommandArgumentType.STRING)],
};

function serverCommand(
  id: string,
  title: string,
  description: string,
  category: string,
): CommandDefinition {
  return { ...BASE_COMMAND, id, title, description, category };
}

const SUCCESS: CommandResult = {
  status: "SUCCESS",
  message: "",
  payload: null,
  followUpCommands: [],
};

/** Opens the palette with a conversation open in workspace `ws-1` and its thread loaded. */
function openPaletteInThread() {
  useShellStore.getState().setSelectedConversationId("conv-9");
  useShellStore.getState().openThreadForMessage("msg-root-1");
  queryClient.setQueryData(queryKeys.threadByRoot("ws-1", "conv-9", "msg-root-1"), {
    id: "thread-1",
  });
  render(<CommandPalette />, { wrapper: Providers });
  act(() => useCommandStore.getState().openCommandPalette());
}

describe("CommandPalette command context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dispatchCommand).mockResolvedValue(SUCCESS);
    mutateAsync.mockResolvedValue({ executeCommand: SUCCESS });
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    useShellStore.getState().reset();
    queryClient.clear();
  });

  it("runs a command with the open conversation and thread", () => {
    openPaletteInThread();
    fireEvent.click(screen.getByText("Mark as read"));

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dispatchCommand).mock.calls[0][2]).toEqual({
      commandContext: {
        workspaceId: "ws-1",
        conversationId: "conv-9",
        threadId: "thread-1",
        focusedSurface: "commandPalette",
      },
    });
  });

  it("runs a command with only the workspace when no conversation is open", () => {
    render(<CommandPalette />, { wrapper: Providers });
    act(() => useCommandStore.getState().openCommandPalette());
    fireEvent.click(screen.getByText("List State"));

    expect(vi.mocked(dispatchCommand).mock.calls[0][2]).toEqual({
      commandContext: { workspaceId: "ws-1", focusedSurface: "commandPalette" },
    });
  });

  it("runs a pipe with the open conversation and thread", async () => {
    openPaletteInThread();
    fireEvent.change(screen.getByPlaceholderText("Type a command..."), {
      target: { value: "chat.list_channels |" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Mark as read"));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      commandId: "chat.list_channels | chat.mark_as_read",
      isPipe: true,
      commandContext: {
        workspaceId: "ws-1",
        conversationId: "conv-9",
        threadId: "thread-1",
      },
    });
  });
});

describe("CommandPalette workspace commands", () => {
  function openAs(role: ServerMemberRoleGql) {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    queryClient.setQueryData(queryKeys.server("ws-1"), {
      id: "ws-1",
      name: "Acme",
      viewerRole: role,
    });
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [WORKSPACE_LEAVE, WORKSPACE_RENAME] }),
    );
    render(<CommandPalette />, { wrapper: Providers });
    act(() => useCommandStore.getState().openCommandPalette());
  }

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    queryClient.clear();
  });

  it("offers Leave Workspace… only where the viewer may leave", () => {
    openAs(ServerMemberRoleGql.MEMBER);
    expect(screen.getByText("Leave Workspace…")).toBeInTheDocument();
    expect(screen.queryByText("Rename Workspace…")).not.toBeInTheDocument();
  });

  it("offers the owner Rename Workspace… and no Leave Workspace…", () => {
    openAs(ServerMemberRoleGql.OWNER);
    expect(screen.getByText("Rename Workspace…")).toBeInTheDocument();
    expect(screen.queryByText("Leave Workspace…")).not.toBeInTheDocument();
  });
});

describe("CommandPalette search", () => {
  beforeEach(() => {
    vi.mocked(useCommands).mockReturnValue({
      data: [
        serverCommand("admin.reset_password", "Reset Password", "Set a new password", "Admin"),
        serverCommand(
          "chat.search_messages",
          "Search Messages",
          "Search workspace messages by text content.",
          "Chat",
        ),
        serverCommand(
          "chat.create_group",
          "Create Group",
          "Create a group conversation.",
          "Conversation",
        ),
      ],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    vi.mocked(useCommands).mockReturnValue({
      data: [MARK_AS_READ, LIST_STATE],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  it("puts the best match first, under its group's header", () => {
    render(<CommandPalette />, { wrapper: Providers });
    act(() => useCommandStore.getState().openCommandPalette());
    fireEvent.change(screen.getByPlaceholderText("Type a command..."), {
      target: { value: "sea" },
    });

    const first = document.querySelector("[data-command-item]") as HTMLElement;
    expect(first).toHaveTextContent("Search Messages");
    expect(first.previousElementSibling).toHaveTextContent("Chat");
  });

  it("is a modal dialog named Command palette", () => {
    render(<CommandPalette />, { wrapper: Providers });
    act(() => useCommandStore.getState().openCommandPalette());

    expect(screen.getByRole("dialog", { name: "Command palette" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
  });

  it("lists chat.create_group as New Message", () => {
    render(<CommandPalette />, { wrapper: Providers });
    act(() => useCommandStore.getState().openCommandPalette());

    expect(screen.getByText("New Message")).toBeInTheDocument();
    expect(screen.getByText("Start a direct message or a group conversation.")).toBeInTheDocument();
    expect(screen.queryByText("Create Group")).not.toBeInTheDocument();
  });
});

/** Serves the commands the argument filter and pipe tests choose among. */
function serveFilterCommands() {
  vi.mocked(useCommands).mockReturnValue({
    data: [MARK_AS_READ, KICK, CREATE_CHANNEL, SEARCH, LIST_STATE],
    isLoading: false,
  } as ReturnType<typeof useCommands>);
}

function openPalette() {
  render(<CommandPalette />, { wrapper: Providers });
  act(() => useCommandStore.getState().openCommandPalette());
}

/** Types `value` into the palette's search input, whatever its placeholder says. */
function typeInPalette(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}

describe("CommandPalette argument filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveFilterCommands();
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    useShellStore.getState().reset();
    vi.mocked(useCommands).mockReturnValue({
      data: [MARK_AS_READ, LIST_STATE],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  it("leaves out a command whose required argument nothing supplies", () => {
    useShellStore.getState().setSelectedConversationId("conv-9");
    openPalette();

    expect(screen.queryByText("Kick Member")).not.toBeInTheDocument();
  });

  it("lists a conversation's command only while a conversation is open", () => {
    openPalette();
    expect(screen.queryByText("Mark as read")).not.toBeInTheDocument();

    act(() => useShellStore.getState().setSelectedConversationId("conv-9"));
    expect(screen.getByText("Mark as read")).toBeInTheDocument();
  });

  it("lists a command the app runs itself, and one whose argument its own prompt asks for", () => {
    openPalette();

    expect(screen.getByText("Create Channel")).toBeInTheDocument();
    expect(screen.getByText("Search Messages")).toBeInTheDocument();
  });
});

describe("CommandPalette pipes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveFilterCommands();
    mutateAsync.mockResolvedValue({ executeCommand: SUCCESS });
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    useShellStore.getState().reset();
    queryClient.clear();
    vi.mocked(useCommands).mockReturnValue({
      data: [MARK_AS_READ, LIST_STATE],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  it("Enter on an empty search runs the chain built so far", async () => {
    openPalette();
    typeInPalette("chat.search_messages query=Lunch|");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      commandId: "chat.search_messages query=Lunch",
      isPipe: true,
    });
  });

  it("Enter with a search adds the highlighted command and runs the chain", async () => {
    openPalette();
    typeInPalette("x|");
    typeInPalette("list st");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ commandId: "x | state.list" });
  });

  it("Tab adds the highlighted command and runs the chain", async () => {
    useShellStore.getState().setSelectedConversationId(null);
    openPalette();
    typeInPalette("x|");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Tab" });
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ commandId: "x | state.list" });
  });

  it("offers only commands the server runs with this context after a pipe", () => {
    openPalette();
    expect(screen.getByText("Toggle Zen Mode")).toBeInTheDocument();

    typeInPalette("x|");

    expect(screen.getByText("List State")).toBeInTheDocument();
    expect(screen.queryByText("Kick Member")).not.toBeInTheDocument();
    expect(screen.queryByText("Create Channel")).not.toBeInTheDocument();
    expect(screen.queryByText("Search Messages")).not.toBeInTheDocument();
    expect(screen.queryByText("Toggle Zen Mode")).not.toBeInTheDocument();
  });

  it("refuses a stage that runs only in the app without sending it", async () => {
    openPalette();
    typeInPalette("workspace.toggle_zen_mode|");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Pipe stage 1: Toggle Zen Mode runs only in this app, so it cannot be part of a pipe.",
    );
  });
});

describe("CommandPalette archive commands", () => {
  const ARCHIVE = serverCommand(
    "chat.archive_channel",
    "Archive Channel",
    "Archives the channel",
    "Conversation",
  );
  const UNARCHIVE = serverCommand(
    "chat.unarchive_channel",
    "Unarchive Channel",
    "Unarchives the channel",
    "Conversation",
  );
  const WITH_CONVERSATION = [
    SERVER_ID,
    requiredArgument("conversation_id", CommandArgumentType.CONVERSATION_ID),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("c-1");
    vi.mocked(useCommands).mockReturnValue({
      data: [
        { ...ARCHIVE, arguments: WITH_CONVERSATION },
        { ...UNARCHIVE, arguments: WITH_CONVERSATION },
      ],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    useShellStore.getState().reset();
    queryClient.clear();
    vi.mocked(useCommands).mockReturnValue({
      data: [MARK_AS_READ, LIST_STATE],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  function openWith(conversationType: ConversationTypeEnum, isArchived: boolean) {
    queryClient.setQueryData(queryKeys.conversation("ws-1", "c-1"), {
      id: "c-1",
      conversationType,
      isArchived,
    });
    render(<CommandPalette />, { wrapper: Providers });
    act(() => useCommandStore.getState().openCommandPalette());
  }

  it("offers Unarchive Channel only in an archived channel and Archive Channel only in one that is not", () => {
    openWith(ConversationTypeEnum.CHANNEL, false);
    expect(screen.getByText("Archive Channel")).toBeInTheDocument();
    expect(screen.queryByText("Unarchive Channel")).not.toBeInTheDocument();
    cleanup();
    act(() => useCommandStore.getState().closeCommandPalette());

    openWith(ConversationTypeEnum.CHANNEL, true);
    expect(screen.getByText("Unarchive Channel")).toBeInTheDocument();
    expect(screen.queryByText("Archive Channel")).not.toBeInTheDocument();
  });

  it("offers neither in a direct message", () => {
    openWith(ConversationTypeEnum.DIRECT, false);
    expect(screen.queryByText("Archive Channel")).not.toBeInTheDocument();
    expect(screen.queryByText("Unarchive Channel")).not.toBeInTheDocument();
  });
});
