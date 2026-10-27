import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { CommandDefinition, CommandResult } from "../types";

const mutateAsync = vi.fn();

const SEARCH_MESSAGES: CommandDefinition = {
  id: "chat.search_messages",
  title: "Search Messages",
  description: "Search workspace messages by text content.",
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

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: [SEARCH_MESSAGES], isLoading: false })),
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
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { toast } from "../../../shared/toast";

import { queryClient } from "../../../core/query/queryClient";

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const FOUND: CommandResult = {
  status: "SUCCESS",
  message: "",
  payload: null,
  followUpCommands: [],
};

function openPalette() {
  render(<CommandPalette />, { wrapper: Providers });
  act(() => useCommandStore.getState().openCommandPalette());
  return screen.getByPlaceholderText("Type a command...");
}

describe("Search Messages in the command palette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ executeCommand: FOUND });
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useSearchOverlayStore.getState().close();
    useWorkspaceStore.getState().clearWorkspaceId();
  });

  it("opens the search overlay for Search Messages without a query", async () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: "sea" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(useSearchOverlayStore.getState()).toMatchObject({
      isOpen: true,
      scope: { kind: "all" },
    });
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("runs the server search as a piped stage", async () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: "chat.list_channels |" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Search Messages"));
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      commandId: "chat.list_channels | chat.search_messages",
      isPipe: true,
    });
    expect(useSearchOverlayStore.getState().isOpen).toBe(false);
  });
});
