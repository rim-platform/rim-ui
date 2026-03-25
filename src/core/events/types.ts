export interface MessageEventData {
  id: string;
  conversation_id: string;
  author_id: string;
  text: string | null;
  sent_at: string;
  is_deleted: boolean;
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
    };
