import { useState } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { openLogFolder } from "../api/logFolderApi";

/** "Open log folder" under the About page's versions, on the desktop only. */
export function AboutLogFolder() {
  const { platform } = useRuntime();
  const [error, setError] = useState<string | null>(null);
  if (platform !== "desktop") return null;

  function open() {
    setError(null);
    openLogFolder().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={open}
        className="text-rim-text-faint underline underline-offset-2 transition hover:text-rim-text-muted"
      >
        Open log folder
      </button>
      {error && (
        <p role="alert" className="mt-0.5 text-rim-danger">
          The log folder could not be opened: {error}
        </p>
      )}
    </div>
  );
}
