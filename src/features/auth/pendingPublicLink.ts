import { isPublicLinkToken } from "../workspaces/publicJoinLink";

/** Where a signed-out visitor's public link waits while they sign in or sign up, per tab. */
export const PENDING_PUBLIC_LINK_KEY = "rim:pending-public-link";

/**
 * Keeps the public link `token` for after the sign-in or signup the visitor is going to, so the
 * app comes back to it. Storage that refuses the write leaves nothing kept.
 */
export function rememberPendingPublicLink(token: string): void {
  try {
    sessionStorage.setItem(PENDING_PUBLIC_LINK_KEY, token);
  } catch {
    // Without storage the visitor opens the link again themselves.
  }
}

/**
 * Takes the kept public link out of storage, once.
 *
 * @returns The link's token, or null when none is kept or what is kept is no public link.
 */
export function takePendingPublicLink(): string | null {
  try {
    const token = sessionStorage.getItem(PENDING_PUBLIC_LINK_KEY);
    sessionStorage.removeItem(PENDING_PUBLIC_LINK_KEY);
    return token && isPublicLinkToken(token) ? token : null;
  } catch {
    return null;
  }
}
