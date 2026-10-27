/**
 * Helpers for reading typed backend errors off a failed `graphqlClient.request`.
 *
 * `graphql-request` throws a `ClientError` whose `message` embeds the whole serialized
 * response, which is unreadable in a toast. The server's own message and its
 * `extensions.code` live on `err.response.errors[0]`; these helpers read them without
 * importing `ClientError`, so plain test doubles of the same shape work too.
 */

import { formatTime } from "../../shared/utils/formatTime";
import { FeatureDisabledError, featureOffMessage } from "../serverFeatures";

/** A write by a member who is timed out in the workspace; extension `until` (RFC 3339). */
export const TIMED_OUT = "TIMED_OUT";

/** Too many requests (also slow mode); extension `retryAfterSeconds`. */
export const RATE_LIMITED = "RATE_LIMITED";

/** A subscription past the WebSocket connection's limit; extension `limit`. */
export const TOO_MANY_SUBSCRIPTIONS = "TOO_MANY_SUBSCRIPTIONS";

/** What the client says when the server refuses this address with 403 `blocked`. */
export const ADDRESS_BLOCKED_MESSAGE = "This address is blocked on this server";

/**
 * The server answered 403 `{"error":"blocked"}`: the operator blocked this client's address. It
 * says nothing about the session.
 */
export class AddressBlockedError extends Error {
  constructor() {
    super(ADDRESS_BLOCKED_MESSAGE);
    this.name = "AddressBlockedError";
  }
}

interface GraphQLErrorLike {
  message?: unknown;
  extensions?: { code?: unknown; [key: string]: unknown };
}

function firstGraphQLError(err: unknown): GraphQLErrorLike | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const errors = (err as { response?: { errors?: unknown } }).response?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const first: unknown = errors[0];
  return typeof first === "object" && first !== null ? (first as GraphQLErrorLike) : undefined;
}

/** The backend error code (`extensions.code`) of a failed request, if any. */
export function graphqlErrorCode(err: unknown): string | undefined {
  const code = firstGraphQLError(err)?.extensions?.code;
  return typeof code === "string" ? code : undefined;
}

/** One extension value (`extensions[key]`) of a failed request's first error, if any. */
export function graphqlErrorExtension(err: unknown, key: string): unknown {
  return firstGraphQLError(err)?.extensions?.[key];
}

/**
 * Whether the server refused the request's document itself, as one older than a field or
 * mutation the request names does: GraphQL errors, none carrying a code.
 */
export function isSchemaRefusal(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const errors = (err as { response?: { errors?: unknown } }).response?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;
  return errors.every((e: unknown) => {
    const code = (e as GraphQLErrorLike | null)?.extensions?.code;
    return code === undefined || code === null;
  });
}

/** Too many wrong passwords: only a reset with the recovery phrase opens the account again. */
export const PASSWORD_LOCKED = "PASSWORD_LOCKED";

/** The request carried no valid session (an absent, expired or revoked cookie). */
export const UNAUTHENTICATED = "UNAUTHENTICATED";

/** The thing the request names does not exist, such as an unknown invite. */
export const NOT_FOUND = "NOT_FOUND";

/** The caller may not do this; the error's message says why. */
export const FORBIDDEN = "FORBIDDEN";

/** The write clashes with existing data, such as a username already taken. */
export const CONFLICT = "CONFLICT";

/** The input was refused; the error's message says why. */
export const VALIDATION = "VALIDATION";

/** An invite token that is unknown, used up or revoked. */
export const INVALID_TOKEN = "INVALID_TOKEN";

/** An invite token past its expiry. */
export const EXPIRED_TOKEN = "EXPIRED_TOKEN";

/** Another server the request needed could not be reached; extension `hostServerId`. */
export const UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE";

/** A feature the server does not run; extension `feature` names it. */
export const FEATURE_DISABLED = "FEATURE_DISABLED";

/** The server holds as many accounts as it accepts and takes no new one. */
export const REGISTRATION_FULL = "REGISTRATION_FULL";

/** The server failed while handling the request. */
export const INTERNAL = "INTERNAL";

/** Something the server depends on, such as its database, is down. */
export const UNAVAILABLE = "UNAVAILABLE";

/** The server gave up on the request before it finished. */
export const TIMEOUT = "TIMEOUT";

/** What a request that never reached the server says. */
export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server. Check your connection and try again.";

/**
 * What a server fault says: `INTERNAL`, `UNAVAILABLE`, `TIMEOUT`, or a 5xx without GraphQL
 * errors.
 */
export const SERVER_FAULT_MESSAGE = "Something went wrong on the server. Try again in a moment.";

/** Codes whose server message is not written for people ("internal error", "service timeout"). */
const SERVER_FAULT_CODES = new Set([INTERNAL, UNAVAILABLE, TIMEOUT]);

/** Whether `err` is `fetch` failing to reach the server at all. */
function isNetworkFailure(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(
      err.message,
    )
  );
}

/** The HTTP status of a failed request's response, if `err` carries one. */
function responseStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { response?: { status?: unknown } }).response?.status;
  return typeof status === "number" ? status : undefined;
}

