import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";

/**
 * "Open log folder" under the About page's versions, on the desktop only: it runs
 * `app.open_log_folder`, which says in a toast when the folder could not be opened.
 */
export function AboutLogFolder() {
  const { platform } = useRuntime();
  if (platform !== "desktop") return null;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => void runCommandFromClick("app.open_log_folder")}
        className="text-rim-text-faint underline underline-offset-2 transition hover:text-rim-text-muted"
      >
        Open log folder
      </button>
    </div>
  );
}
