import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { createTestQueryClient } from "../../test/utils";
import { expectReachableByKeyboard } from "../../test/keyboard";
import { queryKeys } from "../../core/query/keys";
import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";

const requestMock = vi.fn();

vi.mock("../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

// Child surfaces with their own data needs — stubbed so only the header is exercised.
vi.mock("../../features/lenses/components/LensPicker", () => ({ LensPicker: () => null }));
vi.mock("../../features/settings/components/InviteDialog", () => ({ InviteDialog: () => null }));
vi.mock("../../features/commands/hooks/useKeybindLabel", () => ({
  useKeybindLabel: () => null,
}));

import { ConversationHeader } from "./ConversationHeader";
import {
  emptyInbox,
  makeConversation,
} from "../../features/conversations/__fixtures__/conversations";
import type { ConversationSummary } from "../../features/conversations/types";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useE2eeStore } from "../../features/e2ee/state/useE2eeStore";

function renderHeader() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ConversationHeader />
    </QueryClientProvider>,
  );
  return qc;
}

describe("ConversationHeader — keyboard", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("reaches the conversation actions by keyboard", async () => {
    const user = userEvent.setup();
    renderHeader();
    await expectReachableByKeyboard(user, [
      screen.getByRole("button", { name: "Invite member" }),
      screen.getByRole("button", { name: /^Search in/ }),
    ]);
  });
});

function serveConversation(conversation: ConversationSummary) {
  requestMock.mockImplementation((document: string) => {
    if (document.includes("query Conversation(")) {
      return Promise.resolve({ conversation });
    }
    if (document.includes("query InboxConversations")) return Promise.resolve(emptyInbox);
    return new Promise(() => {});
  });
}

describe("ConversationHeader — channel privacy, members and menu", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useMembersPanelStore.setState({ open: false });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("shows a lock and the member count for a private channel; the count opens the members panel", async () => {
    serveConversation(makeConversation({ title: "secret", isPrivate: true, memberCount: 3 }));
    renderHeader();

    expect(await screen.findByRole("img", { name: "Private channel" })).toBeInTheDocument();
    const count = screen.getByRole("button", { name: "3 members" });
    fireEvent.click(count);
    expect(useMembersPanelStore.getState().open).toBe(true);
    expect(screen.getByRole("button", { name: "Conversation menu" })).toBeInTheDocument();
  });

  it("marks an archived channel", async () => {
    serveConversation(makeConversation({ isArchived: true }));
    renderHeader();
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Private channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not encrypted" })).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — unencrypted conversation", () => {
  beforeEach(() => {
    requestMock.mockReset();
    localStorage.clear();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useE2eeStore.setState({ webEncryption: "ready", notReady: { "conv-1": ["Bob"] } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useAuthStore.setState({ session: null });
    useE2eeStore.setState({ webEncryption: "checking", notReady: {} });
  });

  it("marks a DM that is not encrypted and reopens its dialog from the mark", async () => {
    serveConversation(
      makeConversation({
        title: null,
        conversationType: ConversationTypeEnum.DIRECT,
        memberIds: ["me", "u-bob"],
        memberCount: 2,
      }),
    );
    renderHeader();

    fireEvent.click(await screen.findByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("button", { name: "Not encrypted" }));
    expect(
      screen.getByRole("dialog", { name: "This conversation is not encrypted" }),
    ).toHaveTextContent("Bob has not set up encryption on a desktop device yet.");
  });
});

describe("ConversationHeader — guest gate (Track 1.2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it.each([
    [ServerMemberRoleGql.GUEST, false],
    [ServerMemberRoleGql.MEMBER, true],
  ])("viewer %s: Invite member shown = %s", async (role, shown) => {
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query Server(")) {
        return Promise.resolve({ server: { id: "srv-1", name: "Acme", viewerRole: role } });
      }
      return new Promise(() => {});
    });
    const qc = renderHeader();
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("srv-1"))).toBeDefined());
    if (shown) {
      expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
    }
  });
});

describe("ConversationHeader — draft DM", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query Server(")) {
        return Promise.resolve({
          server: { id: "srv-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
        });
      }
      if (document.includes("query ServerMembers")) {
        return Promise.resolve({
          serverMembers: [{ userId: "u-bob", username: "bob", displayName: "Bob" }],
        });
      }
      return new Promise(() => {});
    });
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.getState().openDraftDirect({ workspaceId: "srv-1", otherUserId: "u-bob" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("names the person and the workspace, with no conversation actions", async () => {
    renderHeader();
    expect(await screen.findByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Search in/ })).not.toBeInTheDocument();
  });
});
