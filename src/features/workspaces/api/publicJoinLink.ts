import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  PageDir,
  type JoinByPublicLinkOutcome,
  type JoinRequestCursorInput,
  type JoinRequestStatus,
  type PublicJoinLinkMode,
  type PublicJoinLinkViewer,
  type ServerMemberRoleGql,
  type UpdatePublicJoinLinkInput,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const PUBLIC_JOIN_LINK_FIELDS = gql`
  fragment PublicJoinLinkFields on PublicJoinLink {
    serverId
    enabled
    mode
    role
    allowRemote
    enabledAt
    issuedAt
    token
    url
    joinsLastDay
    joinsLastWeek
    openRequests
  }
`;

const PUBLIC_JOIN_LINK = gql`
  query PublicJoinLink($serverId: ID!) {
    publicJoinLink(serverId: $serverId) {
      ...PublicJoinLinkFields
    }
  }
  ${PUBLIC_JOIN_LINK_FIELDS}
`;

const UPDATE_PUBLIC_JOIN_LINK = gql`
  mutation UpdatePublicJoinLink($input: UpdatePublicJoinLinkInput!) {
    updatePublicJoinLink(input: $input) {
      ...PublicJoinLinkFields
    }
  }
  ${PUBLIC_JOIN_LINK_FIELDS}
`;

const REISSUE_PUBLIC_JOIN_LINK = gql`
  mutation ReissuePublicJoinLink($serverId: ID!) {
    reissuePublicJoinLink(serverId: $serverId) {
      ...PublicJoinLinkFields
    }
  }
  ${PUBLIC_JOIN_LINK_FIELDS}
`;

const PUBLIC_JOIN_LINK_PREVIEW = gql`
  query PublicJoinLinkPreview($token: String!) {
    publicJoinLinkPreview(token: $token) {
      serverId
      name
      mode
      viewer
      joinRequestId
    }
  }
`;

const JOIN_REQUEST_FIELDS = gql`
  fragment JoinRequestFields on JoinRequest {
    id
    serverId
    workspaceName
    userId
    message
    status
    createdAt
    expiresAt
    user {
      id
      username
      displayName
      avatarUrl
      handle
    }
  }
`;

const JOIN_BY_PUBLIC_LINK = gql`
  mutation JoinByPublicLink($token: String!, $message: String) {
    joinByPublicLink(token: $token, message: $message) {
      outcome
      serverId
      joinRequest {
        ...JoinRequestFields
      }
    }
  }
  ${JOIN_REQUEST_FIELDS}
`;

const JOIN_REQUESTS = gql`
  query JoinRequests(
    $serverId: ID!
    $dir: PageDir!
    $cursor: JoinRequestCursorInput
    $limit: Int!
  ) {
    joinRequests(serverId: $serverId, dir: $dir, cursor: $cursor, limit: $limit) {
      items {
        ...JoinRequestFields
      }
      next {
        createdAt
        requestId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
  ${JOIN_REQUEST_FIELDS}
`;

const JOIN_REQUEST_COUNT = gql`
  query JoinRequestCount($serverId: ID!, $dir: PageDir!, $limit: Int!) {
    joinRequests(serverId: $serverId, dir: $dir, limit: $limit) {
      items {
        id
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
`;

const MY_JOIN_REQUESTS = gql`
  query MyJoinRequests {
    myJoinRequests {
      ...JoinRequestFields
    }
  }
  ${JOIN_REQUEST_FIELDS}
`;

const ACCEPT_JOIN_REQUEST = gql`
  mutation AcceptJoinRequest($serverId: ID!, $requestId: ID!) {
    acceptJoinRequest(serverId: $serverId, requestId: $requestId) {
      id
      status
    }
  }
`;

const DECLINE_JOIN_REQUEST = gql`
  mutation DeclineJoinRequest($serverId: ID!, $requestId: ID!) {
    declineJoinRequest(serverId: $serverId, requestId: $requestId) {
      id
      status
    }
  }
`;

const WITHDRAW_JOIN_REQUEST = gql`
  mutation WithdrawJoinRequest($requestId: ID!) {
    withdrawJoinRequest(requestId: $requestId) {
      id
      serverId
      status
    }
  }
`;

/** A workspace's public link as its Owner reads it. */
export interface PublicJoinLinkSettings {
  serverId: string;
  enabled: boolean;
  mode: PublicJoinLinkMode;
  /** `MEMBER` or `GUEST`: the role a person joining through the link gets. */
  role: ServerMemberRoleGql;
  /** Whether accounts from other servers may join through the link. */
  allowRemote: boolean;
  enabledAt: string | null;
  issuedAt: string | null;
  /** Null while the workspace never had a link. */
  token: string | null;
  /** `<server>/join/<token>`; null while the workspace never had a link. */
  url: string | null;
  joinsLastDay: number;
  joinsLastWeek: number;
  openRequests: number;
}

