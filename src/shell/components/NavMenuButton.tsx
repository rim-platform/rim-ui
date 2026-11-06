import type { ReactNode } from "react";
import { Menu } from "lucide-react";

import { useShellWidth } from "../hooks/useShellWidth";
import { useShellStore } from "../state/useShellStore";

/**
 * The button that opens the navigation drawer. It renders only in a narrow window, where the
 * rails and the tool panel are not beside the main area.
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

/**
 * A page in a narrow window: under a slim header that carries the navigation button, for a page
 * that has none of its own. In any other window it is the page alone.
 *
 * @param title - The page's name.
 */
export function NarrowPage({ title, children }: { title: string; children: ReactNode }) {
  if (useShellWidth() !== "narrow") return <>{children}</>;
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rim-line px-3">
        <NavMenuButton />
        <span className="truncate text-sm font-medium text-rim-text">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  );
}
