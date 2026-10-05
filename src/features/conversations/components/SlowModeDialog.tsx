import { useState } from "react";

import { toast } from "../../../shared/toast";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import { SLOW_MODE_OPTIONS, useSetSlowModeMutation } from "../api/useSlowMode";
import type { ConversationSummary } from "../types";
import { conversationLabel } from "../utils";

interface SlowModeDialogProps {
  workspaceId: string;
  conversation: ConversationSummary;
  onClose: () => void;
}

/** Picks a channel's slow-mode interval (Owner/Moderator; the server re-checks). */
export function SlowModeDialog({ workspaceId, conversation, onClose }: SlowModeDialogProps) {
  const current = conversation.slowModeSeconds;
  const options = SLOW_MODE_OPTIONS.some((o) => o.seconds === current)
    ? SLOW_MODE_OPTIONS
    : [...SLOW_MODE_OPTIONS, { seconds: current, label: `${current} seconds (current)` }];
  const [seconds, setSeconds] = useState(current);
  const setSlowMode = useSetSlowModeMutation();
  const label = conversationLabel(conversation);

  return (
    <ModerationDialog
      title={`Slow mode in ${label}`}
      description="Members must wait this long between two messages. Owners and moderators are exempt."
      tone="accent"
      chips={["MUTATING"]}
      confirmLabel="Save"
      confirmDisabled={seconds === current}
      errorFallback="Could not change slow mode"
      onConfirm={() =>
        setSlowMode.mutateAsync({ serverId: workspaceId, conversationId: conversation.id, seconds })
      }
      onDone={() => {
        const chosen = options.find((o) => o.seconds === seconds);
        toast.success(
          seconds === 0
            ? `Slow mode is off in ${label}`
            : `Slow mode in ${label}: ${chosen?.label ?? `${seconds} seconds`}`,
        );
        onClose();
      }}
      onClose={onClose}
    >
      <fieldset className="grid grid-cols-2 gap-1">
        <legend className="mb-1 text-xs font-medium text-rim-text">Interval</legend>
        {options.map((option) => (
          <label
            key={option.seconds}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-rim-text hover:bg-white/5"
          >
            <input
              type="radio"
              name="slow-mode"
              value={option.seconds}
              checked={seconds === option.seconds}
              onChange={() => setSeconds(option.seconds)}
              className="accent-rim-accent"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </ModerationDialog>
  );
}
