import {
  useNotificationSettingsStore,
  type NotificationPreview,
  type NotificationTitle,
} from "../state/useNotificationSettingsStore";
import { formatMessageNotification } from "../runtime/desktopNotification";
import { useNotificationSettings } from "../api/useNotificationSettings";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useWorkspace } from "../../workspaces/api/useWorkspace";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import { NotificationRulesForm } from "./NotificationRulesForm";
import { PauseNotificationsControl } from "./PauseNotificationsControl";

function DeviceToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium text-rim-text">{label}</div>
        <div className="text-xs text-rim-text-muted">{description}</div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

const PREVIEW_OPTIONS: { value: NotificationPreview; label: string }[] = [
  { value: "full", label: "Sender and text" },
  { value: "sender", label: "Sender only" },
  { value: "none", label: "Nothing" },
];

const TITLE_OPTIONS: { value: NotificationTitle; label: string }[] = [
  { value: "conversation", label: "Conversation" },
  { value: "sender", label: "Sender" },
  { value: "both", label: "Sender and conversation" },
];

const SAMPLE = {
  channelName: "#general",
  authorName: "Alice",
  messageText: "The deploy is done",
  encrypted: false,
};

/** A labelled drop-down row of the device settings. */
function DeviceSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  description,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium text-rim-text">{label}</span>
        <span className="block text-xs text-rim-text-muted">{description}</span>
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Device-local settings: they apply on this device only and are kept in local storage. */
function DeviceNotificationSettings() {
  const enabled = useNotificationSettingsStore((s) => s.enabled);
  const soundEnabled = useNotificationSettingsStore((s) => s.soundEnabled);
  const preview = useNotificationSettingsStore((s) => s.preview);
  const hideEncryptedText = useNotificationSettingsStore((s) => s.hideEncryptedText);
  const title = useNotificationSettingsStore((s) => s.title);
  const setEnabled = useNotificationSettingsStore((s) => s.setEnabled);
  const setSoundEnabled = useNotificationSettingsStore((s) => s.setSoundEnabled);
  const setPreview = useNotificationSettingsStore((s) => s.setPreview);
  const setHideEncryptedText = useNotificationSettingsStore((s) => s.setHideEncryptedText);
  const setTitle = useNotificationSettingsStore((s) => s.setTitle);
  const sample = formatMessageNotification(SAMPLE, { preview, hideEncryptedText, title });

  return (
    <section aria-labelledby="device-notifications-heading">
      <h3 id="device-notifications-heading" className="text-sm font-semibold text-rim-text">
        This device
      </h3>
      <p className="mt-0.5 text-xs text-rim-text-muted">
        How notifications are shown here. Other devices keep their own choices.
      </p>
      <div className="mt-2 divide-y divide-rim-line rounded-lg border border-rim-line bg-rim-panel px-4">
        <DeviceToggle
          checked={enabled}
          onChange={setEnabled}
          label="Enable notifications"
          description="Show desktop notifications on this device"
        />
        <DeviceToggle
          checked={soundEnabled}
          onChange={setSoundEnabled}
          label="Sound"
          description="Play a sound with notifications"
        />
        <DeviceSelect
          value={preview}
          onChange={setPreview}
          options={PREVIEW_OPTIONS}
          label="Message preview"
          description="What a notification shows of the message. Nothing hides the sender and the conversation too."
        />
        <DeviceSelect
          value={title}
          onChange={setTitle}
          options={TITLE_OPTIONS}
          label="Title"
          description="What the notification's title names"
          disabled={preview === "none"}
        />
        <DeviceToggle
          checked={hideEncryptedText}
          onChange={setHideEncryptedText}
          label="Hide text of encrypted messages"
          description="Show only the sender for end-to-end encrypted messages"
        />
        <div className="py-3" aria-label="Example notification" role="figure">
          <div className="text-xs text-rim-text-muted">Example</div>
          <div className="mt-1 rounded-md border border-rim-line bg-rim-void px-3 py-2">
            <div className="text-sm font-medium text-rim-text">{sample.title}</div>
            <div className="text-xs text-rim-text-muted">{sample.body}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The server-backed rules of the active workspace, plus the pause quick control. */
function WorkspaceNotificationSettings({ serverId }: { serverId: string }) {
  const { data: settings, isPending, isError, error } = useNotificationSettings(serverId);
  const { data: workspace } = useWorkspace(serverId);

  return (
    <section aria-labelledby="workspace-notifications-heading" className="space-y-4">
      <div>
        <h3 id="workspace-notifications-heading" className="text-sm font-semibold text-rim-text">
          {workspace?.name ? `Rules for ${workspace.name}` : "Rules for this workspace"}
        </h3>
        <p className="mt-0.5 text-xs text-rim-text-muted">
          Decided by the server for every device, push and email.
        </p>
      </div>
      {isPending && <p className="text-sm text-rim-text-muted">Loading notification settings…</p>}
      {isError && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {graphqlErrorMessage(error, "Failed to load notification settings.")}
        </p>
      )}
      {settings && (
        <div className="space-y-6 rounded-lg border border-rim-line bg-rim-panel p-4">
          <PauseNotificationsControl serverId={serverId} settings={settings} />
          <div className="h-px bg-rim-line" />
          <NotificationRulesForm key={serverId} serverId={serverId} settings={settings} />
        </div>
      )}
    </section>
  );
}

export function NotificationSettings() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Notifications</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          What notifies you in this workspace, and how this device shows it.
        </p>
      </div>
      {workspaceId ? (
        <WorkspaceNotificationSettings serverId={workspaceId} />
      ) : (
        <p className="text-sm text-rim-text-muted">
          Open a workspace to change its notification rules.
        </p>
      )}
      <DeviceNotificationSettings />
    </div>
  );
}
