// Mentions in a message a plugin posts. Plugins name people by principal id
// (`<@rimp1_…>`, or `<@rimp0_…>` before a person enrolled a key); the send path
// wants `<@userId>` tokens in plaintext and `<@principalId>` tokens in encrypted
// content.

const MENTION_TOKEN = /<@([^>]*)>/g;

/** A workspace member as the mapping needs them. */
export interface MentionMember {
  userId: string;
  /** The key-based id, when the member has one. */
  principalId: string | null;
  /** The provisional id plugins knew the member by before. */
  provisionalId: string;
}

/**
 * `body` with each mention of a member as the send path wants it: `<@userId>` for a
 * plaintext conversation, `<@principalId>` for an encrypted one. Tokens naming no member
 * stay as written.
 */
export function mentionsForSend(
  body: string,
  members: readonly MentionMember[],
  encrypted: boolean,
): string {
  return body.replace(MENTION_TOKEN, (token, id: string) => {
    const member = members.find((m) => m.principalId === id || m.provisionalId === id);
    if (!member) return token;
    if (!encrypted) return `<@${member.userId}>`;
    return member.principalId ? `<@${member.principalId}>` : token;
  });
}
