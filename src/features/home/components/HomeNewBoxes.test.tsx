import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { RuntimeProvider } from "../../../core/runtime/RuntimeProvider";
import { queryKeys } from "../../../core/query/keys";
import { queryClient as appQueryClient } from "../../../core/query/queryClient";
import { createTestQueryClient } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import {
  baseReadHandlers,
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useConnectionStore } from "../../system/state/useConnectionStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { HomeBox, HomeLayoutDoc } from "../layout/homeLayout";
import { useHomeEditStore } from "../state/useHomeEditStore";
import { useHomeHiddenStore, useHomeLayoutStore } from "../state/useHomeLayoutStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../relay/api/useDmRequests", () => ({
  usePendingDmRequestCounts: () => new Map(),
}));
vi.mock("../../updater/hooks/useServerInfo", () => ({
  useServerInfo: () => ({ info: { defaultWorkspace: null, capabilities: ["home_layout"] } }),
}));
const initiatorUi = vi.hoisted(() => ({ listed: false }));
vi.mock("../../updater/api/serverCapabilities", async (importOriginal) => {
  const listed = async (capability: string) =>
    capability === "home_layout" || (initiatorUi.listed && capability === "command_initiator_ui");
  return {
    ...(await importOriginal<typeof import("../../updater/api/serverCapabilities")>()),
    serverHasCapability: listed,
    spaceHasCapability: (_spaceId: string, capability: string) => listed(capability),
  };
});
vi.mock("../../agent/agentAvailability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agent/agentAvailability")>()),
  agentAvailable: () => false,
}));
const platform = vi.hoisted(() => ({ value: "web" as "web" | "desktop" }));
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => platform.value,
}));
const directItems = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("../../relay/api/useDirectInbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/api/useDirectInbox")>()),
  useDirectInbox: () => ({
    items: directItems.value,
    predecessors: new Map(),
    isPending: false,
    isError: false,
  }),
}));

import { useCommandArgumentsStore } from "../../commands/state/useCommandArgumentsStore";
import { HomePage } from "./HomePage";

const SERVERS = [
  { id: "ws-1", name: "Platform", owner: { id: "u-1", username: "alice", displayName: "Alice" } },
];

const box = (id: string, kind: string, settings?: Record<string, unknown>): HomeBox =>
  settings ? { id, kind, width: "half", settings } : { id, kind, width: "half" };

const layoutOf = (...boxes: HomeBox[]): HomeLayoutDoc => ({ version: 1, boxes });

const CHANNEL = { workspaceId: "ws-1", conversationId: "c-deploys", count: 3 };

function message(id: string, text: string, minutesAgo: number, extra: object = {}) {
  return {
    id,
    serverId: "ws-1",
    conversationId: "c-deploys",
    threadId: null,
    rootThreadId: null,
    authorId: "u-1",
    author: { id: "u-1", username: "alice", displayName: "Alice" },
    text,
    hasAttachments: false,
    parentMessageId: null,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    editedAt: null,
    reactions: [],
    attachments: [],
    linkPreviews: [],
    ...extra,
  };
}

const channelConversation = (extra: object = {}) => ({
  id: "c-deploys",
  serverId: "ws-1",
  title: "deploys",
  conversationType: ConversationTypeEnum.CHANNEL,
  memberIds: [],
  topic: null,
  isPrivate: false,
  isArchived: false,
  archivedAt: null,
  memberCount: 2,
  isMember: true,
  createdBy: "u-1",
  slowModeSeconds: 0,
  notificationLevel: null,
  effectiveNotificationLevel: null,
  encryptedAt: null,
  pendingMemberIds: [],
  ...extra,
});

const state = vi.hoisted(() => ({
  stored: null as { layout: unknown; editedAt: string } | null,
  conversation: null as null | (() => unknown),
  /** The workspace's joined channels, or `null` for the two the fixture has. */
  channels: null as null | unknown[],
  messages: [] as unknown[],
  commands: [] as unknown[],
  execute: null as null | ((vars: Record<string, unknown>) => unknown),
}));

