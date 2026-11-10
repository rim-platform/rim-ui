import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConversationTypeEnum,
  NotificationReason,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { RuntimeProvider } from "../../../core/runtime/RuntimeProvider";
import { createTestQueryClient } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  baseReadHandlers,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useAgentRecordStore, type RecordEntry } from "../../agents/state/useAgentRecordStore";
import {
  useConnectedAgentsStore,
  type ConnectedAgent,
} from "../../agents/state/useConnectedAgentsStore";
import type { NotificationItem } from "../../notifications/api/useNotifications";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

const dmRequestCounts = vi.hoisted(() => ({ value: new Map<string | null, number>() }));
vi.mock("../../relay/api/useDmRequests", () => ({
  usePendingDmRequestCounts: () => dmRequestCounts.value,
}));
const serverInfo = vi.hoisted(() => ({ defaultWorkspace: "ws-default" }));
vi.mock("../../updater/hooks/useServerInfo", () => ({
  useServerInfo: () => ({ info: { defaultWorkspace: serverInfo.defaultWorkspace } }),
}));
const available = vi.hoisted(() => ({ agent: true }));
vi.mock("../../agent/agentAvailability", () => ({ agentAvailable: () => available.agent }));
const jump = vi.hoisted(() => vi.fn());
vi.mock("../../notifications/runtime/jumpToNotification", () => ({
  jumpToNotification: (...args: unknown[]) => jump(...args),
}));

vi.mock("../../commands/runtime/runFromClick", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../commands/runtime/runFromClick")>();
  return { ...actual, runCommandFromClick: vi.fn(actual.runCommandFromClick) };
});

import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { HomePage } from "./HomePage";

const SERVERS = [
  { id: "ws-1", name: "Alpha", owner: { id: "u-1", username: "alice", displayName: "Alice" } },
  { id: "ws-2", name: "Beta", owner: { id: "u-2", username: "bob", displayName: null } },
];

function mention(
  id: string,
  serverId: string,
  minutesAgo: number,
  text: string,
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id,
    serverId,
    conversationId: `c-${id}`,
    messageId: `m-${id}`,
    reason: NotificationReason.MENTION,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    readAt: null,
    conversation: {
      id: `c-${id}`,
      title: "general",
      conversationType: ConversationTypeEnum.CHANNEL,
      memberIds: [],
    },
    message: {
      id: `m-${id}`,
      conversationId: `c-${id}`,
      threadId: null,
      authorId: "u-alice",
      author: { id: "u-alice", username: "alice", displayName: "Alice" },
      text,
      isDeleted: false,
      sentAt: new Date().toISOString(),
      encryption: null,
    },
    ...overrides,
  };
}

type Inbox = Record<string, NotificationItem[] | Error>;