/** What a valid, switched-on link shows, and where the caller stands with its workspace. */
export interface PublicJoinLinkPreviewData {
  serverId: string;
  name: string;
  mode: PublicJoinLinkMode;
  viewer: PublicJoinLinkViewer;
  /** The caller's open request, with `REQUEST_OPEN`. */
  joinRequestId: string | null;
}

/** One join request, as moderators list it and as its person lists their own. */
export interface JoinRequestRow {
  id: string;
  serverId: string;
  workspaceName: string;
  userId: string;
  message: string | null;
  status: JoinRequestStatus;
  createdAt: string;
  expiresAt: string;
  /** Null once the person's account no longer exists. */
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    /** `@<username>:<domain>`; null when the server does not know it. */
    handle: string | null;
  } | null;
}

export interface JoinRequestPage {
  items: JoinRequestRow[];
  next: JoinRequestCursorInput | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}

/** How many open requests a workspace has; `more` when there are more than `count`. */
export interface JoinRequestCount {
  count: number;
  more: boolean;
}

export interface JoinByPublicLinkResult {
  outcome: JoinByPublicLinkOutcome;
  serverId: string;
  joinRequest: JoinRequestRow | null;
}

export const JOIN_REQUESTS_PAGE_SIZE = 50;

/** The most requests the count reads, the server's page limit. */
const JOIN_REQUEST_COUNT_LIMIT = 100;

/** The longest message a join request takes. */
export const JOIN_REQUEST_MESSAGE_MAX = 500;

/**
 * The workspace's public link, its settings and its use. Owner only: the server answers
 * `FORBIDDEN` to anyone else, so callers pass `enabled` false for them.
 *
 * @param serverId The workspace; nothing is fetched without one.
 * @param enabled Whether to fetch at all.
 */
export function usePublicJoinLink(serverId: string | null | undefined, enabled = true) {
  const id = serverId ?? undefined;
  return useQuery({
    queryKey: queryKeys.publicJoinLink(id),
    enabled: Boolean(id) && enabled,
    retry: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{ publicJoinLink: PublicJoinLinkSettings }>(
        PUBLIC_JOIN_LINK,
        { serverId: id! },
      );
      return res.publicJoinLink;
    },
  });
}

/** Changes the link's settings; the answer replaces the cached link. */
export function useUpdatePublicJoinLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePublicJoinLinkInput) => {
      const res = await graphqlClient.request<{ updatePublicJoinLink: PublicJoinLinkSettings }>(
        UPDATE_PUBLIC_JOIN_LINK,
        { input },
      );
      return res.updatePublicJoinLink;
    },
    onSuccess: (link) => qc.setQueryData(queryKeys.publicJoinLink(link.serverId), link),
  });
}

/** Issues a new token for the link, which ends the old one; the answer replaces the cached link. */
export function useReissuePublicJoinLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => {
      const res = await graphqlClient.request<{ reissuePublicJoinLink: PublicJoinLinkSettings }>(
        REISSUE_PUBLIC_JOIN_LINK,
        { serverId },
      );
      return res.reissuePublicJoinLink;
    },
    onSuccess: (link) => qc.setQueryData(queryKeys.publicJoinLink(link.serverId), link),
  });
}

/**
 * What the public link `token` shows. Needs no sign-in; `userId` is the signed-in account, or
 * null, as the answer says where that account stands. Every invalid link fails with
 * `NOT_FOUND`, and too many of them from one address with `RATE_LIMITED`, so a failure is never
 * retried and the page is not refetched on focus.
 *
 * @param token The link's token, `rim_pjl_…`.
 * @param userId The signed-in account, or null when nobody is signed in.
 * @param enabled Whether to fetch at all.
 */
export function usePublicJoinLinkPreview(token: string, userId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.publicJoinLinkPreview(token, userId),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{
        publicJoinLinkPreview: PublicJoinLinkPreviewData;
      }>(PUBLIC_JOIN_LINK_PREVIEW, { token });
      return res.publicJoinLinkPreview;
    },
  });
}

/** Refreshes what every open link page shows, after the caller's standing changed. */
function invalidatePreviews(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ["publicJoinLinkPreview"] });
}

/**
 * Puts the caller's just-filed `request` into their cached open requests, so its workspace
 * name is at hand when the request is decided.
 */
function rememberMyRequest(qc: QueryClient, request: JoinRequestRow) {
  qc.setQueryData<JoinRequestRow[]>(queryKeys.myJoinRequests(), (old) => [
    request,
    ...(old ?? []).filter((r) => r.id !== request.id),
  ]);
}

/**
 * Joins through the link, or asks to join with an optional message, as the link's mode says.
 * A join refreshes the caller's workspaces; a request goes into their open requests.
 */
