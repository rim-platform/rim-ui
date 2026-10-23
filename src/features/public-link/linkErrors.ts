import {
  CONFLICT,
  FORBIDDEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  NOT_FOUND,
  RATE_LIMITED,
  retryAfterSeconds,
  VALIDATION,
} from "../../core/graphql/errors";

/** What every invalid link says, whatever made it invalid. */
export const INVALID_LINK_MESSAGE = "This link isn't valid";

/**
 * How long `seconds` is, rounded up to its largest whole unit.
 *
 * @returns For example "45 seconds", "1 minute" or "58 minutes".
 */
export function waitLabel(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  if (whole < 60) return `${whole} second${whole === 1 ? "" : "s"}`;
  const minutes = Math.ceil(whole / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The wording for a `RATE_LIMITED` link lookup or join, with the wait when the server gave it. */
export function linkRateLimitedMessage(seconds: number | undefined): string {
  const wait = seconds === undefined ? "later" : `in ${waitLabel(seconds)}`;
  return `Too many links that don't work were opened from your network. Try again ${wait}.`;
}

/** `text` as a sentence: a capital first letter and a closing full stop. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * What a failed link lookup, join or join request says: one message for every invalid link,
 * the wait for a rate limit, and a plain sentence for each refusal of a valid link (banned,
 * full, already a member or asked, too many open requests, declined recently, a long message).
 *
 * @param err - What the request failed with.
 * @param fallback - What to say when the failure names no reason.
 */
export function publicLinkErrorMessage(err: unknown, fallback: string): string {
  const code = graphqlErrorCode(err);
  const message = graphqlErrorMessage(err, fallback);
  switch (code) {
    case NOT_FOUND:
      return `${INVALID_LINK_MESSAGE}.`;
    case RATE_LIMITED:
      return linkRateLimitedMessage(retryAfterSeconds(err));
    case FORBIDDEN:
      return message.includes("banned") ? "You are banned from this workspace." : sentence(message);
    case CONFLICT:
      if (message.includes("already a member"))
        return "You are already a member of this workspace.";
      if (message.includes("already asked")) return "You already asked to join this workspace.";
      if (message.includes("no longer open")) return "This request is no longer open.";
      return sentence(message);
    case VALIDATION:
      if (message.includes("members per workspace")) {
        return `This workspace is full: ${message.replace(/^this /, "the ")}.`;
      }
      if (message.includes("open join requests")) {
        return "You have as many open requests to join workspaces as you can. Withdraw one first.";
      }
      if (message.includes("characters")) {
        return "Your message is too long: at most 500 characters.";
      }
      return sentence(message);
    default:
      return message;
  }
}
