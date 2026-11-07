import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  Bot,
  BotToken,
  CreateBotInput,
  CreateIncomingWebhookInput,
  CreatedBot,
  CreatedBotToken,
  CreatedIncomingWebhook,
  IncomingWebhook,
  UpdateBotInput,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { BOT_EVENTS, spaceHasCapability } from "../../updater/api/serverCapabilities";

const BOT_FIELD_NAMES = `
  userId
  serverId
  name
  runBy
  readsGoTo
  addedByName
  createdAt
  deactivatedAt
`;

const BOT_FIELDS = gql`
  fragment BotFields on Bot {
    ${BOT_FIELD_NAMES}
  }
`;

const BOT_TOKEN_FIELDS = gql`
  fragment BotTokenFields on BotToken {
    id
    label
    createdAt
    lastUsedAt
    revokedAt
  }
`;

const WEBHOOK_FIELDS = gql`
  fragment IncomingWebhookFields on IncomingWebhook {
    id
    conversationId
    botUserId
    preset
    createdAt
    lastUsedAt
    revokedAt
  }
`;

const BOTS_QUERY = gql`
  query Bots($serverId: ID!) {
    bots(serverId: $serverId) {
      ...BotFields
    }
  }
  ${BOT_FIELDS}
`;

const BOTS_WITH_JOINS_QUERY = gql`
  query BotsWithJoins($serverId: ID!) {
    bots(serverId: $serverId) {
      ${BOT_FIELD_NAMES}
      seesMemberJoins
    }
  }
`;

const BOT_TOKENS_QUERY = gql`
  query BotTokens($botUserId: ID!) {
    botTokens(botUserId: $botUserId) {
      ...BotTokenFields
    }
  }
  ${BOT_TOKEN_FIELDS}
`;

const INCOMING_WEBHOOKS_QUERY = gql`
  query IncomingWebhooks($serverId: ID!) {
    incomingWebhooks(serverId: $serverId) {
      ...IncomingWebhookFields
    }
  }
  ${WEBHOOK_FIELDS}
`;

const CREATE_BOT_MUTATION = gql`
  mutation CreateBot($input: CreateBotInput!) {
    createBot(input: $input) {
      bot {
        ...BotFields
      }
      token
    }
  }
  ${BOT_FIELDS}
`;

const UPDATE_BOT_MUTATION = gql`
  mutation UpdateBot($input: UpdateBotInput!) {
    updateBot(input: $input) {
      ...BotFields
    }
  }
  ${BOT_FIELDS}
`;

const DEACTIVATE_BOT_MUTATION = gql`
  mutation DeactivateBot($botUserId: ID!) {
    deactivateBot(botUserId: $botUserId) {
      ...BotFields
    }
  }
  ${BOT_FIELDS}
`;

const CREATE_BOT_TOKEN_MUTATION = gql`
  mutation CreateBotToken($botUserId: ID!, $label: String!) {
    createBotToken(botUserId: $botUserId, label: $label) {
      botToken {
        ...BotTokenFields
      }
      token
    }
  }
  ${BOT_TOKEN_FIELDS}
`;

const REVOKE_BOT_TOKEN_MUTATION = gql`
  mutation RevokeBotToken($tokenId: ID!) {
    revokeBotToken(tokenId: $tokenId) {
      ...BotTokenFields
    }
  }
  ${BOT_TOKEN_FIELDS}
`;

const CREATE_INCOMING_WEBHOOK_MUTATION = gql`
  mutation CreateIncomingWebhook($input: CreateIncomingWebhookInput!) {
    createIncomingWebhook(input: $input) {
      webhook {
        ...IncomingWebhookFields
      }
      token
    }
  }
  ${WEBHOOK_FIELDS}
`;

const REVOKE_INCOMING_WEBHOOK_MUTATION = gql`
  mutation RevokeIncomingWebhook($id: ID!) {
    revokeIncomingWebhook(id: $id) {
      ...IncomingWebhookFields
    }
  }
  ${WEBHOOK_FIELDS}
`;

/**
 * A workspace's bots, deactivated ones included. `seesMemberJoins` is asked for only on a host
 * that lists `bot_events`, and is missing from a bot read from any other.
 */
export function useBots(serverId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.bots(serverId ?? undefined),
    enabled: Boolean(serverId),
    queryFn: async () => {
      const document = (await spaceHasCapability(serverId!, BOT_EVENTS))
        ? BOTS_WITH_JOINS_QUERY
        : BOTS_QUERY;
      return (await graphqlClient.request<{ bots: Bot[] }>(document, { serverId })).bots;
    },
  });
}

