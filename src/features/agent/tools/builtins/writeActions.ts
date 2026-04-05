import { gql } from "graphql-request";

import { registerTool } from "../registry";
import { graphqlClient } from "../../../../core/graphql/client";

const SEND_MESSAGE_MUTATION = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      id
      text
      sentAt
    }
  }
`;

const PIN_MESSAGE_MUTATION = gql`
  mutation PinMessage($input: PinMessageInput!) {
    pinMessage(input: $input)
  }
`;

const CREATE_CONVERSATION_MUTATION = gql`
  mutation CreateConversation($input: CreateConversationInput!) {
    createConversation(input: $input) {
      id
      title
    }
  }
`;

const TOGGLE_REACTION_MUTATION = gql`
  mutation ToggleReaction($input: ToggleReactionInput!) {
    toggleReaction(input: $input)
  }
`;

export function registerSendMessageTool(): void {
  registerTool(
    {
      name: "send_message",
      description:
        "Send a message to a channel or conversation on behalf of the user. " +
        "Use this when the user explicitly asks you to send or post a message.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
          conversation_id: { type: "string", description: "The channel or conversation ID to send the message to" },
          text: { type: "string", description: "The message text to send" },
        },
        required: ["workspace_id", "conversation_id", "text"],
      },
    },
    async (input) => {
      const result = await graphqlClient.request<{
        sendMessage: { id: string; text: string; sentAt: string };
      }>(SEND_MESSAGE_MUTATION, {
        input: {
          serverId: input.workspace_id as string,
          conversationId: input.conversation_id as string,
          text: input.text as string,
        },
      });
      return JSON.stringify({
        success: true,
        messageId: result.sendMessage.id,
        sentAt: result.sendMessage.sentAt,
      });
    },
    { sideEffect: true },
  );
}

export function registerPinMessageTool(): void {
  registerTool(
    {
      name: "pin_message",
      description:
        "Pin a message in a channel or conversation. " +
        "Use this when the user asks to pin a specific message.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
          conversation_id: { type: "string", description: "The channel or conversation ID" },
          message_id: { type: "string", description: "The ID of the message to pin" },
        },
        required: ["workspace_id", "conversation_id", "message_id"],
      },
    },
    async (input) => {
      await graphqlClient.request(PIN_MESSAGE_MUTATION, {
        input: {
          serverId: input.workspace_id as string,
          conversationId: input.conversation_id as string,
          messageId: input.message_id as string,
        },
      });
      return JSON.stringify({ success: true, pinned: input.message_id });
    },
    { sideEffect: true },
  );
}

export function registerCreateChannelTool(): void {
  registerTool(
    {
      name: "create_channel",
      description:
        "Create a new channel in the workspace. " +
        "Use this when the user asks to create a new channel.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
          name: { type: "string", description: "The name for the new channel" },
          description: { type: "string", description: "Optional description for the channel" },
        },
        required: ["workspace_id", "name"],
      },
    },
    async (input) => {
      const result = await graphqlClient.request<{
        createConversation: { id: string; title: string };
      }>(CREATE_CONVERSATION_MUTATION, {
        input: {
          serverId: input.workspace_id as string,
          title: input.name as string,
          description: (input.description as string) ?? "",
          conversationType: "Channel",
        },
      });
      return JSON.stringify({
        success: true,
        channelId: result.createConversation.id,
        name: result.createConversation.title,
      });
    },
    { sideEffect: true },
  );
}

export function registerAddReactionTool(): void {
  registerTool(
    {
      name: "add_reaction",
      description:
        "Add an emoji reaction to a message. " +
        "Use this when the user asks to react to a message.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
          conversation_id: { type: "string", description: "The channel or conversation ID" },
          message_id: { type: "string", description: "The ID of the message to react to" },
          emoji: { type: "string", description: "The emoji to add (e.g. a Unicode emoji or custom emoji name)" },
        },
        required: ["workspace_id", "conversation_id", "message_id", "emoji"],
      },
    },
    async (input) => {
      await graphqlClient.request(TOGGLE_REACTION_MUTATION, {
        input: {
          serverId: input.workspace_id as string,
          conversationId: input.conversation_id as string,
          messageId: input.message_id as string,
          emoji: input.emoji as string,
        },
      });
      return JSON.stringify({
        success: true,
        reacted: input.message_id,
        emoji: input.emoji,
      });
    },
    { sideEffect: true },
  );
}
