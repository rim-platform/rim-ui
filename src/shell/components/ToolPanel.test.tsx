import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

// Mock feature dependencies
vi.mock("../../features/conversations/components/ConversationList", () => ({
  ConversationList: () => <div data-testid="conversation-list">ConversationList</div>,
}));

vi.mock("../../features/conversations/components/NewChannelDialog", () => ({
  NewChannelDialog: () => <div data-testid="new-channel-dialog">NewChannelDialog</div>,
}));

vi.mock("../../features/conversations/components/NewMessagePicker", () => ({
  NewMessagePicker: ({ open }: { open: boolean }) =>
    open ? <div data-testid="new-message-picker">NewMessagePicker</div> : null,
}));

vi.mock("../../features/conversations/components/ConversationMembersPanel", () => ({
  ConversationMembersPanel: ({
    conversationId,
    onClose,
  }: {
    conversationId: string;
    onClose: () => void;
  }) => (
    <div data-testid="members-panel">
      {conversationId}
      <button type="button" onClick={onClose}>
        Close members
      </button>
    </div>
  ),
}));

const roleGate = { isGuest: false };
vi.mock("../../features/workspaces/api/useMyServerRole", () => ({
  useIsGuest: () => roleGate.isGuest,
}));

vi.mock("../../features/workspaces/components/WorkspaceMemberDirectory", () => ({
  WorkspaceMemberDirectory: ({
    workspaceId,
    onClose,
  }: {
    workspaceId: string;
    onClose: () => void;
  }) => (
    <div data-testid="member-directory">
      {workspaceId}
      <button type="button" onClick={onClose}>
        Close directory
      </button>
    </div>
  ),
}));

vi.mock("../../features/notifications/components/NotificationsPanel", () => ({
  NotificationsPanel: () => <div data-testid="notifications-panel" />,
}));

vi.mock("../../features/commands/runtime/runFromClick", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../features/commands/runtime/runFromClick")>();
  return { ...actual, runCommandFromClick: vi.fn(actual.runCommandFromClick) };
});

import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useShellStore } from "../state/useShellStore";
import { useNotificationsPanelStore } from "../../features/notifications/state/useNotificationsPanelStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { ToolPanel } from "./ToolPanel";
import userEvent from "@testing-library/user-event";
import { expectReachableByKeyboard } from "../../test/keyboard";

describe("ToolPanel", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
    useMembersPanelStore.setState({ open: false });
    useMemberDirectoryStore.setState({ open: false });
    useNotificationsPanelStore.setState({ open: false });
    useWorkspaceStore.setState({ workspaceId: null });
    roleGate.isGuest = false;
    vi.mocked(runCommandFromClick).mockClear();
  });

  it("keeps the members panel while the notification inbox is open under the top bar", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox", selectedConversationId: "c-1" });
    useMembersPanelStore.setState({ open: true });
    useNotificationsPanelStore.setState({ open: true });
    render(<ToolPanel />);
    expect(screen.queryByTestId("notifications-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("members-panel")).toHaveTextContent("c-1");
  });

  it("renders with 'Conversations' heading when inbox panel is active", () => {
    useShellStore.setState({ activePanel: "inbox" });
    render(<ToolPanel />);
    expect(screen.getByText("Conversations")).toBeInTheDocument();
  });

  it("shows ConversationList when inbox is active", () => {
    useShellStore.setState({ activePanel: "inbox" });
    render(<ToolPanel />);
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
  });

  it("shows new message button only in inbox panel", () => {
    useShellStore.setState({ activePanel: "inbox" });
    render(<ToolPanel />);
    expect(screen.getByLabelText("New message")).toBeInTheDocument();
  });

  it("shows the open conversation's members panel instead of the list when toggled", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox", selectedConversationId: "conv-1" });
    useMembersPanelStore.setState({ open: true });
    render(<ToolPanel />);
    expect(screen.getByTestId("members-panel")).toHaveTextContent("conv-1");
    expect(screen.queryByTestId("conversation-list")).not.toBeInTheDocument();
  });

  it("falls back to the list when no conversation is open", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox", selectedConversationId: null });
    useMembersPanelStore.setState({ open: true });
    render(<ToolPanel />);
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
  });

  it("opens the workspace member directory from the header", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox" });
    render(<ToolPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Workspace members" }));
    expect(screen.getByTestId("member-directory")).toHaveTextContent("ws-1");
    expect(screen.queryByTestId("conversation-list")).not.toBeInTheDocument();
  });

  it("offers no member directory to a guest", () => {
    roleGate.isGuest = true;
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox" });
    useMemberDirectoryStore.setState({ open: true });
    render(<ToolPanel />);
    expect(screen.queryByRole("button", { name: "Workspace members" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-directory")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
  });

  it("reaches the panel's actions by keyboard and opens a new message with Enter", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox" });
    const user = userEvent.setup();
    render(<ToolPanel />);
    const members = screen.getByRole("button", { name: "Workspace members" });
    const newMessage = screen.getByRole("button", { name: "New message" });
    await expectReachableByKeyboard(user, [members, newMessage]);
    newMessage.focus();
    await user.keyboard("{Enter}");
    expect(useShellStore.getState().showNewMessagePicker).toBe(true);
  });

  it("runs its buttons and its panels' close buttons through the commands that show the panels", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox", selectedConversationId: "c-1" });
    render(<ToolPanel />);

    await user.click(screen.getByRole("button", { name: "Workspace members" }));
    expect(useMemberDirectoryStore.getState().open).toBe(true);
    await user.click(screen.getByRole("button", { name: "Close directory" }));
    expect(useMemberDirectoryStore.getState().open).toBe(false);
    await user.click(screen.getByRole("button", { name: "New message" }));
    expect(useShellStore.getState().showNewMessagePicker).toBe(true);
    act(() => useMembersPanelStore.setState({ open: true }));
    await user.click(screen.getByRole("button", { name: "Close members" }));
    expect(useMembersPanelStore.getState().open).toBe(false);

    expect(vi.mocked(runCommandFromClick).mock.calls).toEqual([
      ["workspace.toggle_member_directory"],
      ["workspace.toggle_member_directory"],
      ["chat.create_group"],
      ["workspace.toggle_conversation_members"],
    ]);
  });
});
