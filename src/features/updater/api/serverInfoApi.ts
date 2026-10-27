import { GraphQLClient, gql } from "graphql-request";

import { graphqlClient, readableClientError } from "../../../core/graphql/client";
import type {
  DmInbound,
  DmOutbound,
  ServerInfo,
  ServerLimits,
} from "../../../core/graphql/generated/schema-types";

/** The major GraphQL API version this client speaks. */
export const CLIENT_API_VERSION = 1;

/**
 * What the client knows about the server: `limits` is undefined for a server older than
 * instance limits, which reports none, the `dm*` settings for one older than DM policies, and
 * `registrationFull`, `abuseContact` and `minimumAge` for one older than the account cap and
 * the operator's safety settings, and `capabilities` for one older than capabilities.
 */
export type KnownServerInfo = Omit<
  ServerInfo,
  | "capabilities"
  | "limits"
  | "dmInbound"
  | "dmOutbound"
  | "dmPartners"
  | "registrationFull"
  | "abuseContact"
  | "minimumAge"
> & {
  limits?: ServerLimits;
  dmInbound?: DmInbound;
  dmOutbound?: DmOutbound;
  dmPartners?: string[];
  registrationFull?: boolean;
  abuseContact?: string | null;
  minimumAge?: number | null;
  capabilities?: string[];
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
      dmInbound
      dmOutbound
      dmPartners
      registrationFull
      abuseContact
      minimumAge
      defaultWorkspace
      capabilities
    }
  }
`;

/** The same without `capabilities`, for a server older than them. */
const SERVER_ACCOUNT_QUERY = gql`
  query ServerInfoWithAccount {
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
      dmInbound
      dmOutbound
      dmPartners
      registrationFull
      abuseContact
      minimumAge
      defaultWorkspace
    }
  }
`;

/**
 * The same without the account cap, the safety settings and the default workspace, for a
 * server older than them.
 */
const SERVER_DM_QUERY = gql`
  query ServerInfoWithDm {
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
      dmInbound
      dmOutbound
      dmPartners
    }
  }
`;

/** The same without the DM settings, for a server older than DM policies. */
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
 * notice, terms URL, limits, DM settings, account cap, abuse contact, minimum age and default
 * workspace, and the API capabilities it lists; needs no session. Each query a server refuses
 * falls back to the next older one: one older than capabilities leaves `capabilities` undefined;
 * one older than the account cap also leaves `registrationFull`, `abuseContact`, `minimumAge` and
 * `defaultWorkspace` undefined; one older than DM policies also leaves the `dm*` settings
 * undefined; one older than instance limits also leaves `limits` undefined; one older than the instance notice also leaves `auditRetentionDays`, `instanceNotice` and `termsUrl`
 * undefined (unknown, unlike `null`: rows kept forever, no notice, no terms); one older than
 * `features` runs every feature, so it reads as listing none.
 */
export function fetchServerInfo(): Promise<KnownServerInfo> {
  return readServerInfo(graphqlClient);
}

/**
 * The same read against the server whose GraphQL endpoint is `endpoint`, without a session or
 * cookies; for checking a server before the app moves to it.
 */
export function fetchServerInfoAt(endpoint: string): Promise<KnownServerInfo> {
  return readServerInfo(new GraphQLClient(endpoint, { responseMiddleware: readableClientError }));
}

async function readServerInfo(client: GraphQLClient): Promise<KnownServerInfo> {
  for (const query of [
    SERVER_INFO_QUERY,
    SERVER_ACCOUNT_QUERY,
    SERVER_DM_QUERY,
    SERVER_LIMITS_QUERY,
    SERVER_POLICY_QUERY,
    SERVER_FEATURES_QUERY,
  ]) {
    try {
      const res = await client.request<ServerInfoResponse>(query);
      return { ...res.serverInfo, features: res.serverInfo.features ?? [] };
    } catch (err) {
      if (!refusedByServer(err)) throw err;
    }
  }
  const res = await client.request<ServerInfoResponse>(SERVER_VERSION_QUERY);
  return { ...res.serverInfo, features: [] };
}
