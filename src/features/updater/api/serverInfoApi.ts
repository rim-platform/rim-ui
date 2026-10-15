import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { ServerInfo, ServerLimits } from "../../../core/graphql/generated/schema-types";

/** The major GraphQL API version this client speaks. */
export const CLIENT_API_VERSION = 1;

/**
 * What the client knows about the server: `limits` is undefined for a server older than
 * instance limits, which reports none, and `signupRequiresKeys` for one older than the signup
 * policy, which takes password signups.
 */
export type KnownServerInfo = Omit<ServerInfo, "limits" | "signupRequiresKeys"> & {
  limits?: ServerLimits;
  signupRequiresKeys?: boolean;
};

const LIMITS_FIELDS = `
  limits {
    workspacesPerUser
    membersPerWorkspace
    channelsPerWorkspace
    devicesPerUser
    dmRequestsPerDay
    macrosPerWorkspace
    pipelinesPerWorkspace
    pluginsPerWorkspace
    invitesPerUserPerDay
    inviteMaxUses
    messageBytes
    probationHours
  }
`;

const SERVER_INFO_QUERY = gql`
  query ServerInfo {
    serverInfo {
      version
      apiVersion
      features {
        key
        state
        reason
      }
      auditRetentionDays
      instanceNotice
      termsUrl
      ${LIMITS_FIELDS}
      signupRequiresKeys
    }
  }
`;

/** The same without `signupRequiresKeys`, for a server older than the signup policy. */
const SERVER_LIMITS_QUERY = gql`
  query ServerInfoWithLimits {
    serverInfo {
      version
      apiVersion
      features {
        key
        state
        reason
      }
      auditRetentionDays
      instanceNotice
      termsUrl
      ${LIMITS_FIELDS}
    }
  }
`;

/** The same without `limits`, for a server older than instance limits. */
const SERVER_POLICY_QUERY = gql`
  query ServerPolicy {
    serverInfo {
      version
      apiVersion
      features {
        key
        state
        reason
      }
      auditRetentionDays
      instanceNotice
      termsUrl
    }
  }
`;

/**
 * The same without `auditRetentionDays`, `instanceNotice` and `termsUrl`, for a server older
 * than audit retention.
 */
const SERVER_FEATURES_QUERY = gql`
  query ServerFeatures {
    serverInfo {
      version
      apiVersion
      features {
        key
        state
        reason
      }
    }
  }
`;

/** The same without `features`, for a server older than feature switches. */
const SERVER_VERSION_QUERY = gql`
  query ServerVersion {
    serverInfo {
      version
      apiVersion
    }
  }
`;

interface ServerInfoResponse {
  serverInfo: KnownServerInfo;
}

/** Whether the server answered with GraphQL errors, as opposed to not answering at all. */
function refusedByServer(err: unknown): boolean {
  const errors = (err as { response?: { errors?: unknown } } | null)?.response?.errors;
  return Array.isArray(errors) && errors.length > 0;
}

/**
 * The connected server's release version, API version, features, audit retention, instance
 * notice, terms URL, limits and signup policy; needs no session. Each query a server refuses
 * falls back to the next older one. A server older than the signup policy leaves
 * `signupRequiresKeys` undefined; one older than instance limits also leaves `limits` undefined; one older than
 * the instance notice also leaves `auditRetentionDays`, `instanceNotice` and `termsUrl`
 * undefined (unknown, unlike `null`: rows kept forever, no notice, no terms); one older than
 * `features` runs every feature, so it reads as listing none.
 */
export async function fetchServerInfo(): Promise<KnownServerInfo> {
  for (const query of [
    SERVER_INFO_QUERY,
    SERVER_LIMITS_QUERY,
    SERVER_POLICY_QUERY,
    SERVER_FEATURES_QUERY,
  ]) {
    try {
      const res = await graphqlClient.request<ServerInfoResponse>(query);
      return { ...res.serverInfo, features: res.serverInfo.features ?? [] };
    } catch (err) {
      if (!refusedByServer(err)) throw err;
    }
  }
  const res = await graphqlClient.request<ServerInfoResponse>(SERVER_VERSION_QUERY);
  return { ...res.serverInfo, features: [] };
}
