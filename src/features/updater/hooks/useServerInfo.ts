import { useQuery } from "@tanstack/react-query";

import type { ServerInfo } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { CLIENT_API_VERSION, fetchServerInfo } from "../api/serverInfoApi";

/** What the client says when the server speaks a newer API than it does. */
export const NEWER_SERVER_API_MESSAGE =
  "This server speaks a newer API than this app; update the app.";

/** What the client knows about the server it talks to. */
export interface ServerInfoView {
  /**
   * The server's versions, features, audit retention, instance notice and terms URL; `undefined`
   * while loading or when it could not be read.
   */
  info: ServerInfo | undefined;
  /** The query failed: the server is down, or too old to answer it. */
  unreachable: boolean;
  /** The server speaks a newer API than this client. */
  newerApi: boolean;
}

/**
 * The connected server's versions and features, read once per session (and again after a call
 * is refused for a disabled feature); a failure only sets `unreachable`.
 */
export function useServerInfo(): ServerInfoView {
  const query = useQuery({
    queryKey: queryKeys.serverInfo,
    queryFn: fetchServerInfo,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const info = query.data;
  return {
    info,
    unreachable: query.isError,
    newerApi: info !== undefined && info.apiVersion > CLIENT_API_VERSION,
  };
}
