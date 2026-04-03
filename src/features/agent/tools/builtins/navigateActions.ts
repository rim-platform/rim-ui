import { registerTool } from "../registry";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";

export function registerNavigateToChannelTool(): void {
  registerTool(
    {
      name: "navigate_to_channel",
      description:
        "Switch the user's view to a specific channel/conversation. " +
        "Use this when the user asks to go to, open, or switch to a channel.",
      input_schema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "The channel/conversation ID to navigate to" },
        },
        required: ["conversation_id"],
      },
    },
    async (input) => {
      const conversationId = input.conversation_id as string;
      useShellStore.getState().setSelectedConversationId(conversationId);
      useShellStore.getState().setMainSurface({ kind: "conversation" });
      return JSON.stringify({ success: true, navigatedTo: conversationId });
    },
    { sideEffect: true },
  );
}

export function registerOpenThreadTool(): void {
  registerTool(
    {
      name: "open_thread",
      description:
        "Open a thread panel for a specific root message. " +
        "Use this when the user asks to see or open a thread.",
      input_schema: {
        type: "object",
        properties: {
          root_message_id: { type: "string", description: "The ID of the root message that started the thread" },
        },
        required: ["root_message_id"],
      },
    },
    async (input) => {
      const rootMessageId = input.root_message_id as string;
      useShellStore.getState().openThreadForMessage(rootMessageId);
      return JSON.stringify({ success: true, threadOpened: rootMessageId });
    },
    { sideEffect: true },
  );
}

export function registerSwitchWorkspaceTool(): void {
  registerTool(
    {
      name: "switch_workspace",
      description:
        "Switch to a different workspace/server. " +
        "Use this when the user asks to go to another workspace.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID to switch to" },
        },
        required: ["workspace_id"],
      },
    },
    async (input) => {
      const workspaceId = input.workspace_id as string;
      useWorkspaceStore.getState().setWorkspaceId(workspaceId);
      return JSON.stringify({ success: true, switchedTo: workspaceId });
    },
    { sideEffect: true },
  );
}

export function registerOpenSettingsTool(): void {
  registerTool(
    {
      name: "open_settings",
      description:
        "Open the application settings page. " +
        "Use this when the user asks to open, show, or go to settings.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    async () => {
      useShellStore.getState().setMainSurface({ kind: "settings" });
      return JSON.stringify({ success: true, opened: "settings" });
    },
    { sideEffect: true },
  );
}
