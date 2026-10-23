import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { formatRelativeTime, formatTime } from "../../../shared/utils/formatTime";
import { useMyJoinRequests, useWithdrawJoinRequestMutation } from "../api/publicLink";
import { publicLinkErrorMessage } from "../linkErrors";

/**
 * The signed-in account's open requests to join workspaces, each with its workspace, when it
 * was asked and Withdraw. Renders nothing while there are none or they cannot be read.
 */
export function MyJoinRequests() {
  const { data: requests } = useMyJoinRequests();
  const withdraw = useWithdrawJoinRequestMutation();
  if (!requests || requests.length === 0) return null;

  return (
    <section aria-labelledby="my-join-requests-heading" className="pt-2">
      <h3
        id="my-join-requests-heading"
        className="text-xs font-medium uppercase tracking-wider text-rim-text-faint"
      >
        Waiting to join
      </h3>
      <ul className="mt-1 divide-y divide-rim-line" aria-label="Your join requests">
        {requests.map((request) => (
          <li
            key={request.id}
            data-testid={`my-join-request-${request.id}`}
            className="flex items-center gap-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-rim-text">{request.workspaceName}</p>
              <p className="truncate text-xs text-rim-text-muted">
                <span title={formatTime(request.createdAt)}>
                  Asked {formatRelativeTime(request.createdAt)}
                </span>
                {" · "}
                Waiting for the moderators
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={withdraw.isPending && withdraw.variables === request.id}
              aria-label={`Withdraw your request to join ${request.workspaceName}`}
              onClick={() =>
                withdraw.mutate(request.id, {
                  onSuccess: () =>
                    toast.success(`Withdrew your request to join ${request.workspaceName}`),
                  onError: (err) =>
                    toast.error(publicLinkErrorMessage(err, "Could not withdraw the request")),
                })
              }
            >
              Withdraw
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
