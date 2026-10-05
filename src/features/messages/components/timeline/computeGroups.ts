export interface GroupInfo {
  isGrouped: boolean;
  isFirstInGroup: boolean;
}

/** Consecutive messages by the same author within 2 minutes render as one group. */
export function computeGroups(
  messages: { authorId: string; sentAt: string; isDeleted?: boolean }[],
): GroupInfo[] {
  return messages.map((msg, i) => {
    if (i === 0) return { isGrouped: false, isFirstInGroup: true };
    const prev = messages[i - 1];
    const sameAuthor = msg.authorId === prev.authorId;
    const within2Min = new Date(msg.sentAt).getTime() - new Date(prev.sentAt).getTime() < 120_000;
    const isGrouped = sameAuthor && within2Min && !prev.isDeleted;
    return { isGrouped, isFirstInGroup: !isGrouped };
  });
}
