import { HardDrive } from "lucide-react";

import { useStorageHealthStore } from "../../core/storageHealth";
import { ExternalLink } from "../../features/auth/components/ExternalLink";

/** What to do when this app's stores cannot save on the device. */
export const STORAGE_HELP_URL =
  "https://rim-platform.org/docs/client/install.html#when-rim-cant-save-on-this-device";

/**
 * Across the top of the app for the rest of the session once one of its stores could not open or
 * write: what is lost at restart, and a link to what to do. It has no dismiss button.
 */
export function StorageHealthBanner() {
  const failed = useStorageHealthStore((s) => Object.keys(s.failures).length > 0);
  if (!failed) return null;

  return (
    <div
      role="alert"
      data-testid="storage-health-banner"
      className="flex flex-wrap items-center justify-center gap-2 bg-rim-danger/10 px-3 py-1.5 text-xs text-rim-danger"
    >
      <HardDrive className="h-3.5 w-3.5 shrink-0" />
      <span>
        RIM can't save on this device. Connected agents, drafts and assistant conversations will be
        gone after RIM restarts.
      </span>
      <ExternalLink
        href={STORAGE_HELP_URL}
        className="underline underline-offset-2 hover:text-rim-text"
      >
        What to do
      </ExternalLink>
    </div>
  );
}
