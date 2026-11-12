import { useState } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";

/**
 * "Open log folder" under the About page's versions, on the desktop only: it runs
 * `app.open_log_folder`, which says in a toast when the folder could not be opened.
 */
export function AboutLogFolder() {
  const { platform } = useRuntime();
  // Set while the folder is being opened.
  const [opening, setOpening] = useState(false);
  if (platform !== "desktop") return null;

  function open() {
    setOpening(true);
    void runCommandFromClick("app.open_log_folder").finally(() => setOpening(false));
  }

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="text-rim-text-faint underline underline-offset-2 transition hover:text-rim-text-muted"
      >
        Open log folder
      </button>
    </div>
  );
}
