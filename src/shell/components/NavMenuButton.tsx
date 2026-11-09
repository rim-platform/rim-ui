import { Menu } from "lucide-react";

import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useShellWidth } from "../hooks/useShellWidth";
import { useShellStore } from "../state/useShellStore";

/**
 * The top bar's button that opens the navigation drawer. It renders only in a narrow window,
 * where the workspace rail and the tool panel are not beside the main area, and runs the
 * sidebar command, which opens and closes the drawer there.
 */
export function NavMenuButton() {
  const narrow = useShellWidth() === "narrow";
  const open = useShellStore((s) => s.navDrawerOpen);
  if (!narrow) return null;
  return (
    <button
      type="button"
      onClick={() => void runCommandFromClick("workspace.toggle_sidebar")}
      aria-label="Open navigation"
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Navigation"
      className="shrink-0 rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}
