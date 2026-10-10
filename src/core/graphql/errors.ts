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

/** The wording for an `UPSTREAM_UNAVAILABLE` failure. */
export const UPSTREAM_UNAVAILABLE_MESSAGE =
  "Another server this needs could not be reached. Try again later.";

/**
 * Whether the server answered that the session is not valid: an `UNAUTHENTICATED` error (the
 * server sends it with HTTP 200) or a 401/403 from whatever sits in front of it. Other answers,
 * such as an internal error while the database is down, say nothing about the session.
 */
export function isSessionRefused(err: unknown): boolean {
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
 * "<Feature> is switched off on this server", and an `UPSTREAM_UNAVAILABLE` one names no
 * server id, wherever they surface.
 */
export function graphqlErrorMessage(err: unknown, fallback: string): string {
  const until = timedOutUntil(err);
  if (until) return timedOutMessage(until);
  const feature = disabledFeatureOf(err);
  if (feature) return featureOffMessage(feature);
  if (graphqlErrorCode(err) === UPSTREAM_UNAVAILABLE) return UPSTREAM_UNAVAILABLE_MESSAGE;
  const message = firstGraphQLError(err)?.message;
  if (typeof message === "string" && message.trim()) return message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
