import {
  asSentence,
  CONFLICT,
  FORBIDDEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  NOT_FOUND,
  RATE_LIMITED,
  retryAfterSeconds,
  VALIDATION,
} from "../../core/graphql/errors";
import { getApiOrigin, getWebBaseUrl } from "../../core/graphql/config";

/** The prefix of a workspace's public link token; invite tokens start `rim_inv_` or `rim_iinv_`. */
export const PUBLIC_LINK_PREFIX = "rim_pjl_";

/** Whether `token` is a workspace's public link rather than an invite. */
export function isPublicLinkToken(token: string): boolean {
  return token.startsWith(PUBLIC_LINK_PREFIX);
}

/**
 * The origins this app's own server answers on: where the web app is served and where its API
 * is. A public link at either is a link of this server.
 */
export function ownServerOrigins(): string[] {
  const origins: string[] = [];
  for (const base of [getWebBaseUrl(), getApiOrigin()]) {
    try {
      origins.push(new URL(base).origin);
    } catch {
      // A base that does not parse names no origin.
    }
  }
  return origins;
}

/** What every invalid link says, whatever made it invalid. */
export const INVALID_LINK_MESSAGE = "This link isn't valid.";

/** What a person banned from the link's workspace is told. */
export const BANNED_MESSAGE = "You are banned from this workspace.";

/**
 * How long `seconds` is in whole minutes, rounded up.
 *
 * @returns For example "1 minute" or "58 minutes".
 */
export function waitLabel(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The wording for a `RATE_LIMITED` link lookup or join, with the wait when the server gave it. */
export function linkRateLimitedMessage(seconds: number | undefined): string {
  const wait = seconds === undefined ? "later" : `in ${waitLabel(seconds)}`;
  return `Too many tries from this network. Try again ${wait}.`;
}

/**
 * What a failed link lookup, join or join request says: one message for every invalid link,
 * the wait for a rate limit, the banned text, whether the person is a member already or asked
 * already, and otherwise the server's own message, which names the cap or the hours to wait.
 *
 * @param err - What the request failed with.
 * @param fallback - What to say when the failure names no reason.
 */
export function publicLinkErrorMessage(err: unknown, fallback: string): string {
  const code = graphqlErrorCode(err);
  const message = graphqlErrorMessage(err, fallback);
  switch (code) {
    case NOT_FOUND:
      return INVALID_LINK_MESSAGE;
    case RATE_LIMITED:
      return linkRateLimitedMessage(retryAfterSeconds(err));
    case FORBIDDEN:
      return message.includes("banned") ? BANNED_MESSAGE : asSentence(message);
    case CONFLICT:
      if (message.includes("already a member"))
        return "You are already a member of this workspace.";
      if (message.includes("already asked")) return "Your request to join was already sent.";
      if (message.includes("no longer open")) return "This request is no longer open.";
      return asSentence(message);
    case VALIDATION:
      return asSentence(message);
    default:
      return message;
  }
}