function serve() {
  routeRequests(requestMock, {
    // Ahead of the base handlers, whose "query Me" would also match it.
    "query Messages": () => ({
      messages: {
        items: state.messages,
        next: null,
        prev: null,
        pageInfo: { hasNext: false, hasPrev: false },
      },
    }),
    ...baseReadHandlers,
    "query MyServers": () => ({ myServers: SERVERS }),
    "query MyNotifications": () => ({
      myNotifications: { items: [], next: null, pageInfo: { hasNext: false } },
    }),
    "query HomeLayout": () => ({ homeLayout: state.stored }),
    "mutation SaveHomeLayout": (vars) => {
      state.stored = { layout: vars.layout, editedAt: vars.editedAt as string };
      return { saveHomeLayout: { kept: true, layout: state.stored } };
    },
    "query Conversation(": () => ({
      conversation: state.conversation ? state.conversation() : channelConversation(),
    }),
    "query Channels": () => ({
      channels: {
        items: state.channels ?? [
          channelConversation(),
          channelConversation({ id: "c-other", title: "other" }),
        ],
        pageInfo: { hasNext: false, hasPrev: false },
        next: null,
        prev: null,
      },
    }),
    "query Commands": () => ({ commands: state.commands }),
    "mutation ExecuteCommand": (vars) => state.execute?.(vars),
    "query Server": (vars) => ({
      server: { id: vars.serverId, name: "x", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
  });
}

function command(id: string, title: string, extra: object = {}) {
  return {
    id,
    title,
    description: "",
    category: "Workspace",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    sensitivity: "SAFE",
    arguments: [],
    ...extra,
  };
}

function renderHome() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <RuntimeProvider>
        <HomePage />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return qc;
}

function stored(...boxes: HomeBox[]) {
  state.stored = { layout: layoutOf(...boxes), editedAt: "2026-11-07T10:00:00.000Z" };
}

function saves(): Record<string, unknown>[] {
  return callsTo(requestMock, "mutation SaveHomeLayout");
}

async function startEditing(user: ReturnType<typeof userEvent.setup>) {
  // Edit Home runs its command, which reads the server's capabilities from the app's cache.
  appQueryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["home_layout"] });
  await user.click(await screen.findByRole("button", { name: "Edit Home" }));
  await screen.findByRole("heading", { level: 1, name: "Editing Home" });
}

