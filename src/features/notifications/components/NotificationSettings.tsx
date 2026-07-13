import { useNotificationSettingsStore } from "../state/useNotificationSettingsStore";
import { cn } from "../../../shared/ui/cn";

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium text-rim-text">{label}</div>
        {description && <div className="text-xs text-rim-text-muted">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-rim-accent" : "bg-rim-line",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </label>
  );
}

export function NotificationSettings() {
  const enabled = useNotificationSettingsStore((s) => s.enabled);
  const soundEnabled = useNotificationSettingsStore((s) => s.soundEnabled);
  const showPreview = useNotificationSettingsStore((s) => s.showPreview);
  const setEnabled = useNotificationSettingsStore((s) => s.setEnabled);
  const setSoundEnabled = useNotificationSettingsStore((s) => s.setSoundEnabled);
  const setShowPreview = useNotificationSettingsStore((s) => s.setShowPreview);

  return (
    <div className="space-y-1">
      <h2 className="mb-4 text-base font-semibold text-rim-text">Notifications</h2>
      <div className="divide-y divide-rim-line">
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Enable notifications"
          description="Show desktop notifications for new messages"
        />
        <Toggle
          checked={soundEnabled}
          onChange={setSoundEnabled}
          label="Sound"
          description="Play a sound with notifications"
        />
        <Toggle
          checked={showPreview}
          onChange={setShowPreview}
          label="Show message preview"
          description="Show message text in the notification, otherwise just the sender name"
        />
      </div>
    </div>
  );
}
