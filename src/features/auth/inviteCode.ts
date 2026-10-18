import { isInviteLink } from "../relay/remote/inviteLink";

/**
 * What an invite code typed at signup holds: nothing, a token of this server, or an invite to a
 * workspace on another server (`rim-invite:1:…`), which a signup here cannot take.
 */
export type InviteCode = { kind: "empty" } | { kind: "token"; token: string } | { kind: "remote" };

/** The token segment of an invite link's path: `…/join/<token>`, then an optional query. */
const JOIN_PATH = /\/join\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * Reads the token out of what a person pasted as an invite code: the bare token, or a whole
 * invite link (`https://<server>/join/<token>`), whose token is the path segment after `/join/`,
 * percent-decoded. ASCII whitespace anywhere is dropped, as a pasted link may carry line breaks.
 *
 * @param text - The field's contents.
 * @returns The token, `empty` for a blank field, or `remote` for an invite to another server.
 */
export function inviteCodeToken(text: string): InviteCode {
  const compact = text.replace(/[\t\n\f\r ]/g, "");
  if (!compact) return { kind: "empty" };
  if (isInviteLink(compact)) return { kind: "remote" };
  const segment = JOIN_PATH.exec(compact)?.[1];
  if (!segment) return { kind: "token", token: compact };
  try {
    return { kind: "token", token: decodeURIComponent(segment) };
  } catch {
    return { kind: "token", token: segment };
  }
}
