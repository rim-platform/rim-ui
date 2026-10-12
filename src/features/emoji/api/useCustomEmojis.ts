import { useQuery } from "@tanstack/react-query";
import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useServerFeature } from "../../updater/hooks/useServerFeature";

export interface CustomEmoji {
  id: string;
  name: string;
  imageUrl: string;
  serverId: string;
  uploadedBy: string;
  createdAt: string;
}

const CUSTOM_EMOJIS_QUERY = `
  query CustomEmojis($serverId: ID!) {
    customEmojis(serverId: $serverId) {
      id
      name
      imageUrl
      serverId
      uploadedBy
      createdAt
    }
  }
`;

/**
 * The workspace's custom emoji; none, and no request, while the server has them switched off or
 * in a direct space, which has none.
 */
export function useCustomEmojis(serverId: string | null): {
  emojis: CustomEmoji[];
  isLoading: boolean;
} {
  const featureOn = useServerFeature("custom_emoji").enabled;
  const direct = useIsDirectSpace(serverId);
  const customEmoji = featureOn && !direct;
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.customEmojis(serverId ?? undefined),
    queryFn: () =>
      graphqlClient.request<{ customEmojis: CustomEmoji[] }>(CUSTOM_EMOJIS_QUERY, { serverId }),
    enabled: !!serverId && customEmoji,
  });
  return { emojis: customEmoji ? (data?.customEmojis ?? []) : [], isLoading };
}

/** Build a name → imageUrl lookup map from custom emoji list */
export function buildCustomEmojiMap(emojis: CustomEmoji[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const emoji of emojis) {
    map.set(emoji.name, emoji.imageUrl);
  }
  return map;
}
