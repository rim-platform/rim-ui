import { useInfiniteQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  PageDir,
  type ServerMemberRoleGql,
  type WorkspaceInviteCursorInput,
  type WorkspaceInviteState,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const WORKSPACE_INVITES = gql`
  query WorkspaceInvites(
    $serverId: ID!
    $dir: PageDir!
    $cursor: WorkspaceInviteCursorInput
    $limit: Int!
  ) {
    workspaceInvites(serverId: $serverId, dir: $dir, cursor: $cursor, limit: $limit) {
      items {
        id
        role
        useCount
        maxUses
        expiresAt
        createdAt
        createdById
        revokedAt
        state
        createdBy {
          id
          username
          displayName
          avatarUrl
        }
      }
      next {
        createdAt
        inviteId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
`;

/** One invite of the workspace as its owner sees it; the token is never listed. */
export interface WorkspaceInviteRow {
  id: string;
  role: ServerMemberRoleGql;
  useCount: number;
  maxUses: number;
  /** Null only for an invite stored before invites had to expire; it does not expire. */
  expiresAt: string | null;
  createdAt: string;
  createdById: string;
  revokedAt: string | null;
  state: WorkspaceInviteState;
  /** Null once the creator's account no longer exists. */
  createdBy: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
}

export interface WorkspaceInvitePage {
  items: WorkspaceInviteRow[];
  next: WorkspaceInviteCursorInput | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}

export const INVITES_PAGE_SIZE = 50;

/**
 * The workspace's invites, revoked, expired and used-up ones included, newest first; each
 * further page (`AFTER` from the last page's `next`) holds older invites. Owner only: the
 * server answers `FORBIDDEN` to anyone else, so callers pass `enabled` false for them.
 *
 * @param serverId The workspace whose invites are listed; nothing is fetched without one.
 * @param enabled Whether to fetch at all.
 */
export function useWorkspaceInvites(serverId: string | null | undefined, enabled = true) {
  const id = serverId ?? undefined;
  return useInfiniteQuery({
    queryKey: queryKeys.workspaceInvites(id),
    enabled: Boolean(id) && enabled,
    initialPageParam: null as WorkspaceInvitePage["next"],
    queryFn: async ({ pageParam }) => {
      const res = await graphqlClient.request<{ workspaceInvites: WorkspaceInvitePage }>(
        WORKSPACE_INVITES,
        {
          serverId: id!,
          dir: PageDir.AFTER,
          cursor: pageParam,
          limit: INVITES_PAGE_SIZE,
        },
      );
      return res.workspaceInvites;
    },
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasNext ? lastPage.next : null),
  });
}
