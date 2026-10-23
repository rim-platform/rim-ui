import { isInviteLink } from "../relay/remote/inviteLink";
import { isPublicLinkToken } from "../workspaces/publicJoinLink";

/**
 * What an invite code typed at signup holds: nothing, a token of this server, an invite to a
 * workspace on another server (`rim-invite:1:…`), which a signup here cannot take, or a
 * workspace's public link (`rim_pjl_…`), which is no invite and creates no account.
 */
export type InviteCode =
  | { kind: "empty" }
  | { kind: "token"; token: string }
  | { kind: "remote" }
  | { kind: "publicLink"; token: string };

/** The token segment of an invite link's path: `…/join/<token>`, then an optional query. */
const JOIN_PATH = /\/join\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * Reads the token out of what a person pasted as an invite code: the bare token, or a whole
 * invite link (`https://<server>/join/<token>`), whose token is the path segment after `/join/`,
 * percent-decoded. ASCII whitespace anywhere is dropped, as a pasted link may carry line breaks.
 *
 * @param text - The field's contents.
 * @returns The token, `empty` for a blank field, `remote` for an invite to another server, or
 *   `publicLink` with the token of a workspace's public link.
 */
export function inviteCodeToken(text: string): InviteCode {
  const compact = text.replace(/[\t\n\f\r ]/g, "");
  if (!compact) return { kind: "empty" };
  if (isInviteLink(compact)) return { kind: "remote" };
  const segment = JOIN_PATH.exec(compact)?.[1];
  let token = segment ?? compact;
  if (segment) {
    try {
      token = decodeURIComponent(segment);
    } catch {
      token = segment;
    }
  }
  return isPublicLinkToken(token) ? { kind: "publicLink", token } : { kind: "token", token };
}
