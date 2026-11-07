import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { createTestQueryClient } from "../../test/utils";
import { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";
import type { ServerMember } from "../../features/workspaces/api/useServerMembers";
import {
  makeConversation,
  emptyInbox,
} from "../../features/conversations/__fixtures__/conversations";
import type { ConversationSummary } from "../../features/conversations/types";

const requestMock = vi.fn();
vi.mock("../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../features/lenses/components/LensPicker", () => ({ LensPicker: () => null }));
vi.mock("../../features/settings/components/InviteDialog", () => ({ InviteDialog: () => null }));
vi.mock("../../features/commands/hooks/useKeybindLabel", () => ({ useKeybindLabel: () => null }));

const bots = vi.hoisted(() => ({ list: [] as ServerMember[] }));
vi.mock("../../features/bots/hooks/useWorkspaceBots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/bots/hooks/useWorkspaceBots")>()),
  useWorkspaceBots: () => bots.list,
}));

import { ConversationHeader } from "./ConversationHeader";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useConnectedAgentsStore } from "../../features/agents/state/useConnectedAgentsStore";
import { useShellStore } from "../state/useShellStore";

function botMember(userId: string, name: string): ServerMember {
  return {
    userId,
    username: name,
    displayName: name,
    memberRole: ServerMemberRoleGql.GUEST,
    joinedAt: "2026-11-01T10:00:00Z",
    avatarUrl: null,
    statusText: null,
    bio: null,
    isBot: true,
    bot: { runBy: "Ada", readsGoTo: "A local model", addedByName: "Ada" },
  };
}

function serve(conversation: ConversationSummary) {
  requestMock.mockImplementation((document: string) => {
    if (document.includes("query ServerInfo")) {
      return Promise.resolve({
        serverInfo: { version: "0.0.0", apiVersion: 1, features: [], capabilities: [] },
      });
    }
    if (document.includes("query Conversation(")) return Promise.resolve({ conversation });
    if (document.includes("query InboxConversations")) return Promise.resolve(emptyInbox);
    return new Promise(() => {});
  });
}

function renderHeader() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ConversationHeader />
    </QueryClientProvider>,
  );
}

const devChannel = (memberIds: string[], encryptedAt: string | null = null) =>
  makeConversation({ id: "conv-1", title: "development", memberIds, encryptedAt });

beforeEach(() => {
  requestMock.mockReset();
  bots.list = [botMember("b-1", "Release Helper"), botMember("b-2", "Docs Helper")];
  useWorkspaceStore.setState({ workspaceId: "srv-1" });
  useShellStore.getState().reset();
  useShellStore.setState({ selectedConversationId: "conv-1" });
  useConnectedAgentsStore.setState({ agents: [] });
});

afterEach(() => {
  useWorkspaceStore.setState({ workspaceId: null });
  useShellStore.getState().reset();
  useConnectedAgentsStore.setState({ agents: [] });
});

describe("ConversationHeader — bots in a channel", () => {
  it("counts the bots that are members after the topic, and opens Bots in this channel", async () => {
    const user = userEvent.setup();
    serve(devChannel(["u-1", "b-1", "b-2"]));
    renderHeader();
    const count = await screen.findByRole("button", { name: "2 bots" });
    expect(count).toHaveAttribute("aria-expanded", "false");
    await user.click(count);
    expect(useShellStore.getState().botsPanelOpen).toBe(true);
    expect(count).toHaveAttribute("aria-expanded", "true");
    await user.click(count);
    expect(useShellStore.getState().botsPanelOpen).toBe(false);
  });

  it("says 1 bot for one", async () => {
    serve(devChannel(["u-1", "b-1"]));
    renderHeader();
    expect(await screen.findByRole("button", { name: "1 bot" })).toBeInTheDocument();
  });

  it("counts no bot in an encrypted channel", async () => {
    serve(devChannel(["u-1", "b-1"], "2026-11-01T00:00:00Z"));
    renderHeader();
    await screen.findByText("development");
    expect(screen.queryByRole("button", { name: /bots?$/ })).not.toBeInTheDocument();
  });

  it("says your agent can read this when a connected agent's grant covers the channel", async () => {
    const user = userEvent.setup();
    useConnectedAgentsStore.setState({
      agents: [
        {
          id: "a-1",
          name: "Claude Code",
          tokenHash: "h",
          pairedAt: "2026-11-05T00:00:00Z",
          grants: { "srv-1": { all: true, channelIds: [] } },
          pluginApprovals: {},
        },
      ],
    });
    serve(devChannel(["u-1"]));
    renderHeader();
    const agent = await screen.findByRole("button", { name: "your agent can read this" });
    expect(screen.queryByRole("button", { name: /bots?$/ })).not.toBeInTheDocument();
    await user.click(agent);
    expect(useShellStore.getState().botsPanelOpen).toBe(true);
  });
});