describe("Home's new boxes", () => {
  beforeEach(() => {
    initiatorUi.listed = false;
    requestMock.mockReset();
    state.stored = null;
    state.conversation = null;
    state.channels = null;
    state.messages = [];
    state.commands = [];
    state.execute = null;
    platform.value = "web";
    directItems.value = [];
    useShellStore.getState().reset();
    useShellStore.setState({ shellWidth: "wide" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    useHomeLayoutStore.setState({ copy: null, pending: null, changedElsewhere: false });
    useHomeHiddenStore.setState({ hidden: [] });
    useHomeEditStore.getState().stop();
    useOfflineStore.setState({ offline: false });
    useConnectionStore.setState({ status: "connected" });
    useConfirmationModalStore.getState().reset();
  });

  afterEach(() => {
    appQueryClient.clear();
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  describe("the Getting started box", () => {
    it("I'm done with this saves the layout without the box", async () => {
      stored(box("start", "start"), box("waiting", "waiting"));
      serve();
      const user = userEvent.setup();
      renderHome();
      await user.click(await screen.findByRole("button", { name: "I'm done with this" }));
      await waitFor(() => expect(saves()).toHaveLength(1));
      const layout = saves()[0].layout as HomeLayoutDoc;
      expect(layout.boxes.map((b) => b.kind)).toEqual(["waiting"]);
      expect(screen.queryByRole("region", { name: "Getting started" })).not.toBeInTheDocument();
    });
  });

  describe("a channel box", () => {
    it("shows the channel's latest messages under its name, and marks nothing read", async () => {
      state.messages = [
        message("m1", "first deploy", 40),
        message("m2", "second deploy", 30),
        message("m3", "third deploy", 20),
        message("m4", "fourth deploy", 10),
      ];
      useUnreadStore.getState().setCounts("ws-1", { "c-deploys": 4 });
      stored(box("ch", "channel", CHANNEL));
      serve();
      renderHome();
      // The name needs the layout, the channel and the workspace's label, each read in turn.
      const region = await screen.findByRole(
        "region",
        { name: "#deploys in Platform" },
        { timeout: 4000 },
      );
      expect(await within(region).findByText("fourth deploy")).toBeInTheDocument();
      expect(within(region).getByText("second deploy")).toBeInTheDocument();
      expect(within(region).queryByText("first deploy")).not.toBeInTheDocument();
      // Looking at it leaves the channel unread.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(useUnreadStore.getState().counts["c-deploys"]).toBe(4);
      expect(callsTo(requestMock, "mutation MarkAsRead")).toHaveLength(0);
    });

    it("names it with the channel's invisible characters shown", async () => {
      state.conversation = () => channelConversation({ title: "ops‮evil" });
      stored(box("ch", "channel", CHANNEL));
      serve();
      renderHome();
      const heading = await screen.findByRole("heading", { name: /#ops.*evil in Platform/ });
      expect(heading.textContent).not.toContain("‮");
    });

    it("says when it is empty", async () => {
      stored(box("ch", "channel", CHANNEL));
      serve();
      renderHome();
      expect(await screen.findByText("No messages yet.")).toBeInTheDocument();
    });

    it("opens a message in its channel", async () => {
      state.messages = [message("m1", "deploy done", 5)];
      useWorkspaceStore.setState({ workspaceId: "ws-other" });
      stored(box("ch", "channel", CHANNEL));
      serve();
      const user = userEvent.setup();
      renderHome();
      await screen.findByText("deploy done");
      await user.click(
        screen.getByRole("button", { name: /Open the message from .* in its channel/ }),
      );
      await waitFor(() => expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1"));
      expect(useShellStore.getState().selectedConversationId).toBe("c-deploys");
    });

    it("says it can't see a channel any more and Remove saves the layout without it", async () => {
      state.conversation = () => {
        throw graphqlError("NOT_FOUND", "not found");
      };
      // Getting started, shown until the stored layout arrives, would read the channel list
      // and with it the channel this box says is gone.
      state.channels = [];
      stored(box("waiting", "waiting"), box("ch", "channel", CHANNEL));
      serve();
      const user = userEvent.setup();
      renderHome();
      expect(
        await screen.findByText("You can't see this channel any more, or it was deleted."),
      ).toBeInTheDocument();
      expect(callsTo(requestMock, "query Messages")).toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(saves()).toHaveLength(1));
      expect(saves()[0].layout).toEqual(layoutOf(box("waiting", "waiting")));
    });

    it("says when the channel is archived", async () => {
      state.conversation = () => channelConversation({ isArchived: true });
      stored(box("ch", "channel", CHANNEL));
      serve();
      renderHome();
      expect(await screen.findByText("This channel is archived.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    });

    it("says the timeline's words for encrypted messages this browser can't read", async () => {
      const encryption = { epoch: 1, incarnation: 1 };
      state.messages = [message("m1", "", 5, { encryption })];
      stored(box("ch", "channel", CHANNEL));
      serve();
      renderHome();
      expect(
        await screen.findByText(/To read and send encrypted messages in this browser/),
      ).toBeInTheDocument();
    });

    it("says the desktop holds no text of encrypted messages it can't read", async () => {
      platform.value = "desktop";
      state.messages = [message("m1", "", 5, { encryption: { epoch: 1, incarnation: 1 } })];
      stored(box("ch", "channel", CHANNEL));
      serve();
      renderHome();
      expect(
        await screen.findByText("This device holds no text of these messages."),
      ).toBeInTheDocument();
    });
  });

  describe("Add a box on the web", () => {
    it("doesn't offer the two agent boxes", async () => {
      serve();
      const user = userEvent.setup();
      renderHome();
      await startEditing(user);
      expect(screen.getByRole("button", { name: "Add Channel" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add Your agents' runs" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Add Agent sessions" })).toBeNull();
    });
  });

  describe("settings", () => {
    it("opens a channel's settings before adding it, and Cancel adds nothing", async () => {
      serve();
      const user = userEvent.setup();
      renderHome();
      await startEditing(user);
      await user.click(screen.getByRole("button", { name: "Add Channel" }));
      const dialog = await screen.findByRole("dialog", { name: "Add a box: Channel" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.querySelectorAll('[data-box-id^="channel"]')).toHaveLength(0);
    });

    it("adds two channel boxes with their own channels and counts", async () => {
      serve();
      const user = userEvent.setup();
      renderHome();
      await startEditing(user);
      for (const [title, count] of [
        ["#deploys", "10"],
        ["#other", "3"],
      ]) {
        await user.click(screen.getByRole("button", { name: "Add Channel" }));
        const dialog = await screen.findByRole("dialog", { name: "Add a box: Channel" });
        await user.selectOptions(within(dialog).getByLabelText("Workspace"), "ws-1");
        await within(dialog).findByRole("option", { name: title });
        await user.selectOptions(
          within(dialog).getByLabelText("Channel"),
          within(dialog).getByRole("option", { name: title }),
        );
        await user.click(within(dialog).getByRole("radio", { name: count }));
        await user.click(within(dialog).getByRole("button", { name: "Add" }));
      }
      expect(screen.getByRole("button", { name: "Add Channel" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(saves()).toHaveLength(1));
      const boxes = (saves()[0].layout as HomeLayoutDoc).boxes.filter((b) => b.kind === "channel");
      expect(boxes.map((b) => b.settings)).toEqual([
        { workspaceId: "ws-1", conversationId: "c-deploys", count: 10 },
        { workspaceId: "ws-1", conversationId: "c-other", count: 3 },
      ]);
      expect(new Set(boxes.map((b) => b.id)).size).toBe(2);
    });

    it("keeps a single Direct messages box, added with five shown", async () => {
      directItems.value = [];
      serve();
      const user = userEvent.setup();
      renderHome();
      await startEditing(user);
      await user.click(screen.getByRole("button", { name: "Add Direct messages" }));
      expect(screen.queryByRole("button", { name: "Add Direct messages" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "More for Direct messages" }));
      await user.click(await screen.findByRole("menuitem", { name: "Settings" }));
      const dialog = await screen.findByRole("dialog", { name: "Settings of Direct messages" });
      expect(within(dialog).getByRole("radio", { name: "5" })).toBeChecked();
      await user.click(within(dialog).getByRole("radio", { name: "10" }));
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "More for Direct messages" })).toHaveFocus(),
      );
      await user.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(saves()).toHaveLength(1));
      const direct = (saves()[0].layout as HomeLayoutDoc).boxes.find((b) => b.kind === "direct");
      expect(direct?.settings).toEqual({ count: 10 });
    });

    it("shows settings it can't read as needing fixing, and Fix settings opens them", async () => {
      stored(box("dm", "direct", { count: 7 }), box("ch", "channel", { workspaceId: 3 }));
      serve();
      const user = userEvent.setup();
      renderHome();
      const lines = await screen.findAllByText("This box's settings need fixing");
      expect(lines).toHaveLength(2);
      await user.click(screen.getAllByRole("button", { name: "Fix settings" })[0]);
      const dialog = await screen.findByRole("dialog", { name: "Settings of Direct messages" });
      expect(within(dialog).getByRole("radio", { name: "5" })).toBeChecked();
    });
  });

  describe("a Direct messages box", () => {
    it("shows the latest conversations with their unread counts, and opens one", async () => {
      directItems.value = ["a", "b", "c", "d"].map((id) => ({
        ...channelConversation({
          id: `dm-${id}`,
          serverId: "ws-direct",
          title: `Talk ${id}`,
          conversationType: ConversationTypeEnum.GROUP,
        }),
      }));
      useUnreadStore.getState().setCounts("ws-direct", { "dm-b": 2 });
      stored(box("dm", "direct", { count: 3 }));
      serve();
      const user = userEvent.setup();
      renderHome();
      const list = await screen.findByRole("list", { name: "Latest direct messages" });
      const rows = within(list).getAllByRole("button");
      expect(rows.map((row) => row.textContent)).toEqual(["Talk a", "Talk b2 unread", "Talk c"]);
      await user.click(rows[1]);
      expect(useWorkspaceStore.getState().workspaceId).toBe("ws-direct");
      expect(useShellStore.getState().selectedConversationId).toBe("dm-b");
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    });

    it("says when there are none", async () => {
      stored(box("dm", "direct", { count: 5 }));
      serve();
      renderHome();
      expect(await screen.findByText("No direct messages yet.")).toBeInTheDocument();
    });
  });

  describe("a Quick actions box", () => {
    it("runs a command as a click from the palette, and a confirmation still asks", async () => {
      state.commands = [command("reports.purge_old", "Purge Old Reports")];
      state.execute = () => ({
        executeCommand: {
          status: "CONFIRMATION_REQUIRED",
          message: "Confirm it",
          payload: null,
          followUpCommands: [],
          pipelineStages: null,
          confirmationRequired: {
            token: "t",
            argsHash: "h",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      });
      stored(
        box("q", "quick", {
          actions: [{ commandId: "reports.purge_old", presetArgs: { scope: "all" } }],
        }),
      );
      serve();
      const user = userEvent.setup();
      renderHome();
      await user.click(await screen.findByRole("button", { name: "Purge Old Reports" }));
      await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1));
      await waitFor(() =>
        expect(useConfirmationModalStore.getState().request?.commandId).toBe("reports.purge_old"),
      );
      const [first] = callsTo(requestMock, "mutation ExecuteCommand");
      expect(first.input).toEqual({
        commandId: "reports.purge_old",
        args: { scope: "all" },
        commandContext: { workspaceId: "ws-1" },
        isPipe: undefined,
      });
      act(() => useConfirmationModalStore.getState().reject());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1);
    });

    it("sends its run as UI on a server that lists it", async () => {
      initiatorUi.listed = true;
      state.commands = [command("reports.purge_old", "Purge Old Reports")];
      state.execute = () => ({
        executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
      });
      stored(box("q", "quick", { actions: [{ commandId: "reports.purge_old" }] }));
      serve();
      const user = userEvent.setup();
      renderHome();
      await user.click(await screen.findByRole("button", { name: "Purge Old Reports" }));
      await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1));
      expect(callsTo(requestMock, "mutation ExecuteCommand")[0].input).toMatchObject({
        commandId: "reports.purge_old",
        initiator: "UI",
      });
    });

    it("asks for the arguments its saved ones leave out before running", async () => {
      const exportArguments = [
        { name: "scope", argumentType: "STRING", required: true },
        { name: "format", argumentType: "STRING", required: true },
      ];
      state.commands = [
        command("reports.export", "Export Reports", { arguments: exportArguments }),
      ];
      stored(
        box("q", "quick", {
          actions: [{ commandId: "reports.export", presetArgs: { scope: "all" } }],
        }),
      );
      serve();
      const user = userEvent.setup();
      renderHome();
      await user.click(await screen.findByRole("button", { name: "Export Reports" }));
      await waitFor(() =>
        expect(
          useCommandArgumentsStore.getState().request?.arguments.map((argument) => argument.name),
        ).toEqual(["format"]),
      );
      expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
      act(() => useCommandArgumentsStore.getState().cancel());
    });

    it("disables an action not offered here, saying why in its description", async () => {
      state.commands = [command("chat.mark_all_as_read", "Mark Everything Read")];
      stored(
        box("q", "quick", {
          actions: [
            { commandId: "plugin.k8s.pods" },
            { commandId: "app.quit" },
            { commandId: "workspace.edit_home" },
          ],
        }),
      );
      serve();
      renderHome();
      const list = await screen.findByRole("list", { name: "Quick actions" });
      const buttons = within(list).getAllByRole("button");
      expect(buttons).toHaveLength(3);
      for (const button of buttons) expect(button).toBeDisabled();
      expect(buttons[0]).toHaveAccessibleDescription("Its plugin isn't installed on this device");
      expect(buttons[1]).toHaveAccessibleDescription("This command needs the desktop app");
      expect(buttons[2]).toHaveAccessibleDescription("Editing Home can't be a quick action");
    });

    it("offers only commands it can run, and marks a saved one that needs arguments", async () => {
      const textArgument = [{ name: "text", argumentType: "SELECTION_TEXT", required: true }];
      state.commands = [
        command("chat.mark_all_as_read", "Mark Everything Read"),
        command("chat.quote_selection", "Quote Selection", { arguments: textArgument }),
      ];
      stored(box("q", "quick", { actions: [{ commandId: "chat.quote_selection" }] }));
      serve();
      const user = userEvent.setup();
      renderHome();
      const list = await screen.findByRole("list", { name: "Quick actions" });
      const action = await within(list).findByRole("button", { name: "Quote Selection" });
      expect(action).toBeDisabled();
      expect(action).toHaveAccessibleDescription("Needs arguments this can't supply yet");

      await startEditing(user);
      await user.click(screen.getByRole("button", { name: "More for Quick actions" }));
      await user.click(await screen.findByRole("menuitem", { name: "Settings" }));
      const dialog = await screen.findByRole("dialog", { name: "Settings of Quick actions" });
      await within(dialog).findByRole("option", { name: "Mark Everything Read" });
      const picker = within(dialog).getByLabelText("Action 1");
      expect(picker).toHaveValue("chat.quote_selection");
      expect(within(dialog).getAllByRole("option", { name: "Quote Selection" })).toHaveLength(1);
      expect(picker).toHaveAccessibleDescription("Needs arguments this can't supply yet");

      await user.selectOptions(picker, "chat.mark_all_as_read");
      expect(within(dialog).queryByRole("option", { name: "Quote Selection" })).toBeNull();
      expect(within(dialog).queryByText("Needs arguments this can't supply yet")).toBeNull();
    });

    it("picks keybind-capable commands only, never Edit Home, with arguments under 4096 bytes", async () => {
      state.commands = [
        command("chat.mark_all_as_read", "Mark Everything Read"),
        command("chat.palette_only", "Palette Only", { keybindCapable: false }),
      ];
      serve();
      const user = userEvent.setup();
      renderHome();
      await startEditing(user);
      await user.click(screen.getByRole("button", { name: "Add Quick actions" }));
      const dialog = await screen.findByRole("dialog", { name: "Add a box: Quick actions" });
      const picker = within(dialog).getByLabelText("Action 1");
      await within(dialog).findByRole("option", { name: "Mark Everything Read" });
      expect(within(dialog).queryByRole("option", { name: "Palette Only" })).toBeNull();
      expect(within(dialog).queryByRole("option", { name: "Edit Home" })).toBeNull();
      await user.selectOptions(picker, "chat.mark_all_as_read");
      const args = within(dialog).getByLabelText("Arguments (optional JSON)");
      await user.click(args);
      await user.paste(JSON.stringify({ note: "x".repeat(4100) }));
      await user.click(within(dialog).getByRole("button", { name: "Add" }));
      expect(within(dialog).getByText("Arguments must be at most 4096 bytes")).toBeInTheDocument();
      await user.clear(args);
      await user.paste('{"scope":"all"}');
      await user.click(within(dialog).getByRole("button", { name: "Add" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(saves()).toHaveLength(1));
      const quick = (saves()[0].layout as HomeLayoutDoc).boxes.find((b) => b.kind === "quick");
      expect(quick?.settings).toEqual({
        actions: [{ commandId: "chat.mark_all_as_read", presetArgs: { scope: "all" } }],
      });
    });
  });
});
