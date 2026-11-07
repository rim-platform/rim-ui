import { Menu } from "lucide-react";

import { useShellWidth } from "../hooks/useShellWidth";
import { useShellStore } from "../state/useShellStore";

/**
 * The top bar's button that opens the navigation drawer. It renders only in a narrow window,
 * where the workspace rail and the tool panel are not beside the main area.
 */
export function NavMenuButton() {
  const narrow = useShellWidth() === "narrow";
  const open = useShellStore((s) => s.navDrawerOpen);
  const toggle = useShellStore((s) => s.toggleNavDrawer);
  if (!narrow) return null;
  return (
    <button
      type="button"
      onClick={toggle}
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
