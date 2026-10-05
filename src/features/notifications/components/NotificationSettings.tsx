import { useNotificationSettingsStore } from "../state/useNotificationSettingsStore";
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

/** Desktop-local toggles: they apply on this device only and are kept in local storage. */
function DeviceNotificationSettings() {
  const enabled = useNotificationSettingsStore((s) => s.enabled);
  const soundEnabled = useNotificationSettingsStore((s) => s.soundEnabled);
  const showPreview = useNotificationSettingsStore((s) => s.showPreview);
  const setEnabled = useNotificationSettingsStore((s) => s.setEnabled);
  const setSoundEnabled = useNotificationSettingsStore((s) => s.setSoundEnabled);
  const setShowPreview = useNotificationSettingsStore((s) => s.setShowPreview);

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
        <DeviceToggle
          checked={showPreview}
          onChange={setShowPreview}
          label="Show message preview"
          description="Show message text in the notification, otherwise just the sender name"
        />
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
