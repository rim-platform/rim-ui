import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import type { PluginInfo } from "../types";

interface UninstallPluginDialogProps {
  plugin: PluginInfo;
  /** The web build, which keeps plugins in this browser; otherwise the desktop app. */
  web: boolean;
  /** True while the uninstall runs. */
  isPending: boolean;
  /** Why the last attempt failed, if it did. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before a plugin is uninstalled, saying what goes with it. Cancel has focus;
 * Esc, the backdrop and the close button all cancel.
 */
export function UninstallPluginDialog({
  plugin,
  web,
  isPending,
  error,
  onConfirm,
  onCancel,
}: UninstallPluginDialogProps) {
  const name = plugin.display_name || plugin.plugin_id;
  return (
    <Dialog open onClose={onCancel} title={`Uninstall ${name}?`} maxWidth="max-w-md">
      <div className="space-y-3 text-xs text-rim-text-muted">
        {web ? (
          <p>
            {name} is removed from this browser for your account, with the permissions you granted
            it, the data it stored and its files.
          </p>
        ) : (
          <p>
            {name} is removed from this device, with the permissions you granted it and the data it
            stored.{" "}
            {plugin.source
              ? "Its files are deleted from the plugins folder."
              : "The app did not install it, so its folder stays in the plugins folder."}
          </p>
        )}
        <p>To use it again, install it again.</p>
        {error && (
          <p className="text-rim-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="danger" size="sm" isLoading={isPending} onClick={onConfirm}>
            Uninstall
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
