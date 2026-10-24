/**
 * The keys a web session's server holds for it: the keep key of a kept session, which opens the
 * account's data key at start, and the reload key of an unkept one, which opens what a tab keeps
 * for a reload. Each is 32 bytes, unpadded base64url.
 */

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  Mutation,
  Query,
  ReloadSessionPayload,
} from "../../../core/graphql/generated/schema-types";

const SESSION_KEEP_KEY_QUERY = gql`
  query SessionKeepKey {
    sessionKeepKey
  }
`;

const SET_RELOAD_KEY_MUTATION = gql`
  mutation SetReloadKey {
    setReloadKey
  }
`;

const RELOAD_SESSION_MUTATION = gql`
  mutation ReloadSession {
    reloadSession {
      reloadKey
      nextReloadKey
    }
  }
`;

/**
 * The keep key the server holds for this session.
 *
 * @returns The key, or `null` for a session signed in without "Keep me signed in".
 */
export async function fetchSessionKeepKey(): Promise<string | null> {
  const data = await graphqlClient.request<Pick<Query, "sessionKeepKey">>(SESSION_KEEP_KEY_QUERY);
  return data.sessionKeepKey ?? null;
}

/**
 * A new reload key for this unkept session; the previous one stops opening anything.
 *
 * @returns The key.
 */
export async function setReloadKey(): Promise<string> {
  const data = await graphqlClient.request<Pick<Mutation, "setReloadKey">>(SET_RELOAD_KEY_MUTATION);
  return data.setReloadKey;
}

/**
 * After a reload, the reload key the tab's data is sealed under and the one the server holds
 * now. The server answers once, within 60 seconds of the session's WebSocket closing.
 *
 * @returns The two keys.
 */
export async function reloadSession(): Promise<ReloadSessionPayload> {
  const data =
    await graphqlClient.request<Pick<Mutation, "reloadSession">>(RELOAD_SESSION_MUTATION);
  return data.reloadSession;
}
