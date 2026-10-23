import { useState } from "react";

import { graphqlErrorMessage, isSchemaRefusal } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import { formatRelativeTime, formatTime } from "../../../shared/utils/formatTime";
import { personName } from "../../../shared/utils/handles";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import {
  joinRequestBadge,
  useAcceptJoinRequestMutation,
  useDeclineJoinRequestMutation,
  useJoinRequestCount,
  useJoinRequests,
  type JoinRequestRow,
} from "../api/publicLink";
import { publicLinkErrorMessage } from "../linkErrors";

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

function requesterName(request: JoinRequestRow): string {
  return request.user ? personName(request.user, request.userId, null) : "A deleted account";
}

/**
 * Settings → Moderation → Join requests (Owner and Moderators): the workspace's open requests
 * to join through its public link, newest first, each with the person, their message, when
 * they asked and when the request expires, and Accept or Decline (after a confirmation, as the
 * person can ask again only 24 hours later). Load more follows the server's cursor.
 */
export function JoinRequestsList({ serverId }: { serverId: string }) {
  const { data, isPending, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useJoinRequests(serverId);
  const { data: count } = useJoinRequestCount(serverId);
  const accept = useAcceptJoinRequestMutation();
  const decline = useDeclineJoinRequestMutation();
  const [declining, setDeclining] = useState<JoinRequestRow | null>(null);
  const requests = data?.pages.flatMap((page) => page.items) ?? [];
  const badge = joinRequestBadge(count);
  // A server without join requests refuses the query itself: there is nothing to show.
  if (isError && isSchemaRefusal(error)) return null;

  function handleAccept(request: JoinRequestRow) {
    accept.mutate(
      { serverId, requestId: request.id },
      {
        onSuccess: () => toast.success(`${requesterName(request)} joined the workspace`),
        onError: (err) => toast.error(publicLinkErrorMessage(err, "Could not accept the request")),
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
        expires after 30 days.
      </p>
      {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading join requests…</p>}
      {isError && (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {graphqlErrorMessage(error, "Failed to load join requests.")}
        </p>
      )}
      {data && requests.length === 0 && (
        <p className="mt-2 text-sm text-rim-text-muted">No open requests.</p>
      )}
      {requests.length > 0 && (
        <ul className="mt-2 divide-y divide-rim-line" aria-label="Join requests">
          {requests.map((request) => {
            const name = requesterName(request);
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
                  <p className="truncate text-sm text-rim-text">{name}</p>
                  {request.message ? (
                    <p className="whitespace-pre-wrap break-words text-sm text-rim-text-muted">
                      {request.message}
                    </p>
                  ) : (
                    <p className="text-xs text-rim-text-faint">No message</p>
                  )}
                  <p className="text-xs text-rim-text-faint">
                    <span title={formatTime(request.createdAt)}>
                      Asked {formatRelativeTime(request.createdAt)}
                    </span>
                    {" · "}
                    Expires {formatTime(request.expiresAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    aria-label={`Accept ${name}`}
                    onClick={() => handleAccept(request)}
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={`Decline ${name}`}
                    onClick={() => setDeclining(request)}
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
      {declining && (
        <ModerationDialog
          title={`Decline ${requesterName(declining)}?`}
          description="They are told their request was declined, and can ask to join again in 24 hours."
          tone="warm"
          chips={["MODERATOR"]}
          confirmLabel="Decline"
          errorFallback="Could not decline the request"
          onConfirm={() => decline.mutateAsync({ serverId, requestId: declining.id })}
          onDone={() => {
            toast.success(`Declined ${requesterName(declining)}'s request`);
            setDeclining(null);
          }}
          onClose={() => setDeclining(null)}
        />
      )}
    </div>
  );
}