/** A bot's tokens with when each was created, last used and revoked. */
export function useBotTokens(botUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.botTokens(botUserId),
    enabled: Boolean(botUserId),
    queryFn: async () =>
      (await graphqlClient.request<{ botTokens: BotToken[] }>(BOT_TOKENS_QUERY, { botUserId }))
        .botTokens,
  });
}

/**
 * A workspace's incoming webhooks, revoked ones included. Read only where `enabled`, which a
 * caller sets for a server that lists `incoming_webhooks`.
 */
export function useIncomingWebhooks(serverId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.incomingWebhooks(serverId ?? undefined),
    enabled: enabled && Boolean(serverId),
    queryFn: async () =>
      (
        await graphqlClient.request<{ incomingWebhooks: IncomingWebhook[] }>(
          INCOMING_WEBHOOKS_QUERY,
          { serverId },
        )
      ).incomingWebhooks,
  });
}

/**
 * Creates a bot. Not a TanStack mutation: the answer holds the bot's token, which is shown once
 * and so is never kept in the query or mutation cache.
 */
export async function createBot(input: CreateBotInput): Promise<CreatedBot> {
  const res = await graphqlClient.request<{ createBot: CreatedBot }>(CREATE_BOT_MUTATION, {
    input,
  });
  return res.createBot;
}

/** Creates a token for a bot; kept out of the caches like {@link createBot}. */
export async function createBotToken(botUserId: string, label: string): Promise<CreatedBotToken> {
  const res = await graphqlClient.request<{ createBotToken: CreatedBotToken }>(
    CREATE_BOT_TOKEN_MUTATION,
    { botUserId, label },
  );
  return res.createBotToken;
}

/** Creates a channel's incoming webhook; kept out of the caches like {@link createBot}. */
export async function createIncomingWebhook(
  input: CreateIncomingWebhookInput,
): Promise<CreatedIncomingWebhook> {
  const res = await graphqlClient.request<{ createIncomingWebhook: CreatedIncomingWebhook }>(
    CREATE_INCOMING_WEBHOOK_MUTATION,
    { input },
  );
  return res.createIncomingWebhook;
}

/** Changes a bot's name or statements. */
export function useUpdateBot(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBotInput) =>
      (await graphqlClient.request<{ updateBot: Bot }>(UPDATE_BOT_MUTATION, { input })).updateBot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.bots(serverId) });
      void qc.invalidateQueries({ queryKey: queryKeys.serverMembers(serverId) });
    },
  });
}

/** Deactivates a bot for good; its webhooks are revoked with it. */
export function useDeactivateBot(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (botUserId: string) =>
      (await graphqlClient.request<{ deactivateBot: Bot }>(DEACTIVATE_BOT_MUTATION, { botUserId }))
        .deactivateBot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.bots(serverId) });
      void qc.invalidateQueries({ queryKey: queryKeys.incomingWebhooks(serverId) });
      void qc.invalidateQueries({ queryKey: queryKeys.serverMembers(serverId) });
      void qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
    },
  });
}

/** Revokes one token of a bot. */
export function useRevokeBotToken(botUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string) =>
      (
        await graphqlClient.request<{ revokeBotToken: BotToken }>(REVOKE_BOT_TOKEN_MUTATION, {
          tokenId,
        })
      ).revokeBotToken,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.botTokens(botUserId) }),
  });
}

/** Revokes one incoming webhook. */
export function useRevokeIncomingWebhook(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await graphqlClient.request<{ revokeIncomingWebhook: IncomingWebhook }>(
          REVOKE_INCOMING_WEBHOOK_MUTATION,
          { id },
        )
      ).revokeIncomingWebhook,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.incomingWebhooks(serverId) }),
  });
}

/** Marks the lists a new bot, token or webhook changes as stale. */
export function useInvalidateBots(serverId: string) {
  const qc = useQueryClient();
  return (botUserId?: string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.bots(serverId) });
    void qc.invalidateQueries({ queryKey: queryKeys.serverMembers(serverId) });
    void qc.invalidateQueries({ queryKey: queryKeys.incomingWebhooks(serverId) });
    void qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
    if (botUserId) void qc.invalidateQueries({ queryKey: queryKeys.botTokens(botUserId) });
  };
}
