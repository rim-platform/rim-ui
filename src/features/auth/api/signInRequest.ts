import type { Variables } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { isSchemaRefusal } from "../../../core/graphql/errors";
import { useAuthStore } from "../state/useAuthStore";

/**
 * Sends a mutation that starts a session (`field` names its root field) and keeps the payload's
 * `csrfToken` in the auth store. A server older than `csrfToken` refuses `document` before running
 * it, so `olderDocument`, the same mutation without that field, is sent instead.
 */
export async function signInRequest<T>(
  field: keyof T & string,
  document: string,
  olderDocument: string,
  variables: Variables,
): Promise<T> {
  let res: T;
  try {
    res = await graphqlClient.request<T>(document, variables);
  } catch (err) {
    if (!isSchemaRefusal(err)) throw err;
    return graphqlClient.request<T>(olderDocument, variables);
  }
  const token = (res[field] as { csrfToken?: unknown } | null | undefined)?.csrfToken;
  if (typeof token === "string" && token) useAuthStore.getState().setCsrfToken(token);
  return res;
}
