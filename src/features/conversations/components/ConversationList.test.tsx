import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  baseReadHandlers,
  callsTo,
  makeConversation,
  routeRequests,
} from "../__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../commands/hooks/useKeybindLabel", () => ({ useKeybindLabel: () => null }));
vi.mock("../../../core/events/usePrefetchMessages", () => ({ usePrefetchMessages: () => {} }));

import { ConversationList } from "./ConversationList";

const general = makeConversation({ id: "c-general", title: "general", memberCount: 12 });
const secret = makeConversation({ id: "c-secret", title: "secret", isPrivate: true });
const oldNews = makeConversation({ id: "c-old", title: "old-news", isArchived: true });
const random = makeConversation({
  id: "c-random",
  title: "random",
  isMember: false,
  memberCount: 7,
  topic: "Off-topic chatter",
});
const dm = makeConversation({
  id: "c-dm",
  title: null,
  conversationType: ConversationTypeEnum.DIRECT,
  memberIds: ["me", "u-alice"],
});

function page(items: unknown[]) {
  return { channels: { items, pageInfo: { hasNext: false, hasPrev: false } } };
}

/** The sidebar asks for joined channels; the browse dialog for the default (all visible) list. */
function serve(joined = [general, secret, oldNews], browse = [general, secret, random]) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Channels": (vars) => {
      const filter = vars.filter as { joinedOnly?: boolean } | undefined;
      return page(filter?.joinedOnly ? joined : browse);
    },
    "query InboxConversations": () => ({
      inboxConversations: { items: [dm], pageInfo: { hasNext: false, hasPrev: false } },
    }),
    "mutation JoinChannel": () => ({ joinChannel: { ...random, isMember: true, memberCount: 8 } }),
  });
}

function renderList() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ConversationList onNewChannel={vi.fn()} />
    </QueryClientProvider>,
  );
  return qc;
}

describe("ConversationList — channels sidebar", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
  });

  it("asks for joined channels including archived ones", async () => {
    serve();
    renderList();
    await screen.findByText("general");
    const joinedCalls = callsTo(requestMock, "query Channels");
    expect(joinedCalls[0]).toMatchObject({
      serverId: "ws-1",
      filter: { joinedOnly: true, includeArchived: true },
    });
  });

  it("lists joined channels with a lock for private ones and hides archived ones in a collapsed group", async () => {
    serve();
    renderList();

    const generalRow = (await screen.findByText("general")).closest("li")!;
    const secretRow = screen.getByText("secret").closest("li")!;
    expect(within(secretRow).getByRole("img", { name: "Private channel" })).toBeInTheDocument();
    expect(within(generalRow).queryByRole("img", { name: "Private channel" })).toBeNull();

    // Archived group is collapsed by default
    const toggle = screen.getByRole("button", { name: /archived \(1\)/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("old-news")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(screen.getByRole("list", { name: "Archived channels" })).getByText("old-news"),
    ).toBeInTheDocument();
  });

  it("omits the archived group when nothing is archived", async () => {
    serve([general]);
    renderList();
    await screen.findByText("general");
    expect(screen.queryByRole("button", { name: /archived/i })).not.toBeInTheDocument();
  });

  it("keeps the browse entry reachable when no channel is joined", async () => {
    serve([]);
    renderList();
    fireEvent.click(await screen.findByText(/no channels joined yet/i));
    expect(await screen.findByRole("dialog", { name: "Browse channels" })).toBeInTheDocument();
  });

  it("browse lists channels with member counts, joins one and navigates to it", async () => {
    serve();
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Browse channels" }));

    const dialog = await screen.findByRole("dialog", { name: "Browse channels" });
    const randomRow = await within(dialog).findByTestId("browse-channel-c-random");
    expect(within(randomRow).getByText(/7 members/)).toBeInTheDocument();
    expect(within(randomRow).getByText(/Off-topic chatter/)).toBeInTheDocument();
    // Joined channels offer Open instead of Join
    const generalRow = within(dialog).getByTestId("browse-channel-c-general");
    expect(within(generalRow).getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(within(generalRow).queryByRole("button", { name: /join/i })).toBeNull();

    fireEvent.click(within(randomRow).getByRole("button", { name: "Join random" }));

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-random"));
    expect(callsTo(requestMock, "mutation JoinChannel")).toEqual([
      { serverId: "ws-1", conversationId: "c-random" },
    ]);
    expect(screen.queryByRole("dialog", { name: "Browse channels" })).not.toBeInTheDocument();
    // The joined list is refetched so the channel lands in the sidebar.
    await waitFor(() =>
      expect(
        callsTo(requestMock, "query Channels").filter(
          (v) => (v.filter as { joinedOnly?: boolean }).joinedOnly,
        ).length,
      ).toBeGreaterThan(1),
    );
  });

  it("Open on a joined channel navigates without joining", async () => {
    serve();
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Browse channels" }));
    const dialog = await screen.findByRole("dialog", { name: "Browse channels" });
    const secretRow = await within(dialog).findByTestId("browse-channel-c-secret");
    fireEvent.click(within(secretRow).getByRole("button", { name: "Open" }));

    expect(useShellStore.getState().selectedConversationId).toBe("c-secret");
    expect(callsTo(requestMock, "mutation JoinChannel")).toHaveLength(0);
  });
});

describe("ConversationList — guest gate (Track 1.2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
  });

  function serveAs(role: ServerMemberRoleGql, joined = [general]) {
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
      "query Channels": () => page(joined),
      "query InboxConversations": () => ({
        inboxConversations: { items: [], pageInfo: { hasNext: false, hasPrev: false } },
      }),
    });
  }

  it("hides Browse channels and New channel from a guest", async () => {
    serveAs(ServerMemberRoleGql.GUEST);
    const qc = renderList();
    await screen.findByText("general");
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(screen.queryByRole("button", { name: "Browse channels" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New channel" })).not.toBeInTheDocument();
  });

  it("tells a guest with no channels that a member can add them, without a browse link", async () => {
    serveAs(ServerMemberRoleGql.GUEST, []);
    const qc = renderList();
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(
      await screen.findByText("No channels yet. A member can add you to one."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Browse channels/)).not.toBeInTheDocument();
  });

  it("keeps Browse channels and New channel for a member", async () => {
    serveAs(ServerMemberRoleGql.MEMBER);
    const qc = renderList();
    await screen.findByText("general");
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(screen.getByRole("button", { name: "Browse channels" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New channel" })).toBeInTheDocument();
  });
});
