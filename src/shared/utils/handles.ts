/**
 * Handles: `@<username>:<domain>`, a person's username at their home server and the handle
 * domain that server declares. People of the viewer's own server are shown as `@username`,
 * people from elsewhere with their domain; the `r_…` name a server stores for a person from
 * another server is never shown.
 */

/** A handle split into its username and domain. */
export interface ParsedHandle {
  username: string;
  domain: string;
}

/** How a person's handle reads where they are shown, and what "Copy" puts on the clipboard. */
export interface HandleView {
  /** `@username` for the viewer's own server, the whole handle for anyone else. */
  shown: string;
  /** The whole handle when it is known, else `@username`. */
  copied: string;
}

const USERNAME = /^[a-z0-9_-]{3,32}$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Whether `domain` is a handle domain: a lowercase DNS name of at most 253 bytes whose labels
 * are 1 to 63 letters, digits and hyphens, neither starting nor ending with a hyphen.
 */
export function isHandleDomain(domain: string): boolean {
  return domain.length > 0 && domain.length <= 253 && domain.split(".").every((l) => LABEL.test(l));
}

/**
 * Split `@<username>:<domain>` into its parts.
 *
 * @param handle - A handle as the server answers it, with or without the leading `@`.
 * @returns The parts, or `null` when it is not a handle.
 */
export function parseHandle(handle: string | null | undefined): ParsedHandle | null {
  if (!handle) return null;
  const text = handle.startsWith("@") ? handle.slice(1) : handle;
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const username = text.slice(0, colon);
  const domain = text.slice(colon + 1);
  return USERNAME.test(username) && isHandleDomain(domain) ? { username, domain } : null;
}

/** The domain of `handle`, or `null` when it is not a handle. */
export function handleDomain(handle: string | null | undefined): string | null {
  return parseHandle(handle)?.domain ?? null;
}

/** Whether `username` is the internal name a server gives a person from another server. */
export function isInternalUsername(username: string): boolean {
  return username.toLowerCase().startsWith("r_");
}

/**
 * How a person's handle reads to a viewer whose server's handle domain is `ownDomain`.
 *
 * @param username - The person's username on the server that answered; an `r_…` name is never
 *   shown.
 * @param handle - `User.handle`, when the server answered one.
 * @param ownDomain - The viewer's own handle domain; `null` while it is not known, when every
 *   handle is shown whole.
 * @returns The view, or `null` when there is nothing to show (an `r_…` name without a handle).
 */
export function viewHandle(
  username: string | null | undefined,
  handle: string | null | undefined,
  ownDomain: string | null,
): HandleView | null {
  const parsed = parseHandle(handle);
  if (parsed) {
    const whole = `@${parsed.username}:${parsed.domain}`;
    return { shown: parsed.domain === ownDomain ? `@${parsed.username}` : whole, copied: whole };
  }
  if (!username || isInternalUsername(username)) return null;
  return { shown: `@${username}`, copied: `@${username}` };
}

/**
 * The name a person is shown under: their display name, else their handle as it reads without
 * the `@`, else the start of their user id.
 *
 * @param person - The person as a server answered them, or `null` when it did not.
 * @param userId - Their user id.
 * @param ownDomain - The viewer's own handle domain, as for {@link viewHandle}.
 */
export function personName(
  person: { username?: string | null; displayName?: string | null; handle?: string | null } | null,
  userId: string,
  ownDomain: string | null,
): string {
  if (person?.displayName) return person.displayName;
  return (
    viewHandle(person?.username, person?.handle, ownDomain)?.shown.slice(1) ?? userId.slice(0, 8)
  );
}
