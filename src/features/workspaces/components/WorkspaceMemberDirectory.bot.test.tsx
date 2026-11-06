import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  currentUser,
  routeRequests,
  workspaceMembers,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { WorkspaceMemberDirectory } from "./WorkspaceMemberDirectory";

const members = [
  { ...workspaceMembers[0], memberRole: ServerMemberRoleGql.MODERATOR },
  { ...workspaceMembers[1], memberRole: ServerMemberRoleGql.MEMBER },
  {
    ...workspaceMembers[2],
    userId: "bot-1",
    username: "helper",
    displayName: "Helper",
    memberRole: ServerMemberRoleGql.GUEST,
    isBot: true,
    bot: {
      runBy: "the Halden Studio team",
      readsGoTo: "our own server, with a local model",
      addedByName: "Ivana",
    },
  },
];

async function renderDirectory() {
  routeRequests(requestMock, {
    "query ServerMembers": () => ({ serverMembers: members }),
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MODERATOR },
    }),
    "query Me": () => ({ me: currentUser }),
  });
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <WorkspaceMemberDirectory workspaceId="ws-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByTestId("directory-row-bot-1");
  await waitFor(() => {
    expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined();
    expect(qc.getQueryData(queryKeys.me)).toBeDefined();
  });
}

function menuItems() {
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((el) => el.textContent ?? "");
}

describe("WorkspaceMemberDirectory with a bot", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("marks the bot instead of showing its role, and a person is not marked", async () => {
    await renderDirectory();
    const bot = screen.getByTestId("directory-row-bot-1");
    expect(within(bot).getByTestId("bot-badge")).toHaveTextContent("Bot");
    expect(within(bot).queryByTestId("role-badge")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("directory-row-u-alice")).queryByTestId("bot-badge"),
    ).not.toBeInTheDocument();
  });

  it("offers a moderator no message, role change or block on a bot, and keeps kick and ban", async () => {
    await renderDirectory();
    fireEvent.contextMenu(screen.getByTestId("directory-row-bot-1"));
    expect(menuItems()).toEqual(["View profile", "Time out", "Kick…", "Ban…"]);
  });

  it("opens the bot's disclosure from the keyboard through View profile", async () => {
    await renderDirectory();
    fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Helper" }), {
      key: "ContextMenu",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "View profile" }));
    expect(await screen.findByText("the Halden Studio team")).toBeInTheDocument();
    expect(screen.getByText("our own server, with a local model")).toBeInTheDocument();
    expect(screen.getByText("Ivana")).toBeInTheDocument();
    expect(
      screen.getByText("This is what the person who added it says. RIM can't check it."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send DM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Block/ })).not.toBeInTheDocument();
  });
});