/** Whether `err` carries a response object, as graphql-request's `ClientError` does. */
function hasResponse(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const response = (err as { response?: unknown }).response;
  return typeof response === "object" && response !== null;
}

/**
 * The feature a failed request was refused for: a `FEATURE_DISABLED` GraphQL error's `feature`
 * extension, or a `FeatureDisabledError` from a REST route. `undefined` for anything else.
 */
export function disabledFeatureOf(err: unknown): string | undefined {
  if (err instanceof FeatureDisabledError) return err.feature;
  if (graphqlErrorCode(err) !== FEATURE_DISABLED) return undefined;
  const feature = graphqlErrorExtension(err, "feature");
  return typeof feature === "string" && feature ? feature : undefined;
}

/**
 * The wording for a `RATE_LIMITED` refusal, with the wait when the server gave it: seconds under
 * a minute, whole minutes rounded up from a minute on.
 */
export function rateLimitedMessage(seconds: number | undefined): string {
  if (seconds === undefined) return "Slow down: try again in a moment";
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `Slow down: try again in ${s} s`;
  const m = Math.ceil(s / 60);
  return `Slow down: try again in ${m} minute${m === 1 ? "" : "s"}`;
}

/** The wording for an `UPSTREAM_UNAVAILABLE` failure. */
export const UPSTREAM_UNAVAILABLE_MESSAGE =
  "Another server this needs could not be reached. Try again later.";

/**
 * Whether the server answered that the session is not valid: an `UNAUTHENTICATED` error (the
 * server sends it with HTTP 200) or a 401/403 from whatever sits in front of it. Other answers,
 * such as an internal error while the database is down, say nothing about the session.
 */
export function isSessionRefused(err: unknown): boolean {
  if (err instanceof AddressBlockedError) return false;
  if (graphqlErrorCode(err) === UNAUTHENTICATED) return true;
  if (typeof err !== "object" || err === null) return false;
  const status = (err as { response?: { status?: unknown } }).response?.status;
  return status === 401 || status === 403;
}

/** The end of the viewer's timeout carried by a `TIMED_OUT` error, else `undefined`. */
export function timedOutUntil(err: unknown): string | undefined {
  if (graphqlErrorCode(err) !== TIMED_OUT) return undefined;
  const until = graphqlErrorExtension(err, "until");
  return typeof until === "string" && until ? until : undefined;
}

/** Seconds to wait carried by a `RATE_LIMITED` error, else `undefined`. */
export function retryAfterSeconds(err: unknown): number | undefined {
  if (graphqlErrorCode(err) !== RATE_LIMITED) return undefined;
  const seconds = graphqlErrorExtension(err, "retryAfterSeconds");
  return typeof seconds === "number" && Number.isFinite(seconds) ? seconds : undefined;
}

/** The one wording for a timeout, shared by the composer banner and every error toast. */
export function timedOutMessage(until: string): string {
  return `You are timed out until ${formatTime(until)}`;
}

/**
 * The server's human-readable message for a failed request, else `err.message`, else
 * `fallback`. A `TIMED_OUT` error reads "You are timed out until …", a `FEATURE_DISABLED` one
 * "<Feature> is switched off on this server", a `RATE_LIMITED` one "Slow down: try again in
 * N s" (N minutes from a minute up), an `UPSTREAM_UNAVAILABLE` one names no server id, a request that never reached the
 * server says so, and a server fault reads `SERVER_FAULT_MESSAGE`, wherever they surface. Never
 * the serialized response of a `ClientError`: one without GraphQL errors gets `fallback`.
 */
export function graphqlErrorMessage(err: unknown, fallback: string): string {
  const until = timedOutUntil(err);
  if (until) return timedOutMessage(until);
  if (graphqlErrorCode(err) === RATE_LIMITED) return rateLimitedMessage(retryAfterSeconds(err));
  const feature = disabledFeatureOf(err);
  if (feature) return featureOffMessage(feature);
  if (graphqlErrorCode(err) === UPSTREAM_UNAVAILABLE) return UPSTREAM_UNAVAILABLE_MESSAGE;
  if (isNetworkFailure(err)) return NETWORK_ERROR_MESSAGE;
  const code = graphqlErrorCode(err);
  if (code && SERVER_FAULT_CODES.has(code)) return SERVER_FAULT_MESSAGE;
  const message = firstGraphQLError(err)?.message;
  if (typeof message === "string" && message.trim()) return message;
  if (hasResponse(err)) {
    const status = responseStatus(err);
    return status !== undefined && status >= 500 ? SERVER_FAULT_MESSAGE : fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** `text` as a sentence: a capital first letter and a closing full stop. */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * Why `err` failed, as one sentence for a person: `graphqlErrorMessage` with a capital first
 * letter and a closing full stop.
 *
 * @param err - What the request failed with.
 * @param fallback - What to say when the failure names no reason.
 */
export function errorSentence(err: unknown, fallback: string): string {
  return asSentence(graphqlErrorMessage(err, fallback));
}
