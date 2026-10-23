import { graphqlErrorMessage, isSchemaRefusal } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import { formatRelativeTime, formatTime } from "../../../shared/utils/formatTime";
import { handleDomain, personName, viewHandle } from "../../../shared/utils/handles";
import {
  joinRequestBadge,
  useAcceptJoinRequest,
  useDeclineJoinRequest,
  useJoinRequestCount,
  useJoinRequests,
  type JoinRequestRow,
} from "../api/publicJoinLink";
import { useCurrentUser } from "../api/useCurrentUser";
import { publicLinkErrorMessage } from "../publicJoinLink";

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

function requesterName(request: JoinRequestRow): string {
  return request.user ? personName(request.user, request.userId, null) : "A deleted account";
}

/**
 * Settings → Moderation → Join requests (Owner and Moderators): the workspace's open requests
 * to join through its public link, newest first, each with the person (avatar, display name,
 * handle), their message, when they asked and when the request expires, and Accept or Decline.
 * Load more follows the server's cursor; a count of the open requests sits by the title. A
 * server without join requests shows nothing.
 */
export function JoinRequestsSection({ serverId }: { serverId: string }) {
  const { data, isPending, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useJoinRequests(serverId);
  const { data: count } = useJoinRequestCount(serverId);
  const { data: me } = useCurrentUser();
  const accept = useAcceptJoinRequest();
  const decline = useDeclineJoinRequest();
  const requests = data?.pages.flatMap((page) => page.items) ?? [];
  const badge = joinRequestBadge(count);
  const ownDomain = handleDomain(me?.handle);
  // A server without join requests refuses the query itself: there is nothing to show.
  if (isError && isSchemaRefusal(error)) return null;

  function decide(request: JoinRequestRow, accepted: boolean) {
    const name = requesterName(request);
    (accepted ? accept : decline).mutate(
      { serverId, requestId: request.id },
      {
        onSuccess: () =>
          toast.success(accepted ? `${name} joined the workspace` : `Declined ${name}'s request`),
        onError: (err) =>
          toast.error(
            publicLinkErrorMessage(
              err,
              accepted ? "Could not accept the request" : "Could not decline the request",
            ),
          ),
      },
    );
  }

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-rim-text">
        Join requests
        {badge && (
          <>
            <span
              aria-hidden="true"
              className="rounded-full bg-rim-accent px-1.5 text-[10px] font-semibold text-rim-void"
            >
              {badge}
            </span>
            <span className="sr-only">{badge} open</span>
          </>
        )}
      </h3>
      <p className="mt-1 text-xs text-rim-text-faint">
        People asking to join through the workspace&apos;s public link. Newest first; a request
        expires after 30 days, and someone declined can ask again after 24 hours.
      </p>
      {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading join requests…</p>}
      {isError && (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {graphqlErrorMessage(error, "Failed to load join requests.")}
        </p>
      )}
      {data && requests.length === 0 && (
        <p className="mt-2 text-sm text-rim-text-muted">No one is waiting to join.</p>
      )}
      {requests.length > 0 && (
        <ul className="mt-2 divide-y divide-rim-line" aria-label="Join requests">
          {requests.map((request) => {
            const name = requesterName(request);
            const handle = request.user
              ? viewHandle(request.user.username, request.user.handle, ownDomain)?.shown
              : undefined;
            const busy =
              (accept.isPending && accept.variables?.requestId === request.id) ||
              (decline.isPending && decline.variables?.requestId === request.id);
            return (
              <li
                key={request.id}
                data-testid={`join-request-row-${request.id}`}
                className="flex items-start gap-3 py-2"
              >
                <Avatar
                  url={request.user?.avatarUrl}
                  name={name}
                  userId={request.userId}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-rim-text">
                    {name}
                    {handle && handle.slice(1) !== name && (
                      <span className="ml-1 text-xs text-rim-text-muted">{handle}</span>
                    )}
                  </p>
                  {request.message ? (
                    <p className="whitespace-pre-wrap break-words text-sm text-rim-text-muted">
                      {request.message}
                    </p>
                  ) : (
                    <p className="text-xs text-rim-text-faint">No message</p>
                  )}
                  <p className="text-xs text-rim-text-faint">
                    <span title={formatTime(request.createdAt)}>
                      asked {formatRelativeTime(request.createdAt)}
                    </span>
                    {" · "}
                    expires {formatTime(request.expiresAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    aria-label={`Accept ${name}`}
                    onClick={() => decide(request, true)}
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={`Decline ${name}`}
                    onClick={() => decide(request, false)}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hasNextPage && (
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            isLoading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
