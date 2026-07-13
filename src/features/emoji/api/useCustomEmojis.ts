import { useQuery } from "@tanstack/react-query";
import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

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

export function useCustomEmojis(serverId: string | null): {
  emojis: CustomEmoji[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.customEmojis(serverId ?? undefined),
    queryFn: () =>
      graphqlClient.request<{ customEmojis: CustomEmoji[] }>(CUSTOM_EMOJIS_QUERY, { serverId }),
    enabled: !!serverId,
  });
  return { emojis: data?.customEmojis ?? [], isLoading };
}

/** Build a name → imageUrl lookup map from custom emoji list */
export function buildCustomEmojiMap(emojis: CustomEmoji[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const emoji of emojis) {
    map.set(emoji.name, emoji.imageUrl);
  }
  return map;
}
