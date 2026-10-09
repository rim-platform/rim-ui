/**
 * Contact links: `rim-contact:1:<principal id>:<relay URL>`, shown as text and as a byte-mode
 * QR code. The principal id authenticates everything fetched with the link; the relay URL only
 * says where to ask. Read like a device-link code: ASCII whitespace removed, scheme case
 * ignored, split at the first two `:` after the scheme (the URL keeps its own colons).
 */

import { unb64, utf8 } from "../../key-identity/browser/bytes";

const SCHEME = "rim-contact:";
const VERSION = 1;
const MAX_URL_BYTES = 256;
/** The scheme, the version, a principal id and a 256-byte URL, with their separators. */
export const MAX_CONTACT_LINK_LEN = SCHEME.length + 2 + 49 + 1 + MAX_URL_BYTES;

export interface ContactLink {
  principalId: string;
  relayUrl: string;
}

export class ContactLinkError extends Error {
  constructor(message = "this is not a RIM contact link") {
    super(message);
    this.name = "ContactLinkError";
  }
}

/** A principal id as issued: `rimp1_` and 32 bytes of unpadded base64url. */
export function validPrincipalId(text: string): boolean {
  if (!/^rimp1_[A-Za-z0-9_-]{43}$/.test(text)) return false;
  return unb64(text.slice(6))?.length === 32;
}

/** A relay URL a link may carry: `http(s)`, 1 to 256 bytes of printable ASCII, no `?#@`. */
export function validRelayUrl(url: string): boolean {
  return (
    (url.startsWith("http://") || url.startsWith("https://")) &&
    utf8(url).length <= MAX_URL_BYTES &&
    /^[\x21-\x7e]+$/.test(url) &&
    !/[?#@]/.test(url)
  );
}

export function formatContactLink(link: ContactLink): string {
  if (!validPrincipalId(link.principalId) || !validRelayUrl(link.relayUrl)) {
    throw new ContactLinkError("this account cannot be shared as a contact link");
  }
  return `${SCHEME}${VERSION}:${link.principalId}:${link.relayUrl}`;
}

export function parseContactLink(text: string): ContactLink {
  const compact = text.replace(/[\t\n\f\r ]/g, "");
  if (utf8(compact).length > MAX_CONTACT_LINK_LEN) throw new ContactLinkError();
  const scheme = compact.slice(0, SCHEME.length).replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (scheme !== SCHEME) throw new ContactLinkError();
  const rest = compact.slice(SCHEME.length);
  const first = rest.indexOf(":");
  const second = first < 0 ? -1 : rest.indexOf(":", first + 1);
  if (second < 0) throw new ContactLinkError();
  const version = rest.slice(0, first);
  const principalId = rest.slice(first + 1, second);
  const relayUrl = rest.slice(second + 1);
  if (!/^[1-9][0-9]*$/.test(version) || Number(version) > 0xffffffff) {
    throw new ContactLinkError();
  }
  if (Number(version) > VERSION) {
    throw new ContactLinkError("this link was made by a newer app; update this one");
  }
  if (!validPrincipalId(principalId) || !validRelayUrl(relayUrl)) throw new ContactLinkError();
  return { principalId, relayUrl };
}
