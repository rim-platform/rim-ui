import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CommandDefinition } from "../types";
import type { SearchMessageItem } from "../../messages/api/useSearchMessages";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

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

const mutateAsync = vi.fn();
vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({
    data: [
      command("chat.release_notes", "Post Release Notes"),
      command("chat.list_channels", "List Channels"),
    ],
    isLoading: false,
  })),
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
vi.mock("../runtime/effectiveKeybinds", () => ({ useEffectiveKeybinds: vi.fn(() => []) }));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const targets = vi.hoisted(() => ({
  channels: [
    { id: "c-rel", serverId: "ws-1", label: "#releases" },
    { id: "c-gen", serverId: "ws-1", label: "#general" },
  ],
  direct: [{ id: "d-1", serverId: "direct-1", label: "Release Helper" }],
  workspaces: [{ id: "ws-2", serverId: "ws-2", label: "Pixel Guild" }],
}));
vi.mock("./paletteTargets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./paletteTargets")>()),
  useChannelTargets: () => ({ items: targets.channels, isPending: false }),
  useDirectTargets: () => ({ items: targets.direct, isPending: false }),
  useWorkspaceTargets: () => ({ items: targets.workspaces, isPending: false }),
  useNamed: () => [],
}));

const servers = vi.hoisted(() => ({
  data: [
    { id: "ws-1", name: "RIM Development", owner: null },
    { id: "ws-2", name: "Pixel Guild", owner: null },
  ],
}));
vi.mock("../../workspaces/api/useMyServers", () => ({ useMyServers: () => servers }));

function message(id: string, serverId: string, sentAt: string, text: string): SearchMessageItem {
  return {
    id,
    serverId,
    conversationId: `conv-${id}`,
    conversationTitle: "development",
    conversationType: "CHANNEL",
    threadId: null,
    rootMessageId: null,
    authorId: "u-bob",
    author: { id: "u-bob", username: "bob", displayName: "Bob", avatarUrl: null },
    text,
    sentAt,
    rank: 1,
    headline: null,
  };
}

const here = vi.hoisted(() => ({
  results: [] as SearchMessageItem[],
  isOffline: false,
}));
vi.mock("../../messages/api/useMessageSearchResults", () => ({
  useMessageSearchResults: (workspaceId: string | undefined, _c: unknown, query: string) => ({
    results: workspaceId && query.trim() ? here.results : [],
    isPending: false,
    isOffline: here.isOffline,
  }),
}));
const fetchPage = vi.hoisted(() => vi.fn());
vi.mock("../../messages/api/useSearchMessages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../messages/api/useSearchMessages")>()),
  useDebouncedQuery: (query: string) => query,
  fetchMessageSearchPage: (...args: unknown[]) => fetchPage(...args),
}));

import { CommandPalette } from "./CommandPalette";
import { useCommandStore } from "../state/useCommandStore";
import { runDesktopLocalCommand } from "../runtime/commandDispatcher";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const box = () => screen.getByRole("dialog", { name: "Search or run a command" });
const field = () => screen.getByRole("combobox", { name: "Search or run a command" });
const group = (name: string) => screen.getByRole("group", { name });
const chip = () => screen.getByRole("button", { name: /^Searching / });

function openBox() {
  render(<CommandPalette />, { wrapper: Providers });
  act(() => {
    runDesktopLocalCommand("workspace.open_search");
  });
}

function type(text: string) {
  fireEvent.change(field(), { target: { value: text } });
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(() => new Promise(() => {}));
  fetchPage.mockReset();
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  here.results = [message("m-1", "ws-1", "2026-11-07T10:12:00Z", "blocks the release: #384")];
  here.isOffline = false;
});

afterEach(() => {
  act(() => {
    useCommandStore.getState().closeCommandPalette();
    useSearchOverlayStore.getState().close();
  });
  queryClient.clear();
  useWorkspaceStore.setState({ workspaceId: null });
});

