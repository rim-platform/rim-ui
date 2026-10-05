import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
  ConversationMembersPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="members-panel">{conversationId}</div>
  ),
}));

const roleGate = { isGuest: false };
vi.mock("../../features/workspaces/api/useMyServerRole", () => ({
  useIsGuest: () => roleGate.isGuest,
}));

vi.mock("../../features/workspaces/components/WorkspaceMemberDirectory", () => ({
  WorkspaceMemberDirectory: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="member-directory">{workspaceId}</div>
  ),
}));

vi.mock("../../features/plugins/components/PluginToolPanel", () => ({
  PluginToolPanel: () => <div data-testid="plugin-tool-panel">PluginToolPanel</div>,
}));

vi.mock("../../features/notifications/components/NotificationsPanel", () => ({
  NotificationsPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="notifications-panel">{workspaceId}</div>
  ),
}));

import { useShellStore } from "../state/useShellStore";
import { useNotificationsPanelStore } from "../../features/notifications/state/useNotificationsPanelStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { ToolPanel } from "./ToolPanel";

describe("ToolPanel", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
    useMembersPanelStore.setState({ open: false });
    useMemberDirectoryStore.setState({ open: false });
    useNotificationsPanelStore.setState({ open: false });
    useWorkspaceStore.setState({ workspaceId: null });
    roleGate.isGuest = false;
  });

  it("shows the notification inbox over the members panel while it is open", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ activePanel: "inbox", selectedConversationId: "c-1" });
    useMembersPanelStore.setState({ open: true });
    useNotificationsPanelStore.setState({ open: true });
    render(<ToolPanel />);
    expect(screen.getByTestId("notifications-panel")).toHaveTextContent("ws-1");
    expect(screen.queryByTestId("members-panel")).not.toBeInTheDocument();
  });

  it("renders with 'Conversations' heading when inbox panel is active", () => {
    useShellStore.setState({ activePanel: "inbox" });
    render(<ToolPanel />);
    expect(screen.getByText("Conversations")).toBeInTheDocument();
  });

  it("renders with 'Plugins' heading when plugins panel is active", () => {
    useShellStore.setState({ activePanel: "plugins" });
    render(<ToolPanel />);
    expect(screen.getByText("Plugins")).toBeInTheDocument();
  });

  it("shows ConversationList when inbox is active", () => {
    useShellStore.setState({ activePanel: "inbox" });
    render(<ToolPanel />);
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
  });

  it("shows PluginToolPanel when plugins is active", () => {
    useShellStore.setState({ activePanel: "plugins" });
    render(<ToolPanel />);
    expect(screen.getByTestId("plugin-tool-panel")).toBeInTheDocument();
  });

  it("shows new message button only in inbox panel", () => {
    useShellStore.setState({ activePanel: "inbox" });
    render(<ToolPanel />);
    expect(screen.getByLabelText("New message")).toBeInTheDocument();
  });

  it("does not show new message button in plugins panel", () => {
    useShellStore.setState({ activePanel: "plugins" });
    render(<ToolPanel />);
    expect(screen.queryByLabelText("New message")).not.toBeInTheDocument();
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
});
