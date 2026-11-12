import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  CreateIncomingWebhookInput,
  CreatedIncomingWebhook,
  IncomingWebhook,
  WebhookFormatInfo,
  WebhookFormatPreview,
  WebhookHeaderInput,
  WebhookPreset,
  WebhookTestDeliveries,
  WebhookTestSession,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const WEBHOOK_FORMATS_QUERY = gql`
  query WebhookFormats {
    webhookFormats {
      key
      name
      setupNote
      format
      sampleHeaders {
        name
        value
      }
      sampleBody
    }
  }
`;

const PREVIEW_QUERY = gql`
  query PreviewWebhookFormat(
    $serverId: ID!
    $template: JSON!
    $headers: [WebhookHeaderInput!]!
    $body: String!
  ) {
    previewWebhookFormat(serverId: $serverId, template: $template, headers: $headers, body: $body) {
      outcome
      rule
      text
      link
      placeholder
      reason
    }
  }
`;

const UPDATE_FORMAT_MUTATION = gql`
  mutation UpdateIncomingWebhookFormat($id: ID!, $preset: WebhookPreset!, $template: JSON) {
    updateIncomingWebhookFormat(id: $id, preset: $preset, template: $template) {
      id
      conversationId
      botUserId
      preset
      template
      createdAt
      lastUsedAt
      revokedAt
    }
  }
`;

const CREATE_WITH_FORMAT_MUTATION = gql`
  mutation CreateIncomingWebhookWithFormat($input: CreateIncomingWebhookInput!) {
    createIncomingWebhook(input: $input) {
      webhook {
        id
        conversationId
        botUserId
        preset
        template
        createdAt
        lastUsedAt
        revokedAt
      }
      token
    }
  }
`;

const CREATE_KEEPING_MUTATION = gql`
  mutation CreateIncomingWebhookKeepingTestUrl($input: CreateIncomingWebhookInput!) {
    createIncomingWebhook(input: $input) {
      webhook {
        id
        conversationId
        botUserId
        preset
        template
        createdAt
        lastUsedAt
        revokedAt
      }
      token
      keptTestUrl
    }
  }
`;

const START_SESSION_MUTATION = gql`
  mutation StartWebhookTestSession($serverId: ID!, $webhookId: ID) {
    startWebhookTestSession(serverId: $serverId, webhookId: $webhookId) {
      id
      token
      expiresAt
    }
  }
`;

const END_SESSION_MUTATION = gql`
  mutation EndWebhookTestSession($sessionId: ID!) {
    endWebhookTestSession(sessionId: $sessionId)
  }
`;

const DELIVERIES_QUERY = gql`
  query WebhookTestDeliveries($sessionId: ID!, $after: Int) {
    webhookTestDeliveries(sessionId: $sessionId, after: $after) {
      expiresAt
      deliveries {
        id
        receivedAt
        contentType
        headers {
          name
          value
        }
        bodyState
        body
      }
    }
  }
`;

/** The ready-made formats of the workspace's host, read only where it lists `webhook_formats`. */
export function useWebhookFormats(serverId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.webhookFormats(serverId),
    enabled,
    staleTime: Infinity,
    queryFn: async () =>
      (
        await graphqlClient.request<{ webhookFormats: WebhookFormatInfo[] }>(
          WEBHOOK_FORMATS_QUERY,
          { workspaceId: serverId },
        )
      ).webhookFormats,
  });
}

/** What a sample delivery would come to under `template`, as the workspace's host runs it. */
export async function previewWebhookFormat(
  serverId: string,
  template: unknown,
  headers: WebhookHeaderInput[],
  body: string,
): Promise<WebhookFormatPreview> {
  const res = await graphqlClient.request<{ previewWebhookFormat: WebhookFormatPreview }>(
    PREVIEW_QUERY,
    { serverId, template, headers, body },
  );
  return res.previewWebhookFormat;
}

/**
 * Changes how a webhook of workspace `serverId` turns a delivery into a message; its URL stays
 * the same. `workspaceId` routes the request to the workspace's host and is no variable of it.
 */
export async function updateIncomingWebhookFormat(
  serverId: string,
  id: string,
  preset: WebhookPreset,
  template: unknown,
): Promise<IncomingWebhook> {
  const res = await graphqlClient.request<{ updateIncomingWebhookFormat: IncomingWebhook }>(
    UPDATE_FORMAT_MUTATION,
    { id, preset, template, workspaceId: serverId },
  );
  return res.updateIncomingWebhookFormat;
}

/**
 * Creates a webhook with a format, and keeps a test session's URL when `input.testSessionId` is
 * set. Kept out of the caches like any answer that holds a token.
 */
export async function createIncomingWebhookWithFormat(
  input: CreateIncomingWebhookInput,
): Promise<CreatedIncomingWebhook> {
  const keeping = Boolean(input.testSessionId);
  const res = await graphqlClient.request<{ createIncomingWebhook: CreatedIncomingWebhook }>(
    keeping ? CREATE_KEEPING_MUTATION : CREATE_WITH_FORMAT_MUTATION,
    { input },
  );
  return res.createIncomingWebhook;
}

/** Opens a test session: unbound with a URL of its own, or listening on `webhookId`. */
export async function startWebhookTestSession(
  serverId: string,
  webhookId?: string,
): Promise<WebhookTestSession> {
  const res = await graphqlClient.request<{ startWebhookTestSession: WebhookTestSession }>(
    START_SESSION_MUTATION,
    { serverId, webhookId: webhookId ?? null },
  );
  return res.startWebhookTestSession;
}

/** Ends a test session of workspace `serverId` and drops what it holds. */
export async function endWebhookTestSession(serverId: string, sessionId: string): Promise<void> {
  await graphqlClient.request(END_SESSION_MUTATION, { sessionId, workspaceId: serverId });
}

/**
 * What a test session of workspace `serverId` holds after `after`, oldest first; the read
 * extends the session.
 */
export async function webhookTestDeliveries(
  serverId: string,
  sessionId: string,
  after: number,
): Promise<WebhookTestDeliveries> {
  const res = await graphqlClient.request<{ webhookTestDeliveries: WebhookTestDeliveries }>(
    DELIVERIES_QUERY,
    { sessionId, after, workspaceId: serverId },
  );
  return res.webhookTestDeliveries;
}
