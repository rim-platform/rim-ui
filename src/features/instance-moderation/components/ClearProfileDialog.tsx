import { useState } from "react";

import { toast } from "../../../shared/toast";
import { ModerationDialog, ReasonField } from "../../workspaces/components/ModerationDialog";
import { useClearProfileMutation } from "../api/instanceModeration";
import { FIELD_LABEL, MAX_REASON_LENGTH, TEXT_INPUT } from "./styles";

/** The lock lengths offered, in days; `null` leaves the profile unlocked. */
const LOCK_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: "No lock" },
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 365, label: "365 days" },
];

/**
 * Confirmation for clearing the profile of the account holding `principalId` on this server,
 * with a required reason and an optional lock. Closes through `onClose`, after a success too.
 */
export function ClearProfileDialog({
  principalId,
  onClose,
}: {
  principalId: string;
  onClose: () => void;
}) {
  const clearProfile = useClearProfileMutation();
  const [reason, setReason] = useState("");
  const [lockDays, setLockDays] = useState<number | null>(null);
  const trimmed = reason.trim();

  return (
    <ModerationDialog
      title="Clear this profile?"
      description={
        <>
          Removes the display name, picture, status and bio of{" "}
          <span className="break-all font-mono">{principalId}</span> on this server. Their own copy
          of their profile card on other servers is not changed.
        </>
      }
      tone="danger"
      confirmLabel="Clear profile"
      confirmDisabled={trimmed.length === 0 || trimmed.length > MAX_REASON_LENGTH}
      errorFallback="Could not clear the profile"
      onConfirm={() =>
        clearProfile.mutateAsync({ principalId, reason: trimmed, lockDays }).then((outcome) => {
          toast.success(
            outcome.lockedUntil
              ? `Profile cleared — locked until ${new Date(outcome.lockedUntil).toLocaleDateString()}`
              : "Profile cleared",
          );
        })
      }
      onDone={onClose}
      onClose={onClose}
    >
      <ReasonField
        id="clear-profile-reason"
        label="Reason"
        value={reason}
        onChange={setReason}
        placeholder="Written to the audit log"
      />
      {trimmed.length > MAX_REASON_LENGTH && (
        <p role="alert" className="text-xs text-rim-danger">
          The reason can be at most {MAX_REASON_LENGTH} characters.
        </p>
      )}
      <div>
        <label htmlFor="clear-profile-lock" className={FIELD_LABEL}>
          Lock
        </label>
        <select
          id="clear-profile-lock"
          value={lockDays ?? ""}
          onChange={(e) => setLockDays(e.target.value === "" ? null : Number(e.target.value))}
          className={TEXT_INPUT}
        >
          {LOCK_OPTIONS.map((option) => (
            <option key={option.label} value={option.days ?? ""}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </ModerationDialog>
  );
}
