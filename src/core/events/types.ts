export interface MessageEventData {
  id: string;
  server_id: string;
  conversation_id: string;
  thread_id: string | null;
  root_thread_id: string | null;
  author_id: string;
  text: string | null;
  has_attachments: boolean;
  parent_message_id: string | null;
  is_deleted: boolean;
  sent_at: string;
  reactions: ReactionGroupData[];
}

export interface ReactionGroupData {
  emoji: string;
  count: number;
}

export type WorkspaceEvent =
  | {
      type: "NewMessage";
      workspace_id: string;
      conversation_id: string;
      message: MessageEventData;
    }
  | {
      type: "MessageUpdated";
      workspace_id: string;
      conversation_id: string;
      message: MessageEventData;
    }
  | {
      type: "MessageDeleted";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
      thread_id: string | null;
    }
  | {
      type: "ReactionsUpdated";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
      reactions: ReactionGroupData[];
    }
  | {
      type: "ConversationCreated";
      workspace_id: string;
      conversation_id: string;
      title: string | null;
      conversation_type: string;
    }
  | {
      type: "MemberJoined";
      workspace_id: string;
      user_id: string;
      username: string;
    }
  | {
      type: "ThreadCreated";
      workspace_id: string;
      conversation_id: string;
      thread_id: string;
      root_message_id: string;
    }
  | {
      type: "ReadStateUpdated";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
      last_read_at: string;
    }
  | {
      type: "PresenceChanged";
      workspace_id: string;
      user_id: string;
      status: string;
    }
  | {
      type: "MemberAddedToConversation";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
    }
  | {
      type: "MemberRemovedFromConversation";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
    }
  | {
      type: "TypingStarted";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
      username: string;
    }
  | {
      type: "MessagePinned";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
    }
  | {
      type: "MessageUnpinned";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
    }
  | {
      type: "UserMentioned";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
      mentioned_by: string;
    }
  | {
      type: "LinkPreviewReady";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
    };
