import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { CommandDefinition, CommandResult } from "../types";

const mutateAsync = vi.fn();

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: [MARK_AS_READ], isLoading: false })),
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
import { dispatchCommand } from "../runtime/commandDispatcher";
import { useCommandStore } from "../state/useCommandStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";

const MARK_AS_READ: CommandDefinition = {
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
  render(<CommandPalette />);
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
    render(<CommandPalette />);
    act(() => useCommandStore.getState().openCommandPalette());
    fireEvent.click(screen.getByText("Mark as read"));

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
