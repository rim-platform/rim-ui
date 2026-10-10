/**
 * GraphQL calls sent to another server directly (`directTransport`), through `graphql-request`
 * so a refusal fails with the same `ClientError` as a call to the relay.
 */

import { GraphQLClient } from "graphql-request";

import { directTransport, type DirectTransport } from "./directTransport";

/** A GraphQL client whose requests go to `serverId` directly, over `transport`. */
export function directClient(
  serverId: string,
  transport: DirectTransport = directTransport(),
): GraphQLClient {
  return new GraphQLClient(`https://${serverId}.direct.invalid/api`, {
    fetch: async (_url, init) => {
      const res = await transport.graphql(serverId, String(init?.body ?? ""));
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": res.contentType ?? "application/json" },
      });
    },
  });
}

/** The answer of `serverId` to a direct `document`. */
export function directRequest<T>(
  serverId: string,
  document: string,
  variables: Record<string, unknown> = {},
  transport: DirectTransport = directTransport(),
): Promise<T> {
  return directClient(serverId, transport).request<T>(document, variables);
}
