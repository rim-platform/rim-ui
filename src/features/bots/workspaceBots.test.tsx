import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../core/graphql/generated/schema-types";
import { createTestQueryClient } from "../../test/utils";
import type { ServerMember } from "../workspaces/api/useServerMembers";

const host = vi.hoisted(() => ({ disclosure: true }));
vi.mock("../updater/hooks/useSpaceHasCapability", () => ({
  useSpaceHasCapability: () => host.disclosure,
}));
const members = vi.hoisted(() => ({ data: [] as ServerMember[] }));
vi.mock("../workspaces/api/useServerMembers", () => ({
  useServerMembers: (serverId?: string) => ({ data: serverId ? members.data : undefined }),
}));
const role = vi.hoisted(() => ({ moderates: false }));
vi.mock("../workspaces/api/useMyServerRole", () => ({
  useCanModerate: () => role.moderates,
}));
const channel = vi.hoisted(() => ({
  conversation: null as null | {
    id: string;
    conversationType: string;
    memberIds: string[];
    encryptedAt: string | null;
  },
}));
vi.mock("../conversations/api/useConversation", () => ({
  useConversation: () => ({ data: channel.conversation ?? undefined }),
}));

import { useRelayStore } from "../relay/state/useRelayStore";
import { useShellStore } from "../../shell/state/useShellStore";
import { useConnectedAgentsStore } from "../agents/state/useConnectedAgentsStore";
import { botsInChannel, useWorkspaceBots, type WorkspaceBot } from "./hooks/useWorkspaceBots";
import { WorkspaceBotsSection } from "./components/WorkspaceBotsSection";
import { ChannelBotsPanel } from "./components/ChannelBotsPanel";

function bot(userId: string, name: string, overrides: Partial<ServerMember> = {}): ServerMember {
  return {
    userId,
    username: name.toLowerCase().replace(/ /g, "-"),
    displayName: name,
    memberRole: ServerMemberRoleGql.GUEST,
    joinedAt: "2026-11-01T10:00:00Z",
    avatarUrl: null,
    statusText: null,
    bio: null,
    isBot: true,
    bot: { runBy: `${name}'s owner`, readsGoTo: "A local model", addedByName: "Ada" },
    ...overrides,
  };
}

function person(userId: string, name: string): ServerMember {
  return { ...bot(userId, name), isBot: false, bot: null };
}

const RELEASE = bot("b-release", "Release Helper");
const DOCS = bot("b-docs", "Docs Helper");

