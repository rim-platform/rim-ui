import { useQuery } from "@tanstack/react-query";

import type { ServerLimits } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { CLIENT_API_VERSION, fetchServerInfo, type KnownServerInfo } from "../api/serverInfoApi";

/** What the client says when the server speaks a newer API than it does. */
export const NEWER_SERVER_API_MESSAGE =
  "This server speaks a newer API than this app; update the app.";

/** What the client knows about the server it talks to. */
export interface ServerInfoView {
  /**
   * The server's versions, features, audit retention, instance notice, terms URL and limits;
   * `undefined` while loading or when it could not be read.
   */
  info: KnownServerInfo | undefined;
  /** The instance's caps; `undefined` while loading, or for a server that reports none. */
  limits: ServerLimits | undefined;
  /** The query failed: the server is down, or too old to answer it. */
  unreachable: boolean;
  /** The server speaks a newer API than this client. */
  newerApi: boolean;
}

/**
 * The connected server's versions and features, read once per session (and again after a call
 * is refused for a disabled feature); a failure only sets `unreachable`.
 *
 * @param enabled Whether to fetch it when it is not cached yet; `false` only reads the cache.
 */
export function useServerInfo(enabled = true): ServerInfoView {
  const query = useQuery({
    queryKey: queryKeys.serverInfo,
    queryFn: fetchServerInfo,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    enabled,
  });
  const info = query.data;
  return {
    info,
    limits: info?.limits,
    unreachable: query.isError,
    newerApi: info !== undefined && info.apiVersion > CLIENT_API_VERSION,
  };
}