describe("the search box", () => {
  it("opens with search first, under the scope of the open workspace", () => {
    openBox();
    expect(box()).toBeInTheDocument();
    expect(chip()).toHaveTextContent("RIM Development");
    expect(field()).toHaveAttribute("placeholder", "Search, or type > for commands");
  });

  it("lists channels and people, messages and commands, each as an announced group", () => {
    openBox();
    type("rel");
    expect(
      within(group("Channels and people"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["#releases"]);
    expect(within(group("Messages")).getByRole("option")).toHaveTextContent(
      "blocks the release: #384",
    );
    expect(within(group("Messages")).getByRole("option")).toHaveTextContent("Bob in #development");
    expect(within(group("Commands")).getByRole("option")).toHaveTextContent("Post Release Notes");
  });

  it("moves through every row with the arrow keys, naming the active one on the field", () => {
    openBox();
    type("rel");
    const options = screen.getAllByRole("option");
    expect(field()).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field()).toHaveAttribute("aria-activedescendant", options[1].id);
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field()).toHaveAttribute("aria-activedescendant", options[2].id);
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(field()).toHaveAttribute("aria-activedescendant", options[1].id);
  });

  it("opens a channel with Enter and closes", () => {
    openBox();
    type("rel");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(useShellStore.getState().selectedConversationId).toBe("c-rel");
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("opens a message in its conversation, highlighted", () => {
    openBox();
    type("rel");
    fireEvent.click(within(group("Messages")).getByRole("option"));
    expect(useShellStore.getState()).toMatchObject({
      selectedConversationId: "conv-m-1",
      highlightedMessageId: "m-1",
    });
  });

  it("widens to every workspace with Tab and back, and searches each one's messages", async () => {
    fetchPage.mockImplementation(async (serverId: string) => ({
      items:
        serverId === "ws-2"
          ? [message("m-2", "ws-2", "2026-11-07T11:00:00Z", "release party")]
          : serverId === "ws-1"
            ? [message("m-1", "ws-1", "2026-11-07T10:12:00Z", "blocks the release")]
            : [],
      next: null,
      prev: null,
      pageInfo: { hasNext: false, hasPrev: false },
    }));
    openBox();
    type("rel");
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(chip()).toHaveTextContent("All workspaces");
    expect(
      within(group("Channels and people"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["#releasesRIM Development", "Release HelperDirect message"]);
    await waitFor(() =>
      expect(
        within(group("Messages"))
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual([
        expect.stringContaining("release party"),
        expect.stringContaining("blocks the release"),
      ]),
    );
    expect(fetchPage).toHaveBeenCalledWith("ws-2", "rel", 5, expect.any(AbortSignal));
    expect(
      screen.getByText("Encrypted messages can't be searched in the web app."),
    ).toBeInTheDocument();

    fireEvent.keyDown(field(), { key: "Tab" });
    expect(chip()).toHaveTextContent("RIM Development");
  });

  it("says how many workspaces it searched when there are more than ten", async () => {
    const all = servers.data;
    servers.data = Array.from({ length: 14 }, (_, i) => ({
      id: i === 0 ? "ws-1" : `ws-${i + 1}`,
      name: `Workspace ${i + 1}`,
      owner: null,
    }));
    fetchPage.mockResolvedValue({
      items: [],
      next: null,
      prev: null,
      pageInfo: { hasNext: false, hasPrev: false },
    });
    openBox();
    act(() => useCommandStore.getState().setScope("everything"));
    type("release");
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(10));
    expect(fetchPage.mock.calls[0][0]).toBe("ws-1");
    expect(
      screen.getByText("Searched 10 of your 14 workspaces. Pick one to search the rest."),
    ).toBeInTheDocument();
    servers.data = all;
  });

  it("names a workspace it could not search and keeps the others, with no error toast", async () => {
    fetchPage.mockImplementation(async (serverId: string) => {
      if (serverId === "ws-2") throw new Error("Search is turned off here");
      return {
        items: [message("m-1", "ws-1", "2026-11-07T10:12:00Z", "blocks the release")],
        next: null,
        prev: null,
        pageInfo: { hasNext: false, hasPrev: false },
      };
    });
    openBox();
    act(() => useCommandStore.getState().setScope("everything"));
    type("release");
    expect(await screen.findByText("Couldn't search Pixel Guild.")).toBeInTheDocument();
    expect(within(group("Messages")).getByRole("option")).toHaveTextContent("blocks the release");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("asks for two characters before searching every workspace's messages", () => {
    openBox();
    act(() => useCommandStore.getState().setScope("everything"));
    type("r");
    expect(
      screen.getByText("Type at least 2 characters to search messages in every workspace."),
    ).toBeInTheDocument();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("starts with every workspace from Home and from Unreads", () => {
    useShellStore.getState().setMainSurface({ kind: "home" });
    openBox();
    expect(chip()).toHaveTextContent("All workspaces");
    act(() => useCommandStore.getState().closeCommandPalette());
    act(() => {
      useShellStore.getState().setMainSurface({ kind: "unreads" });
      runDesktopLocalCommand("workspace.open_search");
    });
    expect(chip()).toHaveTextContent("All workspaces");
  });

  it("says the web app can't search encrypted messages", () => {
    openBox();
    type("rel");
    expect(
      within(group("Messages")).getByText("Encrypted messages can't be searched in the web app."),
    ).toBeInTheDocument();
  });

  it("switches to the command palette on > and back with Backspace on an empty field", () => {
    openBox();
    type(">list");
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    const palette = screen.getByPlaceholderText("Type a command...");
    expect(palette).toHaveValue("list");
    fireEvent.change(palette, { target: { value: "" } });
    fireEvent.keyDown(palette, { key: "Backspace" });
    expect(box()).toBeInTheDocument();
  });

  it("opens with commands first from the palette's key, and switches an open box to commands", () => {
    render(<CommandPalette />, { wrapper: Providers });
    act(() => {
      runDesktopLocalCommand("workspace.open_command_palette");
    });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    act(() => {
      runDesktopLocalCommand("workspace.open_command_palette");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => {
      runDesktopLocalCommand("workspace.open_search");
    });
    expect(box()).toBeInTheDocument();
    act(() => {
      runDesktopLocalCommand("workspace.open_command_palette");
    });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("opens the full search with the text from Search all messages", async () => {
    const user = userEvent.setup();
    openBox();
    type("from:@bob release");
    await user.click(screen.getByRole("button", { name: "Search all messages" }));
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    expect(useSearchOverlayStore.getState()).toMatchObject({
      isOpen: true,
      query: "from:@bob release",
      scope: { kind: "all" },
    });
  });

  it("says so when the server cannot be reached and the results come from this device", () => {
    here.isOffline = true;
    openBox();
    type("rel");
    expect(
      screen.getByText("Offline: showing matches from messages saved on this device."),
    ).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    openBox();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });
});
