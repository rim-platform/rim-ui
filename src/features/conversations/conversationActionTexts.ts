/** What a conversation action's confirmation dialog says. */
export interface ConversationActionConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
}

/** The confirmation before archiving the channel `label` names. */
export function archiveConfirmation(label: string): ConversationActionConfirmation {
  return {
    title: `Archive ${label}?`,
    description:
      "Archived channels are read-only for everyone: no new messages, reactions or pins. They stay readable and searchable, and an owner or moderator can unarchive them later.",
    confirmLabel: "Archive",
  };
}

/** The confirmation before leaving the conversation `label` names. */
export function leaveConfirmation(label: string): ConversationActionConfirmation {
  return {
    title: `Leave ${label}?`,
    description: "You will need an invite from a member to rejoin.",
    confirmLabel: "Leave",
  };
}