export function useJoinByPublicLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { token: string; message?: string | null }) => {
      const res = await graphqlClient.request<{ joinByPublicLink: JoinByPublicLinkResult }>(
        JOIN_BY_PUBLIC_LINK,
        { token: vars.token, message: vars.message ?? null },
      );
      return res.joinByPublicLink;
    },
    // Not awaited: the caller's own callbacks open the workspace before the page refetches.
    onSuccess: (result) => {
      if (result.joinRequest) rememberMyRequest(qc, result.joinRequest);
      void qc.invalidateQueries({ queryKey: queryKeys.myServers() });
      void invalidatePreviews(qc);
    },
  });
}

/**
 * The workspace's open join requests, newest first; each further page (`AFTER` from the last
 * page's `next`) holds older ones. Owner and Moderators only.
 *
 * @param serverId The workspace; nothing is fetched without one.
 * @param enabled Whether to fetch at all.
 */
export function useJoinRequests(serverId: string | null | undefined, enabled = true) {
  const id = serverId ?? undefined;
  return useInfiniteQuery({
    queryKey: queryKeys.joinRequests(id),
    enabled: Boolean(id) && enabled,
    initialPageParam: null as JoinRequestPage["next"],
    queryFn: async ({ pageParam }) => {
      const res = await graphqlClient.request<{ joinRequests: JoinRequestPage }>(JOIN_REQUESTS, {
        serverId: id!,
        dir: PageDir.AFTER,
        cursor: pageParam,
        limit: JOIN_REQUESTS_PAGE_SIZE,
      });
      return res.joinRequests;
    },
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasNext ? lastPage.next : null),
  });
}

/**
 * How many open join requests the workspace has, for the badges: up to one server page, with
 * `more` past it. Owner and Moderators only; a server without join requests leaves it failed,
 * which shows no badge.
 *
 * @param serverId The workspace; nothing is fetched without one.
 * @param enabled Whether to fetch at all.
 */
export function useJoinRequestCount(serverId: string | null | undefined, enabled = true) {
  const id = serverId ?? undefined;
  return useQuery({
    queryKey: queryKeys.joinRequestCount(id),
    enabled: Boolean(id) && enabled,
    retry: false,
    queryFn: async (): Promise<JoinRequestCount> => {
      const res = await graphqlClient.request<{
        joinRequests: Pick<JoinRequestPage, "items" | "pageInfo">;
      }>(JOIN_REQUEST_COUNT, {
        serverId: id!,
        dir: PageDir.AFTER,
        limit: JOIN_REQUEST_COUNT_LIMIT,
      });
      return {
        count: res.joinRequests.items.length,
        more: res.joinRequests.pageInfo.hasNext,
      };
    },
  });
}

/** The badge text for `count`: the number, with `+` when there are more. */
export function joinRequestBadge(count: JoinRequestCount | undefined): string | null {
  if (!count || count.count === 0) return null;
  return count.more ? `${count.count}+` : String(count.count);
}

/** Refreshes the workspace's open requests, their count and the Owner's link statistics. */
export function invalidateJoinRequests(qc: QueryClient, serverId: string): void {
  void qc.invalidateQueries({ queryKey: queryKeys.joinRequests(serverId) });
  void qc.invalidateQueries({ queryKey: queryKeys.publicJoinLink(serverId) });
}

/** The signed-in account's own open join requests, newest first. */
export function useMyJoinRequests(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myJoinRequests(),
    enabled,
    retry: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{ myJoinRequests: JoinRequestRow[] }>(
        MY_JOIN_REQUESTS,
      );
      return res.myJoinRequests;
    },
  });
}

/** A moderator accepts an open request; the person joins with the link's current role. */
export function useAcceptJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: string; requestId: string }) =>
      graphqlClient.request<{ acceptJoinRequest: { id: string; status: JoinRequestStatus } }>(
        ACCEPT_JOIN_REQUEST,
        vars,
      ),
    onSuccess: (_data, vars) => {
      invalidateJoinRequests(qc, vars.serverId);
      void qc.invalidateQueries({ queryKey: queryKeys.serverMembers(vars.serverId) });
    },
  });
}

/** A moderator declines an open request; the person may ask again after 24 hours. */
export function useDeclineJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: string; requestId: string }) =>
      graphqlClient.request<{ declineJoinRequest: { id: string; status: JoinRequestStatus } }>(
        DECLINE_JOIN_REQUEST,
        vars,
      ),
    onSuccess: (_data, vars) => invalidateJoinRequests(qc, vars.serverId),
  });
}

/** The person takes back their own open request. */
export function useWithdrawJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      graphqlClient.request<{ withdrawJoinRequest: { id: string; serverId: string } }>(
        WITHDRAW_JOIN_REQUEST,
        { requestId },
      ),
    onSuccess: async (_data, requestId) => {
      qc.setQueryData<JoinRequestRow[]>(queryKeys.myJoinRequests(), (old) =>
        old?.filter((r) => r.id !== requestId),
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.myJoinRequests() }),
        invalidatePreviews(qc),
      ]);
    },
  });
}
