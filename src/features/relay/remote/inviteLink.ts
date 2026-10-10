/**
 * Invites to a workspace on another server:
 * `rim-invite:1:<host server id>:<host key hash>:<invite token>:<host origin>`. Read like a
 * device-link code: ASCII whitespace removed, at most 400 characters, scheme case ignored,
 * split at the first four `:` after the scheme (the origin keeps its own colons). The server id
 * and key hash say which server the origin must serve; the token is the host's own invite token.
 */

import { unb64 } from "../../key-identity/browser/bytes";
import { validRelayUrl } from "../contacts/contactLink";

const SCHEME = "rim-invite:";
const VERSION = 1;
export const MAX_INVITE_LINK_LEN = 400;

export interface InviteLink {
  hostServerId: string;
  hostKeyHash: string;
  inviteToken: string;
  hostOrigin: string;
}

export class InviteLinkError extends Error {
  constructor(message = "this is not a RIM invite link") {
    super(message);
    this.name = "InviteLinkError";
  }
}

/** A server id as issued: `rims1_` and 32 bytes of unpadded base64url. */
export function validServerId(text: string): boolean {
  return /^rims1_[A-Za-z0-9_-]{43}$/.test(text) && unb64(text.slice(6))?.length === 32;
}

function validKeyHash(text: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(text) && unb64(text)?.length === 32;
}

/** An origin a link may carry: `http(s)://host[:port]` and nothing after it. */
export function validOrigin(text: string): boolean {
  if (!validRelayUrl(text)) return false;
  try {
    return new URL(text).origin === text;
  } catch {
    return false;
  }
}

/** Whether `text` looks like an invite to a workspace on another server. */
export function isInviteLink(text: string): boolean {
  return text.trim().toLowerCase().startsWith(SCHEME);
}

export function parseInviteLink(text: string): InviteLink {
  const compact = text.replace(/[\t\n\f\r ]/g, "");
  if (compact.length > MAX_INVITE_LINK_LEN) throw new InviteLinkError();
  const scheme = compact.slice(0, SCHEME.length).replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (scheme !== SCHEME) throw new InviteLinkError();
  const rest = compact.slice(SCHEME.length);
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < 4; i++) {
    const at = rest.indexOf(":", from);
    if (at < 0) throw new InviteLinkError();
    parts.push(rest.slice(from, at));
    from = at + 1;
  }
  const [version, hostServerId, hostKeyHash, inviteToken] = parts;
  const hostOrigin = rest.slice(from);
  if (!/^[1-9][0-9]*$/.test(version) || Number(version) > 0xffffffff) {
    throw new InviteLinkError();
  }
  if (Number(version) > VERSION) {
    throw new InviteLinkError("this invite was made by a newer app; update this one");
  }
  if (
    !validServerId(hostServerId) ||
    !validKeyHash(hostKeyHash) ||
    !/^[\x21-\x39\x3b-\x7e]{1,128}$/.test(inviteToken) ||
    !validOrigin(hostOrigin)
  ) {
    throw new InviteLinkError();
  }
  return { hostServerId, hostKeyHash, inviteToken, hostOrigin };
}

export function formatInviteLink(link: InviteLink): string {
  return `${SCHEME}${VERSION}:${link.hostServerId}:${link.hostKeyHash}:${link.inviteToken}:${link.hostOrigin}`;
}
