import { useState } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { openBundledNotices, RELEASE_NOTICES_URL } from "../api/noticesApi";

/**
 * The About page's "Third-party licences" row: the desktop opens the notices file bundled with
 * the app, the web links to the same file attached to each release.
 */
export function AboutNotices() {
  const { platform } = useRuntime();
  const [error, setError] = useState<string | null>(null);
  const desktop = platform === "desktop";

  function open() {
    setError(null);
    openBundledNotices().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-5 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-rim-text">Third-party licences</p>
          <p className="mt-0.5 text-xs text-rim-text-muted">
            {desktop
              ? "Notices of the open-source software RIM is built on, bundled with the app."
              : "Notices of the open-source software RIM is built on. The web app's notices are the same file attached to each release."}
          </p>
        </div>
        {desktop ? (
          <Button variant="secondary" size="sm" onClick={open}>
            Open notices
          </Button>
        ) : (
          <a
            href={RELEASE_NOTICES_URL}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-rim-line bg-rim-void px-2 py-1 text-xs font-medium text-rim-text-muted transition hover:text-rim-text"
          >
            Open notices
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          The notices could not be opened: {error}
        </p>
      )}
    </div>
  );
}
