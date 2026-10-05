import { useState } from "react";
import { BellOff } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useSetDoNotDisturb, type NotificationSettingsData } from "../api/useNotificationSettings";
import { inOneHour, parseLocalDateTime, tomorrowMorning } from "../rules";

interface PauseNotificationsControlProps {
  serverId: string;
  settings: NotificationSettingsData;
}

/**
 * "Pause notifications" quick control (the manual do-not-disturb pause). Applies at once,
 * separately from the Save button: while paused, notifications still reach the inbox but
 * arrive quiet (no toast, no sound).
 */
export function PauseNotificationsControl({ serverId, settings }: PauseNotificationsControlProps) {
  const setDnd = useSetDoNotDisturb();
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function pause(paused: boolean, until: Date | null) {
    setError(null);
    setDnd.mutate(
      { serverId, paused, until: until ? until.toISOString() : null },
      {
        onSuccess: () => {
          setCustomOpen(false);
          setCustomValue("");
        },
        onError: (err) => setError(graphqlErrorMessage(err, "Could not change the pause.")),
      },
    );
  }

  function handleCustom() {
    const until = parseLocalDateTime(customValue);
    if (!until || until.getTime() <= Date.now()) {
      setError("Pick a time in the future.");
      return;
    }
    pause(true, until);
  }

  // The server keeps reporting a timed pause as on after it ends; only a live one counts.
  const paused =
    settings.dndPaused &&
    (settings.dndPausedUntil === null || Date.parse(settings.dndPausedUntil) > Date.now());
  const status = paused
    ? settings.dndPausedUntil
      ? `Paused until ${formatTime(settings.dndPausedUntil)}`
      : "Paused until you turn it back on"
    : "Not paused";

  return (
    <section aria-labelledby="pause-notifications-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h4 id="pause-notifications-heading" className="text-sm font-medium text-rim-text">
            Pause notifications
          </h4>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-rim-text-muted">
            {paused && <BellOff className="h-3 w-3 text-rim-warm" />}
            <span data-testid="pause-status">{status}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={setDnd.isPending}
          onClick={() => pause(true, inOneHour())}
        >
          For 1 hour
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={setDnd.isPending}
          onClick={() => pause(true, tomorrowMorning())}
        >
          Until tomorrow
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={setDnd.isPending}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Custom…
        </Button>
        {paused && (
          <Button
            variant="ghost"
            size="sm"
            disabled={setDnd.isPending}
            onClick={() => pause(false, null)}
          >
            Turn off pause
          </Button>
        )}
      </div>
      {customOpen && (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            aria-label="Pause until"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            className="rounded-md border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent/40"
          />
          <Button size="sm" disabled={setDnd.isPending} onClick={handleCustom}>
            Pause
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </section>
  );
}
