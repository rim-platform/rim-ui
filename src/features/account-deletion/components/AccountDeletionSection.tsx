import { useId, useState } from "react";

import {
  CONFLICT,
  FORBIDDEN,
  VALIDATION,
  graphqlErrorCode,
  graphqlErrorMessage,
} from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { useServerHost } from "../../relay/state/serverOrigin";
import {
  deletionDateText,
  useAccountDeletionStatus,
  useCancelAccountDeletionMutation,
  useRefreshDeletionStatus,
  useRequestAccountDeletionMutation,
} from "../api/accountDeletion";

interface AccountDeletionSectionProps {
  /** The signed-in account's username, which the person types again to confirm. */
  username: string;
  /** Opens Settings → Workspace, where an owned workspace is handed over or deleted. */
  onOpenWorkspaceSettings: () => void;
}

/**
 * Settings → Account → Delete account: what deleting the account does, the username typed back,
 * then the date the server schedules it for, with a Cancel while it is pending. Hidden on a
 * server without account deletion. A person whose account another server holds is sent to
 * their relay.
 */
export function AccountDeletionSection({
  username,
  onOpenWorkspaceSettings,
}: AccountDeletionSectionProps) {
  const { supported, scheduledFor } = useAccountDeletionStatus();
  const [remote, setRemote] = useState(false);
  const host = useServerHost();
  if (!supported) return null;

  return (
    <section aria-labelledby="delete-account-heading">
      <h3 id="delete-account-heading" className="mb-2 text-sm font-medium text-rim-text">
        Delete account
      </h3>
      {remote ? (
        <p data-testid="account-deletion-remote" className="text-sm text-rim-text-muted">
          Your account is held by another server, not by {host}. Manage your account at your relay:
          delete it there.
        </p>
      ) : scheduledFor ? (
        <PendingDeletion scheduledFor={scheduledFor} />
      ) : (
        <RequestDeletion
          username={username}
          host={host}
          onRemote={() => setRemote(true)}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        />
      )}
    </section>
  );
}

function PendingDeletion({ scheduledFor }: { scheduledFor: string }) {
  const cancel = useCancelAccountDeletionMutation();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setError(null);
    cancel.mutate(undefined, {
      onSuccess: () => toast.success("Your account will not be deleted"),
      onError: (err) => setError(graphqlErrorMessage(err, "Could not cancel the deletion.")),
    });
  }

  return (
    <div data-testid="account-deletion-pending" className="space-y-3">
      <p className="text-sm text-rim-text">
        Your account will be deleted on {deletionDateText(scheduledFor)}.
      </p>
      <p className="text-xs text-rim-text-muted">
        Until then it works as before. Cancel to keep it.
      </p>
      <Button type="button" variant="secondary" isLoading={cancel.isPending} onClick={handleCancel}>
        Cancel deletion
      </Button>
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function RequestDeletion({
  username,
  host,
  onRemote,
  onOpenWorkspaceSettings,
}: {
  username: string;
  host: string;
  onRemote: () => void;
  onOpenWorkspaceSettings: () => void;
}) {
  const request = useRequestAccountDeletionMutation();
  const refreshStatus = useRefreshDeletionStatus();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<{ message: string; ownsWorkspaces: boolean } | null>(null);
  const matches = typed.trim() === username;

  function handleRequest() {
    if (!matches || request.isPending) return;
    setError(null);
    request.mutate(typed.trim(), {
      onError: (err) => {
        const code = graphqlErrorCode(err);
        if (code === FORBIDDEN) {
          onRemote();
          return;
        }
        if (code === CONFLICT) void refreshStatus();
        setError({
          message: graphqlErrorMessage(err, "Could not schedule the deletion."),
          ownsWorkspaces: code === VALIDATION,
        });
      },
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-rim-danger/30 bg-rim-danger/5 p-4">
      <p className="text-sm text-rim-text">Deletes your account on {host}.</p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-rim-text-muted">
        <li>
          After a grace period the server sets, your account is deleted for good: its sessions,
          devices, keys, memberships, unencrypted messages, files and settings. Until then it works
          as before and you can cancel.
        </li>
        <li>
          Encrypted messages you sent stay, shown as from &ldquo;Deleted account&rdquo;, so
          conversations keep their history.
        </li>
        <li>Your key identity cannot be used to sign up on this server again.</li>
        <li>
          Workspaces you own that have other members must be handed over or deleted first. Ones
          where you are the only member are deleted with your account.
        </li>
        <li>Every other session of your account is signed out now; this one stays.</li>
      </ul>
      <div>
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-rim-text">
          Type your username, <span className="font-mono">{username}</span>, to confirm
        </label>
        <input
          id={inputId}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRequest();
          }}
          className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-danger"
        />
      </div>
      {error && (
        <div
          role="alert"
          className="space-y-1 rounded border border-rim-danger/40 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          <p>{error.message}</p>
          {error.ownsWorkspaces && (
            <button
              type="button"
              onClick={onOpenWorkspaceSettings}
              className="text-xs text-rim-accent hover:underline"
            >
              Open Workspace settings
            </button>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="danger"
        disabled={!matches}
        isLoading={request.isPending}
        onClick={handleRequest}
      >
        Delete account
      </Button>
    </div>
  );
}
