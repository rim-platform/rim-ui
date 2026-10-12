import { graphqlErrorCode, graphqlErrorMessage, VALIDATION } from "../../core/graphql/errors";
import { formatTime } from "../../shared/utils/formatTime";

/** The UTF-8 length of `text` in bytes, as the server measures a message. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** The refusal of one more past `cap`, in the server's words: "This instance allows 5 workspaces per user." */
export function limitReachedText(cap: number, what: string): string {
  return `This instance allows ${cap} ${what}.`;
}

/** A cap as shown next to where people create things. */
export interface LimitView {
  /** "4 of 5 workspaces", or "Up to 5 workspaces per user" when the count is unknown. */
  text: string;
  /** The count reached the cap, so creating one more is refused. */
  full: boolean;
  /** Why one more is refused, when `full`. */
  reason: string;
}

/**
 * The view of `cap` over `count`; `null` without a cap. `noun` names one and many of the
 * counted thing, `what` the cap as the server words it ("workspaces per user").
 */
export function limitView(
  cap: number | null | undefined,
  count: number | undefined,
  noun: readonly [string, string],
  what: string,
): LimitView | null {
  if (cap === null || cap === undefined) return null;
  const reason = limitReachedText(cap, what);
  if (count === undefined) return { text: `Up to ${cap} ${what}`, full: false, reason };
  return {
    text: `${count} of ${cap} ${cap === 1 ? noun[0] : noun[1]}`,
    full: count >= cap,
    reason,
  };
}

/** Whether a failed request was refused for one of the instance's caps. */
export function isLimitRefusal(err: unknown): boolean {
  return (
    graphqlErrorCode(err) === VALIDATION &&
    /^this instance allows \d+ /.test(graphqlErrorMessage(err, ""))
  );
}

/** Why a new account cannot do `what` yet: "New account: you can create workspaces after 14:05." */
export function probationText(what: string, endsAt: string): string {
  return `New account: you can ${what} after ${formatTime(endsAt)}.`;
}
