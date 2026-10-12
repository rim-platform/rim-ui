import { CalendarX } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import {
  deletionDateText,
  useAccountDeletionStatus,
  useCancelAccountDeletionMutation,
} from "../api/accountDeletion";

/** Across the top of the app while the account is scheduled for deletion, with a Cancel. */
export function AccountDeletionBanner() {
  const { scheduledFor } = useAccountDeletionStatus();
  const cancel = useCancelAccountDeletionMutation();
  if (!scheduledFor) return null;

  function handleCancel() {
    cancel.mutate(undefined, {
      onSuccess: () => toast.success("Your account will not be deleted"),
      onError: (err) => toast.error(graphqlErrorMessage(err, "Could not cancel the deletion")),
    });
  }

  return (
    <div
      role="status"
      data-testid="account-deletion-banner"
      className="flex items-center justify-center gap-2 bg-rim-danger/10 px-3 py-1.5 text-xs text-rim-danger"
    >
      <CalendarX className="h-3.5 w-3.5 shrink-0" />
      <span>Your account will be deleted on {deletionDateText(scheduledFor)}.</span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        isLoading={cancel.isPending}
        onClick={handleCancel}
      >
        Cancel deletion
      </Button>
    </div>
  );
}
