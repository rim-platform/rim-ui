import { GraphQLClient } from "graphql-request";

import { getGraphqlEndpoint } from "./config";
import { CSRF_HEADER, csrfToken } from "./csrf";
import { SESSION_SECRET_HEADER, sessionSecret } from "./sessionSecret";
import { asGraphqlResponse } from "./edgeRefusals";

/**
 * Where requests for a space on another server go: the relay registers one once it knows
 * which spaces those are. Requests for spaces this server hosts go to it directly.
 */
export interface SpaceRouter {
  /** The host server id of `spaceId`, or `null` when this server hosts it. */
  hostOf(spaceId: string): string | null;
  /** Send a GraphQL request body to `host` and return its verified answer. */
  send(host: string, body: string): Promise<Response>;
}

let spaceRouter: SpaceRouter | null = null;

export function setSpaceRouter(router: SpaceRouter | null): void {
  spaceRouter = router;
}

function idField(fields: unknown, name: "serverId" | "workspaceId"): string | null {
  if (!fields || typeof fields !== "object") return null;
  const value = (fields as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

/**
 * The space a GraphQL request body is about: its `serverId` or `workspaceId` variable, or the
 * same field of its `input`.
 */
export function spaceOfRequest(body: string): string | null {
  let variables: unknown;
  try {
    variables = (JSON.parse(body) as { variables?: unknown }).variables;
  } catch {
    return null;
  }
  const input =
    variables && typeof variables === "object" ? (variables as { input?: unknown }).input : null;
  return (
    idField(variables, "serverId") ??
    idField(variables, "workspaceId") ??
    idField(input, "serverId") ??
    idField(input, "workspaceId")
  );
}

/**
 * `fetch` that sends a request about a space on another server to its host, and turns the
 * server's edge refusals into errors the GraphQL client reports.
 */
const routingFetch: typeof fetch = async (input, init) => {
  if (spaceRouter && typeof init?.body === "string") {
    const space = spaceOfRequest(init.body);
    const host = space ? spaceRouter.hostOf(space) : null;
    if (host) return asGraphqlResponse(await spaceRouter.send(host, init.body));
  }
  return asGraphqlResponse(await fetch(input, init));
};

export function createGraphqlClient(): GraphQLClient {
  return new GraphQLClient(getGraphqlEndpoint(), {
    credentials: "include",
    fetch: routingFetch,
    requestMiddleware: (request) => {
      const csrf = csrfToken();
      const secret = sessionSecret();
      if (!csrf && !secret) return request;

      const headers = new Headers(request.headers as HeadersInit | undefined);
      if (csrf) headers.set(CSRF_HEADER, csrf);
      if (secret) headers.set(SESSION_SECRET_HEADER, secret);
      return { ...request, headers };
    },
  });
}

export const graphqlClient = createGraphqlClient();