function channelWith(memberIds: string[], encryptedAt: string | null = null) {
  return {
    id: "c-dev",
    conversationType: ConversationTypeEnum.CHANNEL,
    memberIds,
    encryptedAt,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

/** The sentence every place that shows a bot's disclosure ends with. */
const CANT_CHECK = "This is what the person who added it says. RIM can't check it.";

beforeEach(() => {
  host.disclosure = true;
  role.moderates = false;
  members.data = [person("u-ada", "Ada"), RELEASE, DOCS];
  channel.conversation = channelWith(["u-ada", "b-release"]);
  useRelayStore.setState({ info: null, spaces: {} });
  useShellStore.getState().reset();
  useConnectedAgentsStore.setState({ agents: [] });
});

afterEach(() => {
  useConnectedAgentsStore.setState({ agents: [] });
});

describe("useWorkspaceBots", () => {
  it("lists the workspace's bots by name, and no person", () => {
    const { result } = renderHook(() => useWorkspaceBots("ws-1"), { wrapper: Providers });
    expect(result.current.map((b) => b.displayName)).toEqual(["Docs Helper", "Release Helper"]);
  });

  it("lists nothing where the host does not list bot_disclosure", () => {
    host.disclosure = false;
    const { result } = renderHook(() => useWorkspaceBots("ws-1"), { wrapper: Providers });
    expect(result.current).toEqual([]);
  });

  it("lists nothing from an older host's member list, which marks no bot", () => {
    members.data = members.data.map(({ isBot: _isBot, bot: _bot, ...rest }) => rest);
    const { result } = renderHook(() => useWorkspaceBots("ws-1"), { wrapper: Providers });
    expect(result.current).toEqual([]);
  });

  it("lists nothing in the direct space", () => {
    useRelayStore.setState({ info: { directSpaceId: "ws-1" } as never });
    const { result } = renderHook(() => useWorkspaceBots("ws-1"), { wrapper: Providers });
    expect(result.current).toEqual([]);
  });
});

describe("botsInChannel", () => {
  const bots = [RELEASE, DOCS] as WorkspaceBot[];

  it("counts the active bots that are members of the channel", () => {
    expect(botsInChannel(bots, channelWith(["u-ada", "b-release"])).map((b) => b.userId)).toEqual([
      "b-release",
    ]);
    expect(botsInChannel(bots, channelWith(["b-release", "b-docs"]))).toHaveLength(2);
  });

  it("leaves out a deactivated bot, which is no longer in the member list", () => {
    // A deactivated bot has left the workspace; its id may still be in an old member list.
    expect(botsInChannel([DOCS] as WorkspaceBot[], channelWith(["b-release", "b-docs"]))).toEqual([
      DOCS,
    ]);
  });

  it("counts none in an encrypted channel, a group or a direct message", () => {
    expect(botsInChannel(bots, channelWith(["b-release"], "2026-11-01T00:00:00Z"))).toEqual([]);
    expect(
      botsInChannel(bots, {
        ...channelWith(["b-release"]),
        conversationType: ConversationTypeEnum.GROUP,
      }),
    ).toEqual([]);
  });
});

describe("the Bots section of the conversation list", () => {
  it("lists each active bot by name, marked as a bot", () => {
    render(<WorkspaceBotsSection workspaceId="ws-1" />, { wrapper: Providers });
    const list = screen.getByRole("list", { name: "Bots" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Docs HelperBot", "Release HelperBot"]);
  });

  it("is hidden while the workspace has no active bot, and on an older host", () => {
    members.data = [person("u-ada", "Ada")];
    const { unmount } = render(<WorkspaceBotsSection workspaceId="ws-1" />, { wrapper: Providers });
    expect(screen.queryByRole("heading", { name: "Bots" })).not.toBeInTheDocument();
    unmount();

    members.data = [RELEASE];
    host.disclosure = false;
    render(<WorkspaceBotsSection workspaceId="ws-1" />, { wrapper: Providers });
    expect(screen.queryByRole("heading", { name: "Bots" })).not.toBeInTheDocument();
  });

  it("opens a bot's card as a dialog from the keyboard, and Escape gives focus back", async () => {
    const user = userEvent.setup();
    render(<WorkspaceBotsSection workspaceId="ws-1" />, { wrapper: Providers });
    await user.tab();
    const docs = screen.getByRole("button", { name: /Docs Helper/ });
    expect(docs).toHaveFocus();
    await user.keyboard("{Enter}");
    const card = screen.getByRole("dialog", { name: "Docs Helper" });
    expect(within(card).getByTestId("bot-disclosure")).toHaveTextContent(
      "Who runs itDocs Helper's ownerWhere what it reads goesA local modelAdded byAda" + CANT_CHECK,
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(docs).toHaveFocus();
  });
});

describe("Bots in this channel", () => {
  function renderPanel() {
    return render(
      <ChannelBotsPanel workspaceId="ws-1" conversationId="c-dev" onClose={vi.fn()} />,
      {
        wrapper: Providers,
      },
    );
  }

  it("shows each bot in the channel with what its adder says, word for word", () => {
    renderPanel();
    const panel = screen.getByRole("region", { name: "Bots in this channel" });
    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Release HelperBot");
    expect(within(items[0]).getByText("Who runs it")).toBeInTheDocument();
    expect(within(items[0]).getByText("Release Helper's owner")).toBeInTheDocument();
    expect(within(items[0]).getByText("Where what it reads goes")).toBeInTheDocument();
    expect(within(items[0]).getByText("A local model")).toBeInTheDocument();
    expect(within(items[0]).getByText("Added by")).toBeInTheDocument();
    expect(within(items[0]).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]).getByText(CANT_CHECK)).toBeInTheDocument();
  });

  it("names someone no longer here as the adder who left", () => {
    members.data = [
      bot("b-release", "Release Helper", {
        bot: { runBy: "x", readsGoTo: "y", addedByName: null },
      }),
    ];
    renderPanel();
    expect(screen.getByText("someone no longer here")).toBeInTheDocument();
  });

  it("links an Owner or Moderator to Settings > Bots, and nobody else", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPanel();
    expect(screen.queryByRole("button", { name: /Settings > Bots/ })).not.toBeInTheDocument();
    unmount();

    role.moderates = true;
    renderPanel();
    await user.click(
      screen.getByRole("button", { name: "Manage bots in Settings > Bots & webhooks" }),
    );
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "bots" });
  });

  it("says which of your agents may read the channel, and where to change it", async () => {
    const user = userEvent.setup();
    act(() =>
      useConnectedAgentsStore.setState({
        agents: [
          {
            id: "a-1",
            name: "Claude Code",
            tokenHash: "h",
            pairedAt: "2026-11-05T00:00:00Z",
            grants: { "ws-1": { all: false, channelIds: ["c-dev"] } },
            pluginApprovals: {},
          },
          {
            id: "a-2",
            name: "Other Agent",
            tokenHash: "h2",
            pairedAt: "2026-11-05T00:00:00Z",
            grants: { "ws-1": { all: false, channelIds: ["c-other"] } },
            pluginApprovals: {},
          },
        ],
      }),
    );
    renderPanel();
    expect(screen.getByRole("heading", { name: "Your agents" })).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.queryByText("Other Agent")).not.toBeInTheDocument();
    expect(screen.getByText("You let it read this channel.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change this in Settings > Agents" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "agents" });
  });

  it("has no Your agents part when no agent's grant covers the channel", () => {
    renderPanel();
    expect(screen.queryByRole("heading", { name: "Your agents" })).not.toBeInTheDocument();
  });

  it("says there is no bot in an encrypted channel", () => {
    channel.conversation = channelWith(["b-release"], "2026-11-01T00:00:00Z");
    renderPanel();
    expect(screen.getByText("No bots in this channel.")).toBeInTheDocument();
  });
});
