import { isInviteLink } from "../relay/remote/inviteLink";
import { isPublicLinkToken, ownServerOrigins } from "../workspaces/publicJoinLink";

/**
 * What an invite code typed at signup holds: nothing, a token of this server, an invite to a
 * workspace on another server (`rim-invite:1:…`), which a signup here cannot take, or a
 * workspace's public link (`rim_pjl_…`), which is no invite and creates no account. A public
 * link carries `hostOrigin`, the other server it is on, or null for a link of this server.
 */
export type InviteCode =
  | { kind: "empty" }
  | { kind: "token"; token: string }
  | { kind: "remote" }
  | { kind: "publicLink"; token: string; hostOrigin: string | null };

/** The token segment of an invite link's path: `…/join/<token>`, then an optional query. */
const JOIN_PATH = /\/join\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * Reads the token out of what a person pasted as an invite code: the bare token, or a whole
 * invite link (`https://<server>/join/<token>`), whose token is the path segment after `/join/`,
 * percent-decoded. ASCII whitespace anywhere is dropped, as a pasted link may carry line breaks.
 * A public link whose origin is none of `ownOrigins` is a link of another server; a bare token
 * is one of this server.
 *
 * @param text - The field's contents.
 * @param ownOrigins - The origins of this app's own server.
 * @returns The token, `empty` for a blank field, `remote` for an invite to another server, or
 *   `publicLink` with the token of a workspace's public link and the other server's origin.
 */
export function inviteCodeToken(
  text: string,
  ownOrigins: string[] = ownServerOrigins(),
): InviteCode {
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
  if (!isPublicLinkToken(token)) return { kind: "token", token };
  const origin = segment ? linkOrigin(compact) : null;
  return {
    kind: "publicLink",
    token,
    hostOrigin: origin && !ownOrigins.includes(origin) ? origin : null,
  };
}

/** The `http(s)` origin of a pasted link, or null when it has none. */
function linkOrigin(link: string): string | null {
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
