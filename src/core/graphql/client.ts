import { GraphQLClient } from "graphql-request";

import { getGraphqlEndpoint } from "./config";

const CSRF_COOKIE = "rim_csrf";
const CSRF_HEADER = "x-csrf-token";

export function getCookie(name: string): string | undefined {
  const row = document.cookie
    .split("; ")
    .find((r) => r.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.split("=")[1]) : undefined;
}

export function createGraphqlClient(): GraphQLClient {
  return new GraphQLClient(getGraphqlEndpoint(), {
    credentials: "include",
    requestMiddleware: (request) => {
      const csrf = getCookie(CSRF_COOKIE);
      if (!csrf) return request;

      const headers = new Headers(request.headers as HeadersInit | undefined);
      headers.set(CSRF_HEADER, csrf);
      return { ...request, headers };
    },
  });
}

export const graphqlClient = createGraphqlClient();
