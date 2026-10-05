import { Hash, Lock, MessageCircle, Users } from "lucide-react";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "../types";

interface ChannelIconProps {
  conversation: Pick<ConversationSummary, "conversationType" | "isPrivate">;
  className?: string;
}

/** `#` for public channels, a lock for private ones, and the DM/group glyphs otherwise. */
export function ChannelIcon({ conversation, className }: ChannelIconProps) {
  switch (conversation.conversationType) {
    case ConversationTypeEnum.DIRECT:
      return <MessageCircle className={className} aria-hidden="true" />;
    case ConversationTypeEnum.GROUP:
      return <Users className={className} aria-hidden="true" />;
    default:
      return conversation.isPrivate ? (
        <Lock className={className} aria-label="Private channel" role="img" />
      ) : (
        <Hash className={className} aria-hidden="true" />
      );
  }
}
