import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import {
  PageDir,
  type ConversationTypeEnum,
  type NotificationReason,
} from "../../../core/graphql/generated/schema-types";

const PAGE_SIZE = 30;

const MY_NOTIFICATIONS = gql`
  query MyNotifications(
    $serverId: ID!
    $unreadOnly: Boolean
    $dir: PageDir
    $cursor: NotificationCursorInput
    $limit: Int
  ) {
    myNotifications(
      serverId: $serverId
      unreadOnly: $unreadOnly
      dir: $dir
      cursor: $cursor
      limit: $limit
    ) {
      items {
        id
        serverId
        conversationId
        messageId
        reason
        createdAt
        readAt
        conversation {
          id
          title
          conversationType
          memberIds
        }
        message {
          id
          conversationId
          threadId
          authorId
          author {
            id
            username
            displayName
          }
          text
          isDeleted
          sentAt
        }
      }
      next {
        createdAt
        notificationId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
`;

const MY_UNREAD_NOTIFICATION_COUNT = gql`
  query MyUnreadNotificationCount($serverId: ID!) {
    myUnreadNotificationCount(serverId: $serverId)
  }
`;

const MARK_NOTIFICATIONS_READ = gql`
  mutation MarkNotificationsRead($serverId: ID!, $ids: [ID!], $allBefore: DateTime) {
    markNotificationsRead(serverId: $serverId, ids: $ids, allBefore: $allBefore)
  }
`;

export interface NotificationCursor {
  createdAt: string;
  notificationId: string;
}

/** The parts of a conversation the inbox needs to label an entry. */
export interface NotificationConversation {
  id: string;
  title: string | null;
  conversationType: ConversationTypeEnum;
  memberIds: string[];
}

export interface NotificationMessage {
  id: string;
  conversationId: string;
  threadId: string | null;
  authorId: string;
  author: { id: string; username: string; displayName: string | null } | null;
  text: string | null;
  isDeleted: boolean;
  sentAt: string;
}

/** One inbox entry. `conversation`/`message` are null once the viewer can no longer read it. */
export interface NotificationItem {
  id: string;
  serverId: string;
  conversationId: string;
  messageId: string;
  reason: NotificationReason;
  createdAt: string;
  readAt: string | null;
  conversation: NotificationConversation | null;
  message: NotificationMessage | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  next: NotificationCursor | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}

/**
 * The viewer's notification inbox, newest first. Pages walk to older entries with the `next`
 * cursor (`AFTER`), per `docs/pagination.md`.
 */
export function useNotifications(serverId: string | null | undefined, unreadOnly: boolean) {
  const ws = serverId ?? undefined;
  return useInfiniteQuery({
    queryKey: queryKeys.notifications(ws, unreadOnly),
    enabled: Boolean(ws),
    staleTime: 15_000,
    initialPageParam: null as NotificationCursor | null,
    queryFn: async ({ pageParam }) => {
      const res = await graphqlClient.request<{ myNotifications: NotificationPage }>(
        MY_NOTIFICATIONS,
        {
          serverId: ws!,
          unreadOnly,
          dir: PageDir.AFTER,
          cursor: pageParam,
          limit: PAGE_SIZE,
        },
      );
      return res.myNotifications;
    },
    getNextPageParam: (last) => (last.pageInfo.hasNext && last.next ? last.next : undefined),
  });
}

/** Unread notifications of the viewer in the workspace: the side-rail bell badge. */
export function useUnreadNotificationCount(serverId: string | null | undefined) {
  const ws = serverId ?? undefined;
  return useQuery({
    queryKey: queryKeys.unreadNotificationCount(ws),
    enabled: Boolean(ws),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await graphqlClient.request<{ myUnreadNotificationCount: number }>(
        MY_UNREAD_NOTIFICATION_COUNT,
        { serverId: ws! },
      );
      return res.myUnreadNotificationCount;
    },
  });
}

/** Refetches the bell count and every inbox list of the workspace. */
export function invalidateNotificationInbox(qc: QueryClient, serverId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.unreadNotificationCount(serverId) });
  qc.invalidateQueries({ queryKey: ["notifications", serverId] });
}

/** Refetches the bell count only (after a conversation is read, which clears its entries). */
export function invalidateUnreadNotificationCount(qc: QueryClient, serverId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.unreadNotificationCount(serverId) });
}

/** Exactly one of `ids` and `allBefore` (RFC 3339). */
export type MarkNotificationsReadVars =
  | { serverId: string; ids: string[]; allBefore?: undefined }
  | { serverId: string; allBefore: string; ids?: undefined };

function markReadInCache(qc: QueryClient, vars: MarkNotificationsReadVars, readAt: string): void {
  const cutoff = vars.allBefore ? Date.parse(vars.allBefore) : null;
  const ids = vars.ids ? new Set(vars.ids) : null;
  const matches = (item: NotificationItem) =>
    !item.readAt && (ids ? ids.has(item.id) : Date.parse(item.createdAt) <= (cutoff ?? 0));
  const changed = new Set<string>();
  for (const unreadOnly of [false, true]) {
    qc.setQueryData<InfiniteData<NotificationPage>>(
      queryKeys.notifications(vars.serverId, unreadOnly),
      (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => {
              if (!matches(item)) return item;
              changed.add(item.id);
              return { ...item, readAt };
            }),
          })),
        };
      },
    );
  }
  if (vars.allBefore) {
    qc.setQueryData<number>(queryKeys.unreadNotificationCount(vars.serverId), (old) =>
      old === undefined ? old : 0,
    );
  } else if (changed.size > 0) {
    qc.setQueryData<number>(queryKeys.unreadNotificationCount(vars.serverId), (old) =>
      old === undefined ? old : Math.max(0, old - changed.size),
    );
  }
}

/**
 * Marks notifications read: the given ids, or everything created up to `allBefore`. The inbox
 * and badge update at once and then refetch from the server either way.
 */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MarkNotificationsReadVars) => {
      const res = await graphqlClient.request<{ markNotificationsRead: number }>(
        MARK_NOTIFICATIONS_READ,
        vars.ids
          ? { serverId: vars.serverId, ids: vars.ids, allBefore: null }
          : { serverId: vars.serverId, ids: null, allBefore: vars.allBefore },
      );
      return res.markNotificationsRead;
    },
    onMutate: (vars) => {
      markReadInCache(qc, vars, new Date().toISOString());
    },
    onSettled: (_data, _err, vars) => {
      invalidateNotificationInbox(qc, vars.serverId);
    },
  });
}