function serve(inbox: Inbox, servers = SERVERS, extra: Record<string, never> = {}) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query MyServers": () => ({ myServers: servers }),
    "query MyNotifications": (vars) => {
      const result = inbox[vars.serverId as string] ?? [];
      if (result instanceof Error) throw result;
      return { myNotifications: { items: result, next: null, pageInfo: { hasNext: false } } };
    },
    "mutation MarkNotificationsRead": () => ({ markNotificationsRead: 1 }),
    "query Server": (vars) => ({
      server: { id: vars.serverId, name: "x", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
    ...extra,
  });
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

const AGENT: ConnectedAgent = {
  id: "a1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: {},
  pluginApprovals: {},
};

function entry(minutesAgo: number, fields: Partial<RecordEntry> = {}): RecordEntry {
  return {
    at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    agentId: "a1",
    agentName: "Claude Code",
    tool: "rim_read_messages",
    workspaceId: "ws-1",
    channelId: "c1",
    query: false,
    messageIds: ["m1"],
    refused: false,
    runId: "r_1",
    ...fields,
  };
}

describe("HomePage", () => {
  beforeEach(() => {
    requestMock.mockReset();
    jump.mockReset();
    dmRequestCounts.value = new Map();
    available.agent = true;
    serverInfo.defaultWorkspace = "ws-default";
    useShellStore.getState().reset();
    useShellStore.setState({ shellWidth: "wide" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    useConnectedAgentsStore.setState({ agents: [] });
    useAgentRecordStore.setState({ entries: [] });
    useBlockedConversations.getState().reset();
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("shows today's boxes in today's order, each saying when it is empty", async () => {
    serve({});
    renderHome();
    expect(await screen.findByText("Nothing waiting.")).toBeInTheDocument();
    expect(await screen.findByText("No unread mentions or replies.")).toBeInTheDocument();
    expect(screen.getByText("Nothing unread.")).toBeInTheDocument();
    expect(screen.getByText("No agent sessions yet.")).toBeInTheDocument();
    expect(
      screen.getAllByRole("region").map((region) => region.getAttribute("data-box-id")),
    ).toEqual(["waiting", "mentions", "unread", "agentSessions"]);
  });

  it("lists mentions of every workspace newest first, naming the workspace", async () => {
    serve({
      "ws-1": [mention("a", "ws-1", 30, "old one")],
      "ws-2": [mention("b", "ws-2", 2, "fresh one")],
    });
    renderHome();
    const list = await screen.findByRole("list", { name: "Mentions and replies" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("fresh one");
    expect(rows[0]).toHaveTextContent("Beta");
    expect(rows[1]).toHaveTextContent("old one");
    expect(rows[1]).toHaveTextContent("Alpha");
    expect(screen.getByText("Other workspaces update every minute.")).toBeInTheDocument();
  });

  it("leaves out entries that are not mentions or replies, and blocked conversations", async () => {
    useBlockedConversations.getState().setIn("ws-1", { "c-hidden": "rimp1_x" });
    serve({
      "ws-1": [
        mention("a", "ws-1", 3, "kept"),
        mention("k", "ws-1", 4, "a keyword", { reason: NotificationReason.KEYWORD }),
        mention("r", "ws-1", 5, "a reply", { reason: NotificationReason.THREAD_REPLY }),
        mention("hidden", "ws-1", 6, "from a blocked person", { conversationId: "c-hidden" }),
      ],
    });
    renderHome();
    await screen.findByText("kept");
    expect(screen.getByText("a reply")).toBeInTheDocument();
    expect(screen.queryByText("a keyword")).not.toBeInTheDocument();
    expect(screen.queryByText("from a blocked person")).not.toBeInTheDocument();
  });

  it("shows twenty at a time and more on request", async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      mention(`n${i}`, "ws-1", i + 1, `message ${i}`),
    );
    serve({ "ws-1": items });
    renderHome();
    const list = await screen.findByRole("list", { name: "Mentions and replies" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(25);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("opens a mention at its message in its workspace and marks it read", async () => {
    serve({ "ws-2": [mention("b", "ws-2", 2, "fresh one")] });
    renderHome();
    await userEvent.click(await screen.findByRole("button", { name: /fresh one/ }));
    expect(jump).toHaveBeenCalledWith(expect.anything(), {
      serverId: "ws-2",
      conversationId: "c-b",
      messageId: "m-b",
      threadId: null,
    });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("mutation MarkNotificationsRead"),
        { serverId: "ws-2", ids: ["b"], allBefore: null },
      ),
    );
  });

  it("keeps the other workspaces when one fails and retries only that one", async () => {
    const inbox: Inbox = {
      "ws-1": [mention("a", "ws-1", 3, "still here")],
      "ws-2": graphqlError("INTERNAL", "boom"),
    };
    serve(inbox);
    renderHome();
    expect(await screen.findByText("still here")).toBeInTheDocument();
    // The failed workspace shows once its one retry, a second later, has failed too.
    expect(
      await screen.findByText("Couldn't load Beta.", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load Alpha.")).not.toBeInTheDocument();

    inbox["ws-2"] = [mention("b", "ws-2", 1, "arrived")];
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("arrived")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load Beta.")).not.toBeInTheDocument();
  });

  it("shows the waiting section only with something in it, and each row opens its page", async () => {
    dmRequestCounts.value = new Map<string | null, number>([
      ["ws-2", 2],
      [null, 1],
    ]);
    serve({});
    renderHome();
    const section = await screen.findByRole("region", { name: "Waiting for you" });
    await userEvent.click(
      await within(section).findByRole("button", { name: /2 message requests/ }),
    );
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "dm-requests",
      workspaceId: "ws-2",
    });
    await userEvent.click(within(section).getByRole("button", { name: /1 message request/ }));
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "dm-requests",
      workspaceId: null,
    });
  });

  it("lists join requests for a moderator of a workspace that can have a link", async () => {
    serve({}, SERVERS, {
      "query Server": (vars: Record<string, unknown>) => ({
        server: { id: vars.serverId, name: "x", viewerRole: ServerMemberRoleGql.OWNER },
      }),
      "query JoinRequestCount": (vars: Record<string, unknown>) =>
        vars.serverId === "ws-2"
          ? { joinRequests: { items: [{ id: "j1" }, { id: "j2" }], pageInfo: { hasNext: false } } }
          : { joinRequests: { items: [], pageInfo: { hasNext: false } } },
    } as never);
    renderHome();
    const row = await screen.findByRole("button", { name: /2 join requests/ });
    expect(row).toHaveTextContent("Beta");
    await userEvent.click(row);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "workspace-moderation",
    });
  });

  it("asks for no join requests of the default workspace or of a member", async () => {
    serverInfo.defaultWorkspace = "ws-2";
    serve({}, SERVERS, {
      "query Server": (vars: Record<string, unknown>) => ({
        server: {
          id: vars.serverId,
          name: "x",
          viewerRole:
            vars.serverId === "ws-1" ? ServerMemberRoleGql.MEMBER : ServerMemberRoleGql.OWNER,
        },
      }),
      "query JoinRequestCount": () => ({
        joinRequests: { items: [{ id: "j1" }], pageInfo: { hasNext: false } },
      }),
    } as never);
    renderHome();
    await screen.findByText("Nothing waiting.");
    expect(
      requestMock.mock.calls.filter(([doc]) => String(doc).includes("query JoinRequestCount")),
    ).toHaveLength(0);
  });

  it("counts unread per workspace and opens the workspace from its row", async () => {
    useUnreadStore.getState().setCounts("ws-1", { c1: 4, c2: 1 });
    useUnreadStore.getState().setCounts("ws-2", { c3: 1 });
    serve({});
    renderHome();
    const section = await screen.findByRole("region", { name: "Unread" });
    expect(await within(section).findByRole("button", { name: /Alpha/ })).toHaveTextContent(
      "5 unread in 2 conversations",
    );
    const beta = within(section).getByRole("button", { name: /Beta/ });
    expect(beta).toHaveTextContent("1 unread in 1 conversation");
    await userEvent.click(beta);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
  });

  it("limits every section to the workspace picked in the filter", async () => {
    useUnreadStore.getState().setCounts("ws-1", { c1: 4 });
    useUnreadStore.getState().setCounts("ws-2", { c3: 1 });
    serve({
      "ws-1": [mention("a", "ws-1", 3, "in alpha")],
      "ws-2": [mention("b", "ws-2", 2, "in beta")],
    });
    renderHome();
    await screen.findByText("in alpha");
    const all = screen.getByRole("button", { name: "All workspaces" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("in alpha")).not.toBeInTheDocument();
    expect(screen.getByText("in beta")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unread" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Unread" })).queryByRole("button", {
        name: /Alpha/,
      }),
    ).not.toBeInTheDocument();
  });

  it("has no filter with a single workspace", async () => {
    serve({}, SERVERS.slice(0, 1));
    renderHome();
    await screen.findByText("Nothing waiting.");
    expect(screen.queryByRole("button", { name: "All workspaces" })).not.toBeInTheDocument();
  });

  it("shows connected agents' newest runs, with their names made visible", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAgentRecordStore.setState({
      entries: [entry(10, { agentName: "Evil‮gnp.exe", runId: "r_1" })],
    });
    serve({});
    renderHome();
    const section = await screen.findByRole("region", { name: "Your agents' runs" });
    expect(section).toHaveTextContent("On this device, only you see these.");
    expect(section).not.toHaveTextContent("‮");
    expect(within(section).queryByText(/Running|Stop/)).not.toBeInTheDocument();
    expect(section).toHaveTextContent("1 read");
    await userEvent.click(within(section).getByRole("button", { name: "All runs" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "agents" });
    expect(runCommandFromClick).toHaveBeenLastCalledWith("workspace.open_agents");
  });

  it("opens a run in the run dialog", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAgentRecordStore.setState({ entries: [entry(10)] });
    serve({});
    renderHome();
    const section = await screen.findByRole("region", { name: "Your agents' runs" });
    await userEvent.click(within(section).getByRole("button", { name: /Claude Code/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("has no agents section without a connected agent or without agents in this app", async () => {
    serve({});
    renderHome();
    await screen.findByText("Nothing waiting.");
    expect(screen.queryByRole("region", { name: "Your agents' runs" })).not.toBeInTheDocument();
    act(() => useConnectedAgentsStore.setState({ agents: [AGENT] }));
    expect(await screen.findByRole("region", { name: "Your agents' runs" })).toBeInTheDocument();
    available.agent = false;
    act(() => useConnectedAgentsStore.setState({ agents: [AGENT, { ...AGENT, id: "a2" }] }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Your agents' runs" })).not.toBeInTheDocument(),
    );
  });

  it("leaves the navigation button to the top bar in a narrow window", async () => {
    serve({});
    renderHome();
    await screen.findByText("Nothing waiting.");
    act(() => useShellStore.setState({ shellWidth: "narrow" }));
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("keeps a bidirectional workspace name in its own direction", async () => {
    serve({ "ws-1": [mention("a", "ws-1", 3, "hello")] }, [
      { ...SERVERS[0], name: "Team ‮evil" },
      SERVERS[1],
    ]);
    renderHome();
    await screen.findByText("hello");
    const filter = screen.getByRole("group", { name: "Workspace" });
    expect(within(filter).getByRole("button", { name: /Team/ })).toBeInTheDocument();
  });
});

describe("HomePage: the way to Unreads", () => {
  it("offers See all unread with the total, which opens the page", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    serve({});
    useUnreadStore.getState().setCounts("ws-1", { a: 2 });
    useUnreadStore.getState().setCounts("ws-2", { b: 3 });
    renderHome();
    const row = await screen.findByRole("button", { name: /See all unread/ });
    expect(row).toHaveTextContent("5");
    await userEvent.setup().click(row);
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "unreads" });
    expect(runCommandFromClick).toHaveBeenLastCalledWith("workspace.open_unreads");
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
  });
});
