import { toast } from "../../shared/toast";
import { logger } from "../logger";
import { TOO_MANY_SUBSCRIPTIONS } from "./errors";

/** The id of the notice that live updates hit the subscription limit; one at a time. */
export const SUBSCRIPTION_LIMIT_TOAST_ID = "too-many-subscriptions";

/** The close code the server ends a WebSocket with once the session behind it has ended. */
export const SESSION_ENDED_CLOSE_CODE = 4401;

/** The subscriptions whose refusal was already logged, by label. */
const logged = new Set<string>();

/**
 * Whether a subscription's error is a `TOO_MANY_SUBSCRIPTIONS` refusal. graphql-ws hands the
 * sink the GraphQL errors of an error message as an array.
 */
export function isSubscriptionLimit(err: unknown): boolean {
  const errors: unknown[] = Array.isArray(err) ? err : [err];
  return errors.some(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      (e as { extensions?: { code?: unknown } }).extensions?.code === TOO_MANY_SUBSCRIPTIONS,
  );
}

/**
 * Whether a subscription's error, or a WebSocket close, is the server closing the connection
 * because its session ended. graphql-ws hands the sink the close event itself.
 */
export function isSessionEndedClose(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === SESSION_ENDED_CLOSE_CODE
  );
}

/**
 * Reports a subscription the server refused because its connection holds as many subscriptions
 * as it allows: a warning logged once per `label` and a notice that does not block anything.
 * The subscription stays ended; nothing reconnects for it. Returns whether `err` was such a
 * refusal.
 */
export function reportSubscriptionLimit(label: string, err: unknown): boolean {
  if (!isSubscriptionLimit(err)) return false;
  if (!logged.has(label)) {
    logged.add(label);
    logger.warn(`${label}: refused, the connection holds as many subscriptions as allowed`);
  }
  toast.info("Some live updates are off", {
    id: SUBSCRIPTION_LIMIT_TOAST_ID,
    description:
      "This connection holds as many subscriptions as the server allows. Reload to try again.",
  });
  return true;
}
