/**
 * Helpers for reading typed backend errors off a failed `graphqlClient.request`.
 *
 * `graphql-request` throws a `ClientError` whose `message` embeds the whole serialized
 * response, which is unreadable in a toast. The server's own message and its
 * `extensions.code` live on `err.response.errors[0]`; these helpers read them without
 * importing `ClientError`, so plain test doubles of the same shape work too.
 */

/** GraphQL extension code for a command or call that belongs to a workspace feature that is off. */
export const FEATURE_DISABLED = "FEATURE_DISABLED";

interface GraphQLErrorLike {
  message?: unknown;
  extensions?: { code?: unknown };
}

function firstGraphQLError(err: unknown): GraphQLErrorLike | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const errors = (err as { response?: { errors?: unknown } }).response?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const first: unknown = errors[0];
  return typeof first === "object" && first !== null ? (first as GraphQLErrorLike) : undefined;
}

/**
 * Raised on the client before a request is sent, when the local cache already knows the
 * command's workspace feature is off. Carries the same code as the server's error so callers
 * handle both the same way.
 */
export class FeatureDisabledError extends Error {
  readonly code = FEATURE_DISABLED;

  constructor(message: string) {
    super(message);
    this.name = "FeatureDisabledError";
  }
}

/** The backend error code (`extensions.code`) of a failed request, if any. */
export function graphqlErrorCode(err: unknown): string | undefined {
  if (err instanceof FeatureDisabledError) return err.code;
  const code = firstGraphQLError(err)?.extensions?.code;
  return typeof code === "string" ? code : undefined;
}

/** The server's human-readable message for a failed request, else `err.message`, else `fallback`. */
export function graphqlErrorMessage(err: unknown, fallback: string): string {
  const message = firstGraphQLError(err)?.message;
  if (typeof message === "string" && message.trim()) return message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
